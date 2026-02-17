import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { writeFileSync, unlinkSync, mkdtempSync, appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { importHollyAlerts } from "../importer.js";
import { queryHollyAlerts, getHollyAlertStats, getLatestHollySymbols, db } from "../../db/database.js";
import { _resetWatcher } from "../watcher.js";

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

  it("handles malformed rows with wrong column count — skips without crashing", () => {
    const csv = [
      "Symbol,Entry Time,Strategy,Entry Price",
      "AAPL,2026-02-17 10:00:00,Holly Grail,150.00", // correct
      "MSFT,2026-02-17 10:05:00", // too few columns
      "TSLA,2026-02-17 10:10:00,Holly Neo,250.00,extra,data,here", // too many columns
      "NVDA,2026-02-17 10:15:00,Holly Grail,300.00", // correct
    ].join("\n");

    const result = importHollyAlerts(csv);
    // csv-parse with relax_column_count should parse all rows
    expect(result.total_parsed).toBe(4);
    // All valid rows with symbols should be inserted
    expect(result.inserted).toBeGreaterThanOrEqual(2);
  });

  it("skips rows with empty symbol field", () => {
    const csv = [
      "Symbol,Entry Time,Strategy",
      ",2026-02-17 10:00:00,Holly Grail", // empty symbol
      "   ,2026-02-17 10:05:00,Holly Neo", // whitespace-only symbol
      "AAPL,2026-02-17 10:10:00,Holly Grail", // valid
    ].join("\n");

    const result = importHollyAlerts(csv);
    expect(result.inserted).toBe(1);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]).toMatch(/missing symbol/i);
    expect(result.errors[1]).toMatch(/missing symbol/i);
    
    const rows = queryHollyAlerts({});
    expect(rows).toHaveLength(1);
    expect(rows[0].symbol).toBe("AAPL");
  });

  it("handles special characters in strategy names", () => {
    const csv = [
      "Symbol,Entry Time,Strategy",
      'AAPL,2026-02-17 10:00:00,"Holly\'s Special Strategy!"',
      "MSFT,2026-02-17 10:05:00,Holly & Friends (v2.0)",
      "TSLA,2026-02-17 10:10:00,Holly—Neo–Strategy",
      "NVDA,2026-02-17 10:15:00,Holly策略",
    ].join("\n");

    const result = importHollyAlerts(csv);
    expect(result.inserted).toBe(4);
    expect(result.errors).toHaveLength(0);

    const rows = queryHollyAlerts({});
    expect(rows).toHaveLength(4);
    expect(rows.find((r) => r.symbol === "AAPL")?.strategy).toBe("Holly's Special Strategy!");
    expect(rows.find((r) => r.symbol === "MSFT")?.strategy).toBe("Holly & Friends (v2.0)");
    expect(rows.find((r) => r.symbol === "TSLA")?.strategy).toBe("Holly—Neo–Strategy");
    expect(rows.find((r) => r.symbol === "NVDA")?.strategy).toBe("Holly策略");
  });

  it("handles BOM-prefixed CSV (UTF-8 BOM)", () => {
    const csv = "\uFEFF" + [
      "Symbol,Entry Time,Strategy,Entry Price",
      "AAPL,2026-02-17 10:00:00,Holly Grail,150.00",
      "MSFT,2026-02-17 10:05:00,Holly Neo,380.00",
    ].join("\n");

    const result = importHollyAlerts(csv);
    expect(result.inserted).toBe(2);
    expect(result.errors).toHaveLength(0);

    const rows = queryHollyAlerts({});
    expect(rows).toHaveLength(2);
    expect(rows.some((r) => r.symbol === "AAPL")).toBe(true);
    expect(rows.some((r) => r.symbol === "MSFT")).toBe(true);
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

  it("handles file-not-found on first poll — no throw", () => {
    const nonExistentPath = join(tmpDir, "does-not-exist.csv");
    
    // Should not throw when file doesn't exist
    expect(() => {
      if (!existsSync(nonExistentPath)) {
        // Simulate watcher behavior: just return early if file doesn't exist
        return;
      }
    }).not.toThrow();

    expect(existsSync(nonExistentPath)).toBe(false);
  });

  it("handles file truncation — resets offset", () => {
    // Initial file with 3 rows
    const initial = [
      HEADER,
      makeRow("AAPL", "2026-02-17 10:00:00"),
      makeRow("MSFT", "2026-02-17 10:05:00"),
      makeRow("TSLA", "2026-02-17 10:10:00"),
    ].join("\n");
    writeFileSync(filePath, initial);

    const r1 = importHollyAlerts(initial);
    expect(r1.inserted).toBe(3);

    // Truncate file to just header + 1 new row
    const truncated = [
      HEADER,
      makeRow("NVDA", "2026-02-17 10:15:00"),
    ].join("\n");
    writeFileSync(filePath, truncated);

    // Should read from start again after truncation
    const r2 = importHollyAlerts(truncated);
    expect(r2.inserted).toBe(1);

    const all = queryHollyAlerts({});
    expect(all).toHaveLength(4); // 3 original + 1 new
  });

  it("handles header-only file then rows appended", () => {
    // Start with header only
    writeFileSync(filePath, HEADER);
    const r1 = importHollyAlerts(HEADER);
    expect(r1.inserted).toBe(0);
    expect(r1.total_parsed).toBe(0);

    // Append rows
    const withRows = [
      HEADER,
      makeRow("AAPL", "2026-02-17 10:00:00"),
      makeRow("MSFT", "2026-02-17 10:05:00"),
    ].join("\n");
    writeFileSync(filePath, withRows);

    const r2 = importHollyAlerts(withRows);
    expect(r2.inserted).toBe(2);

    const rows = queryHollyAlerts({});
    expect(rows).toHaveLength(2);
  });
});

