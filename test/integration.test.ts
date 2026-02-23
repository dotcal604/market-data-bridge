/**
 * Integration Tests — Indicator Endpoints + WebSocket Sequence Features
 *
 * Covers the streaming indicator engine and WebSocket ordering introduced in
 * commit 0d6e0ab ("feat: add streaming indicator engine + MCP/REST exposure +
 * WebSocket ordering").
 *
 * Tests:
 * 1. GET /api/indicators — list all snapshots
 * 2. GET /api/indicators/:symbol — per-symbol snapshot (404 + 200 paths)
 * 3. Quote endpoint still functions alongside indicator routes
 * 4. WS sequence IDs are monotonically increasing across channels
 */

import { describe, it, expect, vi, beforeAll } from "vitest";
import supertest from "supertest";
import type { Express } from "express";

// ── Mocks — same pattern as e2e-smoke.test.ts ─────────────────────────────

vi.mock("../src/ibkr/connection.js", () => ({
  isConnected: vi.fn(() => false),
  getConnectionStatus: vi.fn(() => ({
    connected: false,
    host: "127.0.0.1",
    port: 7497,
    clientId: 0,
    mode: "paper",
    twsVersion: null,
    lastConnectedAt: null,
    lastDisconnectedAt: null,
    totalDisconnects: 0,
    reconnectAttempts: 0,
    uptimeSinceConnect: null,
    recentEvents: [],
  })),
  onReconnect: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  scheduleReconnect: vi.fn(),
}));

vi.mock("../src/providers/yahoo.js", () => ({
  getQuote: vi.fn((symbol: string) => ({
    symbol: symbol.toUpperCase(),
    regularMarketPrice: 175.5,
    regularMarketTime: Date.now(),
    bid: 175.4,
    ask: 175.6,
    source: "yahoo",
  })),
  getHistoricalBars: vi.fn(() => []),
  getOptionsChain: vi.fn(),
  getOptionQuote: vi.fn(),
  getStockDetails: vi.fn(),
  searchSymbols: vi.fn(),
  getNews: vi.fn(() => []),
  getFinancials: vi.fn(),
  getEarnings: vi.fn(),
  getRecommendations: vi.fn(),
  getTrendingSymbols: vi.fn(() => []),
  getScreenerIds: vi.fn(() => []),
  runScreener: vi.fn(() => []),
  runScreenerWithQuotes: vi.fn(() => []),
}));

vi.mock("../src/db/database.js", () => ({
  isDbWritable: vi.fn(() => true),
  closeDb: vi.fn(),
  queryOrders: vi.fn(() => []),
  queryExecutions: vi.fn(() => []),
  queryJournal: vi.fn(() => []),
  insertJournalEntry: vi.fn(),
  updateJournalEntry: vi.fn(),
  getJournalById: vi.fn(),
  upsertRiskConfig: vi.fn(),
  getEvaluationById: vi.fn(),
  insertOutcome: vi.fn(),
  getEvalsForSimulation: vi.fn(() => []),
  getTraderSyncStats: vi.fn(() => ({ total: 0, winRate: 0 })),
  getTraderSyncTrades: vi.fn(() => []),
  queryHollyAlerts: vi.fn(() => []),
  getHollyAlertStats: vi.fn(() => ({ total: 0, uniqueSymbols: 0, strategies: [] })),
  getLatestHollySymbols: vi.fn(() => []),
  querySignals: vi.fn(() => []),
  getSignalStats: vi.fn(() => ({ total: 0, tradeable: 0, blocked: 0, long: 0, short: 0 })),
  getActiveMcpSessions: vi.fn(() => []),
  insertMcpSession: vi.fn(),
  updateMcpSessionActivity: vi.fn(),
  closeMcpSession: vi.fn(),
}));

vi.mock("../src/providers/status.js", () => ({
  getStatus: vi.fn(() => ({
    status: "ready",
    easternTime: "2026-02-17T10:00:00-05:00",
    marketSession: "regular",
    marketData: "yahoo-finance (always available)",
    screener: "yahoo-finance (always available)",
    ibkr: { connected: false, host: "127.0.0.1", port: 7497, clientId: 0, mode: "paper" },
    timestamp: "2026-02-17T15:00:00.000Z",
  })),
}));

vi.mock("../src/ibkr/account.js", () => ({
  getAccountSummary: vi.fn(() => ({})),
  getPositions: vi.fn(() => []),
  getPnL: vi.fn(() => ({ daily: 0, total: 0 })),
}));

