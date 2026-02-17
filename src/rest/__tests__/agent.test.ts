import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Request, Response } from "express";

vi.mock("../gpt-instructions.js", () => ({
  getGptInstructions: vi.fn(() => "mock instructions"),
}));

vi.mock("../../providers/status.js", () => ({
  getStatus: vi.fn(),
}));

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

vi.mock("../../ibkr/connection.js", () => ({
  isConnected: vi.fn(() => false),
}));

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

vi.mock("../../eval/ensemble/scorer.js", () => ({
  computeEnsembleWithWeights: vi.fn(),
}));

vi.mock("../../eval/ensemble/weights.js", () => ({
  getWeights: vi.fn(() => ({ claude: 1, gpt4o: 1, gemini: 1, k: 1 })),
}));

vi.mock("../../db/database.js", () => ({
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
    })),
  },
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

vi.mock("../../holly/trailing-stop-executor.js", () => ({
  applyTrailingStopToOrder: vi.fn(async () => ({ applied: false })),
  trailingStopRecommendation: vi.fn(),
}));

import { handleAgentRequest } from "../agent.js";
import { getStatus } from "../../providers/status.js";
import { isConnected } from "../../ibkr/connection.js";
import { trailingStopRecommendation } from "../../holly/trailing-stop-executor.js";

interface MockResponse {
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
}

function createMockResponse(): MockResponse {
  const res = {} as MockResponse;
  res.status = vi.fn(() => res);
  res.json = vi.fn();
  return res;
}

function createRequest(action?: string, params?: Record<string, unknown>): Request {
  return {
    body: {
      action,
      params,
    },
  } as Request;
}

describe("handleAgentRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isConnected).mockReturnValue(false);
  });

  it("returns 400 when action is missing", async () => {
    const req = createRequest(undefined, {});
    const res = createMockResponse();

    await handleAgentRequest(req, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: "Missing 'action' string. Call get_status to see available actions.",
    });
  });

  it("returns 400 with available actions when action is unknown", async () => {
    const req = createRequest("unknown_action", {});
    const res = createMockResponse();

    await handleAgentRequest(req, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: "Unknown action: 'unknown_action'",
        available_actions: expect.arrayContaining(["get_status"]),
      }),
    );
  });

  it("dispatches get_status and returns action/result payload", async () => {
    const statusPayload = {
      status: "ok",
      easternTime: "2026-01-01T09:30:00-05:00",
      marketSession: "open",
      marketData: "yahoo",
      screener: "ok",
      ibkr: {
        connected: false,
        mode: "paper" as const,
        host: "127.0.0.1",
        port: 7497,
        clientId: 1,
        note: "disconnected",
      },
      timestamp: "2026-01-01T14:30:00.000Z",
    };
    vi.mocked(getStatus).mockResolvedValue(statusPayload);

    const req = createRequest("get_status", {});
    const res = createMockResponse();

    await handleAgentRequest(req, res as unknown as Response);

    expect(res.status).not.toHaveBeenCalled();
    expect(getStatus).toHaveBeenCalledOnce();
    expect(res.json).toHaveBeenCalledWith({
      action: "get_status",
      result: statusPayload,
    });
  });

  it("dispatches trailing_stop_recommend action", async () => {
    vi.mocked(trailingStopRecommendation).mockReturnValue({
      symbol: "AAPL",
      strategy: "Holly Neo",
      source: "table",
      params: { name: "neo", type: "fixed_pct", trail_pct: 0.02 },
    });

    const req = createRequest("trailing_stop_recommend", { symbol: "AAPL" });
    const res = createMockResponse();

    await handleAgentRequest(req, res as unknown as Response);

    expect(trailingStopRecommendation).toHaveBeenCalledWith("AAPL", undefined);
    expect(res.json).toHaveBeenCalledWith({
      action: "trailing_stop_recommend",
      result: {
        symbol: "AAPL",
        strategy: "Holly Neo",
        source: "table",
        params: { name: "neo", type: "fixed_pct", trail_pct: 0.02 },
      },
    });
  });

  it("returns 500 when an action handler throws", async () => {
    vi.mocked(getStatus).mockRejectedValue(new Error("Status backend failed"));

    const req = createRequest("get_status", {});
    const res = createMockResponse();

    await handleAgentRequest(req, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      action: "get_status",
      error: "Status backend failed",
    });
  });

  it("returns 500 with IBKR disconnected error for IBKR-only actions", async () => {
    vi.mocked(isConnected).mockReturnValue(false);

    const req = createRequest("get_account_summary", {});
    const res = createMockResponse();

    await handleAgentRequest(req, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "get_account_summary",
        error: expect.stringContaining("IBKR is not connected"),
      }),
    );
  });
});
