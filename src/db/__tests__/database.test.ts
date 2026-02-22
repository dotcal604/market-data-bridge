import { beforeEach, describe, expect, it, vi } from "vitest";

interface DatabaseModule {
  insertOrder: (row: {
    order_id: number;
    symbol: string;
    action: string;
    order_type: string;
    total_quantity: number;
    lmt_price?: number | null;
    correlation_id: string;
    status?: string;
  }) => unknown;
  getOrderByOrderId: (orderId: number) => Record<string, unknown> | undefined;
  updateOrderStatus: (orderId: number, status: string, filled?: number, avgPrice?: number) => void;
  insertExecution: (row: {
    exec_id: string;
    order_id: number;
    symbol: string;
    side: string;
    shares: number;
    price: number;
    correlation_id: string;
    timestamp: string;
  }) => unknown;
  queryExecutions: (opts?: { symbol?: string; limit?: number }) => Array<Record<string, unknown>>;
  getExecutionsByCorrelation: (correlationId: string) => Array<Record<string, unknown>>;
  updateExecutionCommission: (execId: string, commission: number, realizedPnl: number | null) => void;
  insertEvaluation: (row: Record<string, unknown>) => void;
  getEvaluationById: (id: string) => Record<string, unknown> | undefined;
  getRecentEvaluations: (limit?: number, symbol?: string) => Array<Record<string, unknown>>;
  insertAccountSnapshot: (row: {
    net_liquidation?: number;
    total_cash_value?: number;
    buying_power?: number;
    daily_pnl?: number;
    unrealized_pnl?: number;
    realized_pnl?: number;
  }) => void;
  queryAccountSnapshots: (limit?: number) => Array<Record<string, unknown>>;
  getLatestNetLiquidation: () => number | null;
  getDb: () => { prepare: (sql: string) => { run: (...args: readonly unknown[]) => unknown } };
  isDbWritable: () => boolean;
  closeDb: () => void;
}

async function loadDatabaseModule(): Promise<DatabaseModule> {
  vi.resetModules();
  process.env.DB_PATH = ":memory:";
  return import("../database.js") as unknown as DatabaseModule;
}

