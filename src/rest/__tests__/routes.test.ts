import { describe, it, expect, beforeEach, vi } from "vitest";
import supertest from "supertest";
import type { Express } from "express";

// ── Mock Modules ────────────────────────────────────────────────────

// Mock IBKR connection
vi.mock("../../ibkr/connection.js", () => ({
  isConnected: vi.fn(() => false),
  onReconnect: vi.fn(),
}));

// Mock Yahoo provider
vi.mock("../../providers/yahoo.js", () => ({
  getQuote: vi.fn(),
  getHistoricalBars: vi.fn(),
  getOptionsChain: vi.fn(),
  getOptionQuote: vi.fn(),
  getStockDetails: vi.fn(),
  searchSymbols: vi.fn(),
  getNews: vi.fn(),
  getFinancials: vi.fn(),
  getEarnings: vi.fn(),
  getRecommendations: vi.fn(),
  getTrendingSymbols: vi.fn(),
  getScreenerIds: vi.fn(),
  runScreener: vi.fn(),
  runScreenerWithQuotes: vi.fn(),
}));

// Mock database
vi.mock("../../db/database.js", () => ({
  isDbWritable: vi.fn(() => true),
  queryOrders: vi.fn(),
  queryExecutions: vi.fn(),
  queryJournal: vi.fn(),
  insertJournalEntry: vi.fn(),
  updateJournalEntry: vi.fn(),
  getJournalById: vi.fn(),
  upsertRiskConfig: vi.fn(),
  getEvaluationById: vi.fn(),
  insertOutcome: vi.fn(),
  getEvalsForSimulation: vi.fn(() => []),
  getTraderSyncStats: vi.fn(),
  getTraderSyncTrades: vi.fn(),
  queryHollyAlerts: vi.fn(() => []),
  getHollyAlertStats: vi.fn(() => ({ total: 0, uniqueSymbols: 0, strategies: [] })),
  getLatestHollySymbols: vi.fn(() => []),
  querySignals: vi.fn(() => []),
  getSignalStats: vi.fn(() => ({ total: 0, tradeable: 0, blocked: 0, long: 0, short: 0 })),
}));