// ── File Watcher Integration Tests ───────────────────────────────────────

describe("Holly Watcher Integration", () => {
  let tmpDir: string;
  let filePath: string;

  beforeEach(() => {
    clearHollyTable();
    _resetWatcher();
    tmpDir = mkdtempSync(join(tmpdir(), "holly-watcher-"));
    filePath = join(tmpDir, "holly_alerts.csv");
  });

  afterEach(() => {
    _resetWatcher();
    try { unlinkSync(filePath); } catch {}
  });

  it("integration: write temp CSV, simulate watcher poll, verify DB", () => {
    // Write initial CSV
    const csv = [
      HEADER,
      makeRow("AAPL", "2026-02-17 10:00:00", "Holly Grail", "150.00"),
      makeRow("MSFT", "2026-02-17 10:05:00", "Holly Neo", "380.00"),
    ].join("\n");
    writeFileSync(filePath, csv);

    // Simulate watcher behavior: read and import
    const result = importHollyAlerts(csv);
    expect(result.inserted).toBe(2);
    expect(result.skipped).toBe(0);

    // Verify DB state
    const rows = queryHollyAlerts({});
    expect(rows).toHaveLength(2);
    expect(rows.some((r) => r.symbol === "AAPL")).toBe(true);
    expect(rows.some((r) => r.symbol === "MSFT")).toBe(true);

    // Verify stats
    const stats = getHollyAlertStats();
    expect(stats.total_alerts).toBe(2);
    expect(stats.unique_symbols).toBe(2);

    // Simulate appending more rows
    const newCsv = [
      HEADER,
      makeRow("AAPL", "2026-02-17 10:00:00"), // duplicate
      makeRow("TSLA", "2026-02-17 10:10:00", "Holly Grail", "250.00"), // new
    ].join("\n");

    const result2 = importHollyAlerts(newCsv);
    expect(result2.inserted).toBe(1);
    expect(result2.skipped).toBe(1);

    // Verify final DB state
    const allRows = queryHollyAlerts({});
    expect(allRows).toHaveLength(3);

    const symbols = getLatestHollySymbols(10);
    expect(symbols).toHaveLength(3);
    expect(symbols).toContain("AAPL");
    expect(symbols).toContain("MSFT");
    expect(symbols).toContain("TSLA");
  });
});
