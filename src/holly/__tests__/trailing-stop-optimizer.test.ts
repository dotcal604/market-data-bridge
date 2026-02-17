import { describe, it, expect, vi, beforeEach } from "vitest";
import Database from "better-sqlite3";

/**
 * Tests for the trailing-stop optimizer.
 *
 * Tests cover:
 * 1. Simulation logic with mock data (8 tests)
 * 2. Integration tests with in-memory SQLite (6 tests)
 * 3. Statistical validation (4 tests)
 */

// ── Mock database module ─────────────────────────────────────────────────

let mockDb: Database.Database;

vi.mock("../../db/database.js", () => ({
  getDb: vi.fn(() => mockDb),
}));

vi.mock("../../logging.js", () => ({
  logger: {
    child: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

// Import after mocks
import {
  simulateTrailingStop,
  runTrailingStopSimulation,
  runFullOptimization,
  runPerStrategyOptimization,
  getOptimizationSummary,
  DEFAULT_PARAMS,
  type TrailingStopParams,
  type TradeSimulation,
  type SimulationStats,
} from "../trailing-stop-optimizer.js";

// ── Test Helpers ─────────────────────────────────────────────────────────

interface TradeRowOverrides {
  id?: number;
  entry_time?: string;
  exit_time?: string;
  symbol?: string;
  shares?: number;
  entry_price?: number;
  exit_price?: number;
  actual_pnl?: number;
  mfe?: number | null;
  mae?: number | null;
  time_to_mfe_min?: number | null;
  time_to_mae_min?: number | null;
  hold_minutes?: number | null;
  stop_price?: number | null;
  strategy?: string;
  segment?: string | null;
  r_multiple?: number | null;
}

/**
 * Create a trade row with sensible defaults.
 */
function makeTradeRow(overrides: TradeRowOverrides = {}) {
  return {
    id: 1,
    entry_time: "2024-03-15 09:30:00",
    exit_time: "2024-03-15 10:00:00",
    symbol: "AAPL",
    shares: 100,
    entry_price: 170.0,
    exit_price: 172.0,
    actual_pnl: 200.0,
    mfe: 300.0,         // Peak gain of $300
    mae: -50.0,         // Peak loss of $50
    time_to_mfe_min: 20.0,
    time_to_mae_min: 5.0,
    hold_minutes: 30.0,
    stop_price: 169.0,
    strategy: "Holly Grail",
    segment: "Morning",
    r_multiple: 2.0,
    ...overrides,
  };
}

/**
 * Bulk insert trades into in-memory DB.
 */
function insertTrades(db: Database.Database, trades: TradeRowOverrides[]) {
  const insert = db.prepare(`
    INSERT INTO holly_trades (
      entry_time, exit_time, symbol, shares, entry_price, exit_price,
      actual_pnl, mfe, mae, time_to_mfe_min, time_to_mae_min,
      hold_minutes, stop_price, strategy, segment, r_multiple
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const t of trades) {
    const row = makeTradeRow(t);
    insert.run(
      row.entry_time,
      row.exit_time,
      row.symbol,
      row.shares,
      row.entry_price,
      row.exit_price,
      row.actual_pnl,
      row.mfe,
      row.mae,
      row.time_to_mfe_min,
      row.time_to_mae_min,
      row.hold_minutes,
      row.stop_price,
      row.strategy,
      row.segment,
      row.r_multiple,
    );
  }
}

/**
 * Create in-memory database with holly_trades schema.
 */
function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  
  db.exec(`
    CREATE TABLE holly_trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_time TEXT NOT NULL,
      exit_time TEXT NOT NULL,
      symbol TEXT NOT NULL,
      shares INTEGER,
      entry_price REAL NOT NULL,
      exit_price REAL,
      actual_pnl REAL,
      mfe REAL,
      mae REAL,
      time_to_mfe_min REAL,
      time_to_mae_min REAL,
      hold_minutes REAL,
      stop_price REAL,
      strategy TEXT,
      segment TEXT,
      r_multiple REAL
    );
  `);
  
  return db;
}

// ── Simulation Tests (Mock DB) ───────────────────────────────────────────

describe("Trailing Stop Optimizer - Simulation Tests", () => {
  it("1. Fixed-% trailing stop calculates correct exit price from peak", () => {
    const trade = makeTradeRow({
      entry_price: 100.0,
      exit_price: 103.0,
      actual_pnl: 300.0,    // (103 - 100) * 100 shares
      mfe: 500.0,           // Peak gain of $500 = $5/share -> peak at 105
      shares: 100,
    });

    const params: TrailingStopParams = {
      name: "Fixed 10%",
      type: "fixed_pct",
      fixed_pct: 0.10,
    };

    const result = simulateTrailingStop(trade, params);

    // Peak price = entry + (mfe / shares) = 100 + 5 = 105
    expect(result.peak_price).toBe(105.0);
    
    // Trailing stop = peak - (peak * 0.10) = 105 - 10.5 = 94.5
    expect(result.simulated_exit_price).toBe(94.5);
    
    // Simulated PnL = (94.5 - 100) * 100 = -550
    expect(result.simulated_pnl).toBe(-550.0);
    
    // Improvement = -550 - 300 = -850
    expect(result.improvement).toBe(-850.0);
    
    expect(result.exit_reason).toBe("trailing_stop");
  });

  it("2. ATR-based trail uses atr_pct * multiplier correctly", () => {
    const trade = makeTradeRow({
      entry_price: 100.0,
      exit_price: 102.0,
      actual_pnl: 200.0,
      mfe: 400.0,           // Peak at 104
      shares: 100,
    });

    const params: TrailingStopParams = {
      name: "ATR 1.5x",
      type: "atr_based",
      atr_multiplier: 1.5,
    };

    const result = simulateTrailingStop(trade, params);

    // Peak price = 100 + 4 = 104
    expect(result.peak_price).toBe(104.0);
    
    // ATR distance = entry * 0.02 * 1.5 = 100 * 0.03 = 3.0
    // Trail = peak - 3.0 = 104 - 3 = 101
    expect(result.simulated_exit_price).toBe(101.0);
    
    // Simulated PnL = (101 - 100) * 100 = 100
    expect(result.simulated_pnl).toBe(100.0);
    
    // Improvement = 100 - 200 = -100
    expect(result.improvement).toBe(-100.0);
    
    expect(result.exit_reason).toBe("atr_trail");
  });

  it("3. Time-decay reduces target over holding time", () => {
    const trade = makeTradeRow({
      entry_price: 100.0,
      exit_price: 103.0,
      actual_pnl: 300.0,
      mfe: 500.0,           // Peak at 105
      shares: 100,
      hold_minutes: 60.0,   // Held for 60 minutes
    });

    const params: TrailingStopParams = {
      name: "Decay 60min",
      type: "time_decay",
      decay_minutes: 60,
    };

    const result = simulateTrailingStop(trade, params);

    // Peak price = 105
    expect(result.peak_price).toBe(105.0);
    
    // Decay factor = min(60/60, 1.0) = 1.0 (full decay)
    // Target move = 105 - 100 = 5
    // Reduced target = 100 + 5 * (1 - 1.0 * 0.3) = 100 + 3.5 = 103.5
    expect(result.simulated_exit_price).toBe(103.5);
    
    // Simulated PnL = (103.5 - 100) * 100 = 350
    expect(result.simulated_pnl).toBe(350.0);
    
    // Improvement = 350 - 300 = 50
    expect(result.improvement).toBe(50.0);
    
    expect(result.exit_reason).toBe("time_decay");
  });

  it("4. MFE-escalation tightens after reaching trigger %", () => {
    const trade = makeTradeRow({
      entry_price: 100.0,
      exit_price: 103.0,
      actual_pnl: 300.0,
      mfe: 500.0,           // Peak at 105 (5% move)
      shares: 100,
    });

    const params: TrailingStopParams = {
      name: "MFE 50%",
      type: "mfe_escalation",
      mfe_trigger_pct: 0.50,
      tighten_after_trigger: true,
    };

    const result = simulateTrailingStop(trade, params);

    // Peak price = 105
    expect(result.peak_price).toBe(105.0);
    
    // MFE reached = (105 - 100) / 100 = 0.05 = 5%
    // Trigger check: 5% >= 0.50 * 2% = 1%? Yes, so tighten
    // Tightened trail = peak * 0.05 = 105 * 0.05 = 5.25
    // Exit = 105 - 5.25 = 99.75
    expect(result.simulated_exit_price).toBe(99.75);
    
    // Simulated PnL = (99.75 - 100) * 100 = -25
    expect(result.simulated_pnl).toBe(-25.0);
    
    // Improvement = -25 - 300 = -325
    expect(result.improvement).toBe(-325.0);
    
    expect(result.exit_reason).toBe("mfe_escalation");
  });

  it("5. Breakeven-trail moves stop to entry after N*R reached", () => {
    const trade = makeTradeRow({
      entry_price: 100.0,
      exit_price: 103.0,
      actual_pnl: 300.0,
      mfe: 500.0,
      shares: 100,
      r_multiple: 1.5,      // Reached 1.5R
    });

    const params: TrailingStopParams = {
      name: "Breakeven 1R",
      type: "breakeven_trail",
      breakeven_r_multiple: 1.0,
    };

    const result = simulateTrailingStop(trade, params);

    // Since r_multiple (1.5) >= 1.0, move to breakeven
    expect(result.simulated_exit_price).toBe(100.0);
    
    // Simulated PnL = (100 - 100) * 100 = 0
    expect(result.simulated_pnl).toBe(0);
    
    // Improvement = 0 - 300 = -300
    expect(result.improvement).toBe(-300.0);
    
    expect(result.exit_reason).toBe("breakeven_trail");
  });

  it("6. Trades where MAE happens before MFE get stopped out early", () => {
    const trade = makeTradeRow({
      entry_price: 100.0,
      exit_price: 105.0,
      actual_pnl: 500.0,
      mfe: 600.0,           // Eventually peaked at 106
      mae: -300.0,          // Dropped to 97 first (3% adverse)
      time_to_mae_min: 5.0,  // MAE at 5 minutes
      time_to_mfe_min: 25.0, // MFE at 25 minutes
      shares: 100,
    });

    const params: TrailingStopParams = {
      name: "Fixed 10%",
      type: "fixed_pct",
      fixed_pct: 0.10,
    };

    const result = simulateTrailingStop(trade, params);

    // MAE happened first (5 < 25)
    // MAE distance = 3% > 2% threshold, so stopped early
    expect(result.exit_reason).toBe("mae_first");
    
    // Worst price = 100 + (-300/100) = 97
    expect(result.worst_price).toBe(97.0);
    
    // Simulated exit at worst price
    expect(result.simulated_exit_price).toBe(97.0);
    
    // Simulated PnL = (97 - 100) * 100 = -300
    expect(result.simulated_pnl).toBe(-300.0);
    
    // Improvement = -300 - 500 = -800
    expect(result.improvement).toBe(-800.0);
  });

  it("7. Trades with no MFE data return original exit", () => {
    const trade = makeTradeRow({
      entry_price: 100.0,
      exit_price: 103.0,
      actual_pnl: 300.0,
      mfe: null,            // No MFE data
      mae: null,
      shares: 100,
    });

    const params: TrailingStopParams = {
      name: "Fixed 10%",
      type: "fixed_pct",
      fixed_pct: 0.10,
    };

    const result = simulateTrailingStop(trade, params);

    expect(result.exit_reason).toBe("no_mfe_data");
    expect(result.simulated_exit_price).toBe(103.0);
    expect(result.simulated_pnl).toBe(300.0);
    expect(result.improvement).toBe(0);
  });

  it("8. Edge cases: zero shares, zero entry price, null stop price", () => {
    // Zero shares
    const zeroSharesTrade = makeTradeRow({
      shares: 0,
      entry_price: 100.0,
      exit_price: 103.0,
      actual_pnl: 0,
    });

    const params: TrailingStopParams = {
      name: "Fixed 10%",
      type: "fixed_pct",
      fixed_pct: 0.10,
    };

    const result1 = simulateTrailingStop(zeroSharesTrade, params);
    expect(result1.exit_reason).toBe("invalid_trade");
    expect(result1.improvement).toBe(0);

    // Zero entry price
    const zeroEntryTrade = makeTradeRow({
      shares: 100,
      entry_price: 0,
      exit_price: 103.0,
      actual_pnl: 0,
    });

    const result2 = simulateTrailingStop(zeroEntryTrade, params);
    expect(result2.exit_reason).toBe("invalid_trade");
    expect(result2.improvement).toBe(0);

    // Null stop price (should still work)
    const nullStopTrade = makeTradeRow({
      shares: 100,
      entry_price: 100.0,
      exit_price: 103.0,
      actual_pnl: 300.0,
      stop_price: null,
      mfe: 500.0,
    });

    const result3 = simulateTrailingStop(nullStopTrade, params);
    // Should still simulate normally
    expect(result3.exit_reason).toBe("trailing_stop");
    expect(result3.simulated_exit_price).toBeDefined();
  });
});

// ── Integration Tests (In-Memory SQLite) ─────────────────────────────────

describe("Trailing Stop Optimizer - Integration Tests", () => {
  beforeEach(() => {
    mockDb = createTestDb();
  });

  it("9. runTrailingStopSimulation() produces valid stats", () => {
    const trades = [
      makeTradeRow({ id: 1, symbol: "AAPL", actual_pnl: 200, mfe: 300 }),
      makeTradeRow({ id: 2, symbol: "TSLA", actual_pnl: -100, mfe: 50 }),
      makeTradeRow({ id: 3, symbol: "MSFT", actual_pnl: 500, mfe: 600 }),
    ];

    const params: TrailingStopParams = {
      name: "Fixed 10%",
      type: "fixed_pct",
      fixed_pct: 0.10,
    };

    const stats = runTrailingStopSimulation(trades as any, params);

    expect(stats.param_name).toBe("Fixed 10%");
    expect(stats.total_trades).toBe(3);
    expect(stats.win_rate).toBeGreaterThanOrEqual(0);
    expect(stats.win_rate).toBeLessThanOrEqual(1);
    expect(stats.avg_improvement).toBeDefined();
    expect(stats.total_improvement).toBeDefined();
    expect(stats.median_improvement).toBeDefined();
    expect(stats.improvement_sharpe).toBeDefined();
    expect(stats.better_exits).toBeGreaterThanOrEqual(0);
    expect(stats.worse_exits).toBeGreaterThanOrEqual(0);
    expect(stats.unchanged_exits).toBeGreaterThanOrEqual(0);
    expect(stats.better_exits + stats.worse_exits + stats.unchanged_exits).toBe(3);
    expect(stats.top_improvements).toHaveLength(3);
    expect(stats.top_degradations).toHaveLength(3);
  });

  it("10. runFullOptimization() returns all 19 default param sets sorted by P&L improvement", () => {
    insertTrades(mockDb, [
      { id: 1, symbol: "AAPL", actual_pnl: 200, mfe: 300 },
      { id: 2, symbol: "TSLA", actual_pnl: 100, mfe: 200 },
      { id: 3, symbol: "MSFT", actual_pnl: 300, mfe: 400 },
    ]);

    const results = runFullOptimization();

    expect(results).toHaveLength(19);
    expect(results[0].param_name).toBeDefined();
    
    // Verify sorted by total_improvement descending
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].total_improvement).toBeGreaterThanOrEqual(results[i].total_improvement);
    }
    
    // Verify all DEFAULT_PARAMS are included
    const paramNames = results.map((r) => r.param_name);
    for (const param of DEFAULT_PARAMS) {
      expect(paramNames).toContain(param.name);
    }
  });

  it("11. runPerStrategyOptimization() groups by Holly strategy", () => {
    insertTrades(mockDb, [
      { id: 1, symbol: "AAPL", strategy: "Holly Grail", actual_pnl: 200, mfe: 300 },
      { id: 2, symbol: "TSLA", strategy: "Holly Grail", actual_pnl: 100, mfe: 200 },
      { id: 3, symbol: "MSFT", strategy: "Holly Neo", actual_pnl: 300, mfe: 400 },
    ]);

    const results = runPerStrategyOptimization();

    // Should have results for both strategies
    const strategies = [...new Set(results.map((r) => r.strategy))];
    expect(strategies).toContain("Holly Grail");
    expect(strategies).toContain("Holly Neo");
    
    // Each strategy should have results for all 19 params
    const grailResults = results.filter((r) => r.strategy === "Holly Grail");
    const neoResults = results.filter((r) => r.strategy === "Holly Neo");
    
    expect(grailResults.length).toBe(19);
    expect(neoResults.length).toBe(19);
    
    // Verify fields are populated
    for (const result of results) {
      expect(result.strategy).toBeDefined();
      expect(result.param_name).toBeDefined();
      expect(result.total_trades).toBeGreaterThan(0);
      expect(result.avg_improvement).toBeDefined();
      expect(result.total_improvement).toBeDefined();
      expect(result.win_rate).toBeGreaterThanOrEqual(0);
      expect(result.win_rate).toBeLessThanOrEqual(1);
    }
  });

  it("12. getOptimizationSummary() returns summary table format", () => {
    insertTrades(mockDb, [
      { id: 1, symbol: "AAPL", strategy: "Holly Grail", actual_pnl: 200, mfe: 300 },
      { id: 2, symbol: "TSLA", strategy: "Holly Neo", actual_pnl: 100, mfe: 200 },
    ]);

    const summary = getOptimizationSummary();

    expect(summary.overall_best).toBeDefined();
    expect(typeof summary.overall_best).toBe("string");
    
    expect(summary.by_strategy).toBeDefined();
    expect(Array.isArray(summary.by_strategy)).toBe(true);
    expect(summary.by_strategy.length).toBeGreaterThan(0);
    
    for (const item of summary.by_strategy) {
      expect(item.strategy).toBeDefined();
      expect(item.best_param).toBeDefined();
      expect(item.improvement).toBeDefined();
    }
  });

  it("13. Filtering by strategy/segment/date range works correctly", () => {
    insertTrades(mockDb, [
      { id: 1, symbol: "AAPL", strategy: "Holly Grail", segment: "Morning", entry_time: "2024-03-15 09:30:00", actual_pnl: 200, mfe: 300 },
      { id: 2, symbol: "TSLA", strategy: "Holly Neo", segment: "Afternoon", entry_time: "2024-03-15 14:00:00", actual_pnl: 100, mfe: 200 },
      { id: 3, symbol: "MSFT", strategy: "Holly Grail", segment: "Morning", entry_time: "2024-03-16 09:30:00", actual_pnl: 300, mfe: 400 },
    ]);

    // Filter by strategy
    const grailResults = runFullOptimization({ strategy: "Holly Grail" });
    expect(grailResults).toHaveLength(19);
    // Verify we only got Holly Grail trades (2 trades)
    expect(grailResults[0].total_trades).toBe(2);

    // Filter by segment
    const morningResults = runFullOptimization({ segment: "Morning" });
    expect(morningResults).toHaveLength(19);
    expect(morningResults[0].total_trades).toBe(2);

    // Filter by date range
    const dateResults = runFullOptimization({
      startDate: "2024-03-15 00:00:00",
      endDate: "2024-03-15 23:59:59",
    });
    expect(dateResults).toHaveLength(19);
    expect(dateResults[0].total_trades).toBe(2);

    // Combined filters
    const combinedResults = runFullOptimization({
      strategy: "Holly Grail",
      segment: "Morning",
      startDate: "2024-03-15 00:00:00",
      endDate: "2024-03-15 23:59:59",
    });
    expect(combinedResults).toHaveLength(19);
    expect(combinedResults[0].total_trades).toBe(1);
  });

  it("14. Empty table returns zero results gracefully", () => {
    // No trades inserted
    const results = runFullOptimization();

    expect(results).toHaveLength(0);
    
    const perStrategyResults = runPerStrategyOptimization();
    expect(perStrategyResults).toHaveLength(0);
    
    const summary = getOptimizationSummary();
    expect(summary.overall_best).toBe("");
    expect(summary.by_strategy).toHaveLength(0);
  });
});

// ── Statistical Validation ───────────────────────────────────────────────

describe("Trailing Stop Optimizer - Statistical Validation", () => {
  beforeEach(() => {
    mockDb = createTestDb();
  });

  it("15. Verify simulated P&L + improvement = simulated_pnl - original_pnl", () => {
    const trade = makeTradeRow({
      entry_price: 100.0,
      exit_price: 103.0,
      actual_pnl: 300.0,
      mfe: 500.0,
      shares: 100,
    });

    const params: TrailingStopParams = {
      name: "Fixed 10%",
      type: "fixed_pct",
      fixed_pct: 0.10,
    };

    const result = simulateTrailingStop(trade, params);

    // Verify formula: improvement = simulated_pnl - original_pnl
    const expected_improvement = result.simulated_pnl - result.original_pnl;
    expect(result.improvement).toBeCloseTo(expected_improvement, 2);
  });

  it("16. Win rate calculation is correct", () => {
    const trades = [
      makeTradeRow({ id: 1, actual_pnl: 200, mfe: 300, exit_price: 102, entry_price: 100 }),  // Winner
      makeTradeRow({ id: 2, actual_pnl: -100, mfe: 50, exit_price: 99, entry_price: 100 }),   // Loser
      makeTradeRow({ id: 3, actual_pnl: 300, mfe: 400, exit_price: 103, entry_price: 100 }),  // Winner
      makeTradeRow({ id: 4, actual_pnl: -50, mfe: 25, exit_price: 99.5, entry_price: 100 }),  // Loser
    ];

    const params: TrailingStopParams = {
      name: "Fixed 10%",
      type: "fixed_pct",
      fixed_pct: 0.10,
    };

    const stats = runTrailingStopSimulation(trades as any, params);

    // Count simulated winners
    const simulations = trades.map((t) => simulateTrailingStop(t as any, params));
    const winners = simulations.filter((s) => s.simulated_pnl > 0).length;
    const expected_win_rate = winners / simulations.length;

    expect(stats.win_rate).toBeCloseTo(expected_win_rate, 4);
  });

  it("17. Sharpe ratio formula matches (mean/std * sqrt(252))", () => {
    const trades = [
      makeTradeRow({ id: 1, actual_pnl: 200, mfe: 300 }),
      makeTradeRow({ id: 2, actual_pnl: 100, mfe: 200 }),
      makeTradeRow({ id: 3, actual_pnl: 300, mfe: 400 }),
      makeTradeRow({ id: 4, actual_pnl: -100, mfe: 50 }),
    ];

    const params: TrailingStopParams = {
      name: "Fixed 10%",
      type: "fixed_pct",
      fixed_pct: 0.10,
    };

    const stats = runTrailingStopSimulation(trades as any, params);

    // Manually calculate Sharpe
    const simulations = trades.map((t) => simulateTrailingStop(t as any, params));
    const improvements = simulations.map((s) => s.improvement);
    const mean = improvements.reduce((sum, x) => sum + x, 0) / improvements.length;
    const variance = improvements.reduce((sum, x) => sum + Math.pow(x - mean, 2), 0) / improvements.length;
    const stdDev = Math.sqrt(variance);
    const expected_sharpe = stdDev > 0 ? (mean / stdDev) * Math.sqrt(252) : 0;

    expect(stats.improvement_sharpe).toBeCloseTo(expected_sharpe, 4);
  });

  it("18. Top improvements/degradations are sorted correctly", () => {
    insertTrades(mockDb, [
      { id: 1, symbol: "AAPL", actual_pnl: 200, mfe: 300 },
      { id: 2, symbol: "TSLA", actual_pnl: -100, mfe: 50 },
      { id: 3, symbol: "MSFT", actual_pnl: 500, mfe: 600 },
      { id: 4, symbol: "GOOGL", actual_pnl: 100, mfe: 150 },
      { id: 5, symbol: "AMZN", actual_pnl: -200, mfe: 25 },
    ]);

    const results = runFullOptimization();
    const firstResult = results[0];

    // Verify top_improvements are sorted descending
    for (let i = 1; i < firstResult.top_improvements.length; i++) {
      expect(firstResult.top_improvements[i - 1].improvement).toBeGreaterThanOrEqual(
        firstResult.top_improvements[i].improvement
      );
    }

    // Verify top_degradations are sorted ascending (worst/most negative first)
    for (let i = 1; i < firstResult.top_degradations.length; i++) {
      expect(firstResult.top_degradations[i - 1].improvement).toBeLessThanOrEqual(
        firstResult.top_degradations[i].improvement
      );
    }
  });
});
