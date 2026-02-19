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
import { readInbox, markRead, markAllRead, clearInbox, getInboxStats } from "../inbox/store.js";
import { getGptInstructions } from "./gpt-instructions.js";
import { checkRisk, getSessionState, recordTradeResult, lockSession, unlockSession, resetSession, getRiskGateConfig } from "../ibkr/risk-gate.js";
import { calculatePositionSize } from "../ibkr/risk.js";
import { tuneRiskParams } from "../eval/risk-tuning.js";
import { computeDriftReport } from "../eval/drift.js";
import { checkDriftAlerts, getRecentDriftAlerts } from "../eval/drift-alerts.js";
import { computeEdgeReport, runWalkForward } from "../eval/edge-analytics.js";
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
  getDb,
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
import { buildProfiles, scanSymbols, getPreAlertCandidates } from "../holly/predictor.js";
import { extractRules, runBacktest, getStrategyBreakdown } from "../holly/backtester.js";
import { importHollyTrades, importHollyTradesFromFile, getHollyTradeStats, queryHollyTrades } from "../holly/trade-importer.js";
import { runExitAutopsy } from "../holly/exit-autopsy.js";
import {
  runTrailingStopSimulation, runFullOptimization, runPerStrategyOptimization,
  getOptimizationSummary, getDefaultParamSets,
} from "../holly/trailing-stop-optimizer.js";
import { queryHollyAlerts, getHollyAlertStats, getLatestHollySymbols, querySignals, getSignalStats, getAutoLinkStats, getRecentLinks } from "../db/database.js";
import { onOutcomeRecorded, getRecalibrationStatus } from "../eval/ensemble/recalibration-hook.js";
import { z } from "zod";
import { orchestrator, getConsensusVerdict, formatDisagreements, ProviderScoresSchema } from "../orchestrator.js";
import { applyTrailingStopToOrder, trailingStopRecommendation } from "../holly/trailing-stop-executor.js";
import { getMetrics, getRecentIncidents, getLastIncident } from "../ops/metrics.js";
import { getConnectionStatus } from "../ibkr/connection.js";

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
const MultiModelScoreParamsSchema = z.object({
  symbol: z.string().min(1),
  features: z.record(z.unknown()).default({}),
});
const MultiModelConsensusParamsSchema = z.object({
  scores: ProviderScoresSchema,
});

interface OpsRunbookEntry {
  readonly scenario: string;
  readonly keywords: readonly string[];
  readonly symptoms: readonly string[];
  readonly diagnosis: readonly string[];
  readonly recovery: readonly string[];
  readonly prevention: readonly string[];
}

