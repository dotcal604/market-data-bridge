import Database, { type Database as DatabaseType } from "better-sqlite3";
import { describe, it, expect } from "vitest";
import { computeDriftReport } from "../../src/eval/drift.js";

function createInMemoryDriftDb(): DatabaseType {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE evals (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL
    );
    CREATE TABLE eval_outcomes (
      evaluation_id TEXT NOT NULL,
      trade_taken INTEGER NOT NULL,
      r_multiple REAL
    );
    CREATE TABLE model_outputs (
      evaluation_id TEXT NOT NULL,
      model_id TEXT NOT NULL,
      trade_score REAL,
      should_trade INTEGER,
      compliant INTEGER NOT NULL
    );
  `);
  return db;
}

function seedEval(
  db: ReturnType<typeof createInMemoryDriftDb>,
  id: string,
  modelId: string,
  tradeScore: number,
  shouldTrade: number,
  rMultiple: number,
  index: number,
): void {
  const timestamp = new Date(Date.UTC(2026, 0, 1, 9, 30, index)).toISOString();
  db.prepare("INSERT INTO evals (id, timestamp) VALUES (?, ?)").run(id, timestamp);
  db.prepare("INSERT INTO eval_outcomes (evaluation_id, trade_taken, r_multiple) VALUES (?, 1, ?)").run(id, rMultiple);
  db.prepare(
    "INSERT INTO model_outputs (evaluation_id, model_id, trade_score, should_trade, compliant) VALUES (?, ?, ?, ?, 1)",
  ).run(id, modelId, tradeScore, shouldTrade);
}

describe("computeDriftReport", () => {
  it("returns empty report when no outcome rows exist", () => {
    const db = createInMemoryDriftDb();
    const report = computeDriftReport(db);

    expect(report.overall_accuracy).toBe(0);
    expect(report.by_model).toEqual([]);
    expect(report.regime_shift_detected).toBe(false);
    expect(report.recommendation).toContain("Insufficient");
  });

  it("computes rolling windows, calibration, and regime shift", () => {
    const db = createInMemoryDriftDb();

    for (let i = 0; i < 50; i += 1) {
      const recentLosing = i >= 40;
      seedEval(
        db,
        `claude-${i}`,
        "claude",
        80,
        1,
        recentLosing ? -1 : 1,
        i,
      );
    }

    for (let i = 0; i < 30; i += 1) {
      seedEval(db, `gpt4o-${i}`, "gpt4o", 65, 1, 1, 100 + i);
    }

    const report = computeDriftReport(db);

    expect(report.by_model).toHaveLength(2);
    const claude = report.by_model.find((row) => row.model_id === "claude");
    expect(claude).toBeDefined();
    expect(claude?.rolling_accuracy.last_50).toBe(0.8);
    expect(claude?.rolling_accuracy.last_10).toBe(0);
    expect(claude?.regime_shift_detected).toBe(true);

    const gpt = report.by_model.find((row) => row.model_id === "gpt4o");
    expect(gpt?.rolling_accuracy.last_50).toBe(1);
    expect(gpt?.calibration_error).toBeGreaterThan(0);

    expect(report.regime_shift_detected).toBe(true);
    expect(report.recommendation).toContain("Regime shift detected");
    expect(report.overall_accuracy).toBe(0.875);
  });
});
