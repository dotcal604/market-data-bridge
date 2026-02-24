import { describe, it, expect, beforeEach } from "vitest";
import { getDb } from "../../db/database.js";
import { insertImportRecord, updateImportRecord, getImportHistory, getImportById, getImportStats } from "../history.js";

describe("import history", () => {
  const testRecord = {
    import_id: "test-001",
    file_name: "trade_data.csv",
    format: "tradersync",
    confidence: 0.85,
    detection_reason: "Matched 6/7 TraderSync columns",
    status: "processing",
    inserted: 0,
    skipped: 0,
    errors: "[]",
  };

  beforeEach(() => {
    const db = getDb();
    db.prepare("DELETE FROM import_history WHERE import_id LIKE 'test-%'").run();
  });

  it("inserts and retrieves an import record", () => {
    insertImportRecord(testRecord);
    const record = getImportById("test-001");

    expect(record).toBeTruthy();
    expect(record!.file_name).toBe("trade_data.csv");
    expect(record!.format).toBe("tradersync");
    expect(record!.status).toBe("processing");
  });

  it("updates an import record", () => {
    insertImportRecord(testRecord);
    updateImportRecord("test-001", {
      status: "completed",
      inserted: 10,
      skipped: 2,
      duration_ms: 45,
    });

    const record = getImportById("test-001");
    expect(record!.status).toBe("completed");
    expect(record!.inserted).toBe(10);
    expect(record!.skipped).toBe(2);
    expect(record!.duration_ms).toBe(45);
  });

  it("queries import history with filters", () => {
    insertImportRecord(testRecord);
    insertImportRecord({ ...testRecord, import_id: "test-002", status: "completed", format: "holly_alerts" });

    const all = getImportHistory({ limit: 10 });
    expect(all.length).toBeGreaterThanOrEqual(2);

    const completedOnly = getImportHistory({ status: "completed" });
    expect(completedOnly.every((r) => r.status === "completed")).toBe(true);
  });

  it("returns aggregate stats", () => {
    insertImportRecord({ ...testRecord, import_id: "test-003", status: "completed", inserted: 5 });
    updateImportRecord("test-003", { status: "completed", inserted: 5, duration_ms: 30 });

    const stats = getImportStats();
    expect(stats.total_imports).toBeGreaterThanOrEqual(1);
  });
});
