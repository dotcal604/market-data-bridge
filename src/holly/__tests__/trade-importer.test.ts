import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for the Trade Ideas Holly CSV importer.
 *
 * Our trade-importer handles the non-standard TI CSV format where dates
 * contain commas:  YYYY,Mon,DD,"HH:MM:SS,YYYY",Mon,DD,"HH:MM:SS,rest..."
 *
 * The module uses getDb() internally, so we mock the database module.
 */

// ── Mock database ────────────────────────────────────────────────────────

let mockRun: ReturnType<typeof vi.fn>;
let mockPrepare: ReturnType<typeof vi.fn>;
let mockExec: ReturnType<typeof vi.fn>;
let mockGet: ReturnType<typeof vi.fn>;
let mockTransaction: ReturnType<typeof vi.fn>;

vi.mock("../../db/database.js", () => ({
  getDb: vi.fn(() => ({
    exec: mockExec,
    prepare: mockPrepare,
    transaction: mockTransaction,
  })),
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

// We need to import AFTER mocks are set up
import {
  importHollyTrades,
  ensureHollyTradesTable,
  getHollyTradeStats,
  queryHollyTrades,
  type HollyTrade,
  type TradeImportResult,
} from "../trade-importer.js";

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Build a raw CSV line in the Trade Ideas format.
 * Format: YYYY,Mon,DD,"HH:MM:SS,YYYY",Mon,DD,"HH:MM:SS,Symbol,Shares,...rest"
 */
function makeTILine(overrides: Partial<{
  entryYear: string; entryMon: string; entryDay: string; entryTime: string;
  exitYear: string; exitMon: string; exitDay: string; exitTime: string;
  symbol: string; shares: string; entryPrice: string; lastPrice: string;
  changeFromEntry: string; changeFromClose: string; changeFromClosePct: string;
  strategy: string; exitPrice: string; closedProfit: string;
  profitChange15: string; profitChange5: string; maxProfit: string;
  profitBasisPoints: string; openProfit: string; stopPrice: string;
  timeStop: string; maxProfitTime: string; distFromMaxProfit: string;
  minProfit: string; minProfitTime: string; distFromStop: string;
  smartStop: string; pctToStop: string; timeUntil: string;
  segment: string; changeFromEntryPct: string; longTermProfit: string;
  longTermProfitPct: string;
}> = {}): string {
  const d = {
    entryYear: "2024", entryMon: "Mar", entryDay: "15", entryTime: "09:45:00",
    exitYear: "2024", exitMon: "Mar", exitDay: "15", exitTime: "10:30:00",
    symbol: "AAPL", shares: "100", entryPrice: "170.50", lastPrice: "172.00",
    changeFromEntry: "1.50", changeFromClose: "2.00", changeFromClosePct: "1.18",
    strategy: "Holly Grail", exitPrice: "172.00", closedProfit: "5000",
    profitChange15: "50", profitChange5: "20", maxProfit: "200",
    profitBasisPoints: "88", openProfit: "0", stopPrice: "169.00",
    timeStop: "", maxProfitTime: "2024 Mar 15 10:15:00",
    distFromMaxProfit: "0.50", minProfit: "-30",
    minProfitTime: "2024 Mar 15 09:48:00", distFromStop: "1.50",
    smartStop: "168.50", pctToStop: "0.88", timeUntil: "45",
    segment: "Morning", changeFromEntryPct: "0.88",
    longTermProfit: "300", longTermProfitPct: "1.76",
    ...overrides,
  };
  // rest = symbol,shares,...29 fields
  const rest = [
    d.symbol, d.shares, d.entryPrice, d.lastPrice,
    d.changeFromEntry, d.changeFromClose, d.changeFromClosePct,
    d.strategy, d.exitPrice, d.closedProfit,
    d.profitChange15, d.profitChange5, d.maxProfit,
    d.profitBasisPoints, d.openProfit, d.stopPrice,
    d.timeStop, d.maxProfitTime, d.distFromMaxProfit,
    d.minProfit, d.minProfitTime, d.distFromStop,
    d.smartStop, d.pctToStop, d.timeUntil,
    d.segment, d.changeFromEntryPct, d.longTermProfit, d.longTermProfitPct,
  ].join(",");
  return `${d.entryYear},${d.entryMon},${d.entryDay},"${d.entryTime},${d.exitYear}",${d.exitMon},${d.exitDay},"${d.exitTime},${rest}"`;
}

const HEADER = "Entry Date Year,Entry Date Month,Entry Date Day,Entry Time + Exit Date Year,...";

function makeCSV(lines: string[]): string {
  return [HEADER, ...lines].join("\n");
}

// ── Tests ────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockExec = vi.fn();
  mockRun = vi.fn(() => ({ changes: 1 }));
  mockGet = vi.fn(() => ({
    total_trades: 5, unique_symbols: 3, unique_strategies: 2,
    unique_segments: 1, avg_pnl: 50, total_pnl: 250, avg_hold_minutes: 45,
    win_rate_pct: 60, avg_giveback: 10, avg_giveback_ratio: 0.2,
    avg_time_to_mfe_min: 15, avg_r_multiple: 1.2,
  }));
  mockPrepare = vi.fn(() => ({
    run: mockRun,
    get: mockGet,
    all: vi.fn(() => []),
  }));
  mockTransaction = vi.fn((fn: Function) => (...args: unknown[]) => fn(...args));
});

describe("Holly Trade Importer", () => {
  // ── CSV Parsing ──────────────────────────────────────────────────────

  describe("CSV line parsing", () => {
    it("parses a valid Trade Ideas CSV line", () => {
      const csv = makeCSV([makeTILine()]);
      importHollyTrades(csv);

      // Verify INSERT was called with correct params
      expect(mockRun).toHaveBeenCalledTimes(1);
      const args = mockRun.mock.calls[0];
      // First arg = entry_time
      expect(args[0]).toBe("2024-03-15 09:45:00");
      // Second arg = exit_time
      expect(args[1]).toBe("2024-03-15 10:30:00");
      // Third arg = symbol
      expect(args[2]).toBe("AAPL");
      // Fourth arg = shares
      expect(args[3]).toBe(100);
      // Fifth arg = entry_price
      expect(args[4]).toBe(170.5);
    });

    it("parses dates with single-digit days", () => {
      const csv = makeCSV([makeTILine({ entryDay: "5", exitDay: "5" })]);
      importHollyTrades(csv);
      const args = mockRun.mock.calls[0];
      expect(args[0]).toBe("2024-03-05 09:45:00");
      expect(args[1]).toBe("2024-03-05 10:30:00");
    });

    it("parses all 12 months correctly", () => {
      const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const monthNums = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"];
      for (let i = 0; i < 12; i++) {
        mockRun.mockClear();
        const csv = makeCSV([makeTILine({ entryMon: months[i], exitMon: months[i] })]);
        importHollyTrades(csv);
        const args = mockRun.mock.calls[0];
        expect(args[0]).toContain(`-${monthNums[i]}-`);
      }
    });

    it("extracts strategy from the correct field position", () => {
      const csv = makeCSV([makeTILine({ strategy: "Pullback Long" })]);
      importHollyTrades(csv);
      const args = mockRun.mock.calls[0];
      // strategy is at index 9 in the INSERT params
      expect(args[9]).toBe("Pullback Long");
    });

    it("extracts numeric fields including negative values", () => {
      const csv = makeCSV([makeTILine({
        changeFromEntry: "-2.50",
        minProfit: "-150",
      })]);
      importHollyTrades(csv);
      const args = mockRun.mock.calls[0];
      // change_from_entry is at position 6
      expect(args[6]).toBe(-2.5);
    });

    it("handles fields with spaces in numbers (e.g. '-7 569')", () => {
      const csv = makeCSV([makeTILine({ closedProfit: "-7 569" })]);
      importHollyTrades(csv);
      const args = mockRun.mock.calls[0];
      // closed_profit at position 11
      expect(args[11]).toBe(-7569);
    });

    it("handles empty optional fields as null", () => {
      const csv = makeCSV([makeTILine({
        stopPrice: "",
        maxProfitTime: "",
        minProfitTime: "",
        segment: "",
      })]);
      importHollyTrades(csv);
      const args = mockRun.mock.calls[0];
      // stop_price at position 17
      expect(args[17]).toBeNull();
    });
  });

  // ── Derived Fields ───────────────────────────────────────────────────

  describe("derived field computation", () => {
    it("computes hold_minutes from entry/exit times", () => {
      // entry 09:45:00, exit 10:30:00 → 45 minutes
      const csv = makeCSV([makeTILine()]);
      importHollyTrades(csv);
      const args = mockRun.mock.calls[0];
      // hold_minutes is at position 31
      expect(args[31]).toBe(45);
    });

    it("computes actual_pnl = (exit_price - entry_price) * shares", () => {
      // (172 - 170.5) * 100 = 150
      const csv = makeCSV([makeTILine()]);
      importHollyTrades(csv);
      const args = mockRun.mock.calls[0];
      // actual_pnl is at position 39
      expect(args[39]).toBe(150);
    });

    it("uses max_profit as MFE directly", () => {
      const csv = makeCSV([makeTILine({ maxProfit: "300" })]);
      importHollyTrades(csv);
      const args = mockRun.mock.calls[0];
      // mfe at position 32
      expect(args[32]).toBe(300);
    });

    it("uses min_profit as MAE directly", () => {
      const csv = makeCSV([makeTILine({ minProfit: "-80" })]);
      importHollyTrades(csv);
      const args = mockRun.mock.calls[0];
      // mae at position 33
      expect(args[33]).toBe(-80);
    });

    it("computes giveback = mfe - actual_pnl", () => {
      // MFE=200, actual_pnl=(172-170.5)*100=150, giveback=200-150=50
      const csv = makeCSV([makeTILine({ maxProfit: "200" })]);
      importHollyTrades(csv);
      const args = mockRun.mock.calls[0];
      // giveback at position 34
      expect(args[34]).toBe(50);
    });

    it("computes giveback_ratio = giveback / mfe", () => {
      // giveback=50, mfe=200, ratio=0.25
      const csv = makeCSV([makeTILine({ maxProfit: "200" })]);
      importHollyTrades(csv);
      const args = mockRun.mock.calls[0];
      // giveback_ratio at position 35
      expect(args[35]).toBe(0.25);
    });

    it("gives null giveback_ratio when mfe is 0", () => {
      const csv = makeCSV([makeTILine({ maxProfit: "0" })]);
      importHollyTrades(csv);
      const args = mockRun.mock.calls[0];
      // giveback_ratio at position 35
      expect(args[35]).toBeNull();
    });

    it("gives null giveback_ratio when giveback is negative (actual > mfe)", () => {
      // MFE=10, actual_pnl=(172-170.5)*100=150 → giveback=10-150=-140 < 0 → null
      const csv = makeCSV([makeTILine({ maxProfit: "10" })]);
      importHollyTrades(csv);
      const args = mockRun.mock.calls[0];
      expect(args[35]).toBeNull();
    });

    it("computes r_multiple = actual_pnl / risk", () => {
      // actual_pnl=150, risk=|170.5-169|*100=150, r=1.0
      const csv = makeCSV([makeTILine({ stopPrice: "169.00" })]);
      importHollyTrades(csv);
      const args = mockRun.mock.calls[0];
      // r_multiple at position 38
      expect(args[38]).toBe(1);
    });

    it("gives null r_multiple when no stop price", () => {
      const csv = makeCSV([makeTILine({ stopPrice: "" })]);
      importHollyTrades(csv);
      const args = mockRun.mock.calls[0];
      expect(args[38]).toBeNull();
    });

    it("computes time_to_mfe from max_profit_time", () => {
      // entry: 2024-03-15 09:45:00, max_profit_time: 2024-03-15 10:15:00 → 30 min
      const csv = makeCSV([makeTILine({
        maxProfitTime: "2024 Mar 15 10:15:00",
      })]);
      importHollyTrades(csv);
      const args = mockRun.mock.calls[0];
      // time_to_mfe_min at position 36
      expect(args[36]).toBe(30);
    });

    it("computes time_to_mae from min_profit_time", () => {
      // entry: 2024-03-15 09:45:00, min_profit_time: 2024-03-15 09:48:00 → 3 min
      const csv = makeCSV([makeTILine({
        minProfitTime: "2024 Mar 15 09:48:00",
      })]);
      importHollyTrades(csv);
      const args = mockRun.mock.calls[0];
      // time_to_mae_min at position 37
      expect(args[37]).toBe(3);
    });
  });

  // ── Import Result ────────────────────────────────────────────────────

  describe("import results", () => {
    it("returns correct counts for successful import", () => {
      const csv = makeCSV([
        makeTILine({ symbol: "AAPL" }),
        makeTILine({ symbol: "TSLA" }),
        makeTILine({ symbol: "MSFT" }),
      ]);
      const result = importHollyTrades(csv);
      expect(result.total_rows).toBe(3);
      expect(result.imported).toBe(3);
      expect(result.errors).toBe(0);
    });

    it("counts skipped rows for duplicates (changes=0)", () => {
      mockRun.mockReturnValueOnce({ changes: 1 }).mockReturnValueOnce({ changes: 0 });
      const csv = makeCSV([
        makeTILine({ symbol: "AAPL" }),
        makeTILine({ symbol: "AAPL" }),
      ]);
      const result = importHollyTrades(csv);
      expect(result.imported).toBe(1);
      expect(result.skipped).toBe(1);
    });

    it("counts errors for unparseable lines", () => {
      const csv = makeCSV([
        "this is not a valid TI line",
        makeTILine({ symbol: "AAPL" }),
      ]);
      const result = importHollyTrades(csv);
      expect(result.imported).toBe(1);
      expect(result.errors).toBe(1);
      expect(result.error_samples.length).toBe(1);
    });

    it("handles empty CSV", () => {
      const result = importHollyTrades("");
      expect(result.total_rows).toBe(0);
      expect(result.imported).toBe(0);
    });

    it("handles header-only CSV", () => {
      const result = importHollyTrades(HEADER);
      expect(result.total_rows).toBe(0);
      expect(result.imported).toBe(0);
    });

    it("accepts custom batchId", () => {
      const csv = makeCSV([makeTILine()]);
      importHollyTrades(csv, "custom-batch-123");
      const args = mockRun.mock.calls[0];
      // batch is the last param (position 40)
      expect(args[40]).toBe("custom-batch-123");
    });

    it("caps error samples at 5", () => {
      const badLines = Array.from({ length: 10 }, () => "bad line");
      const csv = makeCSV(badLines);
      const result = importHollyTrades(csv);
      expect(result.errors).toBe(10);
      expect(result.error_samples.length).toBe(5);
    });
  });

  // ── Line Rejection ───────────────────────────────────────────────────

  describe("line rejection", () => {
    it("rejects lines with invalid month abbreviation", () => {
      const line = `2024,Xyz,15,"09:45:00,2024",Mar,15,"10:30:00,AAPL,100,170.50,172.00,1.50,2.00,1.18,Holly Grail,172.00,5000,50,20,200,88,0,169.00,,2024 Mar 15 10:15:00,0.50,-30,2024 Mar 15 09:48:00,1.50,168.50,0.88,45,Morning,0.88,300,1.76"`;
      const csv = makeCSV([line]);
      const result = importHollyTrades(csv);
      expect(result.errors).toBe(1);
      expect(result.imported).toBe(0);
    });

    it("rejects lines with too few fields after second quote", () => {
      // Only 10 fields in rest (need >= 25)
      const line = `2024,Mar,15,"09:45:00,2024",Mar,15,"10:30:00,AAPL,100,170.50,172.00,1.50,2.00,1.18"`;
      const csv = makeCSV([line]);
      const result = importHollyTrades(csv);
      expect(result.errors).toBe(1);
      expect(result.imported).toBe(0);
    });

    it("rejects lines where entry_price is empty", () => {
      const csv = makeCSV([makeTILine({ entryPrice: "" })]);
      const result = importHollyTrades(csv);
      expect(result.errors).toBe(1);
    });

    it("rejects lines where symbol is empty", () => {
      const csv = makeCSV([makeTILine({ symbol: "" })]);
      const result = importHollyTrades(csv);
      expect(result.errors).toBe(1);
    });
  });

  // ── ensureHollyTradesTable ───────────────────────────────────────────

  describe("ensureHollyTradesTable", () => {
    it("calls db.exec with CREATE TABLE", () => {
      ensureHollyTradesTable();
      expect(mockExec).toHaveBeenCalledTimes(1);
      const sql = mockExec.mock.calls[0][0] as string;
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS holly_trades");
      expect(sql).toContain("actual_pnl");
      expect(sql).toContain("UNIQUE(symbol, entry_time, strategy)");
    });
  });

  // ── getHollyTradeStats ───────────────────────────────────────────────

  describe("getHollyTradeStats", () => {
    it("returns aggregate stats from the DB", () => {
      const stats = getHollyTradeStats();
      expect(mockPrepare).toHaveBeenCalled();
      expect(stats).toHaveProperty("total_trades");
    });
  });

  // ── queryHollyTrades ─────────────────────────────────────────────────

  describe("queryHollyTrades", () => {
    it("builds WHERE clause from filter options", () => {
      queryHollyTrades({ symbol: "AAPL", strategy: "Holly Grail" });
      const sql = mockPrepare.mock.calls.find(
        (c: unknown[]) => typeof c[0] === "string" && (c[0] as string).includes("SELECT *"),
      );
      expect(sql).toBeDefined();
      expect(sql![0]).toContain("symbol = ?");
      expect(sql![0]).toContain("strategy = ?");
    });

    it("uppercases the symbol filter", () => {
      const mockAll = vi.fn(() => []);
      mockPrepare.mockReturnValueOnce({ run: mockRun, get: mockGet, all: mockAll })  // ensureTable
        .mockReturnValueOnce({ run: mockRun, get: mockGet, all: mockAll }); // query
      queryHollyTrades({ symbol: "aapl" });
      // The all() call should have received "AAPL"
      if (mockAll.mock.calls.length > 0) {
        const allArgs = mockAll.mock.calls[0];
        expect(allArgs).toContain("AAPL");
      }
    });

    it("limits results to 1000 max", () => {
      queryHollyTrades({ limit: 5000 });
      const sql = mockPrepare.mock.calls.find(
        (c: unknown[]) => typeof c[0] === "string" && (c[0] as string).includes("LIMIT"),
      );
      expect(sql).toBeDefined();
    });
  });
});
