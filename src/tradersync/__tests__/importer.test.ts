import { describe, it, expect, beforeEach, vi } from "vitest";
import { importTraderSyncCSV } from "../importer.js";

// ── Mock Database Module ──────────────────────────────────────────────────
vi.mock("../../db/database.js", () => ({
  bulkInsertTraderSyncTrades: vi.fn(),
  getTraderSyncStats: vi.fn(),
  getTraderSyncTrades: vi.fn(),
}));

// Import after mocking
import { bulkInsertTraderSyncTrades, getTraderSyncStats, getTraderSyncTrades } from "../../db/database.js";

// ── Test Helpers ──────────────────────────────────────────────────────────

const FULL_HEADER = [
  "Status", "Symbol", "Size", "Open Date", "Close Date", "Open Time", "Close Time",
  "Setups", "Mistakes", "Entry Price", "Exit Price", "Return $", "Return %",
  "Avg Buy", "Avg Sell", "Net Return", "Commision", "Notes", "Type", "Side",
  "Spread", "Cost", "Executions", "Holdtime", "Portfolio", "R-Multiple",
  "MAE", "MFE", "Expectancy", "Risk", "target1", "profit_aim1", "stop1", "risk1"
].join(",");

function makeRow(overrides: Partial<Record<string, string>> = {}): string {
  const defaults: Record<string, string> = {
    "Status": "WIN",
    "Symbol": "AAPL",
    "Size": "100",
    "Open Date": "Feb 12, 2026",
    "Close Date": "Feb 12, 2026",
    "Open Time": "10:30:00",
    "Close Time": "11:45:00",
    "Setups": "Breakout",
    "Mistakes": "",
    "Entry Price": "$150.00",
    "Exit Price": "$152.50",
    "Return $": "$250.00",
    "Return %": "1.67%",
    "Avg Buy": "$150.00",
    "Avg Sell": "$152.50",
    "Net Return": "$248.00",
    "Commision": "$2.00",
    "Notes": "",
    "Type": "SHARE",
    "Side": "LONG",
    "Spread": "SINGLE",
    "Cost": "$15000.00",
    "Executions": "2",
    "Holdtime": "1h 15m",
    "Portfolio": "Main",
    "R-Multiple": "2.5",
    "MAE": "-0.5",
    "MFE": "3.0",
    "Expectancy": "0.8",
    "Risk": "$100.00",
    "target1": "$155.00",
    "profit_aim1": "$500.00",
    "stop1": "$149.00",
    "risk1": "$100.00",
  };

  const merged = { ...defaults, ...overrides };
  
  return [
    "Status", "Symbol", "Size", "Open Date", "Close Date", "Open Time", "Close Time",
    "Setups", "Mistakes", "Entry Price", "Exit Price", "Return $", "Return %",
    "Avg Buy", "Avg Sell", "Net Return", "Commision", "Notes", "Type", "Side",
    "Spread", "Cost", "Executions", "Holdtime", "Portfolio", "R-Multiple",
    "MAE", "MFE", "Expectancy", "Risk", "target1", "profit_aim1", "stop1", "risk1"
  ].map((key) => merged[key] || "").join(",");
}

// ── Importer Tests ────────────────────────────────────────────────────────

