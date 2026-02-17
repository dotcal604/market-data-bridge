/**
 * Tests for Holly Predictor
 * 
 * Coverage:
 * - buildProfiles: Mean/std per feature from winning trades
 * - Z-score matching for pattern detection
 * - scanSymbols: Batch symbol scanning
 * - getPreAlertCandidates: Fallback scoring for unevaluated alerts
 * - Cache refresh logic
 */
import { describe, it, expect, beforeEach } from "vitest";
import Database, { type Database as DatabaseType } from "better-sqlite3";
import {
  buildProfiles,
  scanSymbols,
  getPreAlertCandidates,
  createProfileCache,
  shouldRefreshCache,
  refreshCacheIfNeeded,
  getNewOutcomesCount,
  type FeatureProfile,
  type ProfileCache,
} from "../predictor.js";
import type { FeatureVector } from "../../eval/features/types.js";

// ── Test Database Setup ──────────────────────────────────────────────────

function createTestDb(): DatabaseType {
  const db = new Database(":memory:");
  
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
  strategy?: string;
  alert_time: string;
  entry_price?: number;
}): number {
  const result = db.prepare(`
    INSERT INTO holly_alerts (symbol, strategy, alert_time, entry_price)
    VALUES (?, ?, ?, ?)
  `).run(data.symbol, data.strategy ?? null, data.alert_time, data.entry_price ?? 150);
  
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
}): void {
  db.prepare(`
    INSERT INTO evaluations (
      id, symbol, timestamp, features_json,
      rvol, vwap_deviation_pct, spread_pct, gap_pct, atr_pct, spy_change_pct
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.id, 
    data.symbol, 
    data.timestamp, 
    "{}",
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
  recorded_at?: string;
}): void {
  db.prepare(`
    INSERT INTO outcomes (evaluation_id, trade_taken, r_multiple, recorded_at)
    VALUES (?, ?, ?, ?)
  `).run(
    data.evaluation_id, 
    data.trade_taken ?? 1, 
    data.r_multiple,
    data.recorded_at ?? new Date().toISOString()
  );
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

function seedWinningTrades(db: DatabaseType, count: number, strategy?: string, idSuffix = ""): void {
  for (let i = 0; i < count; i++) {
    const alertId = insertHollyAlert(db, {
      symbol: `WIN${idSuffix}${i}`,
      strategy: strategy ?? "Holly Grail",
      alert_time: `2024-01-${String(i + 1).padStart(2, "0")} 10:00:00`,
    });
    
    insertEvaluation(db, {
      id: `eval-win-${idSuffix}${i}`,
      symbol: `WIN${idSuffix}${i}`,
      timestamp: `2024-01-${String(i + 1).padStart(2, "0")} 10:00:00`,
      rvol: 2.0 + Math.random(),
      vwap_deviation_pct: 0.5 + Math.random() * 0.3,
      spread_pct: 0.2 + Math.random() * 0.1,
      gap_pct: 1.0 + Math.random() * 0.5,
      atr_pct: 1.5 + Math.random() * 0.5,
      spy_change_pct: 0.3 + Math.random() * 0.3,
    });
    
    insertOutcome(db, {
      evaluation_id: `eval-win-${idSuffix}${i}`,
      r_multiple: 1.0 + Math.random(),
    });
    
    insertSignal(db, {
      holly_alert_id: alertId,
      evaluation_id: `eval-win-${idSuffix}${i}`,
      symbol: `WIN${idSuffix}${i}`,
    });
  }
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("Holly Predictor", () => {
  let db: DatabaseType;
  
  beforeEach(() => {
    db = createTestDb();
  });
  
  describe("buildProfiles", () => {
    it("should build mean/std profiles from winning trades", () => {
      seedWinningTrades(db, 25);
      
      const profiles = buildProfiles(db, 20);
      
      expect(profiles.length).toBeGreaterThan(0);
      
      for (const profile of profiles) {
        expect(profile).toHaveProperty("feature");
        expect(profile).toHaveProperty("mean");
        expect(profile).toHaveProperty("std");
        expect(profile).toHaveProperty("min");
        expect(profile).toHaveProperty("max");
        expect(profile).toHaveProperty("sample_size");
        expect(profile).toHaveProperty("strategy");
        
        expect(profile.sample_size).toBeGreaterThanOrEqual(20);
        expect(profile.std).toBeGreaterThanOrEqual(0);
        expect(profile.min).toBeLessThanOrEqual(profile.mean);
        expect(profile.max).toBeGreaterThanOrEqual(profile.mean);
      }
    });
    
    it("should filter by strategy when provided", () => {
      seedWinningTrades(db, 15, "Holly Grail", "grail-");
      seedWinningTrades(db, 15, "Gap and Go", "gap-");
      
      const grailProfiles = buildProfiles(db, 10, "Holly Grail");
      const gapProfiles = buildProfiles(db, 10, "Gap and Go");
      
      expect(grailProfiles.length).toBeGreaterThan(0);
      expect(gapProfiles.length).toBeGreaterThan(0);
      
      for (const profile of grailProfiles) {
        expect(profile.strategy).toBe("Holly Grail");
      }
      
      for (const profile of gapProfiles) {
        expect(profile.strategy).toBe("Gap and Go");
      }
    });
    
    it("should respect minSamples threshold", () => {
      seedWinningTrades(db, 15);
      
      const profilesLow = buildProfiles(db, 10);
      const profilesHigh = buildProfiles(db, 50);
      
      expect(profilesLow.length).toBeGreaterThan(0);
      expect(profilesHigh.length).toBe(0); // Not enough samples
    });
    
    it("should handle empty data", () => {
      const profiles = buildProfiles(db, 20);
      
      expect(profiles).toEqual([]);
    });
    
    it("should calculate statistics correctly", () => {
      seedWinningTrades(db, 30);
      
      const profiles = buildProfiles(db, 20);
      const rvolProfile = profiles.find(p => p.feature === "rvol");
      
      expect(rvolProfile).toBeDefined();
      if (rvolProfile) {
        // Mean should be around 2.5 (2.0 + random(0-1))
        expect(rvolProfile.mean).toBeGreaterThan(2.0);
        expect(rvolProfile.mean).toBeLessThan(3.0);
        
        // Std should be positive
        expect(rvolProfile.std).toBeGreaterThan(0);
      }
    });
  });
  
  describe("scanSymbols", () => {
    it("should calculate z-scores for batch of symbols", () => {
      seedWinningTrades(db, 25);
      const profiles = buildProfiles(db, 20);
      
      const features: Array<Partial<FeatureVector>> = [
        {
          symbol: "TEST1",
          rvol: 2.5,
          vwap_deviation_pct: 0.6,
          spread_pct: 0.25,
          gap_pct: 1.2,
        },
        {
          symbol: "TEST2",
          rvol: 1.0,
          vwap_deviation_pct: 0.3,
          spread_pct: 0.5,
          gap_pct: 0.5,
        },
      ];
      
      const results = scanSymbols(features, profiles);
      
      expect(results.length).toBe(2);
      
      for (const result of results) {
        expect(result).toHaveProperty("symbol");
        expect(result).toHaveProperty("z_score");
        expect(result).toHaveProperty("matched_features");
        expect(result).toHaveProperty("total_features");
        expect(result).toHaveProperty("distance");
        expect(result).toHaveProperty("confidence");
        
        expect(result.z_score).toBeGreaterThanOrEqual(0);
        expect(result.confidence).toBeGreaterThanOrEqual(0);
        expect(result.confidence).toBeLessThanOrEqual(100);
        expect(result.matched_features).toBeLessThanOrEqual(result.total_features);
      }
    });
    
    it("should sort results by z_score ascending", () => {
      seedWinningTrades(db, 25);
      const profiles = buildProfiles(db, 20);
      
      const features: Array<Partial<FeatureVector>> = [
        { symbol: "FAR", rvol: 0.5, gap_pct: 0.1 },     // Far from profile
        { symbol: "CLOSE", rvol: 2.5, gap_pct: 1.2 },  // Close to profile
        { symbol: "MEDIUM", rvol: 1.5, gap_pct: 0.8 }, // Medium distance
      ];
      
      const results = scanSymbols(features, profiles);
      
      // Results should be sorted by z_score (lower is better)
      for (let i = 1; i < results.length; i++) {
        expect(results[i-1].z_score).toBeLessThanOrEqual(results[i].z_score);
      }
      
      // CLOSE should have lowest z_score
      expect(results[0].symbol).toBe("CLOSE");
    });
    
    it("should calculate confidence inversely to z_score", () => {
      seedWinningTrades(db, 25);
      const profiles = buildProfiles(db, 20);
      
      const features: Array<Partial<FeatureVector>> = [
        { symbol: "PERFECT", rvol: 2.5, vwap_deviation_pct: 0.6 }, // Should match well
        { symbol: "POOR", rvol: 10.0, vwap_deviation_pct: 5.0 },   // Should match poorly
      ];
      
      const results = scanSymbols(features, profiles);
      
      const perfect = results.find(r => r.symbol === "PERFECT");
      const poor = results.find(r => r.symbol === "POOR");
      
      expect(perfect).toBeDefined();
      expect(poor).toBeDefined();
      
      if (perfect && poor) {
        expect(perfect.confidence).toBeGreaterThan(poor.confidence);
        expect(perfect.z_score).toBeLessThan(poor.z_score);
      }
    });
    
    it("should count features within 1 std as matched", () => {
      seedWinningTrades(db, 25);
      const profiles = buildProfiles(db, 20);
      
      const rvolProfile = profiles.find(p => p.feature === "rvol");
      expect(rvolProfile).toBeDefined();
      
      if (rvolProfile) {
        // Create feature within 1 std
        const closeFeature: Partial<FeatureVector> = {
          symbol: "CLOSE",
          rvol: rvolProfile.mean + rvolProfile.std * 0.5, // Within 1 std
        };
        
        // Create feature outside 1 std
        const farFeature: Partial<FeatureVector> = {
          symbol: "FAR",
          rvol: rvolProfile.mean + rvolProfile.std * 2.0, // Outside 1 std
        };
        
        const results = scanSymbols([closeFeature, farFeature], profiles);
        
        const closeResult = results.find(r => r.symbol === "CLOSE");
        const farResult = results.find(r => r.symbol === "FAR");
        
        if (closeResult && farResult) {
          // Close should have more matched features
          expect(closeResult.matched_features).toBeGreaterThanOrEqual(farResult.matched_features);
        }
      }
    });
    
    it("should handle empty profiles gracefully", () => {
      const features: Array<Partial<FeatureVector>> = [
        { symbol: "TEST", rvol: 2.5 },
      ];
      
      const results = scanSymbols(features, []);
      
      expect(results.length).toBe(1);
      expect(results[0].z_score).toBe(Infinity);
      expect(results[0].confidence).toBe(0);
      expect(results[0].matched_features).toBe(0);
      expect(results[0].total_features).toBe(0);
    });
    
    it("should handle missing feature values", () => {
      seedWinningTrades(db, 25);
      const profiles = buildProfiles(db, 20);
      
      const features: Array<Partial<FeatureVector>> = [
        { symbol: "SPARSE", rvol: 2.5 }, // Only one feature present
      ];
      
      const results = scanSymbols(features, profiles);
      
      expect(results.length).toBe(1);
      expect(results[0].z_score).toBeGreaterThanOrEqual(0);
      expect(results[0].matched_features).toBeLessThanOrEqual(results[0].total_features);
    });
  });
  
  describe("getPreAlertCandidates", () => {
    it("should return unevaluated Holly alerts as candidates", () => {
      // Create alerts without signals
      insertHollyAlert(db, {
        symbol: "AAPL",
        strategy: "Holly Grail",
        alert_time: new Date(Date.now() - 1000 * 60 * 60).toISOString(), // 1 hour ago
      });
      
      insertHollyAlert(db, {
        symbol: "TSLA",
        strategy: "Gap and Go",
        alert_time: new Date(Date.now() - 1000 * 60 * 30).toISOString(), // 30 min ago
      });
      
      // Create alert with signal (should be excluded)
      const alertWithSignal = insertHollyAlert(db, {
        symbol: "NVDA",
        strategy: "Holly Grail",
        alert_time: new Date(Date.now() - 1000 * 60 * 15).toISOString(),
      });
      
      insertEvaluation(db, {
        id: "eval-nvda",
        symbol: "NVDA",
        timestamp: new Date().toISOString(),
      });
      
      insertSignal(db, {
        holly_alert_id: alertWithSignal,
        evaluation_id: "eval-nvda",
        symbol: "NVDA",
      });
      
      const profiles = buildProfiles(db, 10);
      const candidates = getPreAlertCandidates(db, profiles, 10, 24);
      
      expect(candidates.length).toBe(2); // Only alerts without signals
      
      for (const candidate of candidates) {
        expect(candidate).toHaveProperty("symbol");
        expect(candidate).toHaveProperty("score");
        expect(candidate).toHaveProperty("reason");
        expect(candidate).toHaveProperty("strategy");
        expect(candidate).toHaveProperty("features");
        expect(candidate).toHaveProperty("timestamp");
        
        expect(candidate.score).toBeGreaterThanOrEqual(0);
        expect(candidate.score).toBeLessThanOrEqual(100);
      }
      
      const symbols = candidates.map(c => c.symbol);
      expect(symbols).toContain("AAPL");
      expect(symbols).toContain("TSLA");
      expect(symbols).not.toContain("NVDA"); // Has signal, should be excluded
    });
    
    it("should sort by score descending", () => {
      for (let i = 0; i < 5; i++) {
        insertHollyAlert(db, {
          symbol: `SYM${i}`,
          strategy: i % 2 === 0 ? "Holly Grail" : null,
          alert_time: new Date(Date.now() - 1000 * 60 * 60 * (i + 1)).toISOString(),
        });
      }
      
      const profiles = buildProfiles(db, 10);
      const candidates = getPreAlertCandidates(db, profiles, 10, 24);
      
      for (let i = 1; i < candidates.length; i++) {
        expect(candidates[i-1].score).toBeGreaterThanOrEqual(candidates[i].score);
      }
    });
    
    it("should respect limit parameter", () => {
      for (let i = 0; i < 20; i++) {
        insertHollyAlert(db, {
          symbol: `SYM${i}`,
          alert_time: new Date(Date.now() - 1000 * 60 * i).toISOString(),
        });
      }
      
      const profiles = buildProfiles(db, 10);
      const candidates = getPreAlertCandidates(db, profiles, 5, 24);
      
      expect(candidates.length).toBe(5);
    });
    
    it("should respect hoursBack parameter", () => {
      // Recent alert (within 1 hour)
      insertHollyAlert(db, {
        symbol: "RECENT",
        alert_time: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
      });
      
      // Old alert (25 hours ago)
      insertHollyAlert(db, {
        symbol: "OLD",
        alert_time: new Date(Date.now() - 1000 * 60 * 60 * 25).toISOString(),
      });
      
      const profiles = buildProfiles(db, 10);
      const candidates = getPreAlertCandidates(db, profiles, 10, 1); // Only last 1 hour
      
      const symbols = candidates.map(c => c.symbol);
      expect(symbols).toContain("RECENT");
      expect(symbols).not.toContain("OLD");
    });
    
    it("should handle empty data", () => {
      const profiles = buildProfiles(db, 10);
      const candidates = getPreAlertCandidates(db, profiles, 10, 24);
      
      expect(candidates).toEqual([]);
    });
    
    it("should apply strategy-specific profiles", () => {
      insertHollyAlert(db, {
        symbol: "GRAIL",
        strategy: "Holly Grail",
        alert_time: new Date().toISOString(),
      });
      
      insertHollyAlert(db, {
        symbol: "GAP",
        strategy: "Gap and Go",
        alert_time: new Date().toISOString(),
      });
      
      const profiles = buildProfiles(db, 10, "Holly Grail");
      const candidates = getPreAlertCandidates(db, profiles, 10, 24);
      
      expect(candidates.length).toBe(2);
    });
  });
  
  describe("Cache Management", () => {
    it("should create profile cache with timestamp", () => {
      seedWinningTrades(db, 25);
      
      const cache = createProfileCache(db);
      
      expect(cache).toHaveProperty("profiles");
      expect(cache).toHaveProperty("last_updated");
      expect(cache).toHaveProperty("sample_size");
      
      expect(cache.profiles.length).toBeGreaterThan(0);
      expect(cache.sample_size).toBeGreaterThan(0);
      expect(new Date(cache.last_updated).getTime()).toBeGreaterThan(0);
    });
    
    it("should detect when cache needs refresh based on age", () => {
      const oldCache: ProfileCache = {
        profiles: [],
        last_updated: new Date(Date.now() - 1000 * 60 * 60 * 25).toISOString(), // 25 hours ago
        sample_size: 0,
      };
      
      const recentCache: ProfileCache = {
        profiles: [],
        last_updated: new Date(Date.now() - 1000 * 60 * 60).toISOString(), // 1 hour ago
        sample_size: 0,
      };
      
      expect(shouldRefreshCache(oldCache, 24)).toBe(true);
      expect(shouldRefreshCache(recentCache, 24)).toBe(false);
    });
    
    it("should refresh cache if needed", () => {
      seedWinningTrades(db, 25);
      
      const oldCache: ProfileCache = {
        profiles: [],
        last_updated: new Date(Date.now() - 1000 * 60 * 60 * 25).toISOString(),
        sample_size: 0,
      };
      
      const newCache = refreshCacheIfNeeded(db, oldCache);
      
      expect(newCache).not.toBe(oldCache);
      expect(newCache.profiles.length).toBeGreaterThan(0);
      expect(new Date(newCache.last_updated).getTime()).toBeGreaterThan(new Date(oldCache.last_updated).getTime());
    });
    
    it("should not refresh if cache is recent", () => {
      seedWinningTrades(db, 25);
      
      const recentCache = createProfileCache(db);
      const result = refreshCacheIfNeeded(db, recentCache);
      
      expect(result).toBe(recentCache); // Same object
    });
    
    it("should get count of new outcomes since timestamp", () => {
      const baseTime = new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString();
      
      // Add old outcome
      insertEvaluation(db, {
        id: "eval-old",
        symbol: "OLD",
        timestamp: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
      });
      insertOutcome(db, {
        evaluation_id: "eval-old",
        r_multiple: 1.0,
        recorded_at: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
      });
      
      // Add new outcome
      insertEvaluation(db, {
        id: "eval-new",
        symbol: "NEW",
        timestamp: new Date().toISOString(),
      });
      insertOutcome(db, {
        evaluation_id: "eval-new",
        r_multiple: 1.0,
        recorded_at: new Date().toISOString(),
      });
      
      const count = getNewOutcomesCount(db, baseTime);
      
      expect(count).toBe(1); // Only the new outcome
    });
  });
});
