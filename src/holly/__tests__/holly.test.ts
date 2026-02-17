import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, unlinkSync, mkdtempSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { importHollyAlerts } from "../importer.js";
import { queryHollyAlerts, getHollyAlertStats, getLatestHollySymbols, db } from "../../db/database.js";

// ── Helpers ──────────────────────────────────────────────────────────────

function clearHollyTable(): void {
  db.exec("DELETE FROM holly_alerts");
}

const HEADER = "Entry Time,Symbol,Strategy,Entry Price,Stop Price,Shares,Last Price,Segment";

function makeRow(symbol: string, time: string, strategy = "Holly Grail", price = "150.00"): string {
  return `${time},${symbol},${strategy},${price},145.00,100,${price},${strategy}`;
}

// ── Importer Tests ───────────────────────────────────────────────────────

describe("Holly Importer", () => {
  beforeEach(() => clearHollyTable());

  it("parses a basic CSV and inserts rows", () => {
    const csv = [
      HEADER,
      makeRow("AAPL", "2026-02-17 10:00:00"),
      makeRow("MSFT", "2026-02-17 10:05:00"),
      makeRow("TSLA", "2026-02-17 10:10:00"),
    ].join("\n");

    const result = importHollyAlerts(csv);
    expect(result.inserted).toBe(3);
    expect(result.skipped).toBe(0);
    expect(result.total_parsed).toBe(3);
    expect(result.errors).toHaveLength(0);
    expect(result.batch_id).toBeTruthy();
  });

  it("deduplicates by (symbol, alert_time, strategy)", () => {
    const csv = [
      HEADER,
      makeRow("AAPL", "2026-02-17 10:00:00"),
    ].join("\n");

    importHollyAlerts(csv);
    const result2 = importHollyAlerts(csv);
    expect(result2.inserted).toBe(0);
    expect(result2.skipped).toBe(1);
  });

  it("handles unknown columns by storing them in extra JSON", () => {
    const csv = [
      "Symbol,Entry Time,Strategy,Custom Column,Another Field",
      "NVDA,2026-02-17 11:00:00,Holly Neo,custom_value,another_value",
    ].join("\n");

    const result = importHollyAlerts(csv);
    expect(result.inserted).toBe(1);

    const rows = queryHollyAlerts({ symbol: "NVDA" });
    expect(rows).toHaveLength(1);
    const extra = JSON.parse(rows[0].extra as string);
    expect(extra["Custom Column"]).toBe("custom_value");
    expect(extra["Another Field"]).toBe("another_value");
  });

  it("skips rows without a symbol", () => {
    const csv = [
      "Entry Time,Symbol,Strategy",
      "2026-02-17 10:00:00,,Holly Grail",
      "2026-02-17 10:05:00,AAPL,Holly Grail",
    ].join("\n");

    const result = importHollyAlerts(csv);
    expect(result.inserted).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/missing symbol/i);
  });

  it("handles empty CSV", () => {
    const result = importHollyAlerts("");
    expect(result.inserted).toBe(0);
    expect(result.total_parsed).toBe(0);
  });

  it("handles header-only CSV", () => {
    const result = importHollyAlerts(HEADER);
    expect(result.inserted).toBe(0);
    expect(result.total_parsed).toBe(0);
  });

  it("normalizes symbols to uppercase", () => {
    const csv = [
      "Symbol,Entry Time,Strategy",
      "aapl,2026-02-17 12:00:00,Holly Grail",
    ].join("\n");

    importHollyAlerts(csv);
    const rows = queryHollyAlerts({ symbol: "AAPL" });
    expect(rows).toHaveLength(1);
  });

  it("parses numeric fields correctly", () => {
    const csv = [
      "Symbol,Entry Time,Strategy,Entry Price,Stop Price,Shares,Last Price",
      "GOOG,2026-02-17 13:00:00,Holly Neo,$175.50,$170.00,200,176.25",
    ].join("\n");

    importHollyAlerts(csv);
    const rows = queryHollyAlerts({ symbol: "GOOG" });
    expect(rows).toHaveLength(1);
    expect(rows[0].entry_price).toBe(175.5);
    expect(rows[0].stop_price).toBe(170);
    expect(rows[0].shares).toBe(200);
    expect(rows[0].last_price).toBe(176.25);
  });

  it("handles alternative column names (Ticker, Price, Time)", () => {
    const csv = [
      "Ticker,Time,Price",
      "AMD,2026-02-17 14:00:00,125.00",
    ].join("\n");

    const result = importHollyAlerts(csv);
    expect(result.inserted).toBe(1);
    const rows = queryHollyAlerts({ symbol: "AMD" });
    expect(rows).toHaveLength(1);
    expect(rows[0].entry_price).toBe(125);
  });
});

