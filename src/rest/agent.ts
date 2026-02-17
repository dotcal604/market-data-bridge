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
  modifyOrder, cancelOrder, cancelAllOrders, flattenAllPositions,
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
import { computeDriftReport } from "../eval/drift.js";
import { checkDriftAlerts, getRecentDriftAlerts } from "../eval/drift-alerts.js";
import { computeEnsembleWithWeights } from "../eval/ensemble/scorer.js";
import { getWeights } from "../eval/ensemble/weights.js";
import type { ModelEvaluation } from "../eval/models/types.js";
import {
  queryOrders,
  queryExecutions,
  queryJournal,
  insertJournalEntry,
  updateJournalEntry,
  getJournalById,
  upsertRiskConfig,
  getEvaluationById,
  insertOutcome,
  getEvalsForSimulation,
  getTraderSyncStats,
  getTraderSyncTrades,
} from "../db/database.js";
import { RISK_CONFIG_DEFAULTS, type RiskConfigParam } from "../db/schema.js";
import { importTraderSyncCSV } from "../tradersync/importer.js";
import { logger } from "../logging.js";
import {
  subscribeRealTimeBars, unsubscribeRealTimeBars, getRealTimeBars,
  subscribeAccountUpdates, unsubscribeAccountUpdates, getAccountSnapshot,
  getScannerParameters, listSubscriptions,
} from "../ibkr/subscriptions.js";
import { importHollyAlerts } from "../holly/importer.js";
import { isAutoEvalEnabled, setAutoEvalEnabled, getAutoEvalStatus } from "../holly/auto-eval.js";
import { queryHollyAlerts, getHollyAlertStats, getLatestHollySymbols, querySignals, getSignalStats } from "../db/database.js";

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
const VALID_DECISION_TYPES = new Set(["took_trade", "passed_setup", "ensemble_no", "risk_gate_blocked"]);

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
  modify_order: async (p) => { requireIBKR(); return modifyOrder({ orderId: num(p, "orderId"), lmtPrice: p.lmtPrice != null ? Number(p.lmtPrice) : undefined, auxPrice: p.auxPrice != null ? Number(p.auxPrice) : undefined, totalQuantity: p.totalQuantity != null ? Number(p.totalQuantity) : undefined, orderType: typeof p.orderType === "string" ? p.orderType : undefined, tif: typeof p.tif === "string" ? p.tif : undefined }); },
  cancel_order: async (p) => { requireIBKR(); return cancelOrder(num(p, "orderId")); },
  cancel_all_orders: async () => { requireIBKR(); return cancelAllOrders(); },
  flatten_positions: async () => { requireIBKR(); return flattenAllPositions(); },

  // ── Portfolio Analytics ──
  portfolio_exposure: async () => { requireIBKR(); return computePortfolioExposure(); },
  stress_test: async (p) => { requireIBKR(); return runPortfolioStressTest(num(p, "shockPercent", -10), bool(p, "betaAdjusted", true)); },
  size_position: async (p) => { requireIBKR(); return calculatePositionSize({ symbol: str(p, "symbol"), entryPrice: num(p, "entryPrice"), stopPrice: num(p, "stopPrice"), riskPercent: num(p, "riskPercent", 1), maxCapitalPercent: num(p, "maxCapitalPercent", 25), volatilityRegime: typeof p.volatilityRegime === "string" ? p.volatilityRegime : undefined }); },

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

  // ── Evaluation ──
  record_outcome: async (p) => {
    const evaluation_id = str(p, "evaluation_id");
    if (!evaluation_id) {
      throw new Error("evaluation_id is required");
    }

    const decision_type = p.decision_type;
    if (decision_type != null) {
      if (typeof decision_type !== "string" || !VALID_DECISION_TYPES.has(decision_type)) {
        throw new Error("decision_type must be one of: took_trade, passed_setup, ensemble_no, risk_gate_blocked");
      }
    }

    const confidence_rating = p.confidence_rating;
    if (confidence_rating != null && (typeof confidence_rating !== "number" || confidence_rating < 1 || confidence_rating > 3)) {
      throw new Error("confidence_rating must be 1 (low), 2 (medium), or 3 (high)");
    }

    const existing = getEvaluationById(evaluation_id);
    if (!existing) {
      throw new Error(`Evaluation ${evaluation_id} not found`);
    }

    insertOutcome({
      evaluation_id,
      trade_taken: bool(p, "trade_taken") ? 1 : 0,
      decision_type: decision_type ?? null,
      confidence_rating: confidence_rating ?? null,
      rule_followed: p.rule_followed == null ? null : bool(p, "rule_followed") ? 1 : 0,
      setup_type: str(p, "setup_type") || null,
      actual_entry_price: typeof p.actual_entry_price === "number" ? p.actual_entry_price : null,
      actual_exit_price: typeof p.actual_exit_price === "number" ? p.actual_exit_price : null,
      r_multiple: typeof p.r_multiple === "number" ? p.r_multiple : null,
      exit_reason: str(p, "exit_reason") || null,
      notes: str(p, "notes") || null,
    });

    return { success: true, evaluation_id };
  },
  simulate_weights: async (p) => {
    if (typeof p.claude !== "number" || typeof p.gpt4o !== "number" || typeof p.gemini !== "number") {
      throw new Error("claude, gpt4o, and gemini weights are required (numbers)");
    }

    const claude = p.claude;
    const gpt4o = p.gpt4o;
    const gemini = p.gemini;
    if (claude < 0 || gpt4o < 0 || gemini < 0) {
      throw new Error("Weights must be non-negative");
    }

    const currentWeights = getWeights();
    const simWeights = {
      claude,
      gpt4o,
      gemini,
      k: typeof p.k === "number" && p.k >= 0 ? p.k : currentWeights.k,
    };
    const rows = getEvalsForSimulation({
      days: typeof p.days === "number" ? p.days : 90,
      symbol: str(p, "symbol") || undefined,
    });

    let currentScoreSum = 0;
    let simScoreSum = 0;
    for (const row of rows) {
      const modelEvals: ModelEvaluation[] = row.model_outputs.map((mo) => ({
        model_id: mo.model_id as ModelEvaluation["model_id"],
        output: mo.compliant && mo.trade_score != null
          ? {
            trade_score: mo.trade_score,
            extension_risk: 0,
            exhaustion_risk: 0,
            float_rotation_risk: 0,
            market_alignment: 0,
            expected_rr: mo.expected_rr ?? 0,
            confidence: mo.confidence ?? 0,
            should_trade: mo.should_trade === 1,
            reasoning: "",
          }
          : null,
        raw_response: "",
        latency_ms: 0,
        error: null,
        compliant: mo.compliant === 1,
        model_version: "",
        prompt_hash: "",
        token_count: 0,
        api_response_id: "",
        timestamp: row.timestamp,
      }));

      const currentResult = computeEnsembleWithWeights(modelEvals, currentWeights);
      const simResult = computeEnsembleWithWeights(modelEvals, simWeights);
      currentScoreSum += currentResult.trade_score;
      simScoreSum += simResult.trade_score;
    }

    return {
      simulated_weights: simWeights,
      evaluations_count: rows.length,
      average_score_delta: rows.length > 0 ? Math.round(((simScoreSum - currentScoreSum) / rows.length) * 100) / 100 : 0,
    };
  },

  drift_report: async () => computeDriftReport(),
  drift_check: async () => {
    const report = computeDriftReport();
    const alerts = checkDriftAlerts(report);
    return { report, alerts };
  },
  drift_alerts: async (p) => {
    const alerts = getRecentDriftAlerts(num(p, "limit", 50));
    return { count: alerts.length, alerts };
  },

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
  tradersync_import: async (p) => {
    const csv = str(p, "csv");
    if (!csv) throw new Error("csv is required");
    return importTraderSyncCSV(csv);
  },
  tradersync_stats: async () => getTraderSyncStats(),
  tradersync_trades: async (p) => {
    const trades = getTraderSyncTrades({
      symbol: str(p, "symbol") || undefined,
      side: str(p, "side") || undefined,
      status: str(p, "status") || undefined,
      days: num(p, "days") || undefined,
      limit: num(p, "limit") || undefined,
    });
    return { count: trades.length, trades };
  },

  // ── History ──
  orders_history: async (p) => queryOrders({ symbol: str(p, "symbol") || undefined, strategy: str(p, "strategy") || undefined, limit: num(p, "limit", 100) }),
  executions_history: async (p) => queryExecutions({ symbol: str(p, "symbol") || undefined, limit: num(p, "limit", 100) }),

  // ── Subscriptions (streaming) ──
  subscribe_real_time_bars: async (p) => { requireIBKR(); return subscribeRealTimeBars({ symbol: str(p, "symbol"), secType: str(p, "secType", "STK"), exchange: str(p, "exchange", "SMART"), currency: str(p, "currency", "USD"), whatToShow: str(p, "whatToShow", "TRADES"), useRTH: bool(p, "useRTH", true) }); },
  unsubscribe_real_time_bars: async (p) => { requireIBKR(); return { removed: unsubscribeRealTimeBars(str(p, "subscriptionId")) }; },
  get_real_time_bars: async (p) => { const limit = Math.min(num(p, "limit", 60), 300); const bars = getRealTimeBars(str(p, "subscriptionId"), limit); return { subscriptionId: str(p, "subscriptionId"), count: bars.length, bars }; },
  subscribe_account_updates: async (p) => { requireIBKR(); return subscribeAccountUpdates(str(p, "account")); },
  unsubscribe_account_updates: async () => { requireIBKR(); return { removed: unsubscribeAccountUpdates() }; },
  get_account_snapshot_stream: async () => { const snapshot = getAccountSnapshot(); if (!snapshot) throw new Error("No active account updates subscription"); return snapshot; },
  get_scanner_parameters: async () => { requireIBKR(); return { xml: await getScannerParameters() }; },
  list_subscriptions: async () => { const subs = listSubscriptions(); return { count: subs.length, subscriptions: subs }; },

  // ── Holly AI Alerts ──
  holly_import: async (p) => { const csv = str(p, "csv"); if (!csv) throw new Error("csv is required"); return importHollyAlerts(csv); },
  holly_alerts: async (p) => { const alerts = queryHollyAlerts({ symbol: str(p, "symbol") || undefined, strategy: str(p, "strategy") || undefined, limit: num(p, "limit", 100), since: str(p, "since") || undefined }); return { count: alerts.length, alerts }; },
  holly_stats: async () => getHollyAlertStats(),
  holly_symbols: async (p) => { const symbols = getLatestHollySymbols(num(p, "limit", 20)); return { count: symbols.length, symbols }; },

  // ── Signals / Auto-Eval ──
  signal_feed: async (p) => {
    const signals = querySignals({ symbol: str(p, "symbol") || undefined, direction: str(p, "direction") || undefined, limit: num(p, "limit", 50), since: str(p, "since") || undefined });
    return { count: signals.length, signals };
  },
  signal_stats: async () => getSignalStats(),
  auto_eval_status: async () => getAutoEvalStatus(),
  auto_eval_toggle: async (p) => {
    const enabled = bool(p, "enabled");
    setAutoEvalEnabled(enabled);
    return getAutoEvalStatus();
  },
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

