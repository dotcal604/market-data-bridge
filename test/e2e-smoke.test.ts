import { describe, it, expect, beforeEach, vi, beforeAll, afterAll } from "vitest";
import supertest from "supertest";
import type { Express } from "express";
import type { Server } from "http";

// ── Mock Modules (same pattern as routes.test.ts) ────────────────────

// Mock IBKR connection
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

// Mock Yahoo provider
vi.mock("../src/providers/yahoo.js", () => ({
  getQuote: vi.fn(() => ({
    symbol: "SPY",
    regularMarketPrice: 500.00,
    regularMarketTime: Date.now(),
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

// Mock database
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

// Mock status provider
vi.mock("../src/providers/status.js", () => ({
  getStatus: vi.fn(() => ({
    status: "ready",
    easternTime: "2026-02-17T10:00:00-05:00",
    marketSession: "regular",
    marketData: "yahoo-finance (always available)",
    screener: "yahoo-finance (always available)",
    ibkr: {
      connected: false,
      host: "127.0.0.1",
      port: 7497,
      clientId: 0,
      mode: "paper",
      note: "Start TWS/Gateway for account data (positions, PnL)",
    },
    timestamp: "2026-02-17T15:00:00.000Z",
  })),
}));

// Mock all IBKR modules
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
    child: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    })),
  },
  logRest: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
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
  getAutoEvalStatus: vi.fn(() => ({
    enabled: false,
    running: 0,
    maxConcurrent: 5,
    dedupWindowMin: 60,
  })),
}));

vi.mock("../src/holly/watcher.js", () => ({
  startHollyWatcher: vi.fn(),
  stopHollyWatcher: vi.fn(),
}));

vi.mock("../src/rest/gpt-instructions.js", () => ({
  getGptInstructions: vi.fn(() => "Mock GPT instructions for E2E testing"),
}));

vi.mock("../src/mcp/server.js", () => ({
  createMcpServer: vi.fn(() => ({
    connect: vi.fn(),
  })),
}));

vi.mock("../src/ws/server.js", () => ({
  initWebSocket: vi.fn(),
}));

vi.mock("../src/eval/routes.js", async () => {
  const express = await import("express");
  return {
    evalRouter: express.Router(),
  };
});

vi.mock("../src/db/reconcile.js", () => ({
  runReconciliation: vi.fn(async () => { }),
}));

vi.mock("../src/config-validator.js", () => ({
  validateConfig: vi.fn(() => ({ errors: [], warnings: [] })),
}));

// ── Tests ────────────────────────────────────────────────────────────

import { createApp } from "../src/rest/server.js";