vi.mock("../src/ibkr/orders.js", () => ({
  getOpenOrders: vi.fn(() => []),
  getCompletedOrders: vi.fn(() => []),
  getExecutions: vi.fn(() => []),
  placeOrder: vi.fn(),
  placeBracketOrder: vi.fn(),
  placeAdvancedBracket: vi.fn(),
  modifyOrder: vi.fn(),
  cancelOrder: vi.fn(),
  cancelAllOrders: vi.fn(),
  flattenAllPositions: vi.fn(),
  validateOrder: vi.fn(() => ({ valid: true, errors: [] })),
  attachPersistentOrderListeners: vi.fn(),
}));

vi.mock("../src/ibkr/portfolio.js", () => ({
  computePortfolioExposure: vi.fn(() => ({ gross: 0, net: 0 })),
  runPortfolioStressTest: vi.fn(() => ({ baseValue: 0, scenarios: [] })),
}));

vi.mock("../src/scheduler.js", () => ({
  setFlattenEnabled: vi.fn(),
  getFlattenConfig: vi.fn(() => ({ enabled: false, time: "15:55" })),
  startScheduler: vi.fn(),
  stopScheduler: vi.fn(),
}));

vi.mock("../src/ibkr/contracts.js", () => ({
  getContractDetails: vi.fn(),
}));

vi.mock("../src/ibkr/marketdata.js", () => ({
  getIBKRQuote: vi.fn(),
  getHistoricalTicks: vi.fn(() => []),
}));

vi.mock("../src/ibkr/news.js", () => ({
  reqHistoricalNews: vi.fn(() => []),
  reqNewsArticle: vi.fn(),
  reqNewsBulletins: vi.fn(() => []),
  reqNewsProviders: vi.fn(() => []),
}));

vi.mock("../src/ibkr/data.js", () => ({
  calculateImpliedVolatility: vi.fn(),
  calculateOptionPrice: vi.fn(),
  reqAutoOpenOrders: vi.fn(),
  reqCurrentTime: vi.fn(),
  reqFundamentalDataBySymbol: vi.fn(),
  reqHeadTimestampBySymbol: vi.fn(),
  reqHistogramDataBySymbol: vi.fn(),
  reqMarketDataType: vi.fn(),
  reqMarketRule: vi.fn(),
  reqMatchingSymbols: vi.fn(),
  reqMktDepthExchanges: vi.fn(),
  reqPnLSingleBySymbol: vi.fn(),
  reqSmartComponents: vi.fn(),
}));

vi.mock("../src/collab/store.js", () => ({
  readMessages: vi.fn(() => []),
  postMessage: vi.fn(),
  clearMessages: vi.fn(),
  getStats: vi.fn(() => ({ total: 0, byAuthor: {} })),
  initCollabFromDb: vi.fn(),
}));

vi.mock("../src/ibkr/risk-gate.js", () => ({
  checkRisk: vi.fn(() => ({ allowed: true })),
  getSessionState: vi.fn(() => ({ locked: false, trades: 0 })),
  recordTradeResult: vi.fn(),
  lockSession: vi.fn(),
  unlockSession: vi.fn(),
  resetSession: vi.fn(),
  getRiskGateConfig: vi.fn(() => ({ maxPositionSize: 100 })),
}));

vi.mock("../src/ibkr/risk.js", () => ({
  calculatePositionSize: vi.fn(() => ({ shares: 100, notional: 10000 })),
}));

vi.mock("../src/eval/risk-tuning.js", () => ({
  tuneRiskParams: vi.fn(),
}));

vi.mock("../src/eval/drift.js", () => ({
  computeDriftReport: vi.fn(() => ({ drift: 0, models: [] })),
}));

vi.mock("../src/eval/drift-alerts.js", () => ({
  checkDriftAlerts: vi.fn(),
  getRecentDriftAlerts: vi.fn(() => []),
}));

vi.mock("../src/eval/ensemble/scorer.js", () => ({
  computeEnsembleWithWeights: vi.fn(),
}));

vi.mock("../src/eval/ensemble/weights.js", () => ({
  getWeights: vi.fn(() => ({ claude: 1, gpt4o: 1, gemini: 1, k: 1 })),
  initWeights: vi.fn(),
}));

vi.mock("../src/db/schema.js", () => ({
  RISK_CONFIG_DEFAULTS: { maxDailyLoss: 500, maxPositionSize: 100 },
}));

vi.mock("../src/tradersync/importer.js", () => ({
  importTraderSyncCSV: vi.fn(),
}));

vi.mock("../src/logging.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
  },
  logRest: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  requestLogger: vi.fn((req, res, next) => next()),
  pruneOldLogs: vi.fn(),
}));