// ── Action Catalog Metadata ─────────────────────────────────────

interface ActionMeta {
  description: string;
  params?: string[];
  requiresIBKR?: boolean;
}

export const actionsMeta: Record<string, ActionMeta> = {
  // System
  get_status: { description: "Get system status, market session, and IBKR connection state" },
  get_gpt_instructions: { description: "Get GPT system instructions" },

  // Market Data (Yahoo — always available)
  get_quote: { description: "Get real-time quote for a symbol", params: ["symbol"] },
  get_historical_bars: { description: "Get historical price bars", params: ["symbol", "period?", "interval?"] },
  get_stock_details: { description: "Get stock details (sector, industry, description, market cap)", params: ["symbol"] },
  get_options_chain: { description: "Get options chain for a symbol", params: ["symbol", "expiration?"] },
  get_option_quote: { description: "Get quote for a specific option contract", params: ["symbol", "expiry", "strike", "right"] },
  search_symbols: { description: "Search for symbols by query string", params: ["query"] },
  get_news: { description: "Get news articles for a query", params: ["query"] },
  get_financials: { description: "Get financial data (revenue, margins, debt, analyst targets)", params: ["symbol"] },
  get_earnings: { description: "Get earnings history (actual vs estimate)", params: ["symbol"] },
  get_recommendations: { description: "Get analyst recommendations", params: ["symbol"] },
  get_trending: { description: "Get trending symbols by region", params: ["region?"] },
  get_screener_filters: { description: "Get list of available screener IDs" },
  run_screener: { description: "Run a stock screener", params: ["screener_id?", "count?"] },
  run_screener_with_quotes: { description: "Run a stock screener with full quote data", params: ["screener_id?", "count?"] },

  // IBKR Market Data
  get_ibkr_quote: { description: "Get IBKR real-time quote", params: ["symbol", "secType?", "exchange?", "currency?"], requiresIBKR: true },
  get_historical_ticks: { description: "Get historical tick data", params: ["symbol", "startTime", "endTime?", "type?", "count?"], requiresIBKR: true },
  get_contract_details: { description: "Get contract details from IBKR", params: ["symbol", "secType?", "currency?", "exchange?"], requiresIBKR: true },

  // IBKR News
  get_news_providers: { description: "Get list of IBKR news providers", requiresIBKR: true },
  get_news_article: { description: "Get specific news article from IBKR", params: ["providerCode", "articleId"], requiresIBKR: true },
  get_historical_news: { description: "Get historical news from IBKR", params: ["conId", "providerCodes", "startDateTime", "endDateTime"], requiresIBKR: true },
  get_news_bulletins: { description: "Get IBKR news bulletins", requiresIBKR: true },

  // IBKR Data Wrappers
  get_pnl_single: { description: "Get P&L for a single position", params: ["symbol"], requiresIBKR: true },
  search_ibkr_symbols: { description: "Search for symbols using IBKR", params: ["pattern"], requiresIBKR: true },
  set_market_data_type: { description: "Set market data type (live, frozen, delayed)", params: ["marketDataType"], requiresIBKR: true },
  set_auto_open_orders: { description: "Enable/disable auto-binding of open orders", params: ["autoBind?"], requiresIBKR: true },
  get_head_timestamp: { description: "Get earliest available data timestamp", params: ["symbol", "whatToShow?", "useRTH?", "formatDate?"], requiresIBKR: true },
  get_histogram_data: { description: "Get histogram data for a symbol", params: ["symbol", "useRTH?", "period?", "periodUnit?"], requiresIBKR: true },
  calculate_implied_volatility: { description: "Calculate implied volatility for an option", params: ["symbol", "expiry", "strike", "right", "optionPrice", "underlyingPrice"], requiresIBKR: true },
  calculate_option_price: { description: "Calculate theoretical option price", params: ["symbol", "expiry", "strike", "right", "volatility", "underlyingPrice"], requiresIBKR: true },
  get_tws_current_time: { description: "Get current time from TWS server", requiresIBKR: true },
  get_market_rule: { description: "Get market rule by rule ID", params: ["ruleId"], requiresIBKR: true },
  get_smart_components: { description: "Get smart routing components for an exchange", params: ["exchange"], requiresIBKR: true },
  get_depth_exchanges: { description: "Get list of exchanges that support market depth", requiresIBKR: true },
  get_fundamental_data: { description: "Get fundamental data from IBKR", params: ["symbol", "reportType?"], requiresIBKR: true },

  // Account
  get_account_summary: { description: "Get account summary (buying power, cash, equity)", requiresIBKR: true },
  get_positions: { description: "Get all open positions", requiresIBKR: true },
  get_pnl: { description: "Get overall P&L", requiresIBKR: true },

  // Orders
  get_open_orders: { description: "Get all open orders", requiresIBKR: true },
  get_completed_orders: { description: "Get completed orders", requiresIBKR: true },
  get_executions: { description: "Get recent executions", requiresIBKR: true },
  place_order: { description: "Place a single order", params: ["symbol", "action", "orderType", "totalQuantity", "lmtPrice?", "auxPrice?", "secType?", "exchange?", "currency?", "tif?"], requiresIBKR: true },
  place_bracket_order: { description: "Place a bracket order (entry + TP + SL)", params: ["symbol", "action", "totalQuantity", "entryType", "entryPrice?", "takeProfitPrice", "stopLossPrice", "secType?", "tif?"], requiresIBKR: true },
  place_advanced_bracket: { description: "Place an advanced bracket order with full control", params: ["symbol", "action", "totalQuantity", "entry", "takeProfit", "stopLoss", "outsideRth?", "ocaType?", "trailingAmount?", "trailingPercent?"], requiresIBKR: true },
  modify_order: { description: "Modify an existing open order", params: ["orderId", "lmtPrice?", "auxPrice?", "totalQuantity?", "orderType?", "tif?"], requiresIBKR: true },
  cancel_order: { description: "Cancel a specific order", params: ["orderId"], requiresIBKR: true },
  cancel_all_orders: { description: "Cancel all open orders", requiresIBKR: true },
  flatten_positions: { description: "Flatten all positions immediately with market orders", requiresIBKR: true },

  // Portfolio Analytics
  portfolio_exposure: { description: "Get portfolio exposure analysis (gross/net, sector breakdown, beta-weighted)", requiresIBKR: true },
  stress_test: { description: "Run portfolio stress test with market shock", params: ["shockPercent?", "betaAdjusted?"], requiresIBKR: true },
  size_position: { description: "Calculate position size based on risk parameters", params: ["symbol", "entryPrice", "stopPrice", "riskPercent?", "maxCapitalPercent?", "volatilityRegime?"], requiresIBKR: true },

  // Risk / Session
  get_risk_config: { description: "Get effective risk limits and configuration" },
  tune_risk_params: { description: "Auto-tune risk parameters from recent outcomes" },
  update_risk_config: { description: "Update risk configuration parameters", params: ["max_position_pct?", "max_daily_loss_pct?", "max_concentration_pct?", "volatility_scalar?", "source?"] },
  get_session_state: { description: "Get current session state (trades, P&L, lock status)" },
  session_record_trade: { description: "Record a trade result in the session", params: ["realizedPnl"] },
  session_lock: { description: "Lock trading session", params: ["reason?"] },
  session_unlock: { description: "Unlock trading session" },
  session_reset: { description: "Reset trading session state" },

  // Evaluation
  record_outcome: { description: "Record outcome for an evaluation", params: ["evaluation_id", "trade_taken", "decision_type?", "confidence_rating?", "rule_followed?", "setup_type?", "actual_entry_price?", "actual_exit_price?", "r_multiple?", "exit_reason?", "notes?"] },
  simulate_weights: { description: "Simulate ensemble weights against historical evaluations", params: ["claude", "gpt4o", "gemini", "k?", "days?", "symbol?"] },
  drift_report: { description: "Get model drift report (accuracy, calibration, regime shifts)" },

  // Flatten Config
  get_flatten_config: { description: "Get EOD auto-flatten configuration" },
  set_flatten_enabled: { description: "Enable/disable EOD auto-flatten", params: ["enabled"] },

  // Collaboration
  collab_read: { description: "Read collaboration messages", params: ["limit?", "author?", "tag?", "since?"] },
  collab_post: { description: "Post a collaboration message", params: ["content", "tags?", "replyTo?"] },
  collab_clear: { description: "Clear all collaboration messages" },
  collab_stats: { description: "Get collaboration statistics" },

  // Trade Journal
  journal_read: { description: "Read trade journal entries", params: ["symbol?", "strategy?", "limit?"] },
  journal_create: { description: "Create a trade journal entry", params: ["symbol", "reasoning", "tags?", "strategy_version?", "spy_price?", "vix_level?", "ai_recommendations?"] },
  journal_get: { description: "Get a specific journal entry by ID", params: ["id"] },
  journal_update: { description: "Update a journal entry", params: ["id", "outcome_tags?", "notes?"] },
  tradersync_import: { description: "Import TraderSync CSV data", params: ["csv"] },
  tradersync_stats: { description: "Get TraderSync import statistics" },
  tradersync_trades: { description: "Query TraderSync trades", params: ["symbol?", "side?", "status?", "days?", "limit?"] },

  // History
  orders_history: { description: "Query historical orders", params: ["symbol?", "strategy?", "limit?"] },
  executions_history: { description: "Query historical executions", params: ["symbol?", "limit?"] },

  // Subscriptions (streaming)
  subscribe_real_time_bars: { description: "Subscribe to real-time 5-second bars", params: ["symbol", "secType?", "exchange?", "currency?", "whatToShow?", "useRTH?"], requiresIBKR: true },
  unsubscribe_real_time_bars: { description: "Unsubscribe from real-time bars", params: ["subscriptionId"], requiresIBKR: true },
  get_real_time_bars: { description: "Get buffered real-time bars from subscription", params: ["subscriptionId", "limit?"], requiresIBKR: true },
  subscribe_account_updates: { description: "Subscribe to real-time account updates", params: ["account"], requiresIBKR: true },
  unsubscribe_account_updates: { description: "Unsubscribe from account updates", requiresIBKR: true },
  get_account_snapshot_stream: { description: "Get latest account snapshot from active subscription", requiresIBKR: true },
  get_scanner_parameters: { description: "Get IBKR scanner parameters XML", requiresIBKR: true },
  list_subscriptions: { description: "List all active subscriptions", requiresIBKR: true },

  // Holly AI Alerts
  holly_import: { description: "Import Holly AI alerts CSV", params: ["csv"] },
  holly_alerts: { description: "Query Holly AI alerts", params: ["symbol?", "strategy?", "since?", "limit?"] },
  holly_stats: { description: "Get Holly AI alert statistics" },
  holly_symbols: { description: "Get latest distinct symbols from Holly alerts", params: ["limit?"] },

  // Signals / Auto-Eval
  signal_feed: { description: "Query evaluated signals from auto-eval pipeline", params: ["symbol?", "direction?", "since?", "limit?"] },
  signal_stats: { description: "Get signal statistics (total, tradeable, blocked)" },
  auto_eval_status: { description: "Get auto-eval pipeline status (enabled, running, config)" },
  auto_eval_toggle: { description: "Enable or disable auto-eval pipeline", params: ["enabled"] },
};

/**
 * Get the action catalog with metadata for all actions.
 * Returns a JSON-serializable object with action names as keys.
 */
export function getActionCatalog(): Record<string, ActionMeta> {
  return actionsMeta;
}

/** List all registered action names (for the OpenAPI spec description) */
export function getActionList(): string[] {
  return Object.keys(actions);
}
