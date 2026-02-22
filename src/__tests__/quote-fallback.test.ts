import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

// ─── Module Mocks (must be before any import that uses them) ─────────────────

vi.mock("../ibkr/connection.js", () => ({
  isConnected: vi.fn(() => false),
}));

vi.mock("../ibkr/marketdata.js", () => ({
  getIBKRQuote: vi.fn(),
  getHistoricalTicks: vi.fn(),
}));

vi.mock("../providers/yahoo.js", () => ({
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

vi.mock("../providers/status.js", () => ({
  getStatus: vi.fn(() => ({ status: "ready", marketSession: "regular" })),
}));

vi.mock("../ibkr/account.js", () => ({
  getAccountSummary: vi.fn(),
  getPositions: vi.fn(),
  getPnL: vi.fn(),
}));

vi.mock("../ibkr/orders.js", () => ({
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

vi.mock("../ibkr/portfolio.js", () => ({
  computePortfolioExposure: vi.fn(),
  runPortfolioStressTest: vi.fn(),
}));

vi.mock("../scheduler.js", () => ({
  setFlattenEnabled: vi.fn(),
  getFlattenConfig: vi.fn(),
}));

vi.mock("../ibkr/contracts.js", () => ({
  getContractDetails: vi.fn(),
}));

vi.mock("../ibkr/news.js", () => ({
  reqHistoricalNews: vi.fn(),
  reqNewsArticle: vi.fn(),
  reqNewsBulletins: vi.fn(),
  reqNewsProviders: vi.fn(),
}));

vi.mock("../ibkr/subscriptions.js", () => ({
  subscribeRealTimeBars: vi.fn(),
  unsubscribeRealTimeBars: vi.fn(),
  getRealTimeBars: vi.fn(),
  subscribeAccountUpdates: vi.fn(),
  unsubscribeAccountUpdates: vi.fn(),
  getAccountSnapshot: vi.fn(),
  getScannerParameters: vi.fn(),
  listSubscriptions: vi.fn(),
}));

vi.mock("../ibkr/data.js", () => ({
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

vi.mock("../collab/store.js", () => ({
  readMessages: vi.fn(),
  postMessage: vi.fn(),
  clearMessages: vi.fn(),
  getStats: vi.fn(),
}));

vi.mock("../rest/gpt-instructions.js", () => ({
  getGptInstructions: vi.fn(() => ""),
}));

vi.mock("../ibkr/risk-gate.js", () => ({
  checkRisk: vi.fn(),
  getSessionState: vi.fn(),
  recordTradeResult: vi.fn(),
  lockSession: vi.fn(),
  unlockSession: vi.fn(),
  resetSession: vi.fn(),
  getRiskGateConfig: vi.fn(),
}));

vi.mock("../ibkr/risk.js", () => ({
  calculatePositionSize: vi.fn(),
}));

vi.mock("../logging.js", () => ({
  logger: {
    child: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    })),
  },
}));

vi.mock("../rest/openapi.js", () => ({
  getOpenApiSpec: vi.fn(() => ({})),
}));

vi.mock("../eval/risk-tuning.js", () => ({
  tuneRiskParams: vi.fn(),
}));

vi.mock("../db/schema.js", () => ({
  RISK_CONFIG_DEFAULTS: {
    max_position_pct: 0.05,
    max_daily_loss_pct: 0.02,
    max_concentration_pct: 0.25,
    volatility_scalar: 1.0,
  },
}));

vi.mock("../db/database.js", () => ({
  queryOrders: vi.fn(),
  queryExecutions: vi.fn(),
  queryJournal: vi.fn(),
  insertJournalEntry: vi.fn(),
  updateJournalEntry: vi.fn(),
  getJournalById: vi.fn(),
  upsertRiskConfig: vi.fn(),
  queryAccountSnapshots: vi.fn(),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeYahooQuote(symbol: string = "AAPL") {
  return {
    symbol,
    bid: 149.99,
    ask: 150.01,
    last: 150.0,
    open: 148.0,
    high: 151.0,
    low: 147.5,
    close: 149.0,
    volume: 1_000_000,
    change: 1.0,
    changePercent: 0.67,
    marketCap: 2_400_000_000_000,
    timestamp: new Date().toISOString(),
  };
}

function makeIbkrQuote(symbol: string = "AAPL") {
  return {
    symbol,
    bid: 149.98,
    ask: 150.02,
    last: 150.0,
    open: 148.0,
    high: 151.0,
    low: 147.5,
    close: 149.0,
    volume: 500_000,
    timestamp: new Date().toISOString(),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("GET /api/quote/:symbol — fallback behavior", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Build a fresh Express app wired to the router for each test
    const { router } = await import("../rest/routes.js");
    app = express();
    app.use(express.json());
    app.use("/api", router);
  });

  it("1. IBKR connected and returns data → source is 'ibkr'", async () => {
    const { isConnected } = await import("../ibkr/connection.js");
    const { getIBKRQuote } = await import("../ibkr/marketdata.js");

    vi.mocked(isConnected).mockReturnValue(true);
    vi.mocked(getIBKRQuote).mockResolvedValue(makeIbkrQuote());

    const res = await request(app).get("/api/quote/AAPL");

    expect(res.status).toBe(200);
    expect(res.body.source).toBe("ibkr");
    expect(res.body.symbol).toBe("AAPL");
    expect(res.body.last).toBe(150.0);
  });

  it("2. IBKR fails/throws → fallback to Yahoo returns source 'yahoo'", async () => {
    const { isConnected } = await import("../ibkr/connection.js");
    const { getIBKRQuote } = await import("../ibkr/marketdata.js");
    const { getQuote } = await import("../providers/yahoo.js");

    vi.mocked(isConnected).mockReturnValue(true);
    vi.mocked(getIBKRQuote).mockRejectedValue(new Error("TWS timeout"));
    vi.mocked(getQuote).mockResolvedValue(makeYahooQuote());

    const res = await request(app).get("/api/quote/AAPL");

    expect(res.status).toBe(200);
    expect(res.body.source).toBe("yahoo");
    expect(res.body.symbol).toBe("AAPL");
  });

  it("3. Yahoo fallback when IBKR connected → response includes warning field", async () => {
    const { isConnected } = await import("../ibkr/connection.js");
    const { getIBKRQuote } = await import("../ibkr/marketdata.js");
    const { getQuote } = await import("../providers/yahoo.js");

    vi.mocked(isConnected).mockReturnValue(true);
    vi.mocked(getIBKRQuote).mockRejectedValue(new Error("IBKR unavailable"));
    vi.mocked(getQuote).mockResolvedValue(makeYahooQuote());

    const res = await request(app).get("/api/quote/AAPL");

    expect(res.status).toBe(200);
    expect(res.body.source).toBe("yahoo");
    expect(res.body.warning).toBeDefined();
    expect(typeof res.body.warning).toBe("string");
    expect(res.body.warning).toContain("IBKR");
  });

  it("4. Quote response always includes a timestamp field", async () => {
    const { isConnected } = await import("../ibkr/connection.js");
    const { getQuote } = await import("../providers/yahoo.js");

    vi.mocked(isConnected).mockReturnValue(false);
    vi.mocked(getQuote).mockResolvedValue(makeYahooQuote());

    const res = await request(app).get("/api/quote/AAPL");

    expect(res.status).toBe(200);
    expect(res.body.timestamp).toBeDefined();
    expect(typeof res.body.timestamp).toBe("string");
    // Should be a valid ISO date string
    expect(new Date(res.body.timestamp).toISOString()).toBe(res.body.timestamp);
  });

  it("4b. IBKR quote also always includes a timestamp field", async () => {
    const { isConnected } = await import("../ibkr/connection.js");
    const { getIBKRQuote } = await import("../ibkr/marketdata.js");

    vi.mocked(isConnected).mockReturnValue(true);
    vi.mocked(getIBKRQuote).mockResolvedValue(makeIbkrQuote());

    const res = await request(app).get("/api/quote/AAPL");

    expect(res.status).toBe(200);
    expect(res.body.source).toBe("ibkr");
    expect(res.body.timestamp).toBeDefined();
    expect(typeof res.body.timestamp).toBe("string");
  });

  it("5. Same symbol requested twice within 500ms — both calls succeed", async () => {
    const { isConnected } = await import("../ibkr/connection.js");
    const { getQuote } = await import("../providers/yahoo.js");

    vi.mocked(isConnected).mockReturnValue(false);
    vi.mocked(getQuote).mockResolvedValue(makeYahooQuote());

    // Fire both requests simultaneously (within 500ms)
    const [res1, res2] = await Promise.all([
      request(app).get("/api/quote/AAPL"),
      request(app).get("/api/quote/AAPL"),
    ]);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(res1.body.source).toBe("yahoo");
    expect(res2.body.source).toBe("yahoo");
    // Both requests should be fulfilled (no rate-limit error thrown)
    expect(vi.mocked(getQuote)).toHaveBeenCalledTimes(2);
  });

  it("5b. No warning when IBKR is not connected and Yahoo is the primary source", async () => {
    const { isConnected } = await import("../ibkr/connection.js");
    const { getQuote } = await import("../providers/yahoo.js");

    vi.mocked(isConnected).mockReturnValue(false);
    vi.mocked(getQuote).mockResolvedValue(makeYahooQuote());

    const res = await request(app).get("/api/quote/AAPL");

    expect(res.status).toBe(200);
    expect(res.body.source).toBe("yahoo");
    // No warning — Yahoo is used intentionally (IBKR not even connected)
    expect(res.body.warning).toBeUndefined();
  });
});