// Mock status provider
vi.mock("../../providers/status.js", () => ({
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

// Mock all other IBKR modules
vi.mock("../../ibkr/account.js", () => ({
  getAccountSummary: vi.fn(),
  getPositions: vi.fn(),
  getPnL: vi.fn(),
}));

vi.mock("../../ibkr/orders.js", () => ({
  getOpenOrders: vi.fn(),
  getCompletedOrders: vi.fn(),
  getExecutions: vi.fn(),
  placeOrder: vi.fn(),
  placeBracketOrder: vi.fn(),
  placeAdvancedBracket: vi.fn(),
  modifyOrder: vi.fn(),
  cancelOrder: vi.fn(),
  cancelAllOrders: vi.fn(),
  flattenAllPositions: vi.fn(),
  validateOrder: vi.fn(),
}));

vi.mock("../../ibkr/portfolio.js", () => ({
  computePortfolioExposure: vi.fn(),
  runPortfolioStressTest: vi.fn(),
}));

vi.mock("../../scheduler.js", () => ({
  setFlattenEnabled: vi.fn(),
  getFlattenConfig: vi.fn(),
}));

vi.mock("../../ibkr/contracts.js", () => ({
  getContractDetails: vi.fn(),
}));

vi.mock("../../ibkr/marketdata.js", () => ({
  getIBKRQuote: vi.fn(),
  getHistoricalTicks: vi.fn(),
}));

vi.mock("../../ibkr/news.js", () => ({
  reqHistoricalNews: vi.fn(),
  reqNewsArticle: vi.fn(),
  reqNewsBulletins: vi.fn(),
  reqNewsProviders: vi.fn(),
}));

vi.mock("../../ibkr/data.js", () => ({
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

vi.mock("../../collab/store.js", () => ({
  readMessages: vi.fn(),
  postMessage: vi.fn(),
  clearMessages: vi.fn(),
  getStats: vi.fn(),
}));

vi.mock("../../ibkr/risk-gate.js", () => ({
  checkRisk: vi.fn(),
  getSessionState: vi.fn(),
  recordTradeResult: vi.fn(),
  lockSession: vi.fn(),
  unlockSession: vi.fn(),
  resetSession: vi.fn(),
  getRiskGateConfig: vi.fn(),
}));

vi.mock("../../ibkr/risk.js", () => ({
  calculatePositionSize: vi.fn(),
}));

vi.mock("../../eval/risk-tuning.js", () => ({
  tuneRiskParams: vi.fn(),
}));

vi.mock("../../eval/drift.js", () => ({
  computeDriftReport: vi.fn(),
}));

vi.mock("../../eval/drift-alerts.js", () => ({
  checkDriftAlerts: vi.fn(),
  getRecentDriftAlerts: vi.fn(() => []),
}));

vi.mock("../../eval/ensemble/scorer.js", () => ({
  computeEnsembleWithWeights: vi.fn(),
}));

vi.mock("../../eval/ensemble/weights.js", () => ({
  getWeights: vi.fn(() => ({ claude: 1, gpt4o: 1, gemini: 1, k: 1 })),
}));

vi.mock("../../db/schema.js", () => ({
  RISK_CONFIG_DEFAULTS: { maxDailyLoss: 500, maxPositionSize: 100 },
}));

vi.mock("../../tradersync/importer.js", () => ({
  importTraderSyncCSV: vi.fn(),
}));

vi.mock("../../logging.js", () => ({
  logger: {
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
}));

vi.mock("../../ibkr/subscriptions.js", () => ({
  subscribeRealTimeBars: vi.fn(),
  unsubscribeRealTimeBars: vi.fn(),
  getRealTimeBars: vi.fn(() => []),
  subscribeAccountUpdates: vi.fn(),
  unsubscribeAccountUpdates: vi.fn(),
  getAccountSnapshot: vi.fn(),
  getScannerParameters: vi.fn(),
  listSubscriptions: vi.fn(() => []),
}));

vi.mock("../../holly/importer.js", () => ({
  importHollyAlerts: vi.fn(),
}));

vi.mock("../../holly/auto-eval.js", () => ({
  isAutoEvalEnabled: vi.fn(() => false),
  setAutoEvalEnabled: vi.fn(),
  getAutoEvalStatus: vi.fn(() => ({
    enabled: false,
    running: 0,
    maxConcurrent: 5,
    dedupWindowMin: 60,
  })),
}));

vi.mock("../gpt-instructions.js", () => ({
  getGptInstructions: vi.fn(() => "Mock GPT instructions for testing"),
}));

vi.mock("../../mcp/server.js", () => ({
  createMcpServer: vi.fn(() => ({
    connect: vi.fn(),
  })),
}));

vi.mock("../../ws/server.js", () => ({
  initWebSocket: vi.fn(),
}));

vi.mock("../../eval/routes.js", async () => {
  const express = await import("express");
  return {
    evalRouter: express.Router(),
  };
});

// ── Tests ────────────────────────────────────────────────────────────

import { createApp } from "../server.js";
import { validateSymbol } from "../routes.js";

describe("REST Routes", () => {
  let app: Express;
  let request: ReturnType<typeof supertest>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
    request = supertest(app);
  });

  describe("POST /api/agent", () => {
    it("returns 400 with available actions when action is unknown", async () => {
      const response = await request
        .post("/api/agent")
        .send({ action: "unknown_action", params: {} });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty("error");
      expect(response.body.error).toContain("Unknown action");
      expect(response.body).toHaveProperty("available_actions");
      expect(response.body.available_actions).toBeInstanceOf(Array);
      expect(response.body.available_actions.length).toBeGreaterThan(0);
      expect(response.body.available_actions).toContain("get_status");
    });
  });

  describe("GET /api/status", () => {
    it("returns correct status shape", async () => {
      const response = await request.get("/api/status");

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("status");
      expect(response.body).toHaveProperty("easternTime");
      expect(response.body).toHaveProperty("marketSession");
      expect(response.body).toHaveProperty("marketData");
      expect(response.body).toHaveProperty("screener");
      expect(response.body).toHaveProperty("ibkr");
      expect(response.body).toHaveProperty("timestamp");
      
      // Verify IBKR object structure
      expect(response.body.ibkr).toHaveProperty("connected");
      expect(response.body.ibkr).toHaveProperty("host");
      expect(response.body.ibkr).toHaveProperty("port");
      expect(response.body.ibkr).toHaveProperty("clientId");
      expect(response.body.ibkr).toHaveProperty("mode");
    });
  });

  describe("GET /api/gpt-instructions", () => {
    it("returns string instructions", async () => {
      const response = await request.get("/api/gpt-instructions");

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("role");
      expect(response.body).toHaveProperty("instructions");
      expect(response.body.role).toBe("system");
      expect(typeof response.body.instructions).toBe("string");
      expect(response.body.instructions.length).toBeGreaterThan(0);
    });
  });

  describe("GET /openapi.json", () => {
    it("returns valid JSON", async () => {
      const response = await request.get("/openapi.json");

      expect(response.status).toBe(200);
      expect(response.headers["content-type"]).toMatch(/json/);
      
      // Verify it's a valid OpenAPI spec structure
      expect(response.body).toHaveProperty("openapi");
      expect(response.body).toHaveProperty("info");
      expect(response.body).toHaveProperty("paths");
      
      // Should be a 3.x spec
      expect(response.body.openapi).toMatch(/^3\./);
    });
  });

  describe("validateSymbol", () => {
    it("accepts BRK.B", () => {
      const result = validateSymbol("BRK.B");
      expect(result).toBeNull();
    });

    it("accepts ^SPX", () => {
      const result = validateSymbol("^SPX");
      expect(result).toBeNull();
    });

    it("rejects path traversal attempts", () => {
      const result = validateSymbol("../../etc");
      expect(result).not.toBeNull();
      expect(result).toContain("Invalid symbol");
    });

    it("rejects empty string", () => {
      const result = validateSymbol("");
      expect(result).not.toBeNull();
      expect(result).toContain("Invalid symbol");
    });

    it("rejects symbols over 20 characters", () => {
      const result = validateSymbol("A".repeat(21));
      expect(result).not.toBeNull();
      expect(result).toContain("Invalid symbol");
    });

    it("rejects symbols with forward slashes", () => {
      const result = validateSymbol("ABC/DEF");
      expect(result).not.toBeNull();
      expect(result).toContain("Invalid symbol");
    });
  });
});
