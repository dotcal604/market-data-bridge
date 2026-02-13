import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { getTestDb, closeTestDb } from "./setup.js";
import { cleanDb, createTestEvaluation, createTestModelOutput, createTestOutcome } from "./helpers.js";

describe("Test Infrastructure", () => {
  const db = getTestDb();

  beforeEach(() => {
    cleanDb(db);
  });

  afterAll(() => {
    closeTestDb();
  });

  it("should create in-memory database with all tables", () => {
    // Query sqlite_master to verify all 10 tables exist
    const tables = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`
      )
      .all() as Array<{ name: string }>;

    const tableNames = tables.map((t) => t.name);

    expect(tableNames).toContain("trade_journal");
    expect(tableNames).toContain("orders");
    expect(tableNames).toContain("executions");
    expect(tableNames).toContain("positions_snapshots");
    expect(tableNames).toContain("collab_messages");
    expect(tableNames).toContain("account_snapshots");
    expect(tableNames).toContain("evaluations");
    expect(tableNames).toContain("model_outputs");
    expect(tableNames).toContain("outcomes");
    expect(tableNames).toContain("weight_history");

    // Should have at least 10 tables (SQLite creates internal sqlite_sequence table for AUTOINCREMENT)
    expect(tableNames.length).toBeGreaterThanOrEqual(10);
  });

  it("should create test evaluation", () => {
    const eval1 = createTestEvaluation(db, { symbol: "TSLA" });

    expect(eval1.symbol).toBe("TSLA");
    expect(eval1.id).toBeDefined();

    // Verify it was inserted
    const row = db.prepare("SELECT * FROM evaluations WHERE id = ?").get(eval1.id);
    expect(row).toBeDefined();
  });

  it("should create test model output", () => {
    const eval1 = createTestEvaluation(db);
    const output1 = createTestModelOutput(db, eval1.id, { model_id: "claude-sonnet" });

    expect(output1.model_id).toBe("claude-sonnet");
    expect(output1.evaluation_id).toBe(eval1.id);

    // Verify it was inserted
    const row = db.prepare("SELECT * FROM model_outputs WHERE evaluation_id = ?").get(eval1.id);
    expect(row).toBeDefined();
  });

  it("should create test outcome", () => {
    const eval1 = createTestEvaluation(db);
    const outcome1 = createTestOutcome(db, eval1.id, { r_multiple: 2.0 });

    expect(outcome1.r_multiple).toBe(2.0);
    expect(outcome1.evaluation_id).toBe(eval1.id);

    // Verify it was inserted
    const row = db.prepare("SELECT * FROM outcomes WHERE evaluation_id = ?").get(eval1.id);
    expect(row).toBeDefined();
  });

  it("should clean database", () => {
    // Create some test data
    createTestEvaluation(db);
    createTestEvaluation(db);

    // Verify data exists
    let count = (db.prepare("SELECT COUNT(*) as count FROM evaluations").get() as any).count;
    expect(count).toBe(2);

    // Clean database
    cleanDb(db);

    // Verify all data is gone
    count = (db.prepare("SELECT COUNT(*) as count FROM evaluations").get() as any).count;
    expect(count).toBe(0);
  });
});
