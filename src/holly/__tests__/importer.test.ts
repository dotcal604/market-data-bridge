import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for Holly AI Alert CSV Importer
 *
 * Tests flexible column mapping, normalizeRow, parseNum, extra JSON field storage,
 * row rejection, and various edge cases.
 */

// ── Mock database ────────────────────────────────────────────────────────

let mockBulkInsert: ReturnType<typeof vi.fn>;

vi.mock("../../db/database.js", () => ({
  bulkInsertHollyAlerts: mockBulkInsert,
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

// Import after mocks are set up
import { importHollyAlerts, type ImportResult } from "../importer.js";

// ── Test Helpers ─────────────────────────────────────────────────────────

function makeCSV(headers: string, rows: string[]): string {
  return [headers, ...rows].join("\n");
}

beforeEach(() => {
  mockBulkInsert = vi.fn(() => ({ inserted: 1, skipped: 0 }));
  vi.mocked(mockBulkInsert);
});

// ── Tests ────────────────────────────────────────────────────────────────

describe("Holly Alert CSV Importer", () => {
  // ── Column Name Mapping ──────────────────────────────────────────────

  describe("column name mapping", () => {
    it("maps 'Entry Time' to alert_time", () => {
      const csv = makeCSV(
        "Entry Time,Symbol,Price",
        ["2024-03-15 09:45:00,AAPL,170.50"]
      );
      importHollyAlerts(csv);

      expect(mockBulkInsert).toHaveBeenCalled();
      const rows = mockBulkInsert.mock.calls[0][0];
      expect(rows[0]).toHaveProperty("alert_time", "2024-03-15 09:45:00");
    });

    it("maps 'Time' to alert_time", () => {
      const csv = makeCSV(
        "Time,Symbol,Price",
        ["2024-03-15 09:45:00,AAPL,170.50"]
      );
      importHollyAlerts(csv);

      const rows = mockBulkInsert.mock.calls[0][0];
      expect(rows[0]).toHaveProperty("alert_time", "2024-03-15 09:45:00");
    });

    it("maps 'Alert Time' to alert_time", () => {
      const csv = makeCSV(
        "Alert Time,Symbol,Price",
        ["2024-03-15 09:45:00,AAPL,170.50"]
      );
      importHollyAlerts(csv);

      const rows = mockBulkInsert.mock.calls[0][0];
      expect(rows[0]).toHaveProperty("alert_time", "2024-03-15 09:45:00");
    });

    it("maps 'Ticker' to symbol", () => {
      const csv = makeCSV(
        "Time,Ticker,Price",
        ["2024-03-15 09:45:00,AAPL,170.50"]
      );
      importHollyAlerts(csv);

      const rows = mockBulkInsert.mock.calls[0][0];
      expect(rows[0]).toHaveProperty("symbol", "AAPL");
    });

    it("is case-insensitive for column names", () => {
      const csv = makeCSV(
        "ENTRY TIME,SYMBOL,PRICE",
        ["2024-03-15 09:45:00,AAPL,170.50"]
      );
      importHollyAlerts(csv);

      const rows = mockBulkInsert.mock.calls[0][0];
      expect(rows[0]).toHaveProperty("alert_time", "2024-03-15 09:45:00");
      expect(rows[0]).toHaveProperty("symbol", "AAPL");
    });

    it("trims whitespace from column names", () => {
      const csv = makeCSV(
        "  Entry Time  ,  Symbol  ,  Price  ",
        ["2024-03-15 09:45:00,AAPL,170.50"]
      );
      importHollyAlerts(csv);

      const rows = mockBulkInsert.mock.calls[0][0];
      expect(rows[0]).toHaveProperty("alert_time", "2024-03-15 09:45:00");
      expect(rows[0]).toHaveProperty("symbol", "AAPL");
    });

    it("maps verbose column names to DB columns", () => {
      const csv = makeCSV(
        "Entry Time,Symbol,Entry Price,Stop Price,Shares,Last Price,Strategy,Segment",
        ["2024-03-15 09:45:00,AAPL,170.50,169.00,100,172.00,Holly Grail,Morning"]
      );
      importHollyAlerts(csv);

      const rows = mockBulkInsert.mock.calls[0][0];
      expect(rows[0]).toHaveProperty("alert_time", "2024-03-15 09:45:00");
      expect(rows[0]).toHaveProperty("symbol", "AAPL");
      expect(rows[0]).toHaveProperty("entry_price", 170.5);
      expect(rows[0]).toHaveProperty("stop_price", 169.0);
      expect(rows[0]).toHaveProperty("shares", 100);
      expect(rows[0]).toHaveProperty("last_price", 172.0);
      expect(rows[0]).toHaveProperty("strategy", "Holly Grail");
      expect(rows[0]).toHaveProperty("segment", "Morning");
    });

    it("maps alternative column names (Price, Stop, Smart Stop, Size, Last)", () => {
      const csv = makeCSV(
        "Time,Symbol,Price,Smart Stop,Size,Last",
        ["2024-03-15 09:45:00,AAPL,170.50,169.00,100,172.00"]
      );
      importHollyAlerts(csv);

      const rows = mockBulkInsert.mock.calls[0][0];
      expect(rows[0]).toHaveProperty("entry_price", 170.5);
      expect(rows[0]).toHaveProperty("stop_price", 169.0);
      expect(rows[0]).toHaveProperty("shares", 100);
      expect(rows[0]).toHaveProperty("last_price", 172.0);
    });
  });

  // ── normalizeRow() ───────────────────────────────────────────────────

  describe("normalizeRow()", () => {
    it("requires symbol field", () => {
      const csv = makeCSV(
        "Time,Price",
        ["2024-03-15 09:45:00,170.50"]
      );
      const result = importHollyAlerts(csv);

      expect(result.inserted).toBe(0);
      expect(result.skipped).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("missing symbol");
    });

    it("rejects rows with empty symbol", () => {
      const csv = makeCSV(
        "Time,Symbol,Price",
        ["2024-03-15 09:45:00,,170.50"]
      );
      const result = importHollyAlerts(csv);

      expect(result.inserted).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("missing symbol");
    });

    it("rejects rows with whitespace-only symbol", () => {
      const csv = makeCSV(
        "Time,Symbol,Price",
        ["2024-03-15 09:45:00,   ,170.50"]
      );
      const result = importHollyAlerts(csv);

      expect(result.inserted).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("missing symbol");
    });

    it("normalizes symbol to uppercase", () => {
      const csv = makeCSV(
        "Time,Symbol,Price",
        ["2024-03-15 09:45:00,aapl,170.50"]
      );
      importHollyAlerts(csv);

      const rows = mockBulkInsert.mock.calls[0][0];
      expect(rows[0]).toHaveProperty("symbol", "AAPL");
    });

    it("parses numeric fields (entry_price, stop_price, shares, last_price)", () => {
      const csv = makeCSV(
        "Time,Symbol,Entry Price,Stop Price,Shares,Last Price",
        ["2024-03-15 09:45:00,AAPL,170.50,169.00,100,172.00"]
      );
      importHollyAlerts(csv);

      const rows = mockBulkInsert.mock.calls[0][0];
      expect(rows[0]).toHaveProperty("entry_price", 170.5);
      expect(rows[0]).toHaveProperty("stop_price", 169.0);
      expect(rows[0]).toHaveProperty("shares", 100);
      expect(rows[0]).toHaveProperty("last_price", 172.0);
    });

    it("rounds shares to nearest integer", () => {
      const csv = makeCSV(
        "Time,Symbol,Shares",
        ["2024-03-15 09:45:00,AAPL,100.7"]
      );
      importHollyAlerts(csv);

      const rows = mockBulkInsert.mock.calls[0][0];
      expect(rows[0]).toHaveProperty("shares", 101);
    });

    it("defaults alert_time to current time when missing", () => {
      const csv = makeCSV(
        "Symbol,Price",
        ["AAPL,170.50"]
      );
      const beforeTime = new Date().toISOString();
      importHollyAlerts(csv);
      const afterTime = new Date().toISOString();

      const rows = mockBulkInsert.mock.calls[0][0];
      const alertTime = rows[0].alert_time as string;
      expect(alertTime).toBeDefined();
      expect(alertTime >= beforeTime).toBe(true);
      expect(alertTime <= afterTime).toBe(true);
    });

    it("defaults strategy and segment to null when missing", () => {
      const csv = makeCSV(
        "Time,Symbol,Price",
        ["2024-03-15 09:45:00,AAPL,170.50"]
      );
      importHollyAlerts(csv);

      const rows = mockBulkInsert.mock.calls[0][0];
      expect(rows[0]).toHaveProperty("strategy", null);
      expect(rows[0]).toHaveProperty("segment", null);
    });
  });

  // ── parseNum() ───────────────────────────────────────────────────────

  describe("parseNum()", () => {
    it("parses regular numbers", () => {
      const csv = makeCSV(
        "Time,Symbol,Price",
        ["2024-03-15 09:45:00,AAPL,170.50"]
      );
      importHollyAlerts(csv);

      const rows = mockBulkInsert.mock.calls[0][0];
      expect(rows[0]).toHaveProperty("entry_price", 170.5);
    });

    it("handles dollar signs", () => {
      const csv = makeCSV(
        "Time,Symbol,Entry Price",
        ["2024-03-15 09:45:00,AAPL,$170.50"]
      );
      importHollyAlerts(csv);

      const rows = mockBulkInsert.mock.calls[0][0];
      expect(rows[0]).toHaveProperty("entry_price", 170.5);
    });

    it("handles commas in numbers", () => {
      const csv = makeCSV(
        "Time,Symbol,Entry Price",
        ["2024-03-15 09:45:00,AAPL,1,170.50"]
      );
      importHollyAlerts(csv);

      const rows = mockBulkInsert.mock.calls[0][0];
      expect(rows[0]).toHaveProperty("entry_price", 1170.5);
    });

    it("handles whitespace in numbers", () => {
      const csv = makeCSV(
        "Time,Symbol,Entry Price",
        ["2024-03-15 09:45:00,AAPL,  170.50  "]
      );
      importHollyAlerts(csv);

      const rows = mockBulkInsert.mock.calls[0][0];
      expect(rows[0]).toHaveProperty("entry_price", 170.5);
    });

    it("handles quoted numbers", () => {
      const csv = makeCSV(
        "Time,Symbol,Entry Price",
        ['2024-03-15 09:45:00,AAPL,"170.50"']
      );
      importHollyAlerts(csv);

      const rows = mockBulkInsert.mock.calls[0][0];
      expect(rows[0]).toHaveProperty("entry_price", 170.5);
    });

    it("returns null for empty strings", () => {
      const csv = makeCSV(
        "Time,Symbol,Entry Price",
        ["2024-03-15 09:45:00,AAPL,"]
      );
      importHollyAlerts(csv);

      const rows = mockBulkInsert.mock.calls[0][0];
      expect(rows[0]).toHaveProperty("entry_price", null);
    });

    it("returns null for invalid strings", () => {
      const csv = makeCSV(
        "Time,Symbol,Entry Price",
        ["2024-03-15 09:45:00,AAPL,abc"]
      );
      importHollyAlerts(csv);

      const rows = mockBulkInsert.mock.calls[0][0];
      expect(rows[0]).toHaveProperty("entry_price", null);
    });
  });

  // ── Extra JSON Field ─────────────────────────────────────────────────

  describe("extra JSON field", () => {
    it("stores unmapped columns in extra JSON field", () => {
      const csv = makeCSV(
        "Time,Symbol,Price,Custom Field 1,Custom Field 2",
        ["2024-03-15 09:45:00,AAPL,170.50,value1,value2"]
      );
      importHollyAlerts(csv);

      const rows = mockBulkInsert.mock.calls[0][0];
      const extra = JSON.parse(rows[0].extra as string);
      expect(extra).toHaveProperty("Custom Field 1", "value1");
      expect(extra).toHaveProperty("Custom Field 2", "value2");
    });

    it("excludes empty unmapped columns from extra", () => {
      const csv = makeCSV(
        "Time,Symbol,Price,Custom Field 1,Empty Field",
        ["2024-03-15 09:45:00,AAPL,170.50,value1,"]
      );
      importHollyAlerts(csv);

      const rows = mockBulkInsert.mock.calls[0][0];
      const extra = JSON.parse(rows[0].extra as string);
      expect(extra).toHaveProperty("Custom Field 1", "value1");
      expect(extra).not.toHaveProperty("Empty Field");
    });

    it("sets extra to null when no unmapped columns exist", () => {
      const csv = makeCSV(
        "Time,Symbol,Price",
        ["2024-03-15 09:45:00,AAPL,170.50"]
      );
      importHollyAlerts(csv);

      const rows = mockBulkInsert.mock.calls[0][0];
      expect(rows[0]).toHaveProperty("extra", null);
    });

    it("trims whitespace from unmapped column names and values", () => {
      const csv = makeCSV(
        "Time,Symbol,Price,  Custom Field  ",
        ["2024-03-15 09:45:00,AAPL,170.50,  value  "]
      );
      importHollyAlerts(csv);

      const rows = mockBulkInsert.mock.calls[0][0];
      const extra = JSON.parse(rows[0].extra as string);
      expect(extra).toHaveProperty("Custom Field", "value");
    });
  });

  // ── Empty and Header-Only CSV ────────────────────────────────────────

  describe("empty and header-only CSV", () => {
    it("handles empty CSV", () => {
      const result = importHollyAlerts("");

      expect(result.batch_id).toBeDefined();
      expect(result.total_parsed).toBe(0);
      expect(result.inserted).toBe(0);
      expect(result.skipped).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it("handles header-only CSV", () => {
      const result = importHollyAlerts("Time,Symbol,Price");

      expect(result.batch_id).toBeDefined();
      expect(result.total_parsed).toBe(0);
      expect(result.inserted).toBe(0);
      expect(result.skipped).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it("handles CSV with only whitespace", () => {
      const result = importHollyAlerts("   \n   \n   ");

      expect(result.batch_id).toBeDefined();
      expect(result.total_parsed).toBe(0);
      expect(result.inserted).toBe(0);
    });
  });

  // ── Batch ID ─────────────────────────────────────────────────────────

  describe("batch_id", () => {
    it("generates a UUID batch_id", () => {
      const csv = makeCSV(
        "Time,Symbol,Price",
        ["2024-03-15 09:45:00,AAPL,170.50"]
      );
      const result = importHollyAlerts(csv);

      expect(result.batch_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    it("assigns the same batch_id to all rows in one import", () => {
      const csv = makeCSV(
        "Time,Symbol,Price",
        [
          "2024-03-15 09:45:00,AAPL,170.50",
          "2024-03-15 10:00:00,TSLA,800.00",
        ]
      );
      const result = importHollyAlerts(csv);
      const rows = mockBulkInsert.mock.calls[0][0];

      expect(rows[0]).toHaveProperty("import_batch", result.batch_id);
      expect(rows[1]).toHaveProperty("import_batch", result.batch_id);
      expect(rows[0].import_batch).toBe(rows[1].import_batch);
    });

    it("generates different batch_ids for different imports", () => {
      const csv = makeCSV(
        "Time,Symbol,Price",
        ["2024-03-15 09:45:00,AAPL,170.50"]
      );
      const result1 = importHollyAlerts(csv);
      const result2 = importHollyAlerts(csv);

      expect(result1.batch_id).not.toBe(result2.batch_id);
    });
  });

  // ── Import Result ────────────────────────────────────────────────────

  describe("import result", () => {
    it("returns correct counts for successful import", () => {
      mockBulkInsert.mockReturnValueOnce({ inserted: 3, skipped: 0 });
      const csv = makeCSV(
        "Time,Symbol,Price",
        [
          "2024-03-15 09:45:00,AAPL,170.50",
          "2024-03-15 10:00:00,TSLA,800.00",
          "2024-03-15 10:15:00,MSFT,350.00",
        ]
      );
      const result = importHollyAlerts(csv);

      expect(result.total_parsed).toBe(3);
      expect(result.inserted).toBe(3);
      expect(result.skipped).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it("counts skipped rows from duplicate UNIQUE constraint", () => {
      mockBulkInsert.mockReturnValueOnce({ inserted: 1, skipped: 1 });
      const csv = makeCSV(
        "Time,Symbol,Price",
        [
          "2024-03-15 09:45:00,AAPL,170.50",
          "2024-03-15 09:45:00,AAPL,170.50",
        ]
      );
      const result = importHollyAlerts(csv);

      expect(result.total_parsed).toBe(2);
      expect(result.inserted).toBe(1);
      expect(result.skipped).toBe(1);
    });

    it("handles CSV parse errors gracefully", () => {
      const result = importHollyAlerts("invalid,csv\nwith,unclosed,quote\"");

      expect(result.total_parsed).toBe(0);
      expect(result.inserted).toBe(0);
      expect(result.skipped).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("CSV parse error");
    });

    it("skips rows with missing symbols and tracks errors", () => {
      const csv = makeCSV(
        "Time,Symbol,Price",
        [
          "2024-03-15 09:45:00,AAPL,170.50",
          "2024-03-15 10:00:00,,800.00",
          "2024-03-15 10:15:00,MSFT,350.00",
        ]
      );
      mockBulkInsert.mockReturnValueOnce({ inserted: 2, skipped: 0 });
      const result = importHollyAlerts(csv);

      expect(result.total_parsed).toBe(3);
      expect(result.inserted).toBe(2);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("Row 2: missing symbol");
    });

    it("logs symbols in import result", () => {
      mockBulkInsert.mockReturnValueOnce({ inserted: 3, skipped: 0 });
      const csv = makeCSV(
        "Time,Symbol,Price",
        [
          "2024-03-15 09:45:00,AAPL,170.50",
          "2024-03-15 10:00:00,TSLA,800.00",
          "2024-03-15 10:15:00,AAPL,171.00",
        ]
      );
      importHollyAlerts(csv);

      const rows = mockBulkInsert.mock.calls[0][0];
      const symbols = rows.map((r: any) => r.symbol);
      expect(symbols).toContain("AAPL");
      expect(symbols).toContain("TSLA");
    });
  });
});