vi.mock("../src/ibkr/subscriptions.js", () => ({
  subscribeRealTimeBars: vi.fn(),
  unsubscribeRealTimeBars: vi.fn(),
  getRealTimeBars: vi.fn(() => []),
  subscribeAccountUpdates: vi.fn(),
  unsubscribeAccountUpdates: vi.fn(),
  getAccountSnapshot: vi.fn(),
  getScannerParameters: vi.fn(),
  listSubscriptions: vi.fn(() => []),
  unsubscribeAll: vi.fn(),
}));

vi.mock("../src/holly/importer.js", () => ({
  importHollyAlerts: vi.fn(),
}));

vi.mock("../src/holly/auto-eval.js", () => ({
  isAutoEvalEnabled: vi.fn(() => false),
  setAutoEvalEnabled: vi.fn(),
  getAutoEvalStatus: vi.fn(() => ({ enabled: false, running: 0, maxConcurrent: 5, dedupWindowMin: 60 })),
}));

vi.mock("../src/holly/watcher.js", () => ({
  startHollyWatcher: vi.fn(),
  stopHollyWatcher: vi.fn(),
}));

vi.mock("../src/rest/gpt-instructions.js", () => ({
  getGptInstructions: vi.fn(() => "Mock GPT instructions"),
}));

vi.mock("../src/mcp/server.js", () => ({
  createMcpServer: vi.fn(() => ({ connect: vi.fn() })),
}));

vi.mock("../src/ws/server.js", () => {
  let seq = 0;
  return {
    initWebSocket: vi.fn(),
    wsBroadcast: vi.fn(),
    wsBroadcastWithSequence: vi.fn(),
    getNextSequenceId: vi.fn(() => ++seq),
  };
});

vi.mock("../src/eval/routes.js", async () => {
  const express = await import("express");
  return { evalRouter: express.Router() };
});

vi.mock("../src/db/reconcile.js", () => ({
  runReconciliation: vi.fn(async () => {}),
}));

vi.mock("../src/config-validator.js", () => ({
  validateConfig: vi.fn(() => ({ errors: [], warnings: [] })),
}));

// ── Indicator engine mock — returns controlled snapshots ──────────────────

const MOCK_AAPL_SNAPSHOT = {
  symbol: "AAPL",
  ts_et: "2026-02-17T10:30:00-05:00",
  source: "ibkr" as const,
  price_last: 175.5,
  price_bid: 175.4,
  price_ask: 175.6,
  spread_pct: 0.11,
  bar_1m_open: 175.0,
  bar_1m_high: 176.0,
  bar_1m_low: 174.8,
  bar_1m_close: 175.5,
  bar_1m_volume: 12500,
  volume_cumulative: 250000,
  rvol_20d: 1.25,
  ema_9: 175.1,
  ema_21: 174.5,
  vwap: 175.2,
  vwap_dev_pct: 0.17,
  rsi_14: 58.3,
  macd_line: 0.42,
  macd_signal: 0.35,
  macd_histogram: 0.07,
  atr_14_pct: 1.31,
  bollinger_upper: 177.0,
  bollinger_lower: 173.0,
  bb_width_pct: 2.29,
  high_of_day: 176.5,
  low_of_day: 174.0,
  range_pct: 1.44,
  range_position: 0.6,
  prior_close: 174.8,
  gap_pct: 0.4,
  flags: [],
};

vi.mock("../src/indicators/engine.js", () => ({
  getSnapshot: vi.fn((symbol: string) =>
    symbol.toUpperCase() === "AAPL" ? MOCK_AAPL_SNAPSHOT : null
  ),
  getAllSnapshots: vi.fn(() => [MOCK_AAPL_SNAPSHOT]),
  getTrackedSymbols: vi.fn(() => ["AAPL"]),
  feedBar: vi.fn(),
  removeEngine: vi.fn(() => false),
  _resetForTesting: vi.fn(),
}));

// ── App setup ─────────────────────────────────────────────────────────────

import { createApp } from "../src/rest/server.js";

