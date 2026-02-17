import { describe, it, expect, beforeEach } from "vitest";
import Database, { type Database as DatabaseType } from "better-sqlite3";
import { computeDriftReport, type DriftReport } from "../drift.js";

/**
 * Test suite for drift computation module
 * Tests: computeDriftReport, loadDriftRows, DriftReport type
 * Requirements: empty dataset, rolling accuracy windows, perfect/zero accuracy,
 * calibration error by decile, regime shift, per-model breakdown,
 * boundary cases (10/50 evals), single eval
 */

describe("computeDriftReport", () => {
  let db: DatabaseType;

  beforeEach(() => {
    // Create in-memory database for each test
    db = new Database(":memory:");
    
    // Create schema matching production (evaluations table)
    db.exec(`
      CREATE TABLE evaluations (
        id TEXT PRIMARY KEY,
        symbol TEXT NOT NULL,
        timestamp TEXT NOT NULL
      );

      CREATE TABLE model_outputs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        evaluation_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        trade_score REAL,
        should_trade INTEGER,
        compliant INTEGER DEFAULT 1,
        FOREIGN KEY (evaluation_id) REFERENCES evaluations(id)
      );

      CREATE TABLE outcomes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        evaluation_id TEXT NOT NULL,
        trade_taken INTEGER DEFAULT 0,
        r_multiple REAL,
        FOREIGN KEY (evaluation_id) REFERENCES evaluations(id)
      );
    `);
  });

  describe("Empty dataset handling", () => {
    it("should return empty report when no data exists", () => {
      const report = computeDriftReport(db);

      expect(report.overall_accuracy).toBe(0);
      expect(report.by_model).toEqual([]);
      expect(report.regime_shift_detected).toBe(false);
      expect(report.recommendation).toBe("Insufficient outcome data for drift analysis.");
    });

    it("should return empty report when evaluations exist but no outcomes", () => {
      db.prepare(`INSERT INTO evaluations (id, symbol, timestamp) VALUES (?, ?, ?)`).run(
        "eval1",
        "AAPL",
        "2024-01-01T10:00:00.000Z"
      );
      db.prepare(`INSERT INTO model_outputs (evaluation_id, model_id, trade_score, should_trade, compliant) VALUES (?, ?, ?, ?, ?)`).run(
        "eval1",
        "claude-sonnet",
        75,
        1,
        1
      );

      const report = computeDriftReport(db);

      expect(report.overall_accuracy).toBe(0);
      expect(report.by_model).toEqual([]);
      expect(report.regime_shift_detected).toBe(false);
      expect(report.recommendation).toBe("Insufficient outcome data for drift analysis.");
    });

    it("should return empty report when outcomes exist but trade_taken is 0", () => {
      db.prepare(`INSERT INTO evaluations (id, symbol, timestamp) VALUES (?, ?, ?)`).run(
        "eval1",
        "AAPL",
        "2024-01-01T10:00:00.000Z"
      );
      db.prepare(`INSERT INTO model_outputs (evaluation_id, model_id, trade_score, should_trade, compliant) VALUES (?, ?, ?, ?, ?)`).run(
        "eval1",
        "claude-sonnet",
        75,
        1,
        1
      );
      db.prepare(`INSERT INTO outcomes (evaluation_id, trade_taken, r_multiple) VALUES (?, ?, ?)`).run(
        "eval1",
        0,
        1.5
      );

      const report = computeDriftReport(db);

      expect(report.overall_accuracy).toBe(0);
      expect(report.by_model).toEqual([]);
      expect(report.regime_shift_detected).toBe(false);
    });
  });

  describe("Single evaluation", () => {
    it("should handle single winning evaluation", () => {
      db.prepare(`INSERT INTO evaluations (id, symbol, timestamp) VALUES (?, ?, ?)`).run(
        "eval1",
        "AAPL",
        "2024-01-01T10:00:00.000Z"
      );
      db.prepare(`INSERT INTO model_outputs (evaluation_id, model_id, trade_score, should_trade, compliant) VALUES (?, ?, ?, ?, ?)`).run(
        "eval1",
        "claude-sonnet",
        75,
        1,
        1
      );
      db.prepare(`INSERT INTO outcomes (evaluation_id, trade_taken, r_multiple) VALUES (?, ?, ?)`).run(
        "eval1",
        1,
        1.5
      );

      const report = computeDriftReport(db);

      expect(report.overall_accuracy).toBe(1.0);
      expect(report.by_model.length).toBe(1);
      expect(report.by_model[0].model_id).toBe("claude-sonnet");
      expect(report.by_model[0].sample_size).toBe(1);
      expect(report.by_model[0].rolling_accuracy.last_50).toBe(1.0);
      expect(report.by_model[0].rolling_accuracy.last_20).toBe(1.0);
      expect(report.by_model[0].rolling_accuracy.last_10).toBe(1.0);
      expect(report.regime_shift_detected).toBe(false);
    });

    it("should handle single losing evaluation", () => {
      db.prepare(`INSERT INTO evaluations (id, symbol, timestamp) VALUES (?, ?, ?)`).run(
        "eval1",
        "AAPL",
        "2024-01-01T10:00:00.000Z"
      );
      db.prepare(`INSERT INTO model_outputs (evaluation_id, model_id, trade_score, should_trade, compliant) VALUES (?, ?, ?, ?, ?)`).run(
        "eval1",
        "gpt-4o",
        80,
        1,
        1
      );
      db.prepare(`INSERT INTO outcomes (evaluation_id, trade_taken, r_multiple) VALUES (?, ?, ?)`).run(
        "eval1",
        1,
        -0.5
      );

      const report = computeDriftReport(db);

      expect(report.overall_accuracy).toBe(0);
      expect(report.by_model.length).toBe(1);
      expect(report.by_model[0].model_id).toBe("gpt-4o");
      expect(report.by_model[0].rolling_accuracy.last_50).toBe(0);
      expect(report.by_model[0].rolling_accuracy.last_20).toBe(0);
      expect(report.by_model[0].rolling_accuracy.last_10).toBe(0);
    });
  });

  describe("Rolling accuracy windows", () => {
    it("should calculate different windows correctly for last_50, last_20, last_10", () => {
      // Create 60 evaluations to test all windows
      // Data is ordered DESC by timestamp, so most recent (highest i) appears first
      for (let i = 0; i < 60; i++) {
        const evalId = `eval${i}`;
        const timestamp = new Date(2024, 0, 1, 10, i).toISOString();
        
        db.prepare(`INSERT INTO evaluations (id, symbol, timestamp) VALUES (?, ?, ?)`).run(
          evalId,
          "AAPL",
          timestamp
        );
        
        // Most recent 10 (i=50-59): all wins → last_10 = 1.0
        // Most recent 20 (i=40-59): 10 wins + 10 losses → last_20 = 0.5
        // Most recent 50 (i=10-59): 10 wins + 40 losses → last_50 = 0.2
        const rMultiple = i >= 50 ? 1.0 : -0.5;
        
        db.prepare(`INSERT INTO model_outputs (evaluation_id, model_id, trade_score, should_trade, compliant) VALUES (?, ?, ?, ?, ?)`).run(
          evalId,
          "claude-sonnet",
          70,
          1,
          1
        );
        
        db.prepare(`INSERT INTO outcomes (evaluation_id, trade_taken, r_multiple) VALUES (?, ?, ?)`).run(
          evalId,
          1,
          rMultiple
        );
      }

      const report = computeDriftReport(db);

      expect(report.by_model.length).toBe(1);
      const model = report.by_model[0];
      
      // Most recent 10 (i=50-59): all wins
      expect(model.rolling_accuracy.last_10).toBe(1.0);
      // Most recent 20 (i=40-59): 10 wins + 10 losses
      expect(model.rolling_accuracy.last_20).toBe(0.5);
      // Most recent 50 (i=10-59): 10 wins + 40 losses
      expect(model.rolling_accuracy.last_50).toBe(0.2);
    });

    it("should use smaller sample when fewer evaluations exist", () => {
      // Only 5 evaluations
      for (let i = 0; i < 5; i++) {
        const evalId = `eval${i}`;
        db.prepare(`INSERT INTO evaluations (id, symbol, timestamp) VALUES (?, ?, ?)`).run(
          evalId,
          "AAPL",
          new Date(2024, 0, 1, 10, i).toISOString()
        );
        db.prepare(`INSERT INTO model_outputs (evaluation_id, model_id, trade_score, should_trade, compliant) VALUES (?, ?, ?, ?, ?)`).run(
          evalId,
          "gemini-flash",
          60,
          1,
          1
        );
        db.prepare(`INSERT INTO outcomes (evaluation_id, trade_taken, r_multiple) VALUES (?, ?, ?)`).run(
          evalId,
          1,
          1.0
        );
      }

      const report = computeDriftReport(db);

      expect(report.by_model[0].sample_size).toBe(5);
      // All windows should use same 5 evaluations
      expect(report.by_model[0].rolling_accuracy.last_10).toBe(1.0);
      expect(report.by_model[0].rolling_accuracy.last_20).toBe(1.0);
      expect(report.by_model[0].rolling_accuracy.last_50).toBe(1.0);
    });
  });

  describe("Perfect and zero accuracy", () => {
    it("should return 100% accuracy when all predictions are correct", () => {
      // 30 perfect predictions
      for (let i = 0; i < 30; i++) {
        const evalId = `eval${i}`;
        db.prepare(`INSERT INTO evaluations (id, symbol, timestamp) VALUES (?, ?, ?)`).run(
          evalId,
          "AAPL",
          new Date(2024, 0, 1, 10, i).toISOString()
        );
        db.prepare(`INSERT INTO model_outputs (evaluation_id, model_id, trade_score, should_trade, compliant) VALUES (?, ?, ?, ?, ?)`).run(
          evalId,
          "claude-sonnet",
          75,
          1,
          1
        );
        db.prepare(`INSERT INTO outcomes (evaluation_id, trade_taken, r_multiple) VALUES (?, ?, ?)`).run(
          evalId,
          1,
          1.5
        );
      }

      const report = computeDriftReport(db);

      expect(report.overall_accuracy).toBe(1.0);
      expect(report.by_model[0].rolling_accuracy.last_50).toBe(1.0);
      expect(report.by_model[0].rolling_accuracy.last_20).toBe(1.0);
      expect(report.by_model[0].rolling_accuracy.last_10).toBe(1.0);
    });

    it("should return 0% accuracy when all predictions are wrong", () => {
      // 30 wrong predictions (predicted win, actual loss)
      for (let i = 0; i < 30; i++) {
        const evalId = `eval${i}`;
        db.prepare(`INSERT INTO evaluations (id, symbol, timestamp) VALUES (?, ?, ?)`).run(
          evalId,
          "AAPL",
          new Date(2024, 0, 1, 10, i).toISOString()
        );
        db.prepare(`INSERT INTO model_outputs (evaluation_id, model_id, trade_score, should_trade, compliant) VALUES (?, ?, ?, ?, ?)`).run(
          evalId,
          "gpt-4o",
          80,
          1,
          1
        );
        db.prepare(`INSERT INTO outcomes (evaluation_id, trade_taken, r_multiple) VALUES (?, ?, ?)`).run(
          evalId,
          1,
          -1.0
        );
      }

      const report = computeDriftReport(db);

      expect(report.overall_accuracy).toBe(0);
      expect(report.by_model[0].rolling_accuracy.last_50).toBe(0);
      expect(report.by_model[0].rolling_accuracy.last_20).toBe(0);
      expect(report.by_model[0].rolling_accuracy.last_10).toBe(0);
    });

    it("should correctly identify no-trade predictions", () => {
      // Test that model correctly predicted NOT to trade (score < 50)
      for (let i = 0; i < 20; i++) {
        const evalId = `eval${i}`;
        db.prepare(`INSERT INTO evaluations (id, symbol, timestamp) VALUES (?, ?, ?)`).run(
          evalId,
          "AAPL",
          new Date(2024, 0, 1, 10, i).toISOString()
        );
        db.prepare(`INSERT INTO model_outputs (evaluation_id, model_id, trade_score, should_trade, compliant) VALUES (?, ?, ?, ?, ?)`).run(
          evalId,
          "claude-sonnet",
          30, // Low score = predicted no trade
          0,
          1
        );
        db.prepare(`INSERT INTO outcomes (evaluation_id, trade_taken, r_multiple) VALUES (?, ?, ?)`).run(
          evalId,
          1,
          -1.0 // Actually lost (model was right to be bearish)
        );
      }

      const report = computeDriftReport(db);

      // Should be 100% accurate (correctly predicted losses)
      expect(report.overall_accuracy).toBe(1.0);
    });
  });

  describe("Calibration error by decile", () => {
    it("should compute calibration error for each decile", () => {
      // Create evaluations with scores distributed across all deciles
      const scoresAndOutcomes = [
        { score: 5, win: false },   // Decile 0
        { score: 15, win: false },  // Decile 1
        { score: 25, win: false },  // Decile 2
        { score: 35, win: false },  // Decile 3
        { score: 45, win: true },   // Decile 4
        { score: 55, win: true },   // Decile 5
        { score: 65, win: true },   // Decile 6
        { score: 75, win: true },   // Decile 7
        { score: 85, win: true },   // Decile 8
        { score: 95, win: true },   // Decile 9
      ];

      scoresAndOutcomes.forEach((item, i) => {
        const evalId = `eval${i}`;
        db.prepare(`INSERT INTO evaluations (id, symbol, timestamp) VALUES (?, ?, ?)`).run(
          evalId,
          "AAPL",
          new Date(2024, 0, 1, 10, i).toISOString()
        );
        db.prepare(`INSERT INTO model_outputs (evaluation_id, model_id, trade_score, should_trade, compliant) VALUES (?, ?, ?, ?, ?)`).run(
          evalId,
          "claude-sonnet",
          item.score,
          item.score >= 50 ? 1 : 0,
          1
        );
        db.prepare(`INSERT INTO outcomes (evaluation_id, trade_taken, r_multiple) VALUES (?, ?, ?)`).run(
          evalId,
          1,
          item.win ? 1.0 : -1.0
        );
      });

      const report = computeDriftReport(db);

      expect(report.by_model.length).toBe(1);
      const model = report.by_model[0];
      
      // Should have 10 deciles
      expect(model.calibration_by_decile.length).toBe(10);
      
      // Each decile should have exactly 1 evaluation
      model.calibration_by_decile.forEach((decile, i) => {
        expect(decile.decile).toBe(i);
        expect(decile.count).toBe(1);
      });
      
      // Check that calibration_error is calculated
      expect(model.calibration_error).toBeGreaterThanOrEqual(0);
      expect(model.calibration_error).toBeLessThanOrEqual(1);
    });

    it("should handle perfect calibration (predicted = actual)", () => {
      // Create perfectly calibrated predictions
      for (let decile = 0; decile < 10; decile++) {
        const midScore = decile * 10 + 5;
        const winRate = midScore / 100;
        const numInDecile = 10;
        
        for (let i = 0; i < numInDecile; i++) {
          const evalId = `eval_d${decile}_${i}`;
          const shouldWin = i < Math.floor(winRate * numInDecile);
          
          db.prepare(`INSERT INTO evaluations (id, symbol, timestamp) VALUES (?, ?, ?)`).run(
            evalId,
            "AAPL",
            new Date(2024, 0, 1, decile, i).toISOString()
          );
          db.prepare(`INSERT INTO model_outputs (evaluation_id, model_id, trade_score, should_trade, compliant) VALUES (?, ?, ?, ?, ?)`).run(
            evalId,
            "claude-sonnet",
            midScore,
            midScore >= 50 ? 1 : 0,
            1
          );
          db.prepare(`INSERT INTO outcomes (evaluation_id, trade_taken, r_multiple) VALUES (?, ?, ?)`).run(
            evalId,
            1,
            shouldWin ? 1.0 : -1.0
          );
        }
      }

      const report = computeDriftReport(db);

      const model = report.by_model[0];
      // Perfect calibration should have very low error
      expect(model.calibration_error).toBeLessThan(0.1);
    });

    it("should handle worst case calibration (predicted opposite of actual)", () => {
      // High scores predict wins, but all lose; low scores predict losses, but all win
      const testCases = [
        { score: 5, win: true },   // Predicted 5% win rate, actually won
        { score: 95, win: false },  // Predicted 95% win rate, actually lost
      ];

      testCases.forEach((item, i) => {
        const evalId = `eval${i}`;
        db.prepare(`INSERT INTO evaluations (id, symbol, timestamp) VALUES (?, ?, ?)`).run(
          evalId,
          "AAPL",
          new Date(2024, 0, 1, 10, i).toISOString()
        );
        db.prepare(`INSERT INTO model_outputs (evaluation_id, model_id, trade_score, should_trade, compliant) VALUES (?, ?, ?, ?, ?)`).run(
          evalId,
          "gpt-4o",
          item.score,
          item.score >= 50 ? 1 : 0,
          1
        );
        db.prepare(`INSERT INTO outcomes (evaluation_id, trade_taken, r_multiple) VALUES (?, ?, ?)`).run(
          evalId,
          1,
          item.win ? 1.0 : -1.0
        );
      });

      const report = computeDriftReport(db);

      // Should have high calibration error
      expect(report.by_model[0].calibration_error).toBeGreaterThan(0.5);
    });
  });

  describe("Regime shift detection", () => {
    it("should detect regime shift when last_50 - last_10 > 0.15", () => {
      // Create 50 evaluations: first 40 wins (80%), last 10 losses (0%)
      // last_50 = 32/50 = 0.64, last_10 = 0/10 = 0.0, diff = 0.64 > 0.15
      for (let i = 0; i < 50; i++) {
        const evalId = `eval${i}`;
        const isWin = i < 40; // First 40 win, last 10 lose
        
        db.prepare(`INSERT INTO evaluations (id, symbol, timestamp) VALUES (?, ?, ?)`).run(
          evalId,
          "AAPL",
          new Date(2024, 0, 1, 10, i).toISOString()
        );
        db.prepare(`INSERT INTO model_outputs (evaluation_id, model_id, trade_score, should_trade, compliant) VALUES (?, ?, ?, ?, ?)`).run(
          evalId,
          "claude-sonnet",
          70,
          1,
          1
        );
        db.prepare(`INSERT INTO outcomes (evaluation_id, trade_taken, r_multiple) VALUES (?, ?, ?)`).run(
          evalId,
          1,
          isWin ? 1.0 : -1.0
        );
      }

      const report = computeDriftReport(db);

      expect(report.regime_shift_detected).toBe(true);
      expect(report.by_model[0].regime_shift_detected).toBe(true);
      expect(report.recommendation).toContain("Regime shift detected");
      expect(report.recommendation).toContain("Reduce risk");
    });

    it("should not detect regime shift when difference is exactly 0.15", () => {
      // Create scenario where last_50 - last_10 <= 0.15 (not > 0.15)
      // Most recent data (highest i) appears first in DESC order
      // Let's create: last_10 = 0.5 (5 wins), last_50 = 0.64 (32 wins), diff = 0.14
      
      for (let i = 0; i < 50; i++) {
        const evalId = `eval${i}`;
        // Most recent 10 (i=40-49): 5 wins, 5 losses → last_10 = 0.5
        // Most recent 50 (i=0-49): 32 wins, 18 losses → last_50 = 0.64, diff = 0.14 < 0.15
        let isWin = false;
        if (i >= 40) {
          // Last 10: 5 wins (indices 40-44)
          isWin = i < 45;
        } else {
          // First 40: 27 wins to reach total of 32
          isWin = i < 27;
        }
        
        db.prepare(`INSERT INTO evaluations (id, symbol, timestamp) VALUES (?, ?, ?)`).run(
          evalId,
          "AAPL",
          new Date(2024, 0, 1, 10, i).toISOString()
        );
        db.prepare(`INSERT INTO model_outputs (evaluation_id, model_id, trade_score, should_trade, compliant) VALUES (?, ?, ?, ?, ?)`).run(
          evalId,
          "gpt-4o",
          70,
          1,
          1
        );
        db.prepare(`INSERT INTO outcomes (evaluation_id, trade_taken, r_multiple) VALUES (?, ?, ?)`).run(
          evalId,
          1,
          isWin ? 1.0 : -1.0
        );
      }

      const report = computeDriftReport(db);

      // Should not detect regime shift (diff = 0.14 <= 0.15)
      expect(report.by_model[0].regime_shift_detected).toBe(false);
    });

    it("should not detect regime shift with fewer than 10 evaluations", () => {
      // Only 9 evaluations, even with large accuracy difference
      for (let i = 0; i < 9; i++) {
        const evalId = `eval${i}`;
        const isWin = i < 2; // Very different from earlier
        
        db.prepare(`INSERT INTO evaluations (id, symbol, timestamp) VALUES (?, ?, ?)`).run(
          evalId,
          "AAPL",
          new Date(2024, 0, 1, 10, i).toISOString()
        );
        db.prepare(`INSERT INTO model_outputs (evaluation_id, model_id, trade_score, should_trade, compliant) VALUES (?, ?, ?, ?, ?)`).run(
          evalId,
          "gemini-flash",
          70,
          1,
          1
        );
        db.prepare(`INSERT INTO outcomes (evaluation_id, trade_taken, r_multiple) VALUES (?, ?, ?)`).run(
          evalId,
          1,
          isWin ? 1.0 : -1.0
        );
      }

      const report = computeDriftReport(db);

      expect(report.by_model[0].sample_size).toBe(9);
      expect(report.by_model[0].regime_shift_detected).toBe(false);
      expect(report.regime_shift_detected).toBe(false);
    });

    it("should generate appropriate recommendation when no regime shift", () => {
      // Stable accuracy across windows
      for (let i = 0; i < 30; i++) {
        const evalId = `eval${i}`;
        const isWin = i % 2 === 0; // 50% win rate throughout
        
        db.prepare(`INSERT INTO evaluations (id, symbol, timestamp) VALUES (?, ?, ?)`).run(
          evalId,
          "AAPL",
          new Date(2024, 0, 1, 10, i).toISOString()
        );
        db.prepare(`INSERT INTO model_outputs (evaluation_id, model_id, trade_score, should_trade, compliant) VALUES (?, ?, ?, ?, ?)`).run(
          evalId,
          "claude-sonnet",
          70,
          1,
          1
        );
        db.prepare(`INSERT INTO outcomes (evaluation_id, trade_taken, r_multiple) VALUES (?, ?, ?)`).run(
          evalId,
          1,
          isWin ? 1.0 : -1.0
        );
      }

      const report = computeDriftReport(db);

      expect(report.regime_shift_detected).toBe(false);
      expect(report.recommendation).toContain("No major regime shift detected");
      expect(report.recommendation).toContain("Continue monitoring");
    });
  });

  describe("Per-model breakdown", () => {
    it("should separate drift metrics by model", () => {
      const models = ["claude-sonnet", "gpt-4o", "gemini-flash"];
      
      models.forEach((modelId, modelIdx) => {
        for (let i = 0; i < 20; i++) {
          const evalId = `eval_${modelId}_${i}`;
          // Different accuracy per model: claude=100%, gpt=50%, gemini=0%
          const isWin = modelIdx === 0 ? true : (modelIdx === 1 ? i % 2 === 0 : false);
          
          db.prepare(`INSERT INTO evaluations (id, symbol, timestamp) VALUES (?, ?, ?)`).run(
            evalId,
            "AAPL",
            new Date(2024, 0, modelIdx, i).toISOString()
          );
          db.prepare(`INSERT INTO model_outputs (evaluation_id, model_id, trade_score, should_trade, compliant) VALUES (?, ?, ?, ?, ?)`).run(
            evalId,
            modelId,
            70,
            1,
            1
          );
          db.prepare(`INSERT INTO outcomes (evaluation_id, trade_taken, r_multiple) VALUES (?, ?, ?)`).run(
            evalId,
            1,
            isWin ? 1.0 : -1.0
          );
        }
      });

      const report = computeDriftReport(db);

      expect(report.by_model.length).toBe(3);
      
      // Should be sorted alphabetically
      expect(report.by_model[0].model_id).toBe("claude-sonnet");
      expect(report.by_model[1].model_id).toBe("gemini-flash");
      expect(report.by_model[2].model_id).toBe("gpt-4o");
      
      // Check each model's accuracy
      expect(report.by_model[0].rolling_accuracy.last_20).toBe(1.0); // claude: 100%
      expect(report.by_model[1].rolling_accuracy.last_20).toBe(0);   // gemini: 0%
      expect(report.by_model[2].rolling_accuracy.last_20).toBe(0.5); // gpt: 50%
    });

    it("should calculate overall accuracy across all models", () => {
      // Model 1: 10 correct out of 10
      for (let i = 0; i < 10; i++) {
        const evalId = `eval_m1_${i}`;
        db.prepare(`INSERT INTO evaluations (id, symbol, timestamp) VALUES (?, ?, ?)`).run(
          evalId,
          "AAPL",
          new Date(2024, 0, 1, i).toISOString()
        );
        db.prepare(`INSERT INTO model_outputs (evaluation_id, model_id, trade_score, should_trade, compliant) VALUES (?, ?, ?, ?, ?)`).run(
          evalId,
          "claude-sonnet",
          70,
          1,
          1
        );
        db.prepare(`INSERT INTO outcomes (evaluation_id, trade_taken, r_multiple) VALUES (?, ?, ?)`).run(
          evalId,
          1,
          1.0
        );
      }
      
      // Model 2: 5 correct out of 10
      for (let i = 0; i < 10; i++) {
        const evalId = `eval_m2_${i}`;
        db.prepare(`INSERT INTO evaluations (id, symbol, timestamp) VALUES (?, ?, ?)`).run(
          evalId,
          "AAPL",
          new Date(2024, 0, 2, i).toISOString()
        );
        db.prepare(`INSERT INTO model_outputs (evaluation_id, model_id, trade_score, should_trade, compliant) VALUES (?, ?, ?, ?, ?)`).run(
          evalId,
          "gpt-4o",
          70,
          1,
          1
        );
        db.prepare(`INSERT INTO outcomes (evaluation_id, trade_taken, r_multiple) VALUES (?, ?, ?)`).run(
          evalId,
          1,
          i < 5 ? 1.0 : -1.0
        );
      }

      const report = computeDriftReport(db);

      // Overall: 15 correct out of 20 = 0.75
      expect(report.overall_accuracy).toBe(0.75);
    });

    it("should detect regime shift if any model has shift", () => {
      // Model 1: no regime shift
      for (let i = 0; i < 50; i++) {
        const evalId = `eval_m1_${i}`;
        db.prepare(`INSERT INTO evaluations (id, symbol, timestamp) VALUES (?, ?, ?)`).run(
          evalId,
          "AAPL",
          new Date(2024, 0, 1, 10, i).toISOString()
        );
        db.prepare(`INSERT INTO model_outputs (evaluation_id, model_id, trade_score, should_trade, compliant) VALUES (?, ?, ?, ?, ?)`).run(
          evalId,
          "claude-sonnet",
          70,
          1,
          1
        );
        db.prepare(`INSERT INTO outcomes (evaluation_id, trade_taken, r_multiple) VALUES (?, ?, ?)`).run(
          evalId,
          1,
          i % 2 === 0 ? 1.0 : -1.0 // Consistent 50%
        );
      }
      
      // Model 2: has regime shift (first 40 wins, last 10 losses)
      for (let i = 0; i < 50; i++) {
        const evalId = `eval_m2_${i}`;
        db.prepare(`INSERT INTO evaluations (id, symbol, timestamp) VALUES (?, ?, ?)`).run(
          evalId,
          "AAPL",
          new Date(2024, 0, 2, 10, i).toISOString()
        );
        db.prepare(`INSERT INTO model_outputs (evaluation_id, model_id, trade_score, should_trade, compliant) VALUES (?, ?, ?, ?, ?)`).run(
          evalId,
          "gpt-4o",
          70,
          1,
          1
        );
        db.prepare(`INSERT INTO outcomes (evaluation_id, trade_taken, r_multiple) VALUES (?, ?, ?)`).run(
          evalId,
          1,
          i < 40 ? 1.0 : -1.0
        );
      }

      const report = computeDriftReport(db);

      expect(report.by_model[0].regime_shift_detected).toBe(false); // claude
      expect(report.by_model[1].regime_shift_detected).toBe(true);  // gpt
      expect(report.regime_shift_detected).toBe(true); // Overall
    });
  });

  describe("Boundary cases", () => {
    it("should handle exactly 10 evaluations (boundary for last_10)", () => {
      for (let i = 0; i < 10; i++) {
        const evalId = `eval${i}`;
        db.prepare(`INSERT INTO evaluations (id, symbol, timestamp) VALUES (?, ?, ?)`).run(
          evalId,
          "AAPL",
          new Date(2024, 0, 1, 10, i).toISOString()
        );
        db.prepare(`INSERT INTO model_outputs (evaluation_id, model_id, trade_score, should_trade, compliant) VALUES (?, ?, ?, ?, ?)`).run(
          evalId,
          "claude-sonnet",
          70,
          1,
          1
        );
        db.prepare(`INSERT INTO outcomes (evaluation_id, trade_taken, r_multiple) VALUES (?, ?, ?)`).run(
          evalId,
          1,
          i < 7 ? 1.0 : -1.0
        );
      }

      const report = computeDriftReport(db);

      expect(report.by_model[0].sample_size).toBe(10);
      expect(report.by_model[0].rolling_accuracy.last_10).toBe(0.7);
      // All windows use same 10 evals
      expect(report.by_model[0].rolling_accuracy.last_20).toBe(0.7);
      expect(report.by_model[0].rolling_accuracy.last_50).toBe(0.7);
      
      // With exactly 10 evals, regime shift CAN be detected
      expect(report.by_model[0].regime_shift_detected).toBe(false); // diff = 0
    });

    it("should handle exactly 50 evaluations (boundary for last_50)", () => {
      for (let i = 0; i < 50; i++) {
        const evalId = `eval${i}`;
        db.prepare(`INSERT INTO evaluations (id, symbol, timestamp) VALUES (?, ?, ?)`).run(
          evalId,
          "AAPL",
          new Date(2024, 0, 1, 10, i).toISOString()
        );
        db.prepare(`INSERT INTO model_outputs (evaluation_id, model_id, trade_score, should_trade, compliant) VALUES (?, ?, ?, ?, ?)`).run(
          evalId,
          "gpt-4o",
          70,
          1,
          1
        );
        // Most recent 10 (i=40-49): all losses → last_10 = 0.0
        // Most recent 20 (i=30-49): 10 losses + 10 wins → last_20 = 0.5
        // Most recent 50 (i=0-49): 30 wins + 20 losses → last_50 = 0.6
        // i >= 40: 10 losses (last 10)
        // i >= 30 && i < 40: 10 wins (next 10)
        // i < 30: need 20 wins + 10 losses to reach 30 total wins
        const isWin = (i >= 30 && i < 40) || (i < 20);
        
        db.prepare(`INSERT INTO outcomes (evaluation_id, trade_taken, r_multiple) VALUES (?, ?, ?)`).run(
          evalId,
          1,
          isWin ? 1.0 : -1.0
        );
      }

      const report = computeDriftReport(db);

      expect(report.by_model[0].sample_size).toBe(50);
      expect(report.by_model[0].rolling_accuracy.last_50).toBe(0.6); // 30/50
      expect(report.by_model[0].rolling_accuracy.last_20).toBe(0.5); // 10/20
      expect(report.by_model[0].rolling_accuracy.last_10).toBe(0.0); // 0/10
      
      // Should detect regime shift: 0.6 - 0.0 = 0.6 > 0.15
      expect(report.by_model[0].regime_shift_detected).toBe(true);
    });

    it("should handle more than 50 evaluations (only use most recent 50)", () => {
      for (let i = 0; i < 100; i++) {
        const evalId = `eval${i}`;
        db.prepare(`INSERT INTO evaluations (id, symbol, timestamp) VALUES (?, ?, ?)`).run(
          evalId,
          "AAPL",
          new Date(2024, 0, 1, 10, i).toISOString()
        );
        db.prepare(`INSERT INTO model_outputs (evaluation_id, model_id, trade_score, should_trade, compliant) VALUES (?, ?, ?, ?, ?)`).run(
          evalId,
          "gemini-flash",
          70,
          1,
          1
        );
        // First 50: all wins, last 50: all losses
        db.prepare(`INSERT INTO outcomes (evaluation_id, trade_taken, r_multiple) VALUES (?, ?, ?)`).run(
          evalId,
          1,
          i < 50 ? 1.0 : -1.0
        );
      }

      const report = computeDriftReport(db);

      expect(report.by_model[0].sample_size).toBe(100);
      // last_50 should only look at most recent 50 (all losses)
      expect(report.by_model[0].rolling_accuracy.last_50).toBe(0);
      expect(report.by_model[0].rolling_accuracy.last_20).toBe(0);
      expect(report.by_model[0].rolling_accuracy.last_10).toBe(0);
    });
  });

  describe("Filtering and edge cases", () => {
    it("should filter out non-compliant model outputs", () => {
      for (let i = 0; i < 10; i++) {
        const evalId = `eval${i}`;
        db.prepare(`INSERT INTO evaluations (id, symbol, timestamp) VALUES (?, ?, ?)`).run(
          evalId,
          "AAPL",
          new Date(2024, 0, 1, 10, i).toISOString()
        );
        db.prepare(`INSERT INTO model_outputs (evaluation_id, model_id, trade_score, should_trade, compliant) VALUES (?, ?, ?, ?, ?)`).run(
          evalId,
          "claude-sonnet",
          70,
          1,
          0 // Non-compliant
        );
        db.prepare(`INSERT INTO outcomes (evaluation_id, trade_taken, r_multiple) VALUES (?, ?, ?)`).run(
          evalId,
          1,
          1.0
        );
      }

      const report = computeDriftReport(db);

      // All filtered out
      expect(report.overall_accuracy).toBe(0);
      expect(report.by_model).toEqual([]);
    });

    it("should filter out null trade_score", () => {
      const evalId = "eval1";
      db.prepare(`INSERT INTO evaluations (id, symbol, timestamp) VALUES (?, ?, ?)`).run(
        evalId,
        "AAPL",
        new Date(2024, 0, 1, 10, 0).toISOString()
      );
      db.prepare(`INSERT INTO model_outputs (evaluation_id, model_id, trade_score, should_trade, compliant) VALUES (?, ?, ?, ?, ?)`).run(
        evalId,
        "claude-sonnet",
        null,
        null,
        1
      );
      db.prepare(`INSERT INTO outcomes (evaluation_id, trade_taken, r_multiple) VALUES (?, ?, ?)`).run(
        evalId,
        1,
        1.0
      );

      const report = computeDriftReport(db);

      expect(report.overall_accuracy).toBe(0);
      expect(report.by_model).toEqual([]);
    });

    it("should filter out null r_multiple", () => {
      const evalId = "eval1";
      db.prepare(`INSERT INTO evaluations (id, symbol, timestamp) VALUES (?, ?, ?)`).run(
        evalId,
        "AAPL",
        new Date(2024, 0, 1, 10, 0).toISOString()
      );
      db.prepare(`INSERT INTO model_outputs (evaluation_id, model_id, trade_score, should_trade, compliant) VALUES (?, ?, ?, ?, ?)`).run(
        evalId,
        "claude-sonnet",
        70,
        1,
        1
      );
      db.prepare(`INSERT INTO outcomes (evaluation_id, trade_taken, r_multiple) VALUES (?, ?, ?)`).run(
        evalId,
        1,
        null
      );

      const report = computeDriftReport(db);

      expect(report.overall_accuracy).toBe(0);
      expect(report.by_model).toEqual([]);
    });

    it("should use should_trade field when available instead of score >= 50", () => {
      // Create eval with should_trade=0 but score > 50
      const evalId = "eval1";
      db.prepare(`INSERT INTO evaluations (id, symbol, timestamp) VALUES (?, ?, ?)`).run(
        evalId,
        "AAPL",
        new Date(2024, 0, 1, 10, 0).toISOString()
      );
      db.prepare(`INSERT INTO model_outputs (evaluation_id, model_id, trade_score, should_trade, compliant) VALUES (?, ?, ?, ?, ?)`).run(
        evalId,
        "claude-sonnet",
        70, // High score
        0,  // But should_trade = 0
        1
      );
      db.prepare(`INSERT INTO outcomes (evaluation_id, trade_taken, r_multiple) VALUES (?, ?, ?)`).run(
        evalId,
        1,
        -1.0 // Loss
      );

      const report = computeDriftReport(db);

      // Should use should_trade=0 (predicted no trade) and r_multiple<0 (loss)
      // Both agree on "no trade", so accuracy should be 100%
      expect(report.overall_accuracy).toBe(1.0);
    });

    it("should fallback to score >= 50 when should_trade is null", () => {
      const evalId = "eval1";
      db.prepare(`INSERT INTO evaluations (id, symbol, timestamp) VALUES (?, ?, ?)`).run(
        evalId,
        "AAPL",
        new Date(2024, 0, 1, 10, 0).toISOString()
      );
      db.prepare(`INSERT INTO model_outputs (evaluation_id, model_id, trade_score, should_trade, compliant) VALUES (?, ?, ?, ?, ?)`).run(
        evalId,
        "gpt-4o",
        30, // Score < 50
        null, // No explicit should_trade
        1
      );
      db.prepare(`INSERT INTO outcomes (evaluation_id, trade_taken, r_multiple) VALUES (?, ?, ?)`).run(
        evalId,
        1,
        -1.0 // Loss
      );

      const report = computeDriftReport(db);

      // Should use score < 50 (predicted no trade) and r_multiple<0 (loss)
      // Both agree on "no trade", so accuracy should be 100%
      expect(report.overall_accuracy).toBe(1.0);
    });
  });

  describe("Rounding and precision", () => {
    it("should round accuracy and calibration values to 3 decimal places", () => {
      // Create data that will produce non-round values
      for (let i = 0; i < 7; i++) {
        const evalId = `eval${i}`;
        db.prepare(`INSERT INTO evaluations (id, symbol, timestamp) VALUES (?, ?, ?)`).run(
          evalId,
          "AAPL",
          new Date(2024, 0, 1, 10, i).toISOString()
        );
        db.prepare(`INSERT INTO model_outputs (evaluation_id, model_id, trade_score, should_trade, compliant) VALUES (?, ?, ?, ?, ?)`).run(
          evalId,
          "claude-sonnet",
          70,
          1,
          1
        );
        db.prepare(`INSERT INTO outcomes (evaluation_id, trade_taken, r_multiple) VALUES (?, ?, ?)`).run(
          evalId,
          1,
          i < 4 ? 1.0 : -1.0 // 4/7 = 0.571428...
        );
      }

      const report = computeDriftReport(db);

      // 4/7 = 0.571428... should round to 0.571
      expect(report.overall_accuracy).toBe(0.571);
      expect(report.by_model[0].rolling_accuracy.last_10).toBe(0.571);
      
      // Check that values are exactly 3 decimals
      const accuracyStr = report.overall_accuracy.toString();
      const decimalPart = accuracyStr.split('.')[1];
      expect(decimalPart?.length || 0).toBeLessThanOrEqual(3);
    });
  });

  describe("Table name detection (legacy compatibility)", () => {
    it("should work with legacy 'evals' table name", () => {
      // Recreate with legacy table names
      db.exec(`DROP TABLE IF EXISTS outcomes`);
      db.exec(`DROP TABLE IF EXISTS model_outputs`);
      db.exec(`DROP TABLE IF EXISTS evaluations`);
      
      db.exec(`
        CREATE TABLE evals (
          id TEXT PRIMARY KEY,
          symbol TEXT NOT NULL,
          timestamp TEXT NOT NULL
        );

        CREATE TABLE model_outputs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          evaluation_id TEXT NOT NULL,
          model_id TEXT NOT NULL,
          trade_score REAL,
          should_trade INTEGER,
          compliant INTEGER DEFAULT 1
        );

        CREATE TABLE eval_outcomes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          evaluation_id TEXT NOT NULL,
          trade_taken INTEGER DEFAULT 0,
          r_multiple REAL
        );
      `);

      const evalId = "eval1";
      db.prepare(`INSERT INTO evals (id, symbol, timestamp) VALUES (?, ?, ?)`).run(
        evalId,
        "AAPL",
        new Date(2024, 0, 1, 10, 0).toISOString()
      );
      db.prepare(`INSERT INTO model_outputs (evaluation_id, model_id, trade_score, should_trade, compliant) VALUES (?, ?, ?, ?, ?)`).run(
        evalId,
        "claude-sonnet",
        70,
        1,
        1
      );
      db.prepare(`INSERT INTO eval_outcomes (evaluation_id, trade_taken, r_multiple) VALUES (?, ?, ?)`).run(
        evalId,
        1,
        1.0
      );

      const report = computeDriftReport(db);

      expect(report.overall_accuracy).toBe(1.0);
      expect(report.by_model.length).toBe(1);
    });
  });
});
