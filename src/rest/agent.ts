/**
 * Agent dispatcher — single POST /api/agent endpoint that routes
 * { action, params } to internal handlers. Designed for ChatGPT Actions
 * so all 68+ tools fit in a single OpenAPI operation (no 30-op limit).
 */
import { Request, Response } from "express";
import { getStatus } from "../providers/status.js";
import {
  getQuote, getHistoricalBars, getOptionsChain, getOptionQuote,
  getStockDetails, searchSymbols, getNews, getFinancials,
  getEarnings, getRecommendations, getTrendingSymbols,
  getScreenerIds, runScreener, runScreenerWithQuotes,
} from "../providers/yahoo.js";
import { isConnected } from "../ibkr/connection.js";
import { getAccountSummary, getPositions, getPnL } from "../ibkr/account.js";
import {
  getOpenOrders, getCompletedOrders, getExecutions,
  placeOrder, placeBracketOrder, placeAdvancedBracket,
  cancelOrder, cancelAllOrders, flattenAllPositions,
} from "../ibkr/orders.js";
import { computePortfolioExposure, runPortfolioStressTest } from "../ibkr/portfolio.js";
import { setFlattenEnabled, getFlattenConfig } from "../scheduler.js";
import { getContractDetails } from "../ibkr/contracts.js";
import { getIBKRQuote, getHistoricalTicks } from "../ibkr/marketdata.js";
import { reqHistoricalNews, reqNewsArticle, reqNewsBulletins, reqNewsProviders } from "../ibkr/news.js";
import {
  calculateImpliedVolatility, calculateOptionPrice,
  reqAutoOpenOrders, reqCurrentTime, reqFundamentalDataBySymbol,
  reqHeadTimestampBySymbol, reqHistogramDataBySymbol,
  reqMarketDataType, reqMarketRule, reqMatchingSymbols,
  reqMktDepthExchanges, reqPnLSingleBySymbol, reqSmartComponents,
} from "../ibkr/data.js";
import { readMessages, postMessage, clearMessages, getStats } from "../collab/store.js";
import { getGptInstructions } from "./gpt-instructions.js";
import { checkRisk, getSessionState, recordTradeResult, lockSession, unlockSession, resetSession, getRiskGateConfig } from "../ibkr/risk-gate.js";
import { calculatePositionSize } from "../ibkr/risk.js";
import { tuneRiskParams } from "../eval/risk-tuning.js";
import { queryOrders, queryExecutions, queryJournal, insertJournalEntry, updateJournalEntry, getJournalById, upsertRiskConfig, getTraderSyncStats, getTraderSyncTrades } from "../db/database.js";
import { RISK_CONFIG_DEFAULTS, type RiskConfigParam } from "../db/schema.js";
import { importTraderSyncCSV } from "../tradersync/importer.js";
import { logger } from "../logging.js";

const log = logger.child({ module: "agent" });

// ── Action registry ──────────────────────────────────────────────

type ActionHandler = (params: Record<string, unknown>) => Promise<unknown>;

function str(p: Record<string, unknown>, key: string, fallback = ""): string {
  const v = p[key];
  return typeof v === "string" ? v : fallback;
}
function num(p: Record<string, unknown>, key: string, fallback = 0): number {
  const v = p[key];
  return typeof v === "number" ? v : fallback;
}
function bool(p: Record<string, unknown>, key: string, fallback = false): boolean {
  const v = p[key];
  return typeof v === "boolean" ? v : fallback;
}

function requireIBKR(): void {
  if (!isConnected()) throw new Error("IBKR is not connected. Start TWS/Gateway first.");
}

const KNOWN_RISK_KEYS = new Set<RiskConfigParam>(Object.keys(RISK_CONFIG_DEFAULTS) as RiskConfigParam[]);