describe("db/database", () => {
  beforeEach(() => {
    process.env.DB_PATH = ":memory:";
  });

  it("insertOrder + getOrderByOrderId roundtrip", async () => {
    const db = await loadDatabaseModule();

    db.insertOrder({
      order_id: 1001,
      symbol: "AAPL",
      action: "BUY",
      order_type: "LMT",
      total_quantity: 25,
      lmt_price: 190.5,
      correlation_id: "corr-1001",
    });

    const row = db.getOrderByOrderId(1001);
    expect(row).toBeDefined();
    expect(row?.symbol).toBe("AAPL");
    expect(row?.status).toBe("PendingSubmit");
    expect(row?.filled_quantity).toBe(0);

    db.closeDb();
  });

  it("updateOrderStatus updates status, filled quantity, and avg fill price", async () => {
    const db = await loadDatabaseModule();

    db.insertOrder({
      order_id: 1002,
      symbol: "MSFT",
      action: "BUY",
      order_type: "MKT",
      total_quantity: 10,
      correlation_id: "corr-1002",
    });
    db.updateOrderStatus(1002, "Filled", 10, 412.34);

    const row = db.getOrderByOrderId(1002);
    expect(row?.status).toBe("Filled");
    expect(row?.filled_quantity).toBe(10);
    expect(row?.avg_fill_price).toBe(412.34);

    db.closeDb();
  });

  it("updateOrderStatus without fill args only changes status", async () => {
    const db = await loadDatabaseModule();

    db.insertOrder({
      order_id: 1003,
      symbol: "NVDA",
      action: "SELL",
      order_type: "LMT",
      total_quantity: 5,
      lmt_price: 900,
      correlation_id: "corr-1003",
      status: "Submitted",
    });
    db.updateOrderStatus(1003, "Cancelled");

    const row = db.getOrderByOrderId(1003);
    expect(row?.status).toBe("Cancelled");
    expect(row?.filled_quantity).toBe(0);
    expect(row?.avg_fill_price).toBeNull();

    db.closeDb();
  });

  it("insertExecution + queryExecutions roundtrip", async () => {
    const db = await loadDatabaseModule();

    db.insertExecution({
      exec_id: "exec-1001",
      order_id: 2001,
      symbol: "TSLA",
      side: "BOT",
      shares: 30,
      price: 251.75,
      correlation_id: "corr-exec-1",
      timestamp: "2025-01-01T14:30:00.000Z",
    });

    const rows = db.queryExecutions({ symbol: "TSLA", limit: 10 });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.exec_id).toBe("exec-1001");
    expect(rows[0]?.price).toBe(251.75);

    db.closeDb();
  });

  it("getExecutionsByCorrelation returns inserted rows", async () => {
    const db = await loadDatabaseModule();

    db.insertExecution({
      exec_id: "exec-1002",
      order_id: 2002,
      symbol: "AMD",
      side: "SLD",
      shares: 15,
      price: 160.25,
      correlation_id: "corr-shared",
      timestamp: "2025-01-01T14:31:00.000Z",
    });
    db.insertExecution({
      exec_id: "exec-1003",
      order_id: 2002,
      symbol: "AMD",
      side: "SLD",
      shares: 10,
      price: 160.0,
      correlation_id: "corr-shared",
      timestamp: "2025-01-01T14:32:00.000Z",
    });

    const rows = db.getExecutionsByCorrelation("corr-shared");
    expect(rows).toHaveLength(2);

    db.closeDb();
  });

  it("updateExecutionCommission sets commission and realized pnl", async () => {
    const db = await loadDatabaseModule();

    db.insertExecution({
      exec_id: "exec-1004",
      order_id: 2003,
      symbol: "META",
      side: "BOT",
      shares: 4,
      price: 500,
      correlation_id: "corr-comm",
      timestamp: "2025-01-01T14:33:00.000Z",
    });
    db.updateExecutionCommission("exec-1004", 1.23, 50.5);

    const [row] = db.queryExecutions({ symbol: "META", limit: 1 });
    expect(row?.commission).toBe(1.23);
    expect(row?.realized_pnl).toBe(50.5);

    db.closeDb();
  });

  it("insertEvaluation + getEvaluationById roundtrip", async () => {
    const db = await loadDatabaseModule();

    db.insertEvaluation({
      id: "eval-1",
      symbol: "AAPL",
      direction: "long",
      timestamp: "2025-01-01T15:00:00.000Z",
      features_json: JSON.stringify({ rvol: 2.1 }),
      ensemble_trade_score: 78,
      prefilter_passed: 1,
      guardrail_allowed: 1,
    });

    const row = db.getEvaluationById("eval-1");
    expect(row).toBeDefined();
    expect(row?.symbol).toBe("AAPL");
    expect(row?.ensemble_trade_score).toBe(78);

    db.closeDb();
  });

  it("getRecentEvaluations supports symbol filter", async () => {
    const db = await loadDatabaseModule();

    db.insertEvaluation({
      id: "eval-a",
      symbol: "SPY",
      timestamp: "2025-01-01T15:01:00.000Z",
      features_json: "{}",
    });
    db.insertEvaluation({
      id: "eval-b",
      symbol: "QQQ",
      timestamp: "2025-01-01T15:02:00.000Z",
      features_json: "{}",
    });

    const rows = db.getRecentEvaluations(10, "SPY");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("eval-a");

    db.closeDb();
  });

  it("insertAccountSnapshot + queryAccountSnapshots returns latest first", async () => {
    const db = await loadDatabaseModule();

    db.insertAccountSnapshot({ net_liquidation: 100_000, daily_pnl: 100 });
    db.insertAccountSnapshot({ net_liquidation: 100_500, daily_pnl: 600 });

    const rows = db.queryAccountSnapshots(2);
    expect(rows).toHaveLength(2);
    const netLiquidations = rows.map((row) => row.net_liquidation as number).sort((a, b) => a - b);
    expect(netLiquidations).toEqual([100000, 100500]);

    db.closeDb();
  });

  it("isDbWritable returns true for active connection", async () => {
    const db = await loadDatabaseModule();

    expect(db.isDbWritable()).toBe(true);

    db.closeDb();
  });

  it("isDbWritable returns false after closeDb", async () => {
    const db = await loadDatabaseModule();

    db.closeDb();
    expect(db.isDbWritable()).toBe(false);
  });

  describe("getLatestNetLiquidation", () => {
    it("returns null when account_snapshots is empty", async () => {
      const db = await loadDatabaseModule();

      expect(db.getLatestNetLiquidation()).toBeNull();

      db.closeDb();
    });

    it("returns the value from a single row", async () => {
      const db = await loadDatabaseModule();

      db.insertAccountSnapshot({ net_liquidation: 125_000 });
      expect(db.getLatestNetLiquidation()).toBe(125_000);

      db.closeDb();
    });

    it("returns the most recently inserted value when multiple rows exist", async () => {
      const db = await loadDatabaseModule();
      const raw = db.getDb();

      raw.prepare(
        `INSERT INTO account_snapshots (net_liquidation, created_at) VALUES (?, ?)`
      ).run(100_000, "2025-01-01T10:00:00Z");
      raw.prepare(
        `INSERT INTO account_snapshots (net_liquidation, created_at) VALUES (?, ?)`
      ).run(200_000, "2025-01-01T11:00:00Z");

      expect(db.getLatestNetLiquidation()).toBe(200_000);

      db.closeDb();
    });

    it("skips null net_liquidation rows and returns the latest non-null value", async () => {
      const db = await loadDatabaseModule();
      const raw = db.getDb();

      raw.prepare(
        `INSERT INTO account_snapshots (net_liquidation, created_at) VALUES (?, ?)`
      ).run(50_000, "2025-01-01T09:00:00Z");
      raw.prepare(
        `INSERT INTO account_snapshots (net_liquidation, created_at) VALUES (?, ?)`
      ).run(null, "2025-01-01T10:00:00Z");

      expect(db.getLatestNetLiquidation()).toBe(50_000);

      db.closeDb();
    });

    it("returns 0 when the latest net_liquidation is zero", async () => {
      const db = await loadDatabaseModule();

      db.insertAccountSnapshot({ net_liquidation: 0 });
      expect(db.getLatestNetLiquidation()).toBe(0);

      db.closeDb();
    });
  });
});
