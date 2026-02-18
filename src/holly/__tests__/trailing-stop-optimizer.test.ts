import { beforeEach, describe, expect, it, vi } from "vitest";

interface MockTrade {
  id: number;
  symbol: string;
  strategy: string;
  entry_price: number;
  exit_price: number;
  stop_price: number | null;
  shares: number;
  actual_pnl: number;
  mfe: number | null;
  mae: number | null;
  hold_minutes: number | null;
  time_to_mfe_min: number | null;
  time_to_mae_min: number | null;
  giveback: number | null;
  giveback_ratio: number | null;
  max_profit: number | null;
  atr_pct?: number | null;
  segment: string | null;
}

const state: {
  trades: MockTrade[];
  strategyCounts: Array<{ strategy: string; cnt: number }>;
} = {
  trades: [],
  strategyCounts: [],
};

const mockDb = {
  prepare: (sql: string) => ({
    all: (...args: unknown[]) => {
      if (sql.includes("GROUP BY strategy") && sql.includes("HAVING cnt >= ?")) {
        return state.strategyCounts;
      }

      if (sql.includes("FROM holly_trades") && sql.includes("ORDER BY entry_time ASC")) {
        let trades = [...state.trades];
        const firstArg = args[0];
        if (sql.includes("strategy = ?") && typeof firstArg === "string") {
          trades = trades.filter((t) => t.strategy === firstArg);
        }
        return trades;
      }

      return [];
    },
  }),
};

vi.mock("../../db/database.js", () => ({
  getDb: () => mockDb,
}));

vi.mock("../trade-importer.js", () => ({
  ensureHollyTradesTable: vi.fn(),
}));

