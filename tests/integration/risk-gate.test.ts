import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Database as DatabaseType } from "better-sqlite3";
import { cleanDb } from "../../test/helpers.js";
import { closeTestDb, getTestDb } from "../../test/setup.js";

interface RiskGateInput {
  symbol: string;
  side: "BUY" | "SELL";
  quantity: number;
  estimatedPrice: number;
}

interface RiskGateDecision {
  allowed: boolean;
  reason?: string;
}

const MAX_DAILY_LOSS = -1200;
const MAX_POSITION_CONCENTRATION = 0.3;

function seedAccountContext(db: DatabaseType, overrides?: { netLiquidation?: number; dailyPnl?: number }): void {
  db.prepare(
    `INSERT INTO account_snapshots (net_liquidation, total_cash_value, buying_power, daily_pnl, unrealized_pnl, realized_pnl)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    overrides?.netLiquidation ?? 100_000,
    40_000,
    200_000,
    overrides?.dailyPnl ?? 250,
    100,
    150,
  );
}

function seedPosition(db: DatabaseType, symbol: string, quantity: number, marketPrice: number): void {
  const positions = [
    {
      symbol,
      position: quantity,
      marketPrice,
      marketValue: quantity * marketPrice,
      avgCost: marketPrice - 1,
      unrealizedPNL: 120,
      realizedPNL: 45,
      account: "DU123456",
    },
  ];
  db.prepare("INSERT INTO positions_snapshots (positions, source) VALUES (?, ?)").run(JSON.stringify(positions), "integration-test");
}

function seedRecentTrade(db: DatabaseType, params: { symbol: string; shares: number; price: number; realizedPnl: number }): void {
  db.prepare(
    `INSERT INTO executions (exec_id, order_id, symbol, side, shares, price, cum_qty, avg_price, commission, realized_pnl, correlation_id, timestamp)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    `exec-${params.symbol}-${Date.now()}-${Math.random()}`,
    5001,
    params.symbol,
    "BOT",
    params.shares,
    params.price,
    params.shares,
    params.price,
    1.2,
    params.realizedPnl,
    "corr-risk-seed",
    new Date().toISOString(),
  );
}

function evaluateRiskGate(db: DatabaseType, input: RiskGateInput): RiskGateDecision {
  const latestAccount = db.prepare(
    `SELECT net_liquidation, daily_pnl FROM account_snapshots ORDER BY id DESC LIMIT 1`
  ).get() as { net_liquidation: number; daily_pnl: number } | undefined;

  if (!latestAccount) {
    return { allowed: false, reason: "No account snapshot available" };
  }

  if (latestAccount.daily_pnl <= MAX_DAILY_LOSS) {
    return {
      allowed: false,
      reason: `Daily loss limit breached (${latestAccount.daily_pnl.toFixed(2)} <= ${MAX_DAILY_LOSS.toFixed(2)})`,
    };
  }

  const latestPositionsRow = db.prepare(
    `SELECT positions FROM positions_snapshots ORDER BY id DESC LIMIT 1`
  ).get() as { positions: string } | undefined;

  const positions = latestPositionsRow ? (JSON.parse(latestPositionsRow.positions) as Array<{ symbol: string; marketValue: number }>) : [];

  const currentSymbolExposure = positions
    .filter((position) => position.symbol === input.symbol)
    .reduce((sum, position) => sum + Math.abs(position.marketValue), 0);

  const proposedExposure = currentSymbolExposure + input.quantity * input.estimatedPrice;
  const maxAllowedExposure = latestAccount.net_liquidation * MAX_POSITION_CONCENTRATION;

  if (proposedExposure > maxAllowedExposure) {
    return {
      allowed: false,
      reason: `Concentration limit exceeded (${proposedExposure.toFixed(2)} > ${maxAllowedExposure.toFixed(2)})`,
    };
  }

  return { allowed: true };
}

describe("integration/risk-gate", () => {
  const db = getTestDb();

  beforeEach(() => {
    cleanDb(db);
  });

  it("passes for a first trade with healthy account state", () => {
    seedAccountContext(db);

    const result = evaluateRiskGate(db, {
      symbol: "AAPL",
      side: "BUY",
      quantity: 100,
      estimatedPrice: 150,
    });

    expect(result.allowed).toBe(true);
  });

  it("rejects when daily loss breaches max threshold", () => {
    seedAccountContext(db, { dailyPnl: -1500 });

    const result = evaluateRiskGate(db, {
      symbol: "AAPL",
      side: "BUY",
      quantity: 50,
      estimatedPrice: 170,
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Daily loss limit breached");
  });

  it("rejects when concentration limit would be exceeded", () => {
    seedAccountContext(db, { netLiquidation: 100_000 });
    seedPosition(db, "TSLA", 220, 120);

    const result = evaluateRiskGate(db, {
      symbol: "TSLA",
      side: "BUY",
      quantity: 80,
      estimatedPrice: 125,
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Concentration limit exceeded");
  });

  it("allows when exposure remains under concentration cap", () => {
    seedAccountContext(db, { netLiquidation: 100_000 });
    seedPosition(db, "NVDA", 40, 120);

    const result = evaluateRiskGate(db, {
      symbol: "NVDA",
      side: "BUY",
      quantity: 20,
      estimatedPrice: 130,
    });

    expect(result.allowed).toBe(true);
  });

  it("rejects when there is no account snapshot", () => {
    const result = evaluateRiskGate(db, {
      symbol: "MSFT",
      side: "BUY",
      quantity: 15,
      estimatedPrice: 410,
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("No account snapshot available");
  });

  it("uses latest account snapshot when multiple snapshots exist", () => {
    seedAccountContext(db, { dailyPnl: 100 });
    seedAccountContext(db, { dailyPnl: -1300 });

    const result = evaluateRiskGate(db, {
      symbol: "AMD",
      side: "BUY",
      quantity: 10,
      estimatedPrice: 140,
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Daily loss limit breached");
  });

  it("handles realistic seeded recent trades without affecting first-trade pass rule", () => {
    seedAccountContext(db, { dailyPnl: -300 });
    seedRecentTrade(db, { symbol: "META", shares: 200, price: 490, realizedPnl: -220 });

    const result = evaluateRiskGate(db, {
      symbol: "META",
      side: "BUY",
      quantity: 30,
      estimatedPrice: 495,
    });

    expect(result.allowed).toBe(true);
  });

  it("treats opposite-side orders as additional concentration in this conservative gate", () => {
    seedAccountContext(db, { netLiquidation: 80_000 });
    seedPosition(db, "PLTR", 300, 70);

    const result = evaluateRiskGate(db, {
      symbol: "PLTR",
      side: "SELL",
      quantity: 120,
      estimatedPrice: 72,
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Concentration limit exceeded");
  });
});

afterAll(() => {
  closeTestDb();
});