describe("E2E Smoke Test - Bridge Startup + Core API Endpoints", () => {
  let app: Express;
  let request: ReturnType<typeof supertest>;

  beforeAll(() => {
    // Initialize app once for all tests
    app = createApp();
    request = supertest(app);
  });

  describe("Bridge Initialization", () => {
    it("should successfully create Express app", () => {
      expect(app).toBeDefined();
      expect(typeof app).toBe("function"); // Express app is a function
    });

    it("should have routes registered", () => {
      const stack = (app as any)._router?.stack || [];
      expect(stack.length).toBeGreaterThan(0);
    });
  });

  describe("Health Endpoint", () => {
    it("GET /health should return ok status", async () => {
      const response = await request.get("/health");

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("status");
      expect(response.body.status).toMatch(/ok|degraded/);
      expect(response.body).toHaveProperty("uptime_seconds");
      expect(response.body).toHaveProperty("ibkr_connected");
      expect(response.body).toHaveProperty("db_writable");
      expect(response.body).toHaveProperty("rest_server");
      expect(response.body).toHaveProperty("mcp_sessions");
      expect(response.body).toHaveProperty("timestamp");
    });

    it("GET / should return service info", async () => {
      const response = await request.get("/");

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("name", "market-data-bridge");
      expect(response.body).toHaveProperty("version");
      expect(response.body).toHaveProperty("docs");
      expect(response.body).toHaveProperty("api");
      expect(response.body).toHaveProperty("mcp");
    });
  });

  describe("Core REST API Endpoints", () => {
    describe("Status Endpoint", () => {
      it("GET /api/status should return status", async () => {
        const response = await request.get("/api/status");

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty("status");
        expect(response.body).toHaveProperty("easternTime");
        expect(response.body).toHaveProperty("marketSession");
        expect(response.body).toHaveProperty("marketData");
        expect(response.body).toHaveProperty("screener");
        expect(response.body).toHaveProperty("ibkr");
        expect(response.body).toHaveProperty("timestamp");
      });

      it("IBKR status should reflect mocked disconnected state", async () => {
        const response = await request.get("/api/status");

        expect(response.status).toBe(200);
        expect(response.body.ibkr.connected).toBe(false);
        expect(response.body.ibkr).toHaveProperty("host");
        expect(response.body.ibkr).toHaveProperty("port");
        expect(response.body.ibkr).toHaveProperty("mode");
      });
    });

    describe("Quote Endpoint", () => {
      it("GET /api/quote/:symbol should return quote data", async () => {
        const response = await request.get("/api/quote/SPY");

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty("symbol");
        expect(response.body).toHaveProperty("regularMarketPrice");
        expect(response.body).toHaveProperty("source");
      });

      it("GET /api/quote/:symbol should reject invalid symbols", async () => {
        const response = await request.get("/api/quote/INVALID@SYMBOL!");

        expect(response.status).toBe(400);
        expect(response.body).toHaveProperty("error");
        expect(response.body.error).toContain("Invalid symbol");
      });
    });

    describe("Historical Data Endpoint", () => {
      it("GET /api/history/:symbol should return historical bars", async () => {
        const response = await request.get("/api/history/SPY");

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty("symbol");
        expect(response.body).toHaveProperty("count");
        expect(response.body).toHaveProperty("bars");
        expect(Array.isArray(response.body.bars)).toBe(true);
      });
    });

    describe("News Endpoint", () => {
      it("GET /api/news/:query should return news articles", async () => {
        const response = await request.get("/api/news/SPY");

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty("count");
        expect(response.body).toHaveProperty("articles");
        expect(Array.isArray(response.body.articles)).toBe(true);
      });
    });

    describe("Trending Endpoint", () => {
      it("GET /api/trending should return trending symbols", async () => {
        const response = await request.get("/api/trending");

        expect(response.status).toBe(200);
        expect(Array.isArray(response.body)).toBe(true);
      });
    });

    describe("OpenAPI Spec Endpoint", () => {
      it("GET /openapi.json should return valid OpenAPI spec", async () => {
        const response = await request.get("/openapi.json");

        expect(response.status).toBe(200);
        expect(response.headers["content-type"]).toMatch(/json/);
        expect(response.body).toHaveProperty("openapi");
        expect(response.body).toHaveProperty("info");
        expect(response.body).toHaveProperty("paths");
        expect(response.body.openapi).toMatch(/^3\./);
      });
    });

    describe("GPT Instructions Endpoint", () => {
      it("GET /api/gpt-instructions should return instructions", async () => {
        const response = await request.get("/api/gpt-instructions");

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty("role");
        expect(response.body).toHaveProperty("instructions");
        expect(response.body.role).toBe("system");
        expect(typeof response.body.instructions).toBe("string");
      });
    });

    describe("Agent Endpoint", () => {
      it("POST /api/agent should reject unknown actions", async () => {
        const response = await request
          .post("/api/agent")
          .send({ action: "unknown_action", params: {} });

        expect(response.status).toBe(400);
        expect(response.body).toHaveProperty("error");
        expect(response.body.error).toContain("Unknown action");
        expect(response.body).toHaveProperty("available_actions");
        expect(Array.isArray(response.body.available_actions)).toBe(true);
      });
    });

    describe("IBKR-dependent Endpoints (graceful degradation)", () => {
      it("GET /api/account/summary should handle IBKR disconnection", async () => {
        const response = await request.get("/api/account/summary");

        // Should return 503 or empty data when IBKR disconnected
        expect([200, 503]).toContain(response.status);
        if (response.status === 503) {
          expect(response.body).toHaveProperty("error");
        }
      });

      it("GET /api/account/positions should handle IBKR disconnection", async () => {
        const response = await request.get("/api/account/positions");

        // Should return 200 with error message when IBKR disconnected
        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty("error");
        expect(response.body.error).toContain("IBKR not connected");
      });
    });
  });

  describe("Error Handling", () => {
    it("should return 404 for non-existent routes", async () => {
      const response = await request.get("/api/nonexistent");

      expect(response.status).toBe(404);
    });

    it("should handle malformed requests gracefully", async () => {
      const response = await request
        .post("/api/agent")
        .send("invalid json string");

      expect([400, 415]).toContain(response.status);
    });
  });

  describe("Graceful Shutdown", () => {
    it("should have mocked shutdown functions available", async () => {
      const scheduler = await import("../src/scheduler.js");
      const subscriptions = await import("../src/ibkr/subscriptions.js");
      const connection = await import("../src/ibkr/connection.js");
      const database = await import("../src/db/database.js");
      const watcher = await import("../src/holly/watcher.js");

      expect(scheduler.stopScheduler).toBeDefined();
      expect(subscriptions.unsubscribeAll).toBeDefined();
      expect(connection.disconnect).toBeDefined();
      expect(database.closeDb).toBeDefined();
      expect(watcher.stopHollyWatcher).toBeDefined();
    });

    it("shutdown functions should be callable", async () => {
      const scheduler = await import("../src/scheduler.js");
      const subscriptions = await import("../src/ibkr/subscriptions.js");
      const connection = await import("../src/ibkr/connection.js");
      const database = await import("../src/db/database.js");
      const watcher = await import("../src/holly/watcher.js");

      // Verify mocked functions can be called without throwing
      expect(() => scheduler.stopScheduler()).not.toThrow();
      expect(() => subscriptions.unsubscribeAll()).not.toThrow();
      expect(() => connection.disconnect()).not.toThrow();
      expect(() => database.closeDb()).not.toThrow();
      expect(() => watcher.stopHollyWatcher()).not.toThrow();
    });
  });
});