vi.mock("../../logging.js", () => ({
  logger: {
    child: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

import {
  getDefaultParamSets,
  runFullOptimization,
  runPerStrategyOptimization,
  runTrailingStopSimulation,
  type TrailingStopParams,
} from "../trailing-stop-optimizer.js";

describe("trailing-stop-optimizer", () => {
  beforeEach(() => {
    state.trades = [];
    state.strategyCounts = [];
  });

  it("includes 19 default parameter sets", () => {
    expect(getDefaultParamSets()).toHaveLength(19);
  });

  it("simulates fixed 2% trailing stop from peak", () => {
    state.trades = [
      {
        id: 1,
        symbol: "AAPL",
        strategy: "Holly Grail",
        entry_price: 100,
        exit_price: 101,
        stop_price: 97,
        shares: 100,
        actual_pnl: 100,
        mfe: 500,
        mae: -100,
        hold_minutes: 30,
        time_to_mfe_min: 12,
        time_to_mae_min: 5,
        giveback: 400,
        giveback_ratio: 0.8,
        max_profit: 500,
        atr_pct: 0.02,
        segment: "Holly Grail",
      },
    ];

    const result = runTrailingStopSimulation({ name: "Trail 2%", type: "fixed_pct", trail_pct: 0.02 });

    expect(result.total_trades).toBe(1);
    expect(result.simulated.total_pnl).toBe(290);
    expect(result.top_improvements[0]?.simulated_exit_time_min).toBe(13);
  });

  it("uses atr_pct to scale ATR trailing distance", () => {
    state.trades = [
      {
        id: 1,
        symbol: "LOWATR",
        strategy: "Holly Grail",
        entry_price: 100,
        exit_price: 104,
        stop_price: 95,
        shares: 100,
        actual_pnl: 400,
        mfe: 1000,
        mae: -50,
        hold_minutes: 40,
        time_to_mfe_min: 20,
        time_to_mae_min: 5,
        giveback: 600,
        giveback_ratio: 0.6,
        max_profit: 1000,
        atr_pct: 0.01,
        segment: "Holly Grail",
      },
      {
        id: 2,
        symbol: "HIGHATR",
        strategy: "Holly Grail",
        entry_price: 100,
        exit_price: 104,
        stop_price: 95,
        shares: 100,
        actual_pnl: 400,
        mfe: 1000,
        mae: -50,
        hold_minutes: 40,
        time_to_mfe_min: 20,
        time_to_mae_min: 5,
        giveback: 600,
        giveback_ratio: 0.6,
        max_profit: 1000,
        atr_pct: 0.05,
        segment: "Holly Grail",
      },
    ];

    const result = runTrailingStopSimulation({ name: "ATR 2x", type: "atr_multiple", atr_mult: 2 });
    const lowAtr = result.top_improvements.find((r) => r.symbol === "LOWATR") ?? result.top_degradations.find((r) => r.symbol === "LOWATR");
    const highAtr = result.top_improvements.find((r) => r.symbol === "HIGHATR") ?? result.top_degradations.find((r) => r.symbol === "HIGHATR");

    expect(lowAtr?.simulated_pnl).toBe(800);
    expect(highAtr?.simulated_pnl).toBe(0);
  });

  it("uses time-stop when time-decay threshold is exceeded", () => {
    state.trades = [
      {
        id: 1,
        symbol: "NVDA",
        strategy: "Holly Neo",
        entry_price: 200,
        exit_price: 202,
        stop_price: 190,
        shares: 100,
        actual_pnl: 200,
        mfe: 1000,
        mae: -300,
        hold_minutes: 300,
        time_to_mfe_min: 50,
        time_to_mae_min: 15,
        giveback: 800,
        giveback_ratio: 0.8,
        max_profit: 1000,
        atr_pct: 0.02,
        segment: "Holly Neo",
      },
    ];

    const result = runTrailingStopSimulation({
      name: "Decay Medium",
      type: "time_decay",
      initial_target_pct: 0.8,
      decay_per_min: 0.005,
    });

    expect(result.top_improvements[0]?.exit_reason).toBe("time_stop");
    expect(result.top_improvements[0]?.simulated_exit_time_min).toBe(140);
  });

  it("applies MFE escalation tightening only when trigger condition is met", () => {
    state.trades = [
      {
        id: 1,
        symbol: "META",
        strategy: "Holly Grail",
        entry_price: 100,
        exit_price: 103,
        stop_price: 97,
        shares: 100,
        actual_pnl: 300,
        mfe: 500,
        mae: -50,
        hold_minutes: 45,
        time_to_mfe_min: 20,
        time_to_mae_min: 10,
        giveback: 200,
        giveback_ratio: 0.4,
        max_profit: 500,
        atr_pct: 0.02,
        segment: "Holly Grail",
      },
    ];

    const tight = runTrailingStopSimulation({
      name: "tight",
      type: "mfe_escalation",
      mfe_trigger_pct: 0.5,
      tight_trail_pct: 0.01,
    });
    const loose = runTrailingStopSimulation({
      name: "loose",
      type: "mfe_escalation",
      mfe_trigger_pct: 1.5,
      tight_trail_pct: 0.01,
    });

    expect(tight.simulated.total_pnl).toBeGreaterThan(loose.simulated.total_pnl);
  });

  it("moves to breakeven and trails after 1R is reached", () => {
    state.trades = [
      {
        id: 1,
        symbol: "TSLA",
        strategy: "Holly Neo",
        entry_price: 100,
        exit_price: 99,
        stop_price: 95,
        shares: 100,
        actual_pnl: -100,
        mfe: 700,
        mae: -200,
        hold_minutes: 60,
        time_to_mfe_min: 25,
        time_to_mae_min: 8,
        giveback: 800,
        giveback_ratio: 1.1,
        max_profit: 700,
        atr_pct: 0.03,
        segment: "Holly Neo",
      },
    ];

    const result = runTrailingStopSimulation({
      name: "BE at 1R",
      type: "breakeven_trail",
      be_trigger_r: 1,
      post_be_trail_pct: 0.015,
    });

    expect(result.top_improvements[0]?.exit_reason).toBe("trailing_stop");
    expect(result.simulated.total_pnl).toBeGreaterThan(0);
  });

  it("returns empty result for empty trade set", () => {
    const result = runTrailingStopSimulation({ name: "Trail 2%", type: "fixed_pct", trail_pct: 0.02 });

    expect(result.total_trades).toBe(0);
    expect(result.top_improvements).toEqual([]);
    expect(result.top_degradations).toEqual([]);
  });

  it("returns deterministic stats for a single trade", () => {
    state.trades = [
      {
        id: 1,
        symbol: "MSFT",
        strategy: "Holly Grail",
        entry_price: 50,
        exit_price: 52,
        stop_price: 48,
        shares: 100,
        actual_pnl: 200,
        mfe: 400,
        mae: -50,
        hold_minutes: 20,
        time_to_mfe_min: 9,
        time_to_mae_min: 4,
        giveback: 200,
        giveback_ratio: 0.5,
        max_profit: 400,
        atr_pct: 0.02,
        segment: "Holly Grail",
      },
    ];

    const result = runTrailingStopSimulation({ name: "Trail 3%", type: "fixed_pct", trail_pct: 0.03 });

    expect(result.original.win_rate).toBe(1);
    expect(result.simulated.sharpe).toBe(0);
  });

  it("sorts full optimization results by pnl improvement", () => {
    state.trades = [
      {
        id: 1,
        symbol: "AMZN",
        strategy: "Holly Grail",
        entry_price: 100,
        exit_price: 99,
        stop_price: 95,
        shares: 100,
        actual_pnl: -100,
        mfe: 800,
        mae: -100,
        hold_minutes: 35,
        time_to_mfe_min: 12,
        time_to_mae_min: 6,
        giveback: 900,
        giveback_ratio: 1.125,
        max_profit: 800,
        atr_pct: 0.02,
        segment: "Holly Grail",
      },
    ];

    const paramSets: TrailingStopParams[] = [
      { name: "Loose", type: "fixed_pct", trail_pct: 0.05 },
      { name: "Tight", type: "fixed_pct", trail_pct: 0.01 },
    ];

    const results = runFullOptimization({ paramSets });

    expect(results[0]?.pnl_improvement).toBeGreaterThanOrEqual(results[1]?.pnl_improvement ?? 0);
  });

  it("runs per-strategy optimization and returns best strategy result", () => {
    state.trades = [
      {
        id: 1,
        symbol: "AAPL",
        strategy: "Holly Grail",
        entry_price: 100,
        exit_price: 101,
        stop_price: 95,
        shares: 100,
        actual_pnl: 100,
        mfe: 500,
        mae: -100,
        hold_minutes: 20,
        time_to_mfe_min: 10,
        time_to_mae_min: 4,
        giveback: 400,
        giveback_ratio: 0.8,
        max_profit: 500,
        atr_pct: 0.02,
        segment: "Holly Grail",
      },
    ];
    state.strategyCounts = [{ strategy: "Holly Grail", cnt: 25 }];

    const results = runPerStrategyOptimization({ minTrades: 20 });

    expect(results).toHaveLength(1);
    expect(results[0]?.holly_strategy).toBe("Holly Grail");
    expect(results[0]?.best_trailing.params.name).toBeDefined();
  });
});
