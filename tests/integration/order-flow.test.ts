import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTestDb } from "../../test/setup.js";
import { cleanDb } from "../../test/helpers.js";

type TestDb = ReturnType<typeof getTestDb>;

const mockState = vi.hoisted(() => {
  return {
    isConnected: vi.fn(() => true),
    checkRisk: vi.fn(() => ({ allowed: true })),
    placeOrder: vi.fn(async (params: Record<string, unknown>) => ({
      orderId: 9001,
      symbol: params.symbol,
      action: params.action,
      orderType: params.orderType,
      totalQuantity: params.totalQuantity,
      lmtPrice: params.lmtPrice ?? null,
      auxPrice: null,
      status: "Submitted",
      correlation_id: "corr-integration-9001",
    })),
  };
});

const runtime = vi.hoisted(() => ({ db: null as TestDb | null }));

vi.mock("../../src/ibkr/connection.js", () => ({
  isConnected: mockState.isConnected,
}));

vi.mock("../../src/ibkr/risk-gate.js", () => ({
  checkRisk: mockState.checkRisk,
}));

vi.mock("../../src/ibkr/orders.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/ibkr/orders.js")>("../../src/ibkr/orders.js");
  return {
    ...actual,
    placeOrder: mockState.placeOrder,
  };
});

vi.mock("../../src/db/database.js", () => ({
  insertJournalEntry: (data: Record<string, unknown>) => {
    const db = runtime.db;
    if (!db) throw new Error("test db not initialized");
    const result = db.prepare(
      `INSERT INTO trade_journal (symbol, strategy_version, reasoning, ai_recommendations, tags, spy_price, vix_level, gap_pct, relative_volume, time_of_day, session_type, spread_pct)
       VALUES (@symbol, @strategy_version, @reasoning, @ai_recommendations, @tags, @spy_price, @vix_level, @gap_pct, @relative_volume, @time_of_day, @session_type, @spread_pct)`
    ).run({
      symbol: data.symbol ?? null,
      strategy_version: data.strategy_version ?? "manual",
      reasoning: data.reasoning,
      ai_recommendations: data.ai_recommendations ?? null,
      tags: JSON.stringify(data.tags ?? []),
      spy_price: data.spy_price ?? null,
      vix_level: data.vix_level ?? null,
      gap_pct: data.gap_pct ?? null,
      relative_volume: data.relative_volume ?? null,
      time_of_day: data.time_of_day ?? null,
      session_type: data.session_type ?? null,
      spread_pct: data.spread_pct ?? null,
    });
    return Number(result.lastInsertRowid);
  },
  getJournalById: (id: number) => {
    const db = runtime.db;
    if (!db) throw new Error("test db not initialized");
    return db.prepare("SELECT * FROM trade_journal WHERE id = ?").get(id);
  },
}));

import { isConnected } from "../../src/ibkr/connection.js";
import { validateOrder, placeOrder } from "../../src/ibkr/orders.js";
import { checkRisk } from "../../src/ibkr/risk-gate.js";
import { getJournalById, insertJournalEntry } from "../../src/db/database.js";

interface FlowInput {
  symbol: string;
  action: "BUY" | "SELL";
  orderType: "MKT" | "LMT";
  totalQuantity: number;
  lmtPrice?: number;
}

interface FlowResult {
  ok: boolean;
  status: number;
  stage: "connection" | "validation" | "risk" | "submission";
  error?: string;
  data?: Record<string, unknown>;
}

async function executeOrderFlow(input: FlowInput): Promise<FlowResult> {
  if (!isConnected()) {
    return { ok: false, status: 503, stage: "connection", error: "IBKR not connected" };
  }

  const validation = validateOrder(input);
  if (!validation.valid) {
    return {
      ok: false,
      status: 400,
      stage: "validation",
      error: validation.errors.join("; "),
    };
  }

  const riskDecision = checkRisk({
    symbol: input.symbol,
    action: input.action,
    orderType: input.orderType,
    totalQuantity: input.totalQuantity,
    lmtPrice: input.lmtPrice,
    estimatedPrice: input.lmtPrice,
  });

  if (!riskDecision.allowed) {
    return {
      ok: false,
      status: 403,
      stage: "risk",
      error: riskDecision.reason ?? "Risk gate blocked",
    };
  }

  const journalId = insertJournalEntry({
    symbol: input.symbol,
    strategy_version: "integration-test-v1",
    reasoning: "Momentum continuation setup with higher-high structure",
    ai_recommendations: "Risk 0.5R on first scale-in",
    tags: ["breakout", "high-volume"],
    spy_price: 512.34,
    vix_level: 15.2,
    gap_pct: 0.9,
    relative_volume: 1.8,
    time_of_day: "morning",
    session_type: "regular",
    spread_pct: 0.04,
  });

  const result = await placeOrder({
    ...input,
    tif: "DAY",
    secType: "STK",
    strategy_version: "integration-test-v1",
    order_source: "rest",
    journal_id: journalId,
  });

  return {
    ok: true,
    status: 200,
    stage: "submission",
    data: {
      ...result,
      journal_id: journalId,
    },
  };
}

