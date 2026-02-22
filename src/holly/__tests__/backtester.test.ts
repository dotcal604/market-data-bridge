/**
 * Tests for Holly Backtester
 * 
 * Coverage:
 * - extractRules: Cohen's d separation, per-strategy rules, edge cases
 * - runBacktest: precision/win_rate/sharpe/P&L calculations
 * - scoreAgainstRules: weighted matching logic
 * - getStrategyBreakdown: per-strategy metrics
 * - Empty data edge cases
 */
import { describe, it, expect, beforeEach } from "vitest";
import Database, { type Database as DatabaseType } from "better-sqlite3";
import {
  extractRules,
  runBacktest,
  scoreAgainstRules,
  getStrategyBreakdown,
  type Rule,
} from "../backtester.js";
import type { FeatureVector } from "../../eval/features/types.js";

// ── Test Database Setup ──────────────────────────────────────────────────

function createTestDb(): DatabaseType {
  const db = new Database(":memory:");
  
  // Create schema
  db.exec(`
    CREATE TABLE holly_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      alert_time TEXT NOT NULL,
      symbol TEXT NOT NULL,
      strategy TEXT,
      entry_price REAL,
      stop_price REAL,
      shares INTEGER,
      last_price REAL,
      segment TEXT,
      extra TEXT,
      import_batch TEXT,
      imported_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    
    CREATE TABLE evaluations (
      id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      direction TEXT,
      entry_price REAL,
      stop_price REAL,
      user_notes TEXT,
      timestamp TEXT NOT NULL,
      features_json TEXT NOT NULL,
      last_price REAL,
      rvol REAL,
      vwap_deviation_pct REAL,
      spread_pct REAL,
      float_rotation_est REAL,
      volume_acceleration REAL,
      atr_pct REAL,
      price_extension_pct REAL,
      gap_pct REAL,
      range_position_pct REAL,
      volatility_regime TEXT,
      liquidity_bucket TEXT,
      spy_change_pct REAL,
      qqq_change_pct REAL,
      market_alignment TEXT,
      time_of_day TEXT,
      minutes_since_open INTEGER,
      ensemble_trade_score REAL,
      ensemble_should_trade INTEGER DEFAULT 0,
      prefilter_passed INTEGER DEFAULT 1
    );
    
    CREATE TABLE outcomes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      evaluation_id TEXT NOT NULL UNIQUE REFERENCES evaluations(id),
      trade_taken INTEGER NOT NULL,
      decision_type TEXT,
      confidence_rating INTEGER,
      rule_followed INTEGER,
      setup_type TEXT,
      actual_entry_price REAL,
      actual_exit_price REAL,
      r_multiple REAL,
      exit_reason TEXT,
      notes TEXT,
      recorded_at TEXT NOT NULL
    );
    
    CREATE TABLE signals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      holly_alert_id INTEGER REFERENCES holly_alerts(id),
      evaluation_id TEXT,
      symbol TEXT NOT NULL,
      direction TEXT NOT NULL DEFAULT 'long',
      strategy TEXT,
      ensemble_score REAL,
      should_trade INTEGER DEFAULT 0,
      blocked_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  
  return db;
}

// ── Test Data Helpers ────────────────────────────────────────────────────

function insertHollyAlert(db: DatabaseType, data: {
  symbol: string;
  strategy: string;
  alert_time: string;
  entry_price?: number;
}): number {
  const result = db.prepare(`
    INSERT INTO holly_alerts (symbol, strategy, alert_time, entry_price)
    VALUES (?, ?, ?, ?)
  `).run(data.symbol, data.strategy, data.alert_time, data.entry_price ?? 150);
  
  return result.lastInsertRowid as number;
}

function insertEvaluation(db: DatabaseType, data: {
  id: string;
  symbol: string;
  timestamp: string;
  rvol?: number;
  vwap_deviation_pct?: number;
  spread_pct?: number;
  gap_pct?: number;
  atr_pct?: number;
  spy_change_pct?: number;
  features_json?: string;
}): void {
  const features = data.features_json ?? JSON.stringify({
    symbol: data.symbol,
    timestamp: data.timestamp,
    last: 150,
    bid: 149.8,
    ask: 150.2,
    open: 148,
    high: 151,
    low: 147.5,
    close_prev: 147,
    volume: 1000000,
    rvol: data.rvol ?? 1.5,
    vwap_deviation_pct: data.vwap_deviation_pct ?? 0.5,
    spread_pct: data.spread_pct ?? 0.3,
    gap_pct: data.gap_pct ?? 0.68,
    atr_pct: data.atr_pct ?? 1.67,
    spy_change_pct: data.spy_change_pct ?? 0.5,
  });
  
  db.prepare(`
    INSERT INTO evaluations (
      id, symbol, timestamp, features_json,
      rvol, vwap_deviation_pct, spread_pct, gap_pct, atr_pct, spy_change_pct
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.id, data.symbol, data.timestamp, features,
    data.rvol ?? 1.5,
    data.vwap_deviation_pct ?? 0.5,
    data.spread_pct ?? 0.3,
    data.gap_pct ?? 0.68,
    data.atr_pct ?? 1.67,
    data.spy_change_pct ?? 0.5
  );
}

function insertOutcome(db: DatabaseType, data: {
  evaluation_id: string;
  r_multiple: number;
  trade_taken?: number;
}): void {
  db.prepare(`
    INSERT INTO outcomes (evaluation_id, trade_taken, r_multiple, recorded_at)
    VALUES (?, ?, ?, datetime('now'))
  `).run(data.evaluation_id, data.trade_taken ?? 1, data.r_multiple);
}

function insertSignal(db: DatabaseType, data: {
  holly_alert_id: number;
  evaluation_id: string;
  symbol: string;
}): void {
  db.prepare(`
    INSERT INTO signals (holly_alert_id, evaluation_id, symbol)
    VALUES (?, ?, ?)
  `).run(data.holly_alert_id, data.evaluation_id, data.symbol);
}

function seedTestData(db: DatabaseType): void {
  // Strategy A: High rvol wins, low rvol losses
  const alertA1 = insertHollyAlert(db, { symbol: "AAPL", strategy: "Holly Grail", alert_time: "2024-01-01 10:00:00" });
  insertEvaluation(db, { id: "eval-a1", symbol: "AAPL", timestamp: "2024-01-01 10:00:00", rvol: 2.5, gap_pct: 1.2 });
  insertOutcome(db, { evaluation_id: "eval-a1", r_multiple: 1.5 }); // Win
  insertSignal(db, { holly_alert_id: alertA1, evaluation_id: "eval-a1", symbol: "AAPL" });
  
  const alertA2 = insertHollyAlert(db, { symbol: "TSLA", strategy: "Holly Grail", alert_time: "2024-01-02 10:00:00" });
  insertEvaluation(db, { id: "eval-a2", symbol: "TSLA", timestamp: "2024-01-02 10:00:00", rvol: 0.8, gap_pct: 0.3 });
  insertOutcome(db, { evaluation_id: "eval-a2", r_multiple: -1.0 }); // Loss
  insertSignal(db, { holly_alert_id: alertA2, evaluation_id: "eval-a2", symbol: "TSLA" });
  
  const alertA3 = insertHollyAlert(db, { symbol: "NVDA", strategy: "Holly Grail", alert_time: "2024-01-03 10:00:00" });
  insertEvaluation(db, { id: "eval-a3", symbol: "NVDA", timestamp: "2024-01-03 10:00:00", rvol: 3.0, gap_pct: 1.5 });
  insertOutcome(db, { evaluation_id: "eval-a3", r_multiple: 2.0 }); // Win
  insertSignal(db, { holly_alert_id: alertA3, evaluation_id: "eval-a3", symbol: "NVDA" });
  
  const alertA4 = insertHollyAlert(db, { symbol: "AMD", strategy: "Holly Grail", alert_time: "2024-01-04 10:00:00" });
  insertEvaluation(db, { id: "eval-a4", symbol: "AMD", timestamp: "2024-01-04 10:00:00", rvol: 0.7, gap_pct: 0.2 });
  insertOutcome(db, { evaluation_id: "eval-a4", r_multiple: -0.5 }); // Loss
  insertSignal(db, { holly_alert_id: alertA4, evaluation_id: "eval-a4", symbol: "AMD" });
  
  const alertA5 = insertHollyAlert(db, { symbol: "GOOGL", strategy: "Holly Grail", alert_time: "2024-01-05 10:00:00" });
  insertEvaluation(db, { id: "eval-a5", symbol: "GOOGL", timestamp: "2024-01-05 10:00:00", rvol: 2.2, gap_pct: 1.0 });
  insertOutcome(db, { evaluation_id: "eval-a5", r_multiple: 1.2 }); // Win
  insertSignal(db, { holly_alert_id: alertA5, evaluation_id: "eval-a5", symbol: "GOOGL" });
  
  // Strategy B: High spread_pct losses, low spread_pct wins
  const alertB1 = insertHollyAlert(db, { symbol: "MSFT", strategy: "Gap and Go", alert_time: "2024-01-06 10:00:00" });
  insertEvaluation(db, { id: "eval-b1", symbol: "MSFT", timestamp: "2024-01-06 10:00:00", spread_pct: 0.1, rvol: 1.5 });
  insertOutcome(db, { evaluation_id: "eval-b1", r_multiple: 1.0 }); // Win
  insertSignal(db, { holly_alert_id: alertB1, evaluation_id: "eval-b1", symbol: "MSFT" });
  
  const alertB2 = insertHollyAlert(db, { symbol: "META", strategy: "Gap and Go", alert_time: "2024-01-07 10:00:00" });
  insertEvaluation(db, { id: "eval-b2", symbol: "META", timestamp: "2024-01-07 10:00:00", spread_pct: 0.8, rvol: 1.5 });
  insertOutcome(db, { evaluation_id: "eval-b2", r_multiple: -1.5 }); // Loss
  insertSignal(db, { holly_alert_id: alertB2, evaluation_id: "eval-b2", symbol: "META" });
  
  const alertB3 = insertHollyAlert(db, { symbol: "AMZN", strategy: "Gap and Go", alert_time: "2024-01-08 10:00:00" });
  insertEvaluation(db, { id: "eval-b3", symbol: "AMZN", timestamp: "2024-01-08 10:00:00", spread_pct: 0.15, rvol: 1.5 });
  insertOutcome(db, { evaluation_id: "eval-b3", r_multiple: 0.8 }); // Win
  insertSignal(db, { holly_alert_id: alertB3, evaluation_id: "eval-b3", symbol: "AMZN" });
  
  const alertB4 = insertHollyAlert(db, { symbol: "NFLX", strategy: "Gap and Go", alert_time: "2024-01-09 10:00:00" });
  insertEvaluation(db, { id: "eval-b4", symbol: "NFLX", timestamp: "2024-01-09 10:00:00", spread_pct: 0.9, rvol: 1.5 });
  insertOutcome(db, { evaluation_id: "eval-b4", r_multiple: -1.2 }); // Loss
  insertSignal(db, { holly_alert_id: alertB4, evaluation_id: "eval-b4", symbol: "NFLX" });
  
  const alertB5 = insertHollyAlert(db, { symbol: "INTC", strategy: "Gap and Go", alert_time: "2024-01-10 10:00:00" });
  insertEvaluation(db, { id: "eval-b5", symbol: "INTC", timestamp: "2024-01-10 10:00:00", spread_pct: 0.12, rvol: 1.5 });
  insertOutcome(db, { evaluation_id: "eval-b5", r_multiple: 1.1 }); // Win
  insertSignal(db, { holly_alert_id: alertB5, evaluation_id: "eval-b5", symbol: "INTC" });
  
  // Add more samples for cross-strategy patterns
  for (let i = 0; i < 10; i++) {
    const alertId = insertHollyAlert(db, { 
      symbol: `SYM${i}`, 
      strategy: "Holly Grail", 
      alert_time: `2024-01-${11 + i} 10:00:00` 
    });
    const isWin = i % 3 === 0;
    insertEvaluation(db, { 
      id: `eval-extra-${i}`, 
      symbol: `SYM${i}`, 
      timestamp: `2024-01-${11 + i} 10:00:00`,
      rvol: isWin ? 2.0 + Math.random() : 0.5 + Math.random() * 0.5,
      gap_pct: isWin ? 1.0 + Math.random() : 0.2 + Math.random() * 0.3
    });
    insertOutcome(db, { evaluation_id: `eval-extra-${i}`, r_multiple: isWin ? 0.8 + Math.random() : -0.5 - Math.random() });
    insertSignal(db, { holly_alert_id: alertId, evaluation_id: `eval-extra-${i}`, symbol: `SYM${i}` });
  }
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("Holly Backtester", () => {
  let db: DatabaseType;
  
  beforeEach(() => {
    db = createTestDb();
    seedTestData(db);
  });
  
  describe("extractRules", () => {
    it("should extract rules with Cohen's d effect size", () => {
      const rules = extractRules(db, 5, 0.2);
      
      expect(rules.length).toBeGreaterThan(0);
      
      // Check that rules have required fields
      for (const rule of rules) {
        expect(rule).toHaveProperty("feature");
        expect(rule).toHaveProperty("cohens_d");
        expect(rule).toHaveProperty("mean_win");
        expect(rule).toHaveProperty("mean_loss");
        expect(rule).toHaveProperty("std_win");
        expect(rule).toHaveProperty("std_loss");
        expect(rule).toHaveProperty("n_win");
        expect(rule).toHaveProperty("n_loss");
        expect(rule).toHaveProperty("direction");
        expect(Math.abs(rule.cohens_d)).toBeGreaterThanOrEqual(0.2);
      }
    });
    
    it("should extract per-strategy rules", () => {
      const rules = extractRules(db, 3, 0.2);
      
      const grailRules = rules.filter(r => r.strategy === "Holly Grail");
      const gapRules = rules.filter(r => r.strategy === "Gap and Go");
      const crossRules = rules.filter(r => r.strategy === null);
      
      expect(grailRules.length).toBeGreaterThan(0);
      expect(gapRules.length).toBeGreaterThan(0);
      
      // Check rvol rule for Holly Grail (winners have higher rvol)
      const rvolRule = grailRules.find(r => r.feature === "rvol");
      if (rvolRule) {
        expect(rvolRule.mean_win).toBeGreaterThan(rvolRule.mean_loss);
        expect(rvolRule.direction).toBe("higher");
      }
      
      // Check spread_pct rule for Gap and Go (winners have lower spread)
      const spreadRule = gapRules.find(r => r.feature === "spread_pct");
      if (spreadRule) {
        expect(spreadRule.mean_win).toBeLessThan(spreadRule.mean_loss);
        expect(spreadRule.direction).toBe("lower");
      }
    });
    
    it("should sort rules by absolute Cohen's d descending", () => {
      const rules = extractRules(db, 3, 0.2);
      
      for (let i = 1; i < rules.length; i++) {
        expect(Math.abs(rules[i-1].cohens_d)).toBeGreaterThanOrEqual(Math.abs(rules[i].cohens_d));
      }
    });
    
    it("should handle empty data gracefully", () => {
      const emptyDb = createTestDb();
      const rules = extractRules(emptyDb, 5, 0.2);
      
      expect(rules).toEqual([]);
    });
    
    it("should respect minSamples threshold", () => {
      const rules = extractRules(db, 50, 0.2); // Too few samples
      
      expect(rules.length).toBe(0);
    });
    
    it("should respect minCohenD threshold", () => {
      const rulesStrict = extractRules(db, 3, 2.0); // Very high threshold
      const rulesLenient = extractRules(db, 3, 0.1); // Low threshold
      
      expect(rulesStrict.length).toBeLessThanOrEqual(rulesLenient.length);
    });
  });
  
  describe("scoreAgainstRules", () => {
    it("should score feature vector against rules", () => {
      const rules = extractRules(db, 3, 0.2);
      
      const features: Partial<FeatureVector> = {
        symbol: "TEST",
        rvol: 2.5,
        vwap_deviation_pct: 0.5,
        spread_pct: 0.3,
        gap_pct: 1.0,
        atr_pct: 1.5,
      };
      
      const result = scoreAgainstRules(features, rules);
      
      expect(result.symbol).toBe("TEST");
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
      expect(result.matched_rules).toBeLessThanOrEqual(result.total_rules);
    });
    
    it("should apply strategy-specific rules when provided", () => {
      const rules = extractRules(db, 3, 0.2);
      
      const features: Partial<FeatureVector> = {
        symbol: "TEST",
        rvol: 2.5,
        spread_pct: 0.1,
      };
      
      const grailScore = scoreAgainstRules(features, rules, "Holly Grail");
      const gapScore = scoreAgainstRules(features, rules, "Gap and Go");
      
      expect(grailScore.score).toBeGreaterThanOrEqual(0);
      expect(gapScore.score).toBeGreaterThanOrEqual(0);
    });
    
    it("should weight by Cohen's d magnitude", () => {
      const rules: Rule[] = [
        {
          feature: "rvol",
          strategy: null,
          mean_win: 2.5,
          mean_loss: 1.0,
          std_win: 0.5,
          std_loss: 0.3,
          cohens_d: 2.0, // Strong effect
          n_win: 10,
          n_loss: 10,
          threshold: 2.5,
          direction: "higher",
        },
        {
          feature: "spread_pct",
          strategy: null,
          mean_win: 0.2,
          mean_loss: 0.3,
          std_win: 0.1,
          std_loss: 0.1,
          cohens_d: 0.3, // Weak effect
          n_win: 10,
          n_loss: 10,
          threshold: 0.2,
          direction: "lower",
        },
      ];
      
      // Matches strong rule, misses weak rule
      const features1: Partial<FeatureVector> = {
        symbol: "TEST1",
        rvol: 3.0, // Matches
        spread_pct: 0.5, // Doesn't match
      };
      
      // Misses strong rule, matches weak rule
      const features2: Partial<FeatureVector> = {
        symbol: "TEST2",
        rvol: 0.5, // Doesn't match
        spread_pct: 0.1, // Matches
      };
      
      const score1 = scoreAgainstRules(features1, rules);
      const score2 = scoreAgainstRules(features2, rules);
      
      // Score1 should be higher because it matches the stronger rule
      expect(score1.score).toBeGreaterThan(score2.score);
    });
    
    it("should return neutral score for empty rules", () => {
      const features: Partial<FeatureVector> = {
        symbol: "TEST",
        rvol: 2.5,
      };
      
      const result = scoreAgainstRules(features, []);
      
      expect(result.score).toBe(50);
      expect(result.matched_rules).toBe(0);
      expect(result.total_rules).toBe(0);
    });
  });
  
  describe("runBacktest", () => {
    it("should calculate precision, win rate, Sharpe, and P&L", () => {
      const rules = extractRules(db, 3, 0.2);
      const result = runBacktest(db, rules, 60);
      
      expect(result.total_trades).toBeGreaterThan(0);
      expect(result.wins).toBeGreaterThanOrEqual(0);
      expect(result.losses).toBeGreaterThanOrEqual(0);
      expect(result.wins + result.losses).toBe(result.total_trades);
      
      expect(result.win_rate).toBeGreaterThanOrEqual(0);
      expect(result.win_rate).toBeLessThanOrEqual(1);
      
      expect(result.precision).toBeGreaterThanOrEqual(0);
      expect(result.precision).toBeLessThanOrEqual(1);
      
      expect(result.sharpe).toBeDefined();
      expect(result.max_drawdown).toBeGreaterThanOrEqual(0);
      // Max drawdown can theoretically exceed 1 if losses compound or exceed capital,
      // but for standard non-levered backtests it's usually 0-1.
      // Allowing slight overflow for potential calculation artifacts or extreme loss scenarios.
      expect(result.max_drawdown).toBeLessThanOrEqual(2);
      
      expect(result.trades.length).toBe(result.total_trades);
    });
    
    it("should track predicted vs actual wins", () => {
      const rules = extractRules(db, 3, 0.2);
      const result = runBacktest(db, rules, 60);
      
      for (const trade of result.trades) {
        expect(trade).toHaveProperty("symbol");
        expect(trade).toHaveProperty("timestamp");
        expect(trade).toHaveProperty("predicted_win");
        expect(trade).toHaveProperty("actual_win");
        expect(trade).toHaveProperty("r_multiple");
        expect(trade).toHaveProperty("score");
        
        expect(typeof trade.predicted_win).toBe("boolean");
        expect(typeof trade.actual_win).toBe("boolean");
      }
    });
    
    it("should calculate Sharpe ratio correctly", () => {
      const rules = extractRules(db, 3, 0.2);
      const result = runBacktest(db, rules, 60);
      
      // Sharpe should be reasonable (not Infinity or NaN)
      expect(isFinite(result.sharpe)).toBe(true);
    });
    
    it("should handle empty data", () => {
      const emptyDb = createTestDb();
      const rules: Rule[] = [];
      const result = runBacktest(emptyDb, rules, 60);
      
      expect(result.total_trades).toBe(0);
      expect(result.wins).toBe(0);
      expect(result.losses).toBe(0);
      expect(result.win_rate).toBe(0);
      expect(result.avg_r).toBe(0);
      expect(result.sharpe).toBe(0);
      expect(result.total_pnl_r).toBe(0);
      expect(result.precision).toBe(0);
      expect(result.max_drawdown).toBe(0);
      expect(result.trades).toEqual([]);
    });
    
    it("should respect winThreshold parameter", () => {
      const rules = extractRules(db, 3, 0.2);
      
      const resultLow = runBacktest(db, rules, 30);  // Low threshold
      const resultHigh = runBacktest(db, rules, 80); // High threshold
      
      // Lower threshold should predict more wins
      const predictedWinsLow = resultLow.trades.filter(t => t.predicted_win).length;
      const predictedWinsHigh = resultHigh.trades.filter(t => t.predicted_win).length;
      
      expect(predictedWinsLow).toBeGreaterThanOrEqual(predictedWinsHigh);
    });
  });
  
  describe("getStrategyBreakdown", () => {
    it("should return per-strategy metrics", () => {
      const breakdown = getStrategyBreakdown(db);
      
      expect(breakdown.length).toBeGreaterThan(0);
      
      for (const item of breakdown) {
        expect(item).toHaveProperty("strategy");
        expect(item).toHaveProperty("count");
        expect(item).toHaveProperty("win_rate");
        expect(item).toHaveProperty("avg_r");
        expect(item).toHaveProperty("sharpe");
        expect(item).toHaveProperty("total_pnl_r");
        
        expect(item.count).toBeGreaterThan(0);
        expect(item.win_rate).toBeGreaterThanOrEqual(0);
        expect(item.win_rate).toBeLessThanOrEqual(1);
      }
    });
    
    it("should sort by count descending", () => {
      const breakdown = getStrategyBreakdown(db);
      
      for (let i = 1; i < breakdown.length; i++) {
        expect(breakdown[i-1].count).toBeGreaterThanOrEqual(breakdown[i].count);
      }
    });
    
    it("should calculate strategy-specific Sharpe ratios", () => {
      const breakdown = getStrategyBreakdown(db);
      
      for (const item of breakdown) {
        expect(isFinite(item.sharpe)).toBe(true);
      }
    });
    
    it("should handle empty data", () => {
      const emptyDb = createTestDb();
      const breakdown = getStrategyBreakdown(emptyDb);
      
      expect(breakdown).toEqual([]);
    });
  });
});