const actions: Record<string, ActionHandler> = {
  // ── System ──
  get_status: async () => getStatus(),
  get_gpt_instructions: async () => ({ instructions: getGptInstructions() }),

  // ── Market Data (Yahoo — always available) ──
  get_quote: async (p) => getQuote(str(p, "symbol")),
  get_historical_bars: async (p) => getHistoricalBars(str(p, "symbol"), str(p, "period", "3mo"), str(p, "interval", "1d")),
  get_stock_details: async (p) => getStockDetails(str(p, "symbol")),
  get_options_chain: async (p) => getOptionsChain(str(p, "symbol"), str(p, "expiration")),
  get_option_quote: async (p) => getOptionQuote(str(p, "symbol"), str(p, "expiry"), num(p, "strike"), str(p, "right") as "C" | "P"),
  search_symbols: async (p) => searchSymbols(str(p, "query")),
  get_news: async (p) => getNews(str(p, "query")),
  get_financials: async (p) => getFinancials(str(p, "symbol")),
  get_earnings: async (p) => getEarnings(str(p, "symbol")),
  get_recommendations: async (p) => getRecommendations(str(p, "symbol")),
  get_trending: async (p) => getTrendingSymbols(str(p, "region", "US")),
  get_screener_filters: async () => getScreenerIds(),
  run_screener: async (p) => runScreener(str(p, "screener_id", "day_gainers"), num(p, "count", 20)),
  run_screener_with_quotes: async (p) => runScreenerWithQuotes(str(p, "screener_id", "day_gainers"), num(p, "count", 20)),

  // ── IBKR Market Data ──
  get_ibkr_quote: async (p) => { requireIBKR(); return getIBKRQuote({ symbol: str(p, "symbol"), secType: str(p, "secType", "STK"), exchange: str(p, "exchange", "SMART"), currency: str(p, "currency", "USD") }); },
  get_historical_ticks: async (p) => { requireIBKR(); return getHistoricalTicks(str(p, "symbol"), str(p, "startTime"), str(p, "endTime", ""), str(p, "type", "TRADES") as "TRADES" | "BID_ASK" | "MIDPOINT", num(p, "count", 1000)); },
  get_contract_details: async (p) => { requireIBKR(); return getContractDetails({ symbol: str(p, "symbol"), secType: str(p, "secType", "STK"), currency: str(p, "currency", "USD"), exchange: str(p, "exchange", "SMART") }); },

  // ── IBKR News ──
  get_news_providers: async () => { requireIBKR(); return reqNewsProviders(); },
  get_news_article: async (p) => { requireIBKR(); return reqNewsArticle(str(p, "providerCode"), str(p, "articleId")); },
  get_historical_news: async (p) => { requireIBKR(); return reqHistoricalNews(num(p, "conId"), str(p, "providerCodes"), str(p, "startDateTime"), str(p, "endDateTime")); },
  get_news_bulletins: async () => { requireIBKR(); return reqNewsBulletins(); },

  // ── IBKR Data Wrappers ──
  get_pnl_single: async (p) => { requireIBKR(); return reqPnLSingleBySymbol(str(p, "symbol")); },
  search_ibkr_symbols: async (p) => { requireIBKR(); return reqMatchingSymbols(str(p, "pattern")); },
  set_market_data_type: async (p) => { requireIBKR(); return reqMarketDataType(num(p, "marketDataType", 1)); },
  set_auto_open_orders: async (p) => { requireIBKR(); return reqAutoOpenOrders(bool(p, "autoBind", true)); },
  get_head_timestamp: async (p) => { requireIBKR(); return reqHeadTimestampBySymbol({ symbol: str(p, "symbol"), whatToShow: str(p, "whatToShow", "TRADES") as "TRADES" | "MIDPOINT" | "BID" | "ASK", useRTH: bool(p, "useRTH", true), formatDate: (num(p, "formatDate", 1) as 1 | 2) }); },
  get_histogram_data: async (p) => { requireIBKR(); return reqHistogramDataBySymbol({ symbol: str(p, "symbol"), useRTH: bool(p, "useRTH", true), period: num(p, "period", 1), periodUnit: str(p, "periodUnit", "W") as "S" | "D" | "W" | "M" | "Y" }); },
  calculate_implied_volatility: async (p) => { requireIBKR(); return calculateImpliedVolatility({ symbol: str(p, "symbol"), expiry: str(p, "expiry"), strike: num(p, "strike"), right: str(p, "right") as "C" | "P", optionPrice: num(p, "optionPrice"), underlyingPrice: num(p, "underlyingPrice") }); },
  calculate_option_price: async (p) => { requireIBKR(); return calculateOptionPrice({ symbol: str(p, "symbol"), expiry: str(p, "expiry"), strike: num(p, "strike"), right: str(p, "right") as "C" | "P", volatility: num(p, "volatility"), underlyingPrice: num(p, "underlyingPrice") }); },
  get_tws_current_time: async () => { requireIBKR(); return reqCurrentTime(); },
  get_market_rule: async (p) => { requireIBKR(); return reqMarketRule(num(p, "ruleId")); },
  get_smart_components: async (p) => { requireIBKR(); return reqSmartComponents(str(p, "exchange")); },
  get_depth_exchanges: async () => { requireIBKR(); return reqMktDepthExchanges(); },
  get_fundamental_data: async (p) => { requireIBKR(); return reqFundamentalDataBySymbol({ symbol: str(p, "symbol"), reportType: str(p, "reportType", "ReportSnapshot") }); },

  // ── Account ──
  get_account_summary: async () => { requireIBKR(); return getAccountSummary(); },
  get_positions: async () => { requireIBKR(); return getPositions(); },
  get_pnl: async () => { requireIBKR(); return getPnL(); },

  // ── Orders ──
  get_open_orders: async () => { requireIBKR(); return getOpenOrders(); },
  get_completed_orders: async () => { requireIBKR(); return getCompletedOrders(); },
  get_executions: async () => { requireIBKR(); return getExecutions(); },
  place_order: async (p) => { requireIBKR(); return placeOrder(p as never); },
  place_bracket_order: async (p) => { requireIBKR(); return placeBracketOrder(p as never); },
  place_advanced_bracket: async (p) => { requireIBKR(); return placeAdvancedBracket(p as never); },
  cancel_order: async (p) => { requireIBKR(); return cancelOrder(num(p, "orderId")); },
  cancel_all_orders: async () => { requireIBKR(); return cancelAllOrders(); },
  flatten_positions: async () => { requireIBKR(); return flattenAllPositions(); },

  // ── Portfolio Analytics ──
  portfolio_exposure: async () => { requireIBKR(); return computePortfolioExposure(); },
  stress_test: async (p) => { requireIBKR(); return runPortfolioStressTest(num(p, "shockPercent", -10), bool(p, "betaAdjusted", true)); },
  size_position: async (p) => { requireIBKR(); return calculatePositionSize({ symbol: str(p, "symbol"), entryPrice: num(p, "entryPrice"), stopPrice: num(p, "stopPrice"), riskPercent: num(p, "riskPercent", 1), maxCapitalPercent: num(p, "maxCapitalPercent", 25) }); },

  // ── Risk / Session ──
  get_risk_config: async () => getRiskGateConfig(),
  tune_risk_params: async () => {
    const tuning = tuneRiskParams();
    return { tuning, config: getRiskGateConfig() };
  },
  update_risk_config: async (p) => {
    const source = str(p, "source", "manual");
    const entries: Array<{ param: RiskConfigParam; value: number; source: string }> = Object.entries(p)
      .filter((entry): entry is [RiskConfigParam, number] => {
        const [key, value] = entry;
        return KNOWN_RISK_KEYS.has(key as RiskConfigParam) && typeof value === "number" && Number.isFinite(value);
      })
      .map(([param, value]) => ({ param, value, source }));

    if (entries.length === 0) {
      return { updated: 0, config: getRiskGateConfig() };
    }

    upsertRiskConfig(entries);
    return { updated: entries.length, config: getRiskGateConfig() };
  },
  get_session_state: async () => getSessionState(),
  session_record_trade: async (p) => recordTradeResult(num(p, "realizedPnl")),
  session_lock: async (p) => { lockSession(str(p, "reason", "manual")); return { locked: true }; },
  session_unlock: async () => unlockSession(),
  session_reset: async () => resetSession(),

  // ── Flatten Config ──
  get_flatten_config: async () => getFlattenConfig(),
  set_flatten_enabled: async (p) => { setFlattenEnabled(bool(p, "enabled")); return { enabled: bool(p, "enabled") }; },

  // ── Collaboration ──
  collab_read: async (p) => readMessages({ limit: num(p, "limit", 50), author: (str(p, "author") || undefined) as "claude" | "chatgpt" | "user" | undefined, tag: str(p, "tag") || undefined, since: str(p, "since") || undefined }),
  collab_post: async (p) => postMessage({ author: "chatgpt", content: str(p, "content"), tags: p.tags as string[] | undefined, replyTo: str(p, "replyTo") || undefined }),
  collab_clear: async () => clearMessages(),
  collab_stats: async () => getStats(),

  // ── Trade Journal ──
  journal_read: async (p) => queryJournal({ symbol: str(p, "symbol") || undefined, strategy: str(p, "strategy") || undefined, limit: num(p, "limit", 100) }),
  journal_create: async (p) => insertJournalEntry(p as never),
  journal_get: async (p) => getJournalById(num(p, "id")),
  journal_update: async (p) => updateJournalEntry(num(p, "id"), p as never),

  // ── History ──
  orders_history: async (p) => queryOrders({ symbol: str(p, "symbol") || undefined, strategy: str(p, "strategy") || undefined, limit: num(p, "limit", 100) }),
  executions_history: async (p) => queryExecutions({ symbol: str(p, "symbol") || undefined, limit: num(p, "limit", 100) }),

  // ── TraderSync ──
  tradersync_import: async (p) => {
    const csv = str(p, "csv");
    if (!csv) {
      throw new Error("csv is required");
    }
    return importTraderSyncCSV(csv);
  },
  tradersync_stats: async () => getTraderSyncStats(),
  tradersync_trades: async (p) => getTraderSyncTrades({
    symbol: str(p, "symbol") || undefined,
    side: str(p, "side") || undefined,
    status: str(p, "status") || undefined,
    days: p.days !== undefined ? num(p, "days") : undefined,
    limit: p.limit !== undefined ? num(p, "limit") : undefined,
  }),
};

// ── Dispatcher ───────────────────────────────────────────────────

export async function handleAgentRequest(req: Request, res: Response): Promise<void> {
  const { action, params = {} } = req.body as { action?: string; params?: Record<string, unknown> };

  if (!action || typeof action !== "string") {
    res.status(400).json({ error: "Missing 'action' string. Call get_status to see available actions." });
    return;
  }

  const handler = actions[action];
  if (!handler) {
    res.status(400).json({
      error: `Unknown action: '${action}'`,
      available_actions: Object.keys(actions),
    });
    return;
  }

  try {
    log.info({ action, params }, "agent dispatch");
    const result = await handler(params);
    res.json({ action, result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn({ action, params, error: message }, "agent action failed");
    res.status(500).json({ action, error: message });
  }
}

/** List all registered action names (for the OpenAPI spec description) */
export function getActionList(): string[] {
  return Object.keys(actions);
}