describe("integration/order-flow", () => {
  const db = getTestDb();

  beforeEach(() => {
    runtime.db = db;
    cleanDb(db);
    mockState.isConnected.mockClear();
    mockState.checkRisk.mockClear();
    mockState.placeOrder.mockClear();
    mockState.isConnected.mockReturnValue(true);
    mockState.checkRisk.mockReturnValue({ allowed: true });
    mockState.placeOrder.mockResolvedValue({
      orderId: 9001,
      symbol: "AAPL",
      action: "BUY",
      orderType: "LMT",
      totalQuantity: 100,
      lmtPrice: 190,
      auxPrice: null,
      status: "Submitted",
      correlation_id: "corr-integration-9001",
    });
  });

  it("runs the full order flow and creates a linked journal entry", async () => {
    const result = await executeOrderFlow({
      symbol: "AAPL",
      action: "BUY",
      orderType: "LMT",
      totalQuantity: 100,
      lmtPrice: 190,
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(mockState.checkRisk).toHaveBeenCalledOnce();
    expect(mockState.placeOrder).toHaveBeenCalledOnce();

    const journalId = Number(result.data?.journal_id);
    const journal = getJournalById(journalId) as { symbol: string; reasoning: string };
    expect(journal.symbol).toBe("AAPL");
    expect(journal.reasoning).toContain("Momentum continuation");
  });

  it("stops immediately when IBKR is disconnected", async () => {
    mockState.isConnected.mockReturnValue(false);

    const result = await executeOrderFlow({
      symbol: "AAPL",
      action: "BUY",
      orderType: "MKT",
      totalQuantity: 20,
    });

    expect(result.ok).toBe(false);
    expect(result.stage).toBe("connection");
    expect(mockState.checkRisk).not.toHaveBeenCalled();
  });

  it("rejects invalid order payload at validation stage", async () => {
    const result = await executeOrderFlow({
      symbol: "AAPL",
      action: "BUY",
      orderType: "LMT",
      totalQuantity: 0,
      lmtPrice: 190,
    });

    expect(result.ok).toBe(false);
    expect(result.stage).toBe("validation");
    expect(result.status).toBe(400);
    expect(mockState.checkRisk).not.toHaveBeenCalled();
    expect(mockState.placeOrder).not.toHaveBeenCalled();
  });

  it("rejects when risk gate fails with max daily loss", async () => {
    mockState.checkRisk.mockReturnValue({
      allowed: false,
      reason: "Daily loss limit breached (-1500.00 <= -1200.00)",
    });

    const result = await executeOrderFlow({
      symbol: "NVDA",
      action: "BUY",
      orderType: "LMT",
      totalQuantity: 15,
      lmtPrice: 520,
    });

    expect(result.ok).toBe(false);
    expect(result.stage).toBe("risk");
    expect(result.error).toContain("Daily loss limit breached");
    expect(mockState.placeOrder).not.toHaveBeenCalled();
  });

  it("rejects when risk gate fails with concentration cap", async () => {
    mockState.checkRisk.mockReturnValue({
      allowed: false,
      reason: "Concentration limit exceeded (42000.00 > 30000.00)",
    });

    const result = await executeOrderFlow({
      symbol: "TSLA",
      action: "BUY",
      orderType: "MKT",
      totalQuantity: 70,
      lmtPrice: 600,
    });

    expect(result.ok).toBe(false);
    expect(result.stage).toBe("risk");
    expect(result.status).toBe(403);
    expect(result.error).toContain("Concentration limit exceeded");
  });

  it("passes journal_id through to mocked order submission", async () => {
    await executeOrderFlow({
      symbol: "MSFT",
      action: "BUY",
      orderType: "LMT",
      totalQuantity: 30,
      lmtPrice: 410,
    });

    const submitted = mockState.placeOrder.mock.calls[0][0] as { journal_id: number; strategy_version: string };
    expect(typeof submitted.journal_id).toBe("number");
    expect(submitted.strategy_version).toBe("integration-test-v1");
  });
});