// ── Query Tests ──────────────────────────────────────────────────────────

describe("Holly Queries", () => {
  beforeEach(() => {
    clearHollyTable();
    const csv = [
      HEADER,
      makeRow("AAPL", "2026-02-17 10:00:00", "Holly Grail", "150"),
      makeRow("MSFT", "2026-02-17 10:05:00", "Holly Neo", "380"),
      makeRow("TSLA", "2026-02-17 10:10:00", "Holly Grail", "250"),
      makeRow("AAPL", "2026-02-17 10:15:00", "Holly Neo", "151"),
    ].join("\n");
    importHollyAlerts(csv);
  });

  it("queryHollyAlerts filters by symbol", () => {
    const rows = queryHollyAlerts({ symbol: "AAPL" });
    expect(rows).toHaveLength(2);
  });

  it("queryHollyAlerts filters by strategy", () => {
    const rows = queryHollyAlerts({ strategy: "Holly Neo" });
    expect(rows).toHaveLength(2);
  });

  it("queryHollyAlerts filters by since", () => {
    const rows = queryHollyAlerts({ since: "2026-02-17 10:10:00" });
    expect(rows).toHaveLength(2); // TSLA 10:10 + AAPL 10:15
  });

  it("queryHollyAlerts respects limit", () => {
    const rows = queryHollyAlerts({ limit: 2 });
    expect(rows).toHaveLength(2);
  });

  it("getHollyAlertStats returns correct counts", () => {
    const stats = getHollyAlertStats();
    expect(stats.total_alerts).toBe(4);
    expect(stats.unique_symbols).toBe(3);
    expect(stats.unique_strategies).toBe(2);
  });

  it("getLatestHollySymbols returns distinct symbols in order", () => {
    const symbols = getLatestHollySymbols(10);
    expect(symbols).toContain("AAPL");
    expect(symbols).toContain("MSFT");
    expect(symbols).toContain("TSLA");
    expect(symbols[0]).toBe("AAPL"); // latest alert time
  });
});

// ── File Watcher Simulation ──────────────────────────────────────────────

describe("Holly Watcher Simulation", () => {
  let tmpDir: string;
  let filePath: string;

  beforeEach(() => {
    clearHollyTable();
    tmpDir = mkdtempSync(join(tmpdir(), "holly-test-"));
    filePath = join(tmpDir, "holly_alerts.csv");
  });

  afterEach(() => {
    try { unlinkSync(filePath); } catch {}
  });

  it("importHollyAlerts works with incremental CSV appends", () => {
    // Simulate initial file with header + 2 rows
    const initial = [
      HEADER,
      makeRow("AAPL", "2026-02-17 10:00:00"),
      makeRow("MSFT", "2026-02-17 10:05:00"),
    ].join("\n");
    writeFileSync(filePath, initial);

    const r1 = importHollyAlerts(initial);
    expect(r1.inserted).toBe(2);

    // Simulate appending 2 new rows (1 is duplicate AAPL)
    const newRows = [
      HEADER,
      makeRow("AAPL", "2026-02-17 10:00:00"), // duplicate
      makeRow("TSLA", "2026-02-17 10:10:00"), // new
    ].join("\n");

    const r2 = importHollyAlerts(newRows);
    expect(r2.inserted).toBe(1);
    expect(r2.skipped).toBe(1);

    // Verify final DB state
    const all = queryHollyAlerts({});
    expect(all).toHaveLength(3);

    const symbols = getLatestHollySymbols(10);
    expect(symbols).toHaveLength(3);
  });
});