const OPS_RUNBOOK: Record<string, OpsRunbookEntry> = {
  bridge_crash: {
    scenario: "bridge_crash",
    keywords: ["crash", "bridge", "restart"],
    symptoms: [
      "PM2 shows market-bridge stopped, errored, or restart looping",
      "REST API requests fail with connection refused/timeouts",
      "MCP clients cannot complete tool calls",
    ],
    diagnosis: [
      "Run pm2 status to verify process state",
      "Review logs with pm2 logs market-bridge --lines 100",
      "Confirm port 3000 is bound and reachable locally",
      "Check local readiness endpoint at /health/ready",
    ],
    recovery: [
      "Restart the process with pm2 restart market-bridge",
      "Validate /health/deep after restart",
      "If crash loop persists, roll back to last known-good build",
      "If exposure is unknown, execute flatten_positions immediately",
    ],
    prevention: [
      "Alert on repeated PM2 restarts",
      "Verify npm test and npm run build before deploy",
      "Keep startup persistence configured in PM2",
    ],
  },
  ibkr_disconnect: {
    scenario: "ibkr_disconnect",
    keywords: ["disconnect", "ibkr", "gateway"],
    symptoms: [
      "IBKR actions return not connected errors",
      "Account/position/order endpoints fail",
      "Ops uptime metrics show IBKR availability drop",
    ],
    diagnosis: [
      "Check IBKR connection status via health/ops endpoints",
      "Confirm TWS/Gateway is running and authenticated",
      "Review reconnect attempts and disconnect logs",
      "Verify host/port/clientId settings are unchanged",
    ],
    recovery: [
      "Restore TWS/Gateway session and unlock prompts",
      "Restart market-bridge if reconnect does not recover",
      "Verify get_account_summary and get_positions succeed",
      "Re-check risk/session state before resuming orders",
    ],
    prevention: [
      "Monitor disconnect frequency and reconnect attempt spikes",
      "Document TWS/Gateway maintenance windows",
      "Use stable host/network path for IBKR client",
    ],
  },
  tunnel_down: {
    scenario: "tunnel_down",
    keywords: ["tunnel", "cloudflare", "external"],
    symptoms: [
      "Public URL api.klfh-dot-io.com is unavailable",
      "Local health checks pass while external health fails",
      "Remote operators cannot reach the bridge",
    ],
    diagnosis: [
      "Test localhost /health/deep and external tunnel health URL",
      "Check Cloudflare tunnel process status",
      "Inspect tunnel logs for auth/routing failures",
      "Confirm DNS/tunnel route still targets localhost:3000",
    ],
    recovery: [
      "Restart tunnel process/service",
      "Re-validate external /health/deep",
      "Confirm TLS and route configuration is valid",
      "Notify operators of external degradation until restored",
    ],
    prevention: [
      "Monitor tunnel endpoint independently from local health",
      "Keep tunnel credentials current and documented",
      "Run tunnel under supervised process management",
    ],
  },
  mcp_transport_broken: {
    scenario: "mcp_transport_broken",
    keywords: ["mcp", "transport", "stdio"],
    symptoms: [
      "MCP tool calls fail while REST might still work",
      "Agent clients report transport/handshake errors",
      "Logs contain MCP protocol failures",
    ],
    diagnosis: [
      "Check /health/deep to confirm process is otherwise healthy",
      "Inspect PM2 logs for MCP handshake or stdio errors",
      "Verify process mode is configured as both (MCP + REST)",
      "Confirm no stdout pollution in MCP transport path",
    ],
    recovery: [
      "Restart market-bridge via PM2",
      "Reconnect MCP client sessions",
      "Test a basic MCP action before high-risk operations",
      "Use REST fallback temporarily if MCP remains degraded",
    ],
    prevention: [
      "Add MCP transport synthetic health checks",
      "Run pre-release MCP handshake smoke tests",
      "Keep MCP stdout isolation enabled in production",
    ],
  },
  high_error_rate: {
    scenario: "high_error_rate",
    keywords: ["error", "errors", "5xx"],
    symptoms: [
      "Request error rate rises above normal baseline",
      "Incident stream fills with repeated failures",
      "Latency and timeout rates increase",
    ],
    diagnosis: [
      "Review ops_health and ops_incidents output",
      "Inspect PM2 logs for recurring stack traces",
      "Identify failing subsystem (IBKR, Yahoo, DB, MCP)",
      "Validate dependency reachability and limits",
    ],
    recovery: [
      "Reduce load/retry pressure from clients",
      "Restart market-bridge if failure state is persistent",
      "Disable non-critical workflows amplifying errors",
      "Restore full traffic only after metrics normalize",
    ],
    prevention: [
      "Alert on error-rate and latency SLO breaches",
      "Use retry backoff/circuit-breaker patterns",
      "Complete RCA and add regression coverage for root causes",
    ],
  },
  memory_leak: {
    scenario: "memory_leak",
    keywords: ["memory", "leak", "oom"],
    symptoms: [
      "Memory usage grows over time and does not recover",
      "PM2 restarts due to memory pressure",
      "Latency degradation before restarts/OOM",
    ],
    diagnosis: [
      "Check pm2 status for memory trend",
      "Review ops metrics and incidents for memory anomalies",
      "Correlate growth with specific endpoints/workloads",
      "Inspect logs for GC pressure or OOM signatures",
    ],
    recovery: [
      "Restart market-bridge to reclaim memory",
      "Temporarily limit high-volume endpoints/tasks",
      "Flatten positions if prolonged instability creates risk",
      "Capture diagnostics and patch leaking path",
    ],
    prevention: [
      "Add memory trend alerting",
      "Bound buffers/caches and large payload sizes",
      "Run soak tests to catch leak regressions",
    ],
  },
  tws_restart: {
    scenario: "tws_restart",
    keywords: ["tws", "restart", "session"],
    symptoms: [
      "Sudden IBKR disconnect during trading",
      "Order/account calls fail after TWS reset",
      "Reconnect attempts spike",
    ],
    diagnosis: [
      "Confirm whether TWS/Gateway restarted",
      "Check bridge reconnect status and disconnect reason",
      "Validate account permissions and API settings post-login",
      "Confirm system clock/time sync correctness",
    ],
    recovery: [
      "Complete TWS login/unlock flow",
      "Restart market-bridge if reconnect stalls",
      "Validate account summary, positions, and quotes",
      "Resume operations after stable IBKR connectivity",
    ],
    prevention: [
      "Schedule restarts outside market hours",
      "Document required TWS API settings",
      "Alert on unexpected midday restarts",
    ],
  },
  database_corruption: {
    scenario: "database_corruption",
    keywords: ["database", "db", "sqlite"],
    symptoms: [
      "SQLite errors for reads/writes or startup init",
      "Persistent DB operation failures",
      "Potential malformed database or I/O issues",
    ],
    diagnosis: [
      "Inspect logs for exact SQLite error text",
      "Check disk free space and filesystem health",
      "Validate database file permissions/ownership",
      "Run integrity checks on a maintenance copy",
    ],
    recovery: [
      "Stop writes and preserve current DB artifacts",
      "Restore from latest known-good backup when needed",
      "Restart bridge and validate core read/write paths",
      "Reconcile operational data after restore",
    ],
    prevention: [
      "Maintain scheduled backups and restore drills",
      "Avoid unsafe shutdowns; keep WAL mode enabled",
      "Monitor disk I/O and space exhaustion",
    ],
  },
};

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

    // Trigger Bayesian weight recalibration
    const rMul = typeof p.r_multiple === "number" ? p.r_multiple : null;
    onOutcomeRecorded(evaluation_id, rMul, bool(p, "trade_taken"));

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

  // ── Edge Analytics ──
  edge_report: async (p) => computeEdgeReport({
    days: num(p, "days", 90),
    rollingWindow: num(p, "rolling_window", 20),
    includeWalkForward: bool(p, "include_walk_forward", true),
  }),
  walk_forward: async (p) => runWalkForward({
    days: num(p, "days", 180),
    trainSize: num(p, "train_size", 30),
    testSize: num(p, "test_size", 10),
  }),

  // ── Flatten Config ──
  get_flatten_config: async () => getFlattenConfig(),
  set_flatten_enabled: async (p) => { setFlattenEnabled(bool(p, "enabled")); return { enabled: bool(p, "enabled") }; },

  // ── Collaboration ──
  collab_read: async (p) => readMessages({ limit: num(p, "limit", 50), author: (str(p, "author") || undefined) as "claude" | "chatgpt" | "user" | undefined, tag: str(p, "tag") || undefined, since: str(p, "since") || undefined }),
  collab_post: async (p) => postMessage({ author: "chatgpt", content: str(p, "content"), tags: p.tags as string[] | undefined, replyTo: str(p, "replyTo") || undefined }),
  collab_clear: async () => clearMessages(),
  collab_stats: async () => getStats(),

  // ── Inbox (event buffer for ChatGPT polling) ──
  check_inbox: async (p) => {
    const items = readInbox({
      since: str(p, "since") || undefined,
      type: str(p, "type") || undefined,
      symbol: str(p, "symbol") || undefined,
      unreadOnly: p.unread_only !== undefined ? bool(p, "unread_only") : undefined,
      limit: num(p, "limit", 50),
    });
    const stats = getInboxStats();
    return { total: stats.total, unread: stats.unread, count: items.length, items };
  },
  mark_inbox_read: async (p) => {
    if (bool(p, "all")) {
      const count = markAllRead();
      return { marked: count };
    }
    const id = str(p, "id");
    const ids = Array.isArray(p.ids) ? (p.ids as string[]) : id ? [id] : [];
    if (ids.length === 0) throw new Error("Provide id, ids[], or all: true");
    const count = markRead(ids);
    return { marked: count };
  },
  clear_inbox: async () => clearInbox(),
  inbox_stats: async () => getInboxStats(),

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

  // ── Holly Pre-Alert Predictor ──
  holly_predictor_status: async () => {
    const db = getDb();
    const profiles = buildProfiles(db);
    return { profiles_built: profiles.length, strategies: [...new Set(profiles.map(p => p.strategy))], sample_sizes: profiles.map(p => p.sample_size) };
  },
  holly_predictor_profiles: async (p) => {
    const db = getDb();
    const profiles = buildProfiles(db, num(p, "min_samples", 20), str(p, "strategy") || undefined);
    return { count: profiles.length, profiles };
  },
  holly_predictor_scan: async (p) => {
    const symbol = str(p, "symbol");
    if (!symbol) throw new Error("symbol is required");
    const db = getDb();
    const profiles = buildProfiles(db);
    // Build a minimal feature vector for the single symbol
    const featureVec = { symbol } as any;
    return scanSymbols([featureVec], profiles);
  },
  holly_predictor_scan_batch: async (p) => {
    const symbols = p.symbols as string[] | undefined;
    if (!symbols || !Array.isArray(symbols) || symbols.length === 0) throw new Error("symbols array is required");
    const db = getDb();
    const profiles = buildProfiles(db);
    const features = symbols.map(s => ({ symbol: s }) as any);
    return scanSymbols(features, profiles);
  },
  holly_predictor_candidates: async (p) => {
    const db = getDb();
    const profiles = buildProfiles(db);
    return getPreAlertCandidates(db, profiles, num(p, "limit", 10), num(p, "hours_back", 24));
  },
  holly_predictor_refresh: async (p) => {
    const db = getDb();
    const profiles = buildProfiles(db, num(p, "min_samples", 20));
    return { profiles_built: profiles.length };
  },

  // ── Holly Reverse-Engineering & Backtest ──
  holly_extract_rules: async (p) => {
    const db = getDb();
    const rules = extractRules(db, num(p, "min_alerts", 10), num(p, "min_separation", 0.2));
    return { total_rules: rules.length, rules };
  },
  holly_backtest: async (p) => {
    const db = getDb();
    const rules = extractRules(db, num(p, "min_alerts", 10), num(p, "min_separation", 0.2));
    return runBacktest(db, rules, num(p, "win_threshold", 60));
  },
  holly_strategy_breakdown: async () => getStrategyBreakdown(getDb()),

  // ── Holly Trade Data ──
  holly_trade_import: async (p) => {
    const csv = str(p, "csv");
    if (!csv) throw new Error("csv content is required");
    return importHollyTrades(csv);
  },
  holly_trade_import_file: async (p) => {
    const filePath = str(p, "file_path");
    if (!filePath) throw new Error("file_path is required");
    return importHollyTradesFromFile(filePath);
  },
  holly_trade_stats: async () => getHollyTradeStats(),
  holly_trades: async (p) => {
    const trades = queryHollyTrades({
      symbol: str(p, "symbol") || undefined,
      strategy: str(p, "strategy") || undefined,
      segment: str(p, "segment") || undefined,
      since: str(p, "since") || undefined,
      until: str(p, "until") || undefined,
      limit: num(p, "limit", 100),
    });
    return { count: trades.length, trades };
  },

  // ── Holly Exit Autopsy ──
  holly_exit_autopsy: async (p) => runExitAutopsy({
    since: str(p, "since") || undefined,
    until: str(p, "until") || undefined,
  }),

  // ── Trailing Stop Optimizer ──
  trailing_stop_optimize: async (p) => runFullOptimization({
    strategy: str(p, "strategy") || undefined,
    segment: str(p, "segment") || undefined,
    since: str(p, "since") || undefined,
    until: str(p, "until") || undefined,
  }),
  trailing_stop_summary: async (p) => getOptimizationSummary({
    strategy: str(p, "strategy") || undefined,
    segment: str(p, "segment") || undefined,
    since: str(p, "since") || undefined,
    until: str(p, "until") || undefined,
  }),
  trailing_stop_per_strategy: async (p) => runPerStrategyOptimization({
    since: str(p, "since") || undefined,
    until: str(p, "until") || undefined,
    minTrades: num(p, "min_trades", 20),
  }),
  trailing_stop_recommend: async (p) => trailingStopRecommendation(str(p, "symbol"), str(p, "strategy") || undefined),
  trailing_stop_simulate: async (p) => {
    const type = str(p, "type") as any;
    if (!type) throw new Error("type is required (fixed_pct, atr_multiple, time_decay, mfe_escalation, breakeven_trail)");
    return runTrailingStopSimulation({
      name: str(p, "name") || type,
      type,
      trail_pct: num(p, "trail_pct", undefined as any) || undefined,
      atr_mult: num(p, "atr_mult", undefined as any) || undefined,
      initial_target_pct: num(p, "initial_target_pct", undefined as any) || undefined,
      decay_per_min: num(p, "decay_per_min", undefined as any) || undefined,
      mfe_trigger_pct: num(p, "mfe_trigger_pct", undefined as any) || undefined,
      tight_trail_pct: num(p, "tight_trail_pct", undefined as any) || undefined,
      be_trigger_r: num(p, "be_trigger_r", undefined as any) || undefined,
      post_be_trail_pct: num(p, "post_be_trail_pct", undefined as any) || undefined,
    }, {
      strategy: str(p, "strategy") || undefined,
      segment: str(p, "segment") || undefined,
      since: str(p, "since") || undefined,
      until: str(p, "until") || undefined,
    });
  },
  trailing_stop_params: async () => getDefaultParamSets(),

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
  auto_link_stats: async () => {
    const stats = getAutoLinkStats();
    const recent = getRecentLinks(20);
    return { stats, recent };
  },
  recalibration_status: async () => {
    return getRecalibrationStatus();
  },

  // ── Multi-model orchestration ──
  multi_model_score: async (p) => {
    const parsed = MultiModelScoreParamsSchema.parse(p);
    return orchestrator.collectEnsembleScores(parsed.symbol, parsed.features);
  },
  multi_model_consensus: async (p) => {
    const parsed = MultiModelConsensusParamsSchema.parse(p);
    return {
      consensus: getConsensusVerdict(parsed.scores),
      disagreements: formatDisagreements(parsed.scores),
    };
  },

  // ── Divoom Display ──
  divoom_status: async () => {
    const { getDivoomDisplay } = await import("../divoom/updater.js");
    const display = getDivoomDisplay();
    if (!display) {
      throw new Error("Divoom display not initialized. Check DIVOOM_ENABLED and DIVOOM_DEVICE_IP config.");
    }
    return display.getDeviceInfo();
  },
  divoom_send_text: async (p) => {
    const { getDivoomDisplay } = await import("../divoom/updater.js");
    const display = getDivoomDisplay();
    if (!display) {
      throw new Error("Divoom display not initialized. Check DIVOOM_ENABLED and DIVOOM_DEVICE_IP config.");
    }
    await display.sendText(str(p, "text"), {
      color: str(p, "color") || undefined,
      x: p.x != null ? num(p, "x") : undefined,
      y: p.y != null ? num(p, "y") : undefined,
      font: p.font != null ? num(p, "font") : undefined,
      scrollSpeed: p.scrollSpeed != null ? num(p, "scrollSpeed") : undefined,
    });
    return { success: true, text: str(p, "text") };
  },
  divoom_set_brightness: async (p) => {
    const { getDivoomDisplay } = await import("../divoom/updater.js");
    const display = getDivoomDisplay();
    if (!display) {
      throw new Error("Divoom display not initialized. Check DIVOOM_ENABLED and DIVOOM_DEVICE_IP config.");
    }
    const brightness = num(p, "brightness");
    await display.setBrightness(brightness);
    return { success: true, brightness };
  },

  // ── Ops / Monitoring ──
  ops_health: async () => getMetrics(),
  ops_incidents: async (p) => {
    const limit = num(p, "limit", 20);
    const incidents = getRecentIncidents(limit);
    return { count: incidents.length, incidents };
  },
  ops_runbook: async (p) => {
    const scenarioQuery = str(p, "scenario").trim().toLowerCase();
    const entries = Object.values(OPS_RUNBOOK);

    if (!scenarioQuery) {
      return {
        available_scenarios: entries.map((entry) => ({
          scenario: entry.scenario,
          keywords: entry.keywords,
        })),
      };
    }

    const matched = entries.find((entry) =>
      entry.scenario === scenarioQuery
      || entry.keywords.some((keyword) => keyword === scenarioQuery),
    );

    if (!matched) {
      throw new Error(`Unknown runbook scenario '${scenarioQuery}'. Use ops_runbook with no scenario to list available scenarios.`);
    }

    return {
      scenario: matched.scenario,
      symptoms: matched.symptoms,
      diagnosis: matched.diagnosis,
      recovery: matched.recovery,
      prevention: matched.prevention,
    };
  },
  ops_uptime: async () => {
    const connStatus = getConnectionStatus();
    const metrics = getMetrics();
    return {
      process_uptime_seconds: metrics.uptimeSeconds,
      started_at: metrics.startedAt,
      ibkr_uptime_percent: metrics.ibkrUptimePercent,
      ibkr_connected: metrics.ibkrConnected,
      ibkr_current_streak_seconds: metrics.ibkrCurrentStreakSeconds,
      ibkr_total_disconnects: connStatus.totalDisconnects,
      ibkr_reconnect_attempts: connStatus.reconnectAttempts,
      tunnel_uptime_percent: metrics.tunnelUptimePercent,
      tunnel_connected: metrics.tunnelConnected,
      tunnel_last_probe_latency_ms: metrics.tunnelLastProbeLatencyMs,
      tunnel_consecutive_failures: metrics.tunnelConsecutiveFailures,
      tunnel_restart_attempts: metrics.tunnelRestartAttempts,
      tunnel_url: metrics.tunnelUrl,
      memory_mb: metrics.memoryMb,
      cpu_percent: metrics.cpuPercent,
      request_error_rate: metrics.requests.errorRate,
      incident_count: metrics.incidentCount,
      last_incident: metrics.lastIncident,
    };
  },
  ops_sla: async () => {
    const { getSlaReport } = await import("../ops/availability.js");
    return getSlaReport();
  },
  ops_outages: async (p) => {
    const { getRecentOutages } = await import("../ops/availability.js");
    const limit = num(p, "limit", 20);
    return { count: getRecentOutages(limit).length, outages: getRecentOutages(limit) };
  },
};