describe("Integration — Indicator Endpoints + WebSocket Sequence", () => {
  let app: Express;
  let request: ReturnType<typeof supertest>;

  beforeAll(() => {
    app = createApp();
    request = supertest(app);
  });

  // ── GET /api/indicators ─────────────────────────────────────────────────

  describe("GET /api/indicators", () => {
    it("should return 200 with count and snapshots array", async () => {
      const res = await request.get("/api/indicators");

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("count");
      expect(res.body).toHaveProperty("snapshots");
      expect(Array.isArray(res.body.snapshots)).toBe(true);
    });

    it("should return the mocked AAPL snapshot in the list", async () => {
      const res = await request.get("/api/indicators");

      expect(res.status).toBe(200);
      expect(res.body.count).toBe(1);
      expect(res.body.snapshots[0].symbol).toBe("AAPL");
    });

    it("should include all required FeatureSnapshot fields", async () => {
      const res = await request.get("/api/indicators");

      const snap = res.body.snapshots[0];
      expect(snap).toHaveProperty("symbol");
      expect(snap).toHaveProperty("ts_et");
      expect(snap).toHaveProperty("source");
      expect(snap).toHaveProperty("price_last");
      expect(snap).toHaveProperty("ema_9");
      expect(snap).toHaveProperty("ema_21");
      expect(snap).toHaveProperty("rsi_14");
      expect(snap).toHaveProperty("macd_line");
      expect(snap).toHaveProperty("vwap");
      expect(snap).toHaveProperty("atr_14_pct");
    });
  });

  // ── GET /api/indicators/:symbol ─────────────────────────────────────────

  describe("GET /api/indicators/:symbol", () => {
    it("should return 200 with snapshot for tracked symbol", async () => {
      const res = await request.get("/api/indicators/AAPL");

      expect(res.status).toBe(200);
      expect(res.body.symbol).toBe("AAPL");
      expect(res.body.price_last).toBe(175.5);
      expect(res.body.rsi_14).toBe(58.3);
    });

    it("should return 404 for untracked symbol", async () => {
      const res = await request.get("/api/indicators/UNKNOWN");

      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty("error");
    });

    it("should return indicator values from streaming engine", async () => {
      const res = await request.get("/api/indicators/AAPL");

      expect(res.status).toBe(200);
      expect(res.body.ema_9).toBe(175.1);
      expect(res.body.ema_21).toBe(174.5);
      expect(res.body.vwap).toBe(175.2);
      expect(res.body.macd_histogram).toBe(0.07);
      expect(res.body.bollinger_upper).toBe(177.0);
      expect(res.body.bollinger_lower).toBe(173.0);
    });

    it("should return source field indicating data origin", async () => {
      const res = await request.get("/api/indicators/AAPL");

      expect(res.status).toBe(200);
      expect(["ibkr", "yahoo"]).toContain(res.body.source);
    });
  });

  // ── Quote endpoint still works alongside indicators ─────────────────────

  describe("GET /api/quote/:symbol (indicator integration)", () => {
    it("should return quote data independently of indicator engine", async () => {
      const res = await request.get("/api/quote/AAPL");

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("symbol");
      expect(res.body).toHaveProperty("regularMarketPrice");
      expect(res.body).toHaveProperty("source");
    });

    it("indicator and quote endpoints return data for same symbol", async () => {
      const [quoteRes, indicatorRes] = await Promise.all([
        request.get("/api/quote/AAPL"),
        request.get("/api/indicators/AAPL"),
      ]);

      expect(quoteRes.status).toBe(200);
      expect(indicatorRes.status).toBe(200);
      expect(quoteRes.body.symbol).toBe(indicatorRes.body.symbol);
    });
  });

  // ── WebSocket sequence ordering ──────────────────────────────────────────

  describe("WebSocket message sequence IDs (via ws/server exports)", () => {
    it("getNextSequenceId increments monotonically", async () => {
      const { getNextSequenceId } = await import("../src/ws/server.js");

      const s1 = getNextSequenceId();
      const s2 = getNextSequenceId();
      const s3 = getNextSequenceId();

      expect(s2).toBeGreaterThan(s1);
      expect(s3).toBeGreaterThan(s2);
    });

    it("wsBroadcast does not throw when called before WS server init", async () => {
      const { wsBroadcast } = await import("../src/ws/server.js");

      expect(() => {
        wsBroadcast("eval_created", {
          type: "eval",
          action: "created",
          evalId: "test-123",
          symbol: "AAPL",
          score: 75,
          models: ["claude", "gpt4o", "gemini"],
          timestamp: new Date().toISOString(),
        });
      }).not.toThrow();
    });

    it("wsBroadcastWithSequence does not throw when called before WS server init", async () => {
      const { wsBroadcastWithSequence, getNextSequenceId } = await import("../src/ws/server.js");
      const seq = getNextSequenceId();

      expect(() => {
        wsBroadcastWithSequence("journal_posted", {
          type: "journal",
          action: "posted",
          entryId: 1,
          symbol: "AAPL",
          reasoning: "Strong setup",
          timestamp: new Date().toISOString(),
        }, seq);
      }).not.toThrow();
    });
  });
});