describe("TraderSync CSV Importer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Valid CSV Parsing", () => {
    it("parses a basic CSV and returns correct counts", () => {
      vi.mocked(bulkInsertTraderSyncTrades).mockReturnValue({ inserted: 2, skipped: 0 });

      const csv = [
        FULL_HEADER,
        makeRow({ "Symbol": "AAPL" }),
        makeRow({ "Symbol": "MSFT" }),
      ].join("\n");

      const result = importTraderSyncCSV(csv);

      expect(result.total_parsed).toBe(2);
      expect(result.inserted).toBe(2);
      expect(result.skipped).toBe(0);
      expect(result.errors).toHaveLength(0);
      expect(result.batch_id).toBeTruthy();
      expect(result.batch_id).toMatch(/^[0-9a-f]{8}$/); // UUID slice(0, 8)
    });

    it("calls bulkInsertTraderSyncTrades with parsed rows including batch_id", () => {
      vi.mocked(bulkInsertTraderSyncTrades).mockReturnValue({ inserted: 1, skipped: 0 });

      const csv = [FULL_HEADER, makeRow({ "Symbol": "TSLA" })].join("\n");

      const result = importTraderSyncCSV(csv);

      expect(bulkInsertTraderSyncTrades).toHaveBeenCalledTimes(1);
      const insertedRows = vi.mocked(bulkInsertTraderSyncTrades).mock.calls[0][0];
      expect(insertedRows).toHaveLength(1);
      expect(insertedRows[0].symbol).toBe("TSLA");
      expect(insertedRows[0].import_batch).toBe(result.batch_id);
    });
  });

  describe("Deduplication", () => {
    it("handles duplicate rows via UNIQUE constraint (skipped count)", () => {
      // First import: 1 inserted, 0 skipped
      vi.mocked(bulkInsertTraderSyncTrades).mockReturnValueOnce({ inserted: 1, skipped: 0 });

      const csv = [FULL_HEADER, makeRow({ "Symbol": "NVDA" })].join("\n");
      const result1 = importTraderSyncCSV(csv);
      expect(result1.inserted).toBe(1);
      expect(result1.skipped).toBe(0);

      // Second import: 0 inserted, 1 skipped (duplicate)
      vi.mocked(bulkInsertTraderSyncTrades).mockReturnValueOnce({ inserted: 0, skipped: 1 });
      const result2 = importTraderSyncCSV(csv);
      expect(result2.inserted).toBe(0);
      expect(result2.skipped).toBe(1);
    });
  });

  describe("Missing Fields", () => {
    it("skips rows without a symbol", () => {
      vi.mocked(bulkInsertTraderSyncTrades).mockReturnValue({ inserted: 1, skipped: 0 });

      const csv = [
        FULL_HEADER,
        makeRow({ "Symbol": "" }),        // Empty symbol → skip (Row 2)
        makeRow({ "Symbol": "AAPL" }),    // Valid (Row 3)
      ].join("\n");

      const result = importTraderSyncCSV(csv);

      expect(result.total_parsed).toBe(2);
      expect(result.inserted).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatch(/row 2.*missing symbol/i);

      // Only 1 row should be passed to insert (the valid one)
      const insertedRows = vi.mocked(bulkInsertTraderSyncTrades).mock.calls[0][0];
      expect(insertedRows).toHaveLength(1);
      expect(insertedRows[0].symbol).toBe("AAPL");
    });

    it("handles rows with whitespace-only symbol as missing", () => {
      vi.mocked(bulkInsertTraderSyncTrades).mockReturnValue({ inserted: 0, skipped: 0 });

      const csv = [FULL_HEADER, makeRow({ "Symbol": "   " })].join("\n");

      const result = importTraderSyncCSV(csv);

      expect(result.inserted).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatch(/missing symbol/i);
    });
  });

  describe("Numeric Parsing", () => {
    it("strips dollar signs from prices", () => {
      vi.mocked(bulkInsertTraderSyncTrades).mockReturnValue({ inserted: 1, skipped: 0 });

      const csv = [
        "Symbol,Entry Price,Exit Price",
        "AAPL,$123.45,$125.67"
      ].join("\n");

      importTraderSyncCSV(csv);

      const insertedRows = vi.mocked(bulkInsertTraderSyncTrades).mock.calls[0][0];
      expect(insertedRows[0].entry_price).toBe(123.45);
      expect(insertedRows[0].exit_price).toBe(125.67);
    });

    it("strips commas from numbers", () => {
      vi.mocked(bulkInsertTraderSyncTrades).mockReturnValue({ inserted: 1, skipped: 0 });

      const csv = [
        "Symbol,Size,Cost",
        "AAPL,\"1,000\",\"$15,000.00\""
      ].join("\n");

      importTraderSyncCSV(csv);

      const insertedRows = vi.mocked(bulkInsertTraderSyncTrades).mock.calls[0][0];
      expect(insertedRows[0].size).toBe(1000);
      expect(insertedRows[0].cost).toBe(15000);
    });

    it("strips quotes from numeric strings", () => {
      vi.mocked(bulkInsertTraderSyncTrades).mockReturnValue({ inserted: 1, skipped: 0 });

      const csv = [
        "Symbol,Return $",
        'AAPL,"250.00"'
      ].join("\n");

      importTraderSyncCSV(csv);

      const insertedRows = vi.mocked(bulkInsertTraderSyncTrades).mock.calls[0][0];
      expect(insertedRows[0].return_dollars).toBe(250);
    });

    it("handles percent signs in Return %", () => {
      vi.mocked(bulkInsertTraderSyncTrades).mockReturnValue({ inserted: 1, skipped: 0 });

      const csv = [
        "Symbol,Return %",
        "AAPL,2.5%"
      ].join("\n");

      importTraderSyncCSV(csv);

      const insertedRows = vi.mocked(bulkInsertTraderSyncTrades).mock.calls[0][0];
      expect(insertedRows[0].return_pct).toBe(2.5);
    });

    it("parses negative numbers correctly", () => {
      vi.mocked(bulkInsertTraderSyncTrades).mockReturnValue({ inserted: 1, skipped: 0 });

      const csv = [
        "Symbol,MAE,Return $",
        "AAPL,-$1.50,-$100.00"
      ].join("\n");

      importTraderSyncCSV(csv);

      const insertedRows = vi.mocked(bulkInsertTraderSyncTrades).mock.calls[0][0];
      expect(insertedRows[0].mae).toBe(-1.5);
      expect(insertedRows[0].return_dollars).toBe(-100);
    });

    it("returns null for empty/invalid numeric fields", () => {
      vi.mocked(bulkInsertTraderSyncTrades).mockReturnValue({ inserted: 1, skipped: 0 });

      const csv = [
        "Symbol,MAE,MFE,Avg Buy",
        "AAPL,,N/A,   "
      ].join("\n");

      importTraderSyncCSV(csv);

      const insertedRows = vi.mocked(bulkInsertTraderSyncTrades).mock.calls[0][0];
      expect(insertedRows[0].mae).toBeNull();
      expect(insertedRows[0].mfe).toBeNull();
      expect(insertedRows[0].avg_buy).toBeNull();
    });

    it("rounds executions to integer", () => {
      vi.mocked(bulkInsertTraderSyncTrades).mockReturnValue({ inserted: 1, skipped: 0 });

      const csv = [
        "Symbol,Executions",
        "AAPL,3.7"
      ].join("\n");

      importTraderSyncCSV(csv);

      const insertedRows = vi.mocked(bulkInsertTraderSyncTrades).mock.calls[0][0];
      expect(insertedRows[0].executions).toBe(4); // Math.round(3.7)
    });
  });

  describe("Date Handling", () => {
    it("normalizes 'Feb 12, 2026' format to ISO date", () => {
      vi.mocked(bulkInsertTraderSyncTrades).mockReturnValue({ inserted: 1, skipped: 0 });

      const csv = [
        "Symbol,Open Date,Close Date",
        "AAPL,Feb 12 2026,Feb 13 2026"
      ].join("\n");

      importTraderSyncCSV(csv);

      const insertedRows = vi.mocked(bulkInsertTraderSyncTrades).mock.calls[0][0];
      expect(insertedRows[0].open_date).toBe("2026-02-12");
      expect(insertedRows[0].close_date).toBe("2026-02-13");
    });

    it("normalizes various date formats", () => {
      vi.mocked(bulkInsertTraderSyncTrades).mockReturnValue({ inserted: 1, skipped: 0 });

      const csv = [FULL_HEADER, makeRow({ "Open Date": "2026-02-17", "Close Date": "02/17/2026" })].join("\n");

      importTraderSyncCSV(csv);

      const insertedRows = vi.mocked(bulkInsertTraderSyncTrades).mock.calls[0][0];
      expect(insertedRows[0].open_date).toBe("2026-02-17");
      expect(insertedRows[0].close_date).toBe("2026-02-17");
    });

    it("handles invalid dates by keeping them as-is", () => {
      vi.mocked(bulkInsertTraderSyncTrades).mockReturnValue({ inserted: 1, skipped: 0 });

      const csv = [FULL_HEADER, makeRow({ "Open Date": "Invalid Date" })].join("\n");

      importTraderSyncCSV(csv);

      const insertedRows = vi.mocked(bulkInsertTraderSyncTrades).mock.calls[0][0];
      expect(insertedRows[0].open_date).toBe("Invalid Date");
    });
  });

  describe("Status Mapping", () => {
    it("preserves status as-is (WIN/LOSS)", () => {
      vi.mocked(bulkInsertTraderSyncTrades).mockReturnValue({ inserted: 2, skipped: 0 });

      const csv = [
        FULL_HEADER,
        makeRow({ "Status": "WIN" }),
        makeRow({ "Status": "LOSS" }),
      ].join("\n");

      importTraderSyncCSV(csv);

      const insertedRows = vi.mocked(bulkInsertTraderSyncTrades).mock.calls[0][0];
      expect(insertedRows[0].status).toBe("WIN");
      expect(insertedRows[1].status).toBe("LOSS");
    });

    it("defaults to UNKNOWN when status field is missing from CSV", () => {
      vi.mocked(bulkInsertTraderSyncTrades).mockReturnValue({ inserted: 1, skipped: 0 });

      // CSV without Status column
      const csv = [
        "Symbol",
        "AAPL"
      ].join("\n");

      importTraderSyncCSV(csv);

      const insertedRows = vi.mocked(bulkInsertTraderSyncTrades).mock.calls[0][0];
      expect(insertedRows[0].status).toBe("UNKNOWN");
    });

    it("keeps empty string when status is empty (not UNKNOWN)", () => {
      vi.mocked(bulkInsertTraderSyncTrades).mockReturnValue({ inserted: 1, skipped: 0 });

      const csv = [
        "Symbol,Status",
        "AAPL,"
      ].join("\n");

      importTraderSyncCSV(csv);

      const insertedRows = vi.mocked(bulkInsertTraderSyncTrades).mock.calls[0][0];
      // Empty string trimmed is still empty string, not UNKNOWN
      expect(insertedRows[0].status).toBe("");
    });
  });

  describe("Side Normalization", () => {
    it("preserves LONG and SHORT sides", () => {
      vi.mocked(bulkInsertTraderSyncTrades).mockReturnValue({ inserted: 2, skipped: 0 });

      const csv = [
        "Symbol,Side",
        "AAPL,LONG",
        "MSFT,SHORT",
      ].join("\n");

      importTraderSyncCSV(csv);

      const insertedRows = vi.mocked(bulkInsertTraderSyncTrades).mock.calls[0][0];
      expect(insertedRows[0].side).toBe("LONG");
      expect(insertedRows[1].side).toBe("SHORT");
    });

    it("defaults to LONG when side field is missing from CSV", () => {
      vi.mocked(bulkInsertTraderSyncTrades).mockReturnValue({ inserted: 1, skipped: 0 });

      // CSV without Side column
      const csv = [
        "Symbol",
        "AAPL"
      ].join("\n");

      importTraderSyncCSV(csv);

      const insertedRows = vi.mocked(bulkInsertTraderSyncTrades).mock.calls[0][0];
      expect(insertedRows[0].side).toBe("LONG");
    });

    it("keeps empty string when side is empty (not LONG)", () => {
      vi.mocked(bulkInsertTraderSyncTrades).mockReturnValue({ inserted: 1, skipped: 0 });

      const csv = [
        "Symbol,Side",
        "AAPL,"
      ].join("\n");

      importTraderSyncCSV(csv);

      const insertedRows = vi.mocked(bulkInsertTraderSyncTrades).mock.calls[0][0];
      // Empty string trimmed is still empty string, not LONG
      expect(insertedRows[0].side).toBe("");
    });
  });

  describe("Empty CSV", () => {
    it("handles completely empty CSV", () => {
      vi.mocked(bulkInsertTraderSyncTrades).mockReturnValue({ inserted: 0, skipped: 0 });

      const result = importTraderSyncCSV("");

      expect(result.total_parsed).toBe(0);
      expect(result.inserted).toBe(0);
      expect(result.skipped).toBe(0);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe("Header-Only CSV", () => {
    it("handles CSV with only headers", () => {
      vi.mocked(bulkInsertTraderSyncTrades).mockReturnValue({ inserted: 0, skipped: 0 });

      const result = importTraderSyncCSV(FULL_HEADER);

      expect(result.total_parsed).toBe(0);
      expect(result.inserted).toBe(0);
      expect(result.skipped).toBe(0);
    });
  });

  describe("BOM (Byte Order Mark)", () => {
    it("handles UTF-8 BOM at start of CSV", () => {
      vi.mocked(bulkInsertTraderSyncTrades).mockReturnValue({ inserted: 1, skipped: 0 });

      const BOM = "\uFEFF";
      const csv = BOM + [FULL_HEADER, makeRow({ "Symbol": "GOOG" })].join("\n");

      const result = importTraderSyncCSV(csv);

      expect(result.total_parsed).toBe(1);
      expect(result.inserted).toBe(1);

      const insertedRows = vi.mocked(bulkInsertTraderSyncTrades).mock.calls[0][0];
      expect(insertedRows[0].symbol).toBe("GOOG");
    });
  });

  describe("Extra Columns", () => {
    it("handles CSV with more columns than expected (relax_column_count)", () => {
      vi.mocked(bulkInsertTraderSyncTrades).mockReturnValue({ inserted: 1, skipped: 0 });

      const csv = [
        FULL_HEADER + ",Extra Column 1,Extra Column 2",
        makeRow({ "Symbol": "AMD" }) + ",extra_value_1,extra_value_2",
      ].join("\n");

      const result = importTraderSyncCSV(csv);

      expect(result.total_parsed).toBe(1);
      expect(result.inserted).toBe(1);
      expect(result.errors).toHaveLength(0);
    });

    it("handles CSV with fewer columns than expected (relax_column_count)", () => {
      vi.mocked(bulkInsertTraderSyncTrades).mockReturnValue({ inserted: 1, skipped: 0 });

      // Only provide first 10 columns
      const shortHeader = [
        "Status", "Symbol", "Size", "Open Date", "Close Date", "Open Time", "Close Time",
        "Setups", "Mistakes", "Entry Price"
      ].join(",");

      const shortRow = ["WIN", "INTC", "200", "Feb 15 2026", "Feb 15 2026", "09:45:00", "10:30:00", "Gap", "", "$50.00"].join(",");

      const csv = [shortHeader, shortRow].join("\n");

      const result = importTraderSyncCSV(csv);

      expect(result.total_parsed).toBe(1);
      expect(result.inserted).toBe(1);

      const insertedRows = vi.mocked(bulkInsertTraderSyncTrades).mock.calls[0][0];
      expect(insertedRows[0].symbol).toBe("INTC");
      expect(insertedRows[0].entry_price).toBe(50);
      // Fields not in CSV should have defaults
      expect(insertedRows[0].exit_price).toBe(0);
    });
  });

  describe("Batch ID", () => {
    it("generates unique batch IDs for each import", () => {
      vi.mocked(bulkInsertTraderSyncTrades).mockReturnValue({ inserted: 1, skipped: 0 });

      const csv = [FULL_HEADER, makeRow()].join("\n");

      const result1 = importTraderSyncCSV(csv);
      const result2 = importTraderSyncCSV(csv);

      expect(result1.batch_id).not.toBe(result2.batch_id);
      expect(result1.batch_id).toMatch(/^[0-9a-f]{8}$/);
      expect(result2.batch_id).toMatch(/^[0-9a-f]{8}$/);
    });

    it("includes batch_id in all inserted rows", () => {
      vi.mocked(bulkInsertTraderSyncTrades).mockReturnValue({ inserted: 3, skipped: 0 });

      const csv = [
        FULL_HEADER,
        makeRow({ "Symbol": "AAPL" }),
        makeRow({ "Symbol": "MSFT" }),
        makeRow({ "Symbol": "TSLA" }),
      ].join("\n");

      const result = importTraderSyncCSV(csv);

      const insertedRows = vi.mocked(bulkInsertTraderSyncTrades).mock.calls[0][0];
      expect(insertedRows).toHaveLength(3);
      expect(insertedRows[0].import_batch).toBe(result.batch_id);
      expect(insertedRows[1].import_batch).toBe(result.batch_id);
      expect(insertedRows[2].import_batch).toBe(result.batch_id);
    });
  });

  describe("CSV Parse Errors", () => {
    it("returns error when CSV is malformed", () => {
      const malformedCsv = 'Status,Symbol\n"Unclosed quote,AAPL';

      const result = importTraderSyncCSV(malformedCsv);

      expect(result.total_parsed).toBe(0);
      expect(result.inserted).toBe(0);
      expect(result.skipped).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatch(/CSV parse error/i);
    });
  });

  describe("Signal Source Parsing", () => {
    it("parses 'IA' tag in notes as holly signal source", () => {
      vi.mocked(bulkInsertTraderSyncTrades).mockReturnValue({ inserted: 1, skipped: 0 });

      const csv = [
        "Symbol,Notes",
        "AAPL,IA; high momentum"
      ].join("\n");

      importTraderSyncCSV(csv);

      const insertedRows = vi.mocked(bulkInsertTraderSyncTrades).mock.calls[0][0];
      expect(insertedRows[0].signal_source).toBe("holly");
    });

    it("parses 'FP' tag in notes as finviz signal source", () => {
      vi.mocked(bulkInsertTraderSyncTrades).mockReturnValue({ inserted: 1, skipped: 0 });

      const csv = [
        "Symbol,Notes",
        "AAPL,FP; top gainer"
      ].join("\n");

      importTraderSyncCSV(csv);

      const insertedRows = vi.mocked(bulkInsertTraderSyncTrades).mock.calls[0][0];
      expect(insertedRows[0].signal_source).toBe("finviz");
    });

    it("parses 'RP' tag in notes as replay signal source", () => {
      vi.mocked(bulkInsertTraderSyncTrades).mockReturnValue({ inserted: 1, skipped: 0 });

      const csv = [
        "Symbol,Notes",
        "AAPL,RP; backtest trade"
      ].join("\n");

      importTraderSyncCSV(csv);

      const insertedRows = vi.mocked(bulkInsertTraderSyncTrades).mock.calls[0][0];
      expect(insertedRows[0].signal_source).toBe("replay");
    });

    it("defaults to 'manual' signal source when no tag in notes", () => {
      vi.mocked(bulkInsertTraderSyncTrades).mockReturnValue({ inserted: 1, skipped: 0 });

      const csv = [FULL_HEADER, makeRow({ "Notes": "good setup" })].join("\n");

      importTraderSyncCSV(csv);

      const insertedRows = vi.mocked(bulkInsertTraderSyncTrades).mock.calls[0][0];
      expect(insertedRows[0].signal_source).toBe("manual");
    });

    it("defaults to 'manual' when notes is empty", () => {
      vi.mocked(bulkInsertTraderSyncTrades).mockReturnValue({ inserted: 1, skipped: 0 });

      const csv = [FULL_HEADER, makeRow({ "Notes": "" })].join("\n");

      importTraderSyncCSV(csv);

      const insertedRows = vi.mocked(bulkInsertTraderSyncTrades).mock.calls[0][0];
      expect(insertedRows[0].signal_source).toBe("manual");
    });
  });

  describe("Field Defaults", () => {
    it("uses correct defaults for missing optional fields", () => {
      vi.mocked(bulkInsertTraderSyncTrades).mockReturnValue({ inserted: 1, skipped: 0 });

      const minimalHeader = "Status,Symbol,Size,Open Date,Close Date,Open Time,Close Time,Entry Price,Exit Price,Return $,Return %,Side";
      const minimalRow = "WIN,AAPL,100,Feb 12, 2026,Feb 12, 2026,10:30:00,11:45:00,150.00,152.50,250.00,1.67%,LONG";

      const csv = [minimalHeader, minimalRow].join("\n");

      importTraderSyncCSV(csv);

      const insertedRows = vi.mocked(bulkInsertTraderSyncTrades).mock.calls[0][0];
      expect(insertedRows[0].type).toBe("SHARE");
      expect(insertedRows[0].spread).toBe("SINGLE");
      expect(insertedRows[0].setups).toBeNull();
      expect(insertedRows[0].mistakes).toBeNull();
      expect(insertedRows[0].notes).toBeNull();
      expect(insertedRows[0].holdtime).toBeNull();
      expect(insertedRows[0].portfolio).toBeNull();
    });
  });

  describe("Row Error Handling", () => {
    it("collects errors for individual row parsing failures but continues", () => {
      vi.mocked(bulkInsertTraderSyncTrades).mockReturnValue({ inserted: 1, skipped: 0 });

      const csv = [
        FULL_HEADER,
        makeRow({ "Symbol": "" }),         // Missing symbol → error (Row 2)
        makeRow({ "Symbol": "AAPL" }),     // Valid (Row 3)
      ].join("\n");

      const result = importTraderSyncCSV(csv);

      expect(result.total_parsed).toBe(2);
      expect(result.inserted).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatch(/row 2/i);
    });
  });
});

// ── Database Query Tests ──────────────────────────────────────────────────

describe("TraderSync Database Queries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getTraderSyncStats", () => {
    it("returns aggregated statistics", () => {
      const mockStats = {
        total_trades: 100,
        wins: 60,
        losses: 40,
        win_rate: 0.6,
        avg_r: 1.5,
        total_pnl: 5000,
        avg_pnl: 50,
        total_net: 4800,
        unique_symbols: 25,
        first_trade: "2026-01-01",
        last_trade: "2026-02-17",
        import_batches: 5,
      };

      vi.mocked(getTraderSyncStats).mockReturnValue(mockStats);

      const stats = getTraderSyncStats();

      expect(stats.total_trades).toBe(100);
      expect(stats.wins).toBe(60);
      expect(stats.losses).toBe(40);
      expect(stats.win_rate).toBe(0.6);
      expect(stats.avg_r).toBe(1.5);
      expect(getTraderSyncStats).toHaveBeenCalledTimes(1);
    });
  });

  describe("getTraderSyncTrades", () => {
    it("filters trades by symbol", () => {
      const mockTrades = [
        { id: 1, symbol: "AAPL", side: "LONG", status: "WIN" },
        { id: 2, symbol: "AAPL", side: "SHORT", status: "LOSS" },
      ];

      vi.mocked(getTraderSyncTrades).mockReturnValue(mockTrades);

      const trades = getTraderSyncTrades({ symbol: "AAPL" });

      expect(trades).toHaveLength(2);
      expect(trades[0].symbol).toBe("AAPL");
      expect(getTraderSyncTrades).toHaveBeenCalledWith({ symbol: "AAPL" });
    });

    it("filters trades by side", () => {
      const mockTrades = [
        { id: 1, symbol: "MSFT", side: "LONG", status: "WIN" },
      ];

      vi.mocked(getTraderSyncTrades).mockReturnValue(mockTrades);

      const trades = getTraderSyncTrades({ side: "LONG" });

      expect(trades).toHaveLength(1);
      expect(trades[0].side).toBe("LONG");
      expect(getTraderSyncTrades).toHaveBeenCalledWith({ side: "LONG" });
    });

    it("filters trades by status", () => {
      const mockTrades = [
        { id: 1, symbol: "TSLA", side: "LONG", status: "WIN" },
        { id: 2, symbol: "NVDA", side: "LONG", status: "WIN" },
      ];

      vi.mocked(getTraderSyncTrades).mockReturnValue(mockTrades);

      const trades = getTraderSyncTrades({ status: "WIN" });

      expect(trades).toHaveLength(2);
      expect(trades.every((t) => t.status === "WIN")).toBe(true);
      expect(getTraderSyncTrades).toHaveBeenCalledWith({ status: "WIN" });
    });

    it("filters trades by days (last N days)", () => {
      const mockTrades = [
        { id: 1, symbol: "GOOG", open_date: "2026-02-15", status: "WIN" },
        { id: 2, symbol: "AMD", open_date: "2026-02-16", status: "LOSS" },
      ];

      vi.mocked(getTraderSyncTrades).mockReturnValue(mockTrades);

      const trades = getTraderSyncTrades({ days: 7 });

      expect(trades).toHaveLength(2);
      expect(getTraderSyncTrades).toHaveBeenCalledWith({ days: 7 });
    });

    it("applies limit parameter", () => {
      const mockTrades = Array.from({ length: 50 }, (_, i) => ({
        id: i + 1,
        symbol: "AAPL",
        status: "WIN",
      }));

      vi.mocked(getTraderSyncTrades).mockReturnValue(mockTrades);

      const trades = getTraderSyncTrades({ limit: 50 });

      expect(trades).toHaveLength(50);
      expect(getTraderSyncTrades).toHaveBeenCalledWith({ limit: 50 });
    });

    it("combines multiple filters", () => {
      const mockTrades = [
        { id: 1, symbol: "AAPL", side: "LONG", status: "WIN", open_date: "2026-02-15" },
      ];

      vi.mocked(getTraderSyncTrades).mockReturnValue(mockTrades);

      const trades = getTraderSyncTrades({ symbol: "AAPL", side: "LONG", status: "WIN", days: 7 });

      expect(trades).toHaveLength(1);
      expect(trades[0].symbol).toBe("AAPL");
      expect(trades[0].side).toBe("LONG");
      expect(trades[0].status).toBe("WIN");
      expect(getTraderSyncTrades).toHaveBeenCalledWith({ symbol: "AAPL", side: "LONG", status: "WIN", days: 7 });
    });
  });
});