// ── Dispatcher ───────────────────────────────────────────────────

export async function handleAgentRequest(req: Request, res: Response): Promise<void> {
  const body = req.body as Record<string, unknown>;
  const action = typeof body.action === "string" ? body.action : undefined;

  if (!action) {
    res.status(400).json({ error: "Missing 'action' string. Call get_status to see available actions." });
    return;
  }

  // Accept params in multiple shapes for ChatGPT Actions compatibility:
  //   1. { action, params: { ... } }        — canonical format
  //   2. { action, arguments: { ... } }      — ChatGPT sometimes uses this
  //   3. { action, input: { ... } }          — alternative variant
  //   4. { action, key1: val1, key2: val2 }  — flat/inline params
  let params: Record<string, unknown>;
  if (body.params && typeof body.params === "object" && !Array.isArray(body.params)) {
    params = body.params as Record<string, unknown>;
  } else if (body.arguments && typeof body.arguments === "object" && !Array.isArray(body.arguments)) {
    params = body.arguments as Record<string, unknown>;
  } else if (body.input && typeof body.input === "object" && !Array.isArray(body.input)) {
    params = body.input as Record<string, unknown>;
  } else {
    // Fallback: treat all keys except 'action' as inline params
    const { action: _a, ...rest } = body;
    params = rest;
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

interface ParamSchema {
  type: "string" | "number" | "boolean" | "object" | "array";
  description: string;
  required?: boolean;
  enum?: string[] | number[];
  default?: string | number | boolean;
  items?: { type: string };
}

interface ActionMeta {
  description: string;
  params?: string[] | Record<string, ParamSchema>;
  requiresIBKR?: boolean;
}

export type { ParamSchema, ActionMeta };

export const actionsMeta: Record<string, ActionMeta> = {
  // System
  get_status: { description: "Get system status, market session, and IBKR connection state" },
  get_gpt_instructions: { description: "Get GPT system instructions" },

  // Market Data (Yahoo — always available)
  get_quote: { 
    description: "Get real-time quote for a symbol", 
    params: {
      symbol: { type: "string", description: "Stock ticker symbol (e.g., 'AAPL', 'TSLA')", required: true },
    },
  },
  get_historical_bars: { 
    description: "Get historical price bars", 
    params: {
      symbol: { type: "string", description: "Stock ticker symbol (e.g., 'AAPL', 'TSLA')", required: true },
      period: { 
        type: "string", 
        description: "Historical period to fetch",
        enum: ["1d", "5d", "1mo", "3mo", "6mo", "1y", "2y", "5y", "10y", "ytd", "max"],
        default: "3mo",
      },
      interval: { 
        type: "string", 
        description: "Bar interval/timeframe",
        enum: ["1m", "2m", "5m", "15m", "30m", "60m", "90m", "1h", "1d", "5d", "1wk", "1mo", "3mo"],
        default: "1d",
      },
    },
  },
  get_stock_details: { 
    description: "Get stock details (sector, industry, description, market cap)", 
    params: {
      symbol: { type: "string", description: "Stock ticker symbol (e.g., 'AAPL', 'TSLA')", required: true },
    },
  },
  get_options_chain: { 
    description: "Get options chain for a symbol", 
    params: {
      symbol: { type: "string", description: "Stock ticker symbol (e.g., 'AAPL', 'TSLA')", required: true },
      expiration: { type: "string", description: "Option expiration date in YYYYMMDD format (e.g., '20240315')" },
    },
  },
  get_option_quote: { 
    description: "Get quote for a specific option contract", 
    params: {
      symbol: { type: "string", description: "Stock ticker symbol (e.g., 'AAPL', 'TSLA')", required: true },
      expiry: { type: "string", description: "Option expiration date in YYYYMMDD format (e.g., '20240315')", required: true },
      strike: { type: "number", description: "Strike price (e.g., 150.0)", required: true },
      right: { type: "string", description: "Option type", enum: ["C", "P"], required: true },
    },
  },
  search_symbols: { 
    description: "Search for symbols by query string", 
    params: {
      query: { type: "string", description: "Search query (company name or ticker)", required: true },
    },
  },
  get_news: { 
    description: "Get news articles for a query", 
    params: {
      query: { type: "string", description: "Search query (ticker or topic)", required: true },
    },
  },
  get_financials: { 
    description: "Get financial data (revenue, margins, debt, analyst targets)", 
    params: {
      symbol: { type: "string", description: "Stock ticker symbol (e.g., 'AAPL', 'TSLA')", required: true },
    },
  },
  get_earnings: { 
    description: "Get earnings history (actual vs estimate)", 
    params: {
      symbol: { type: "string", description: "Stock ticker symbol (e.g., 'AAPL', 'TSLA')", required: true },
    },
  },
  get_recommendations: { 
    description: "Get analyst recommendations", 
    params: {
      symbol: { type: "string", description: "Stock ticker symbol (e.g., 'AAPL', 'TSLA')", required: true },
    },
  },
  get_trending: { 
    description: "Get trending symbols by region", 
    params: {
      region: { type: "string", description: "Region code", enum: ["US", "GB", "IN", "FR", "DE", "IT", "ES"], default: "US" },
    },
  },
  get_screener_filters: { description: "Get list of available screener IDs" },
  run_screener: { 
    description: "Run a stock screener", 
    params: {
      screener_id: { 
        type: "string", 
        description: "Screener to run",
        enum: ["day_gainers", "day_losers", "most_actives", "small_cap_gainers", "undervalued_large_caps", "aggressive_small_caps", "growth_technology_stocks"],
        default: "day_gainers",
      },
      count: { type: "number", description: "Number of results to return (max 100)", default: 20 },
    },
  },
  run_screener_with_quotes: { 
    description: "Run a stock screener with full quote data", 
    params: {
      screener_id: { 
        type: "string", 
        description: "Screener to run",
        enum: ["day_gainers", "day_losers", "most_actives", "small_cap_gainers", "undervalued_large_caps", "aggressive_small_caps", "growth_technology_stocks"],
        default: "day_gainers",
      },
      count: { type: "number", description: "Number of results to return (max 100)", default: 20 },
    },
  },

  // IBKR Market Data
  get_ibkr_quote: { 
    description: "Get IBKR real-time quote", 
    params: {
      symbol: { type: "string", description: "Stock ticker symbol (e.g., 'AAPL', 'TSLA')", required: true },
      secType: { type: "string", description: "Security type", enum: ["STK", "OPT", "FUT", "CASH", "BOND", "CFD", "FOP", "WAR", "IOPT", "FWD", "BAG", "IND", "BILL", "FUND", "FIXED", "SLB", "NEWS", "CMDTY", "BSK", "ICU", "ICS"], default: "STK" },
      exchange: { type: "string", description: "Exchange code", default: "SMART" },
      currency: { type: "string", description: "Currency code", default: "USD" },
    },
    requiresIBKR: true 
  },
  get_historical_ticks: { 
    description: "Get historical tick data", 
    params: {
      symbol: { type: "string", description: "Stock ticker symbol", required: true },
      startTime: { type: "string", description: "Start time in ISO 8601 format or YYYYMMDD-HH:MM:SS", required: true },
      endTime: { type: "string", description: "End time in ISO 8601 format or YYYYMMDD-HH:MM:SS" },
      type: { type: "string", description: "Tick data type", enum: ["TRADES", "MIDPOINT", "BID", "ASK", "BID_ASK"], default: "TRADES" },
      count: { type: "number", description: "Maximum number of ticks to return (max 1000)", default: 1000 },
    },
    requiresIBKR: true 
  },
  get_contract_details: { 
    description: "Get contract details from IBKR", 
    params: {
      symbol: { type: "string", description: "Stock ticker symbol", required: true },
      secType: { type: "string", description: "Security type", enum: ["STK", "OPT", "FUT", "CASH", "BOND", "CFD", "FOP", "WAR", "IOPT", "FWD", "BAG", "IND", "BILL", "FUND", "FIXED", "SLB", "NEWS", "CMDTY", "BSK", "ICU", "ICS"], default: "STK" },
      currency: { type: "string", description: "Currency code", default: "USD" },
      exchange: { type: "string", description: "Exchange code", default: "SMART" },
    },
    requiresIBKR: true 
  },

  // IBKR News
  get_news_providers: { description: "Get list of IBKR news providers", requiresIBKR: true },
  get_news_article: { 
    description: "Get specific news article from IBKR", 
    params: {
      providerCode: { type: "string", description: "News provider code (e.g., 'BRFUPDN', 'DJ-N')", required: true },
      articleId: { type: "string", description: "Article ID from provider", required: true },
    },
    requiresIBKR: true 
  },
  get_historical_news: { 
    description: "Get historical news from IBKR", 
    params: {
      conId: { type: "number", description: "Contract ID for the symbol", required: true },
      providerCodes: { type: "string", description: "Comma-separated provider codes (e.g., 'BRFUPDN,DJ-N')", required: true },
      startDateTime: { type: "string", description: "Start date/time in YYYYMMDD HH:MM:SS format", required: true },
      endDateTime: { type: "string", description: "End date/time in YYYYMMDD HH:MM:SS format", required: true },
    },
    requiresIBKR: true 
  },
  get_news_bulletins: { description: "Get IBKR news bulletins", requiresIBKR: true },

  // IBKR Data Wrappers
  get_pnl_single: { 
    description: "Get P&L for a single position", 
    params: {
      symbol: { type: "string", description: "Stock ticker symbol", required: true },
    },
    requiresIBKR: true 
  },
  search_ibkr_symbols: { 
    description: "Search for symbols using IBKR", 
    params: {
      pattern: { type: "string", description: "Search pattern (partial symbol or company name)", required: true },
    },
    requiresIBKR: true 
  },
  set_market_data_type: { 
    description: "Set market data type (live, frozen, delayed)", 
    params: {
      marketDataType: { type: "number", description: "Market data type (1=Live, 2=Frozen, 3=Delayed, 4=Delayed-Frozen)", enum: [1, 2, 3, 4], required: true },
    },
    requiresIBKR: true 
  },
  set_auto_open_orders: { 
    description: "Enable/disable auto-binding of open orders", 
    params: {
      autoBind: { type: "boolean", description: "Enable automatic order binding", default: true },
    },
    requiresIBKR: true 
  },
  get_head_timestamp: { 
    description: "Get earliest available data timestamp", 
    params: {
      symbol: { type: "string", description: "Stock ticker symbol", required: true },
      whatToShow: { type: "string", description: "Data type to query", enum: ["TRADES", "MIDPOINT", "BID", "ASK", "BID_ASK", "ADJUSTED_LAST", "HISTORICAL_VOLATILITY", "OPTION_IMPLIED_VOLATILITY"], default: "TRADES" },
      useRTH: { type: "boolean", description: "Use regular trading hours only", default: true },
      formatDate: { type: "number", description: "Date format (1=YYYYMMDD HH:MM:SS, 2=Unix timestamp)", enum: [1, 2], default: 1 },
    },
    requiresIBKR: true 
  },
  get_histogram_data: { 
    description: "Get histogram data for a symbol", 
    params: {
      symbol: { type: "string", description: "Stock ticker symbol", required: true },
      useRTH: { type: "boolean", description: "Use regular trading hours only", default: true },
      period: { type: "number", description: "Period duration (combine with periodUnit)", default: 1 },
      periodUnit: { type: "string", description: "Period unit", enum: ["S", "D", "W", "M", "Y"], default: "D" },
    },
    requiresIBKR: true 
  },
  calculate_implied_volatility: { 
    description: "Calculate implied volatility for an option", 
    params: {
      symbol: { type: "string", description: "Stock ticker symbol", required: true },
      expiry: { type: "string", description: "Option expiration date in YYYYMMDD format", required: true },
      strike: { type: "number", description: "Strike price", required: true },
      right: { type: "string", description: "Option type", enum: ["C", "P"], required: true },
      optionPrice: { type: "number", description: "Current option price", required: true },
      underlyingPrice: { type: "number", description: "Current underlying stock price", required: true },
    },
    requiresIBKR: true 
  },
  calculate_option_price: { 
    description: "Calculate theoretical option price", 
    params: {
      symbol: { type: "string", description: "Stock ticker symbol", required: true },
      expiry: { type: "string", description: "Option expiration date in YYYYMMDD format", required: true },
      strike: { type: "number", description: "Strike price", required: true },
      right: { type: "string", description: "Option type", enum: ["C", "P"], required: true },
      volatility: { type: "number", description: "Implied volatility (as decimal, e.g., 0.25 for 25%)", required: true },
      underlyingPrice: { type: "number", description: "Current underlying stock price", required: true },
    },
    requiresIBKR: true 
  },
  get_tws_current_time: { description: "Get current time from TWS server", requiresIBKR: true },
  get_market_rule: { 
    description: "Get market rule by rule ID", 
    params: {
      ruleId: { type: "number", description: "Market rule ID", required: true },
    },
    requiresIBKR: true 
  },
  get_smart_components: { 
    description: "Get smart routing components for an exchange", 
    params: {
      exchange: { type: "string", description: "Exchange code (e.g., 'NYSE', 'NASDAQ')", required: true },
    },
    requiresIBKR: true 
  },
  get_depth_exchanges: { description: "Get list of exchanges that support market depth", requiresIBKR: true },
  get_fundamental_data: { 
    description: "Get fundamental data from IBKR", 
    params: {
      symbol: { type: "string", description: "Stock ticker symbol", required: true },
      reportType: { type: "string", description: "Report type", enum: ["ReportsFinSummary", "ReportsOwnership", "ReportSnapshot", "ReportsFinStatements", "RESC", "CalendarReport"], default: "ReportsFinSummary" },
    },
    requiresIBKR: true 
  },

  // Account
  get_account_summary: { description: "Get account summary (buying power, cash, equity)", requiresIBKR: true },
  get_positions: { description: "Get all open positions", requiresIBKR: true },
  get_pnl: { description: "Get overall P&L", requiresIBKR: true },

  // Orders
  get_open_orders: { description: "Get all open orders", requiresIBKR: true },
  get_completed_orders: { description: "Get completed orders", requiresIBKR: true },
  get_executions: { description: "Get recent executions", requiresIBKR: true },
  place_order: { 
    description: "Place a single order", 
    params: {
      symbol: { type: "string", description: "Stock ticker symbol (e.g., 'AAPL', 'TSLA')", required: true },
      action: { type: "string", description: "Order action", enum: ["BUY", "SELL"], required: true },
      orderType: { type: "string", description: "Order type", enum: ["MKT", "LMT", "STP", "STP LMT", "TRAIL", "TRAIL LIMIT", "REL", "MIT", "MOC", "LOC", "MIDPRICE"], required: true },
      totalQuantity: { type: "number", description: "Number of shares/contracts to trade", required: true },
      lmtPrice: { type: "number", description: "Limit price (required for LMT, STP LMT, TRAIL LIMIT, REL orders)" },
      auxPrice: { type: "number", description: "Auxiliary price (stop price for STP/STP LMT, trailing amount for TRAIL)" },
      secType: { type: "string", description: "Security type", enum: ["STK", "OPT", "FUT", "CASH", "BOND", "CFD", "FOP", "WAR", "IOPT", "FWD", "BAG", "IND", "BILL", "FUND", "FIXED", "SLB", "NEWS", "CMDTY", "BSK", "ICU", "ICS"], default: "STK" },
      exchange: { type: "string", description: "Exchange code", default: "SMART" },
      currency: { type: "string", description: "Currency code", default: "USD" },
      tif: { type: "string", description: "Time in force", enum: ["DAY", "GTC", "IOC", "GTD", "OPG", "FOK", "DTC"], default: "DAY" },
    },
    requiresIBKR: true 
  },
  place_bracket_order: { 
    description: "Place a bracket order (entry + TP + SL)", 
    params: {
      symbol: { type: "string", description: "Stock ticker symbol (e.g., 'AAPL', 'TSLA')", required: true },
      action: { type: "string", description: "Order action", enum: ["BUY", "SELL"], required: true },
      totalQuantity: { type: "number", description: "Number of shares/contracts to trade", required: true },
      entryType: { type: "string", description: "Entry order type", enum: ["MKT", "LMT", "STP", "STP LMT"], required: true },
      entryPrice: { type: "number", description: "Entry price (required for LMT, STP, STP LMT entry types)" },
      takeProfitPrice: { type: "number", description: "Take profit limit price", required: true },
      stopLossPrice: { type: "number", description: "Stop loss price", required: true },
      secType: { type: "string", description: "Security type", enum: ["STK", "OPT", "FUT", "CASH", "BOND", "CFD", "FOP", "WAR", "IOPT", "FWD", "BAG", "IND", "BILL", "FUND", "FIXED", "SLB", "NEWS", "CMDTY", "BSK", "ICU", "ICS"], default: "STK" },
      tif: { type: "string", description: "Time in force", enum: ["DAY", "GTC", "IOC", "GTD", "OPG", "FOK", "DTC"], default: "DAY" },
    },
    requiresIBKR: true 
  },
  place_advanced_bracket: { 
    description: "Place an advanced bracket order with full control", 
    params: {
      symbol: { type: "string", description: "Stock ticker symbol", required: true },
      action: { type: "string", description: "Order action", enum: ["BUY", "SELL"], required: true },
      totalQuantity: { type: "number", description: "Number of shares/contracts", required: true },
      entry: { type: "object", description: "Entry order configuration (orderType, lmtPrice, auxPrice)", required: true },
      takeProfit: { type: "object", description: "Take profit order configuration (lmtPrice)", required: true },
      stopLoss: { type: "object", description: "Stop loss order configuration (auxPrice, orderType)", required: true },
      outsideRth: { type: "boolean", description: "Allow execution outside regular trading hours", default: false },
      ocaType: { type: "number", description: "OCA type (1=Cancel with block, 2=Reduce with block, 3=Reduce non-block)", enum: [1, 2, 3], default: 1 },
      trailingAmount: { type: "number", description: "Trailing stop amount (for TRAIL orders)" },
      trailingPercent: { type: "number", description: "Trailing stop percentage (for TRAIL orders)" },
    },
    requiresIBKR: true 
  },
  modify_order: { 
    description: "Modify an existing open order", 
    params: {
      orderId: { type: "number", description: "Order ID to modify", required: true },
      lmtPrice: { type: "number", description: "New limit price" },
      auxPrice: { type: "number", description: "New auxiliary price (stop price)" },
      totalQuantity: { type: "number", description: "New quantity" },
      orderType: { type: "string", description: "New order type", enum: ["MKT", "LMT", "STP", "STP LMT", "TRAIL", "TRAIL LIMIT", "REL", "MIT", "MOC", "LOC", "MIDPRICE"] },
      tif: { type: "string", description: "New time in force", enum: ["DAY", "GTC", "IOC", "GTD", "OPG", "FOK", "DTC"] },
    },
    requiresIBKR: true 
  },
  cancel_order: { 
    description: "Cancel a specific order", 
    params: {
      orderId: { type: "number", description: "Order ID to cancel", required: true },
    },
    requiresIBKR: true 
  },
  cancel_all_orders: { description: "Cancel all open orders", requiresIBKR: true },
  flatten_positions: { description: "Flatten all positions immediately with market orders", requiresIBKR: true },

  // Portfolio Analytics
  portfolio_exposure: { description: "Get portfolio exposure analysis (gross/net, sector breakdown, beta-weighted)", requiresIBKR: true },
  stress_test: { 
    description: "Run portfolio stress test with market shock", 
    params: {
      shockPercent: { type: "number", description: "Market shock percentage (e.g., -10 for 10% drop)", default: -10 },
      betaAdjusted: { type: "boolean", description: "Apply beta-adjusted shocks per position", default: true },
    },
    requiresIBKR: true 
  },
  size_position: { 
    description: "Calculate position size based on risk parameters", 
    params: {
      symbol: { type: "string", description: "Stock ticker symbol", required: true },
      entryPrice: { type: "number", description: "Planned entry price", required: true },
      stopPrice: { type: "number", description: "Stop loss price", required: true },
      riskPercent: { type: "number", description: "Risk percentage of account (e.g., 1 for 1%)", default: 1 },
      maxCapitalPercent: { type: "number", description: "Maximum capital allocation percentage", default: 20 },
      volatilityRegime: { type: "string", description: "Volatility regime", enum: ["low", "normal", "high"] },
    },
    requiresIBKR: true 
  },

  // Risk / Session
  get_risk_config: { description: "Get effective risk limits and configuration" },
  tune_risk_params: { description: "Auto-tune risk parameters from recent outcomes" },
  update_risk_config: { 
    description: "Update risk configuration parameters", 
    params: {
      max_position_pct: { type: "number", description: "Maximum position size as % of account" },
      max_daily_loss_pct: { type: "number", description: "Maximum daily loss as % of account" },
      max_concentration_pct: { type: "number", description: "Maximum concentration in single position as %" },
      volatility_scalar: { type: "number", description: "Volatility adjustment scalar" },
      source: { type: "string", description: "Configuration source identifier" },
    },
  },
  get_session_state: { description: "Get current session state (trades, P&L, lock status)" },
  session_record_trade: { 
    description: "Record a trade result in the session", 
    params: {
      realizedPnl: { type: "number", description: "Realized P&L from the trade", required: true },
    },
  },
  session_lock: { 
    description: "Lock trading session", 
    params: {
      reason: { type: "string", description: "Reason for locking the session" },
    },
  },
  session_unlock: { description: "Unlock trading session" },
  session_reset: { description: "Reset trading session state" },

  // Evaluation
  record_outcome: { 
    description: "Record outcome for an evaluation", 
    params: {
      evaluation_id: { type: "string", description: "Evaluation ID", required: true },
      trade_taken: { type: "boolean", description: "Whether the trade was taken", required: true },
      decision_type: { type: "string", description: "Decision type", enum: ["took_trade", "passed_setup", "ensemble_no", "risk_gate_blocked"] },
      confidence_rating: { type: "number", description: "Confidence rating (1-5)" },
      rule_followed: { type: "boolean", description: "Whether evaluation rules were followed" },
      setup_type: { type: "string", description: "Setup type/category" },
      actual_entry_price: { type: "number", description: "Actual entry price if trade was taken" },
      actual_exit_price: { type: "number", description: "Actual exit price if trade was closed" },
      r_multiple: { type: "number", description: "R-multiple (profit/loss as multiple of risk)" },
      exit_reason: { type: "string", description: "Exit reason" },
      notes: { type: "string", description: "Additional notes" },
    },
  },
  simulate_weights: { 
    description: "Simulate ensemble weights against historical evaluations", 
    params: {
      claude: { type: "number", description: "Weight for Claude model (0-1)", required: true },
      gpt4o: { type: "number", description: "Weight for GPT-4o model (0-1)", required: true },
      gemini: { type: "number", description: "Weight for Gemini model (0-1)", required: true },
      k: { type: "number", description: "Disagreement penalty coefficient", default: 50 },
      days: { type: "number", description: "Days of history to analyze", default: 90 },
      symbol: { type: "string", description: "Filter by symbol (optional)" },
    },
  },
  drift_report: { description: "Get model drift report (accuracy, calibration, regime shifts)" },
  drift_check: { description: "Check model drift against thresholds and generate alerts" },
  drift_alerts: { 
    description: "Get recent model drift alerts from database", 
    params: {
      limit: { type: "number", description: "Maximum number of alerts to return", default: 50 },
    },
  },
  edge_report: { 
    description: "Full edge analytics: rolling Sharpe/Sortino, win rate, profit factor, feature attribution, walk-forward validation", 
    params: {
      days: { type: "number", description: "Days of history to analyze", default: 90 },
      rolling_window: { type: "number", description: "Rolling window size for metrics", default: 20 },
      include_walk_forward: { type: "boolean", description: "Include walk-forward validation", default: true },
    },
  },
  walk_forward: { 
    description: "Walk-forward backtest: train/test split with weight optimization, proves out-of-sample edge vs luck", 
    params: {
      days: { type: "number", description: "Days of history to analyze", default: 180 },
      train_size: { type: "number", description: "Training window size in days", default: 30 },
      test_size: { type: "number", description: "Test window size in days", default: 10 },
    },
  },

  // ── Evaluation Analytics ──
  eval_stats: { 
    description: "Get evaluation statistics (total, by model, win rate, avg scores)",
    params: {
      days: { type: "number", description: "Days of history to analyze", default: 30 },
      symbol: { type: "string", description: "Filter by symbol" },
    },
  },
  eval_outcomes: { 
    description: "Query recorded evaluation outcomes", 
    params: {
      days: { type: "number", description: "Days of history to query", default: 90 },
      symbol: { type: "string", description: "Filter by symbol" },
      limit: { type: "number", description: "Maximum number of outcomes to return", default: 100 },
    },
  },
  eval_reasoning: { 
    description: "Get detailed model reasoning for an evaluation", 
    params: {
      evaluation_id: { type: "string", description: "Evaluation ID", required: true },
    },
  },
  daily_summary: { 
    description: "Get daily evaluation and outcome summary", 
    params: {
      date: { type: "string", description: "Date in YYYY-MM-DD format (defaults to today)" },
    },
  },
  weight_history: { 
    description: "Get ensemble weight history and changes", 
    params: {
      limit: { type: "number", description: "Maximum number of weight changes to return", default: 50 },
    },
  },

  // ── Inbox Management ──
  inbox_digest: { 
    description: "Get inbox digest summary (grouped by type, recent unread)", 
    params: {
      hours: { type: "number", description: "Hours back to include in digest", default: 24 },
    },
  },
  inbox_prune: { 
    description: "Remove old read inbox items", 
    params: {
      days: { type: "number", description: "Remove items older than N days", default: 7 },
    },
  },

  // Flatten Config
  get_flatten_config: { description: "Get EOD auto-flatten configuration" },
  set_flatten_enabled: { 
    description: "Enable/disable EOD auto-flatten", 
    params: {
      enabled: { type: "boolean", description: "Enable auto-flatten", required: true },
    },
  },

  // Collaboration
  collab_read: { 
    description: "Read collaboration messages", 
    params: {
      limit: { type: "number", description: "Maximum number of messages to return", default: 50 },
      author: { type: "string", description: "Filter by author", enum: ["claude", "chatgpt", "user"] },
      tag: { type: "string", description: "Filter by tag" },
      since: { type: "string", description: "Filter messages since timestamp (ISO 8601)" },
    },
  },
  collab_post: { 
    description: "Post a collaboration message", 
    params: {
      content: { type: "string", description: "Message content", required: true },
      tags: { type: "array", description: "Message tags", items: { type: "string" } },
      replyTo: { type: "string", description: "Message ID to reply to" },
    },
  },
  collab_clear: { description: "Clear all collaboration messages" },
  collab_stats: { description: "Get collaboration statistics" },

  // Inbox (event buffer for ChatGPT polling)
  check_inbox: { 
    description: "Check inbox for recent events (fills, signals, drift alerts, order status). Poll this at conversation start.", 
    params: {
      since: { type: "string", description: "Filter events since timestamp (ISO 8601)" },
      type: { type: "string", description: "Filter by event type (e.g., 'fill', 'signal', 'drift_alert', 'order_status')" },
      symbol: { type: "string", description: "Filter by symbol" },
      unread_only: { type: "boolean", description: "Only return unread items", default: false },
      limit: { type: "number", description: "Maximum number of items to return", default: 50 },
    },
  },
  mark_inbox_read: { 
    description: "Mark inbox items as read", 
    params: {
      id: { type: "string", description: "Single item ID to mark as read" },
      ids: { type: "array", description: "Array of item IDs to mark as read", items: { type: "string" } },
      all: { type: "boolean", description: "Mark all items as read", default: false },
    },
  },
  clear_inbox: { description: "Clear all inbox items" },
  inbox_stats: { description: "Get inbox statistics (total, unread, breakdown by type)" },

  // Trade Journal
  journal_read: { 
    description: "Read trade journal entries", 
    params: {
      symbol: { type: "string", description: "Filter by symbol" },
      strategy: { type: "string", description: "Filter by strategy" },
      limit: { type: "number", description: "Maximum number of entries to return", default: 100 },
    },
  },
  journal_create: { 
    description: "Create a trade journal entry", 
    params: {
      symbol: { type: "string", description: "Stock ticker symbol", required: true },
      reasoning: { type: "string", description: "Trade reasoning/setup description", required: true },
      tags: { type: "array", description: "Tags for the entry", items: { type: "string" } },
      strategy_version: { type: "string", description: "Strategy version identifier" },
      spy_price: { type: "number", description: "SPY price at entry time" },
      vix_level: { type: "number", description: "VIX level at entry time" },
      ai_recommendations: { type: "string", description: "AI recommendations/notes" },
    },
  },
  journal_get: { 
    description: "Get a specific journal entry by ID", 
    params: {
      id: { type: "number", description: "Journal entry ID", required: true },
    },
  },
  journal_update: { 
    description: "Update a journal entry", 
    params: {
      id: { type: "number", description: "Journal entry ID", required: true },
      outcome_tags: { type: "array", description: "Outcome tags (e.g., ['win', 'stopped_out'])", items: { type: "string" } },
      notes: { type: "string", description: "Additional notes/updates" },
    },
  },
  tradersync_import: { 
    description: "Import TraderSync CSV data", 
    params: {
      csv: { type: "string", description: "CSV content as string", required: true },
    },
  },
  tradersync_stats: { description: "Get TraderSync import statistics" },
  tradersync_trades: { 
    description: "Query TraderSync trades", 
    params: {
      symbol: { type: "string", description: "Filter by symbol" },
      side: { type: "string", description: "Filter by side", enum: ["LONG", "SHORT"] },
      status: { type: "string", description: "Filter by status" },
      days: { type: "number", description: "Days of history to query" },
      limit: { type: "number", description: "Maximum number of trades to return" },
    },
  },

  // History
  orders_history: { 
    description: "Query historical orders", 
    params: {
      symbol: { type: "string", description: "Filter by symbol" },
      strategy: { type: "string", description: "Filter by strategy" },
      limit: { type: "number", description: "Maximum number of orders to return", default: 100 },
    },
  },
  executions_history: { 
    description: "Query historical executions", 
    params: {
      symbol: { type: "string", description: "Filter by symbol" },
      limit: { type: "number", description: "Maximum number of executions to return", default: 100 },
    },
  },

  // Subscriptions (streaming)
  subscribe_real_time_bars: { 
    description: "Subscribe to real-time 5-second bars", 
    params: {
      symbol: { type: "string", description: "Stock ticker symbol", required: true },
      secType: { type: "string", description: "Security type", enum: ["STK", "OPT", "FUT", "CASH", "BOND", "CFD", "FOP", "WAR", "IOPT", "FWD", "BAG", "IND", "BILL", "FUND", "FIXED", "SLB", "NEWS", "CMDTY", "BSK", "ICU", "ICS"], default: "STK" },
      exchange: { type: "string", description: "Exchange code", default: "SMART" },
      currency: { type: "string", description: "Currency code", default: "USD" },
      whatToShow: { type: "string", description: "Data type to show", enum: ["TRADES", "MIDPOINT", "BID", "ASK"], default: "TRADES" },
      useRTH: { type: "boolean", description: "Use regular trading hours only", default: true },
    },
    requiresIBKR: true 
  },
  unsubscribe_real_time_bars: { 
    description: "Unsubscribe from real-time bars", 
    params: {
      subscriptionId: { type: "string", description: "Subscription ID to unsubscribe", required: true },
    },
    requiresIBKR: true 
  },
  get_real_time_bars: { 
    description: "Get buffered real-time bars from subscription", 
    params: {
      subscriptionId: { type: "string", description: "Subscription ID", required: true },
      limit: { type: "number", description: "Maximum number of bars to return (max 300)", default: 60 },
    },
    requiresIBKR: true 
  },
  subscribe_account_updates: { 
    description: "Subscribe to real-time account updates", 
    params: {
      account: { type: "string", description: "Account ID to subscribe to", required: true },
    },
    requiresIBKR: true 
  },
  unsubscribe_account_updates: { description: "Unsubscribe from account updates", requiresIBKR: true },
  get_account_snapshot_stream: { description: "Get latest account snapshot from active subscription", requiresIBKR: true },
  get_scanner_parameters: { description: "Get IBKR scanner parameters XML", requiresIBKR: true },
  list_subscriptions: { description: "List all active subscriptions", requiresIBKR: true },

  // Holly AI Alerts
  holly_import: { 
    description: "Import Holly AI alerts CSV", 
    params: {
      csv: { type: "string", description: "CSV content as string", required: true },
    },
  },
  holly_alerts: { 
    description: "Query Holly AI alerts", 
    params: {
      symbol: { type: "string", description: "Filter by symbol" },
      strategy: { type: "string", description: "Filter by strategy" },
      since: { type: "string", description: "Filter alerts since timestamp (ISO 8601)" },
      limit: { type: "number", description: "Maximum number of alerts to return", default: 100 },
    },
  },
  holly_stats: { description: "Get Holly AI alert statistics" },
  holly_symbols: { 
    description: "Get latest distinct symbols from Holly alerts", 
    params: {
      limit: { type: "number", description: "Maximum number of symbols to return", default: 20 },
    },
  },

  // Holly Pre-Alert Predictor
  holly_predictor_status: { description: "Get Holly predictor status (profiles built, strategies, sample count)" },
  holly_predictor_profiles: { 
    description: "Get feature distribution profiles learned from historical Holly alerts", 
    params: {
      min_samples: { type: "number", description: "Minimum sample size for profile inclusion", default: 20 },
      strategy: { type: "string", description: "Filter by strategy" },
    },
  },
  holly_predictor_scan: { 
    description: "Scan a single symbol against Holly strategy profiles to detect pre-alert conditions", 
    params: {
      symbol: { type: "string", description: "Stock ticker symbol", required: true },
      threshold: { type: "number", description: "Probability threshold for candidate detection", default: 0.7 },
    },
  },
  holly_predictor_scan_batch: { 
    description: "Scan multiple symbols against Holly profiles in parallel", 
    params: {
      symbols: { type: "array", description: "Array of stock ticker symbols", items: { type: "string" }, required: true },
      threshold: { type: "number", description: "Probability threshold for candidate detection", default: 0.7 },
    },
  },
  holly_predictor_candidates: { 
    description: "Get top pre-alert candidates — symbols most likely to trigger Holly alerts soon", 
    params: {
      symbols: { type: "array", description: "Array of stock ticker symbols to scan", items: { type: "string" } },
      threshold: { type: "number", description: "Probability threshold for candidate detection", default: 0.7 },
      limit: { type: "number", description: "Maximum number of candidates to return", default: 10 },
      hours_back: { type: "number", description: "Hours back to check for recent signals", default: 24 },
    },
  },
  holly_predictor_refresh: { 
    description: "Rebuild Holly predictor profiles from latest data", 
    params: {
      min_samples: { type: "number", description: "Minimum sample size for profile inclusion", default: 20 },
    },
  },

  // Holly Reverse-Engineering & Backtest
  holly_extract_rules: { 
    description: "Reverse-engineer Holly trigger conditions: extract feature thresholds that distinguish Holly alerts from baseline evaluations", 
    params: {
      min_alerts: { type: "number", description: "Minimum alerts required per rule", default: 10 },
      min_separation: { type: "number", description: "Minimum feature separation threshold", default: 0.2 },
      since: { type: "string", description: "Filter rules since timestamp (ISO 8601)" },
    },
  },
  holly_backtest: { 
    description: "Backtest extracted Holly rules across any symbol universe and timeframe. Reports precision, win rate, Sharpe, P&L per strategy", 
    params: {
      days: { type: "number", description: "Days of history to backtest" },
      symbols: { type: "array", description: "Array of symbols to backtest", items: { type: "string" } },
      min_match_score: { type: "number", description: "Minimum match score for rule firing", default: 0.6 },
      since: { type: "string", description: "Backtest start date (ISO 8601)" },
      until: { type: "string", description: "Backtest end date (ISO 8601)" },
    },
  },
  holly_strategy_breakdown: { 
    description: "Quick breakdown of each Holly strategy: defining features, separation, outcome P&L", 
    params: {
      since: { type: "string", description: "Filter since timestamp (ISO 8601)" },
    },
  },

  // Holly Trade Data (historical Trade Ideas export)
  holly_trade_import: { 
    description: "Import Holly trade CSV content (Trade Ideas export format)", 
    params: {
      csv: { type: "string", description: "CSV content as string", required: true },
    },
  },
  holly_trade_import_file: { 
    description: "Import Holly trades from a file path on disk", 
    params: {
      file_path: { type: "string", description: "Path to CSV file on disk", required: true },
    },
  },
  holly_trade_stats: { description: "Get Holly trade statistics (total, win rate, avg R, avg giveback, avg hold time)" },
  holly_trades: { 
    description: "Query Holly historical trades with MFE/MAE/giveback metrics", 
    params: {
      symbol: { type: "string", description: "Filter by symbol" },
      strategy: { type: "string", description: "Filter by strategy" },
      segment: { type: "string", description: "Filter by segment (e.g., 'AM', 'PM')" },
      since: { type: "string", description: "Filter trades since timestamp (ISO 8601)" },
      until: { type: "string", description: "Filter trades until timestamp (ISO 8601)" },
      limit: { type: "number", description: "Maximum number of trades to return", default: 100 },
    },
  },

  // Holly Exit Autopsy
  holly_exit_autopsy: { 
    description: "Full exit autopsy report: strategy leaderboard, MFE/MAE profiles, exit policy recommendations, time-of-day analysis, segment comparison", 
    params: {
      since: { type: "string", description: "Filter trades since timestamp (ISO 8601)" },
      until: { type: "string", description: "Filter trades until timestamp (ISO 8601)" },
    },
  },

  // Trailing Stop Optimizer
  trailing_stop_optimize: { 
    description: "Run all 19 trailing stop strategies on Holly trades, sorted by P&L improvement. Simulates fixed-%, ATR, time-decay, MFE-escalation, breakeven+trail exits", 
    params: {
      strategy: { type: "string", description: "Filter by strategy" },
      segment: { type: "string", description: "Filter by segment (e.g., 'AM', 'PM')" },
      since: { type: "string", description: "Filter trades since timestamp (ISO 8601)" },
      until: { type: "string", description: "Filter trades until timestamp (ISO 8601)" },
    },
  },
  trailing_stop_summary: { 
    description: "Compact comparison table of all trailing stop strategies: original vs simulated P&L, win rate, Sharpe, giveback reduction", 
    params: {
      strategy: { type: "string", description: "Filter by strategy" },
      segment: { type: "string", description: "Filter by segment (e.g., 'AM', 'PM')" },
      since: { type: "string", description: "Filter trades since timestamp (ISO 8601)" },
      until: { type: "string", description: "Filter trades until timestamp (ISO 8601)" },
    },
  },
  trailing_stop_per_strategy: { 
    description: "Find the optimal trailing stop for EACH Holly strategy independently. Shows best trailing params per strategy", 
    params: {
      since: { type: "string", description: "Filter trades since timestamp (ISO 8601)" },
      until: { type: "string", description: "Filter trades until timestamp (ISO 8601)" },
      min_trades: { type: "number", description: "Minimum trades required per strategy", default: 20 },
    },
  },
  trailing_stop_recommend: { 
    description: "Get the best trailing stop recommendation for a symbol/strategy", 
    params: {
      symbol: { type: "string", description: "Stock ticker symbol", required: true },
      strategy: { type: "string", description: "Filter by strategy" },
    },
  },
  trailing_stop_simulate: { 
    description: "Simulate a single custom trailing stop strategy with specific parameters", 
    params: {
      type: { type: "string", description: "Trailing stop type", enum: ["fixed_pct", "atr_multiple", "time_decay", "mfe_escalation", "breakeven_trail"], required: true },
      name: { type: "string", description: "Custom name for the simulation" },
      trail_pct: { type: "number", description: "Trailing percentage (for fixed_pct type)" },
      atr_mult: { type: "number", description: "ATR multiplier (for atr_multiple type)" },
      initial_target_pct: { type: "number", description: "Initial target percentage (for time_decay type)" },
      decay_per_min: { type: "number", description: "Decay per minute (for time_decay type)" },
      mfe_trigger_pct: { type: "number", description: "MFE trigger percentage (for mfe_escalation type)" },
      tight_trail_pct: { type: "number", description: "Tight trail percentage (for mfe_escalation type)" },
      be_trigger_r: { type: "number", description: "Breakeven trigger R-multiple (for breakeven_trail type)" },
      post_be_trail_pct: { type: "number", description: "Post-breakeven trail percentage (for breakeven_trail type)" },
      strategy: { type: "string", description: "Filter by strategy" },
      segment: { type: "string", description: "Filter by segment (e.g., 'AM', 'PM')" },
      since: { type: "string", description: "Filter trades since timestamp (ISO 8601)" },
      until: { type: "string", description: "Filter trades until timestamp (ISO 8601)" },
    },
  },
  trailing_stop_params: { description: "List all 19 default trailing stop parameter sets that can be tested" },

  // Signals / Auto-Eval
  signal_feed: { 
    description: "Query evaluated signals from auto-eval pipeline", 
    params: {
      symbol: { type: "string", description: "Filter by symbol" },
      direction: { type: "string", description: "Filter by direction", enum: ["LONG", "SHORT"] },
      since: { type: "string", description: "Filter signals since timestamp (ISO 8601)" },
      limit: { type: "number", description: "Maximum number of signals to return", default: 50 },
    },
  },
  signal_stats: { description: "Get signal statistics (total, tradeable, blocked)" },
  auto_eval_status: { description: "Get auto-eval pipeline status (enabled, running, config)" },
  auto_eval_toggle: { 
    description: "Enable or disable auto-eval pipeline", 
    params: {
      enabled: { type: "boolean", description: "Enable auto-eval pipeline", required: true },
    },
  },
  auto_link_stats: { description: "Get evaluation-to-execution auto-link statistics and recent links" },
  recalibration_status: { description: "Get Bayesian recalibration status: outcomes since last batch, per-regime weights, state file" },

  // Multi-model orchestration
  multi_model_score: { 
    description: "Collect weighted scores from GPT, Gemini, and Claude providers", 
    params: {
      symbol: { type: "string", description: "Stock ticker symbol", required: true },
      features: { type: "object", description: "Optional feature vector to override auto-computation" },
    },
  },
  multi_model_consensus: { 
    description: "Return weighted consensus verdict and disagreement notes from provider scores", 
    params: {
      scores: { type: "object", description: "Provider scores object with gpt4o, gemini, claude fields", required: true },
    },
  },

  // Divoom Display
  divoom_status: { description: "Check Divoom Times Gate display connection and get device info" },
  divoom_send_text: { 
    description: "Send text to Divoom Times Gate display", 
    params: {
      text: { type: "string", description: "Text to display", required: true },
      color: { type: "string", description: "Text color in hex format (e.g., '#FF0000')" },
      x: { type: "number", description: "X position (0-63)" },
      y: { type: "number", description: "Y position (0-63)" },
      font: { type: "number", description: "Font ID (0-7)" },
      scrollSpeed: { type: "number", description: "Scroll speed (ms per pixel)" },
    },
  },
  divoom_set_brightness: { 
    description: "Set Divoom Times Gate display brightness (0-100)", 
    params: {
      brightness: { type: "number", description: "Brightness level (0-100)", required: true },
    },
  },

  // Ops / Monitoring
  ops_health: { description: "Full ops health dashboard: process metrics, IBKR availability SLA, request latency percentiles, error rates, incidents" },
  ops_incidents: { 
    description: "Get recent operational incidents (disconnects, errors, heartbeat timeouts)", 
    params: {
      limit: { type: "number", description: "Maximum number of incidents to return", default: 20 },
    },
  },
  ops_runbook: { 
    description: "Get operational runbook guidance by scenario keyword", 
    params: {
      scenario: { type: "string", description: "Scenario keyword (e.g., 'bridge_crash', 'ibkr_disconnect', 'tunnel_down')", enum: ["bridge_crash", "ibkr_disconnect", "tunnel_down", "mcp_transport_broken", "high_error_rate", "memory_leak", "tws_restart"] },
    },
  },
  ops_uptime: { description: "Get uptime summary: process uptime, IBKR connection SLA, memory/CPU, error rate" },
  ops_sla: { description: "Get availability SLA report: uptime % for bridge/IBKR/tunnel/end-to-end over 1h/24h/7d/30d windows" },
  ops_outages: { 
    description: "Get recent outages with duration and affected components", 
    params: {
      limit: { type: "number", description: "Maximum number of outages to return", default: 20 },
    },
  },
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
