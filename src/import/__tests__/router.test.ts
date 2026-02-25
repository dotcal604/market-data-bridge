import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies before importing
vi.mock("../../tradersync/importer.js", () => ({
  importTraderSyncCSV: vi.fn().mockReturnValue({
    batch_id: "abc123",
    total_parsed: 2,
    inserted: 2,
    skipped: 0,
    errors: [],
  }),
}));

vi.mock("../../holly/importer.js", () => ({
  importHollyAlerts: vi.fn().mockReturnValue({
    batch_id: "def456",
    total_parsed: 3,
    inserted: 3,
    skipped: 0,
    errors: [],
  }),
}));

vi.mock("../../holly/trade-importer.js", () => ({
  importHollyTrades: vi.fn().mockReturnValue({
    total_rows: 5,
    imported: 5,
    skipped: 0,
    errors: 0,
    error_samples: [],
  }),
}));

vi.mock("../history.js", () => ({
  insertImportRecord: vi.fn(),
  updateImportRecord: vi.fn(),
}));

vi.mock("../importers.js", () => ({
  importWatchlist: vi.fn().mockReturnValue({ inserted: 3, skipped: 0, errors: [] }),
  importSymbolList: vi.fn().mockReturnValue({ inserted: 5, skipped: 0, errors: [] }),
  importJournalEntries: vi.fn().mockReturnValue({ inserted: 2, skipped: 0, errors: [] }),
  importEvalOutcomes: vi.fn().mockReturnValue({ inserted: 1, skipped: 0, errors: [] }),
  importScreenerSnapshots: vi.fn().mockReturnValue({ inserted: 4, skipped: 0, errors: [] }),
  importGenericData: vi.fn().mockReturnValue({ inserted: 3, skipped: 0, errors: [] }),
}));

vi.mock("../tables.js", () => ({}));

vi.mock("../../logging.js", () => ({
  logger: {
    child: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

import { importFile, importRows } from "../router.js";
import { importTraderSyncCSV } from "../../tradersync/importer.js";
import { importHollyAlerts } from "../../holly/importer.js";
import { importJournalEntries } from "../importers.js";

describe("importFile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("routes TraderSync CSV to the TraderSync importer", () => {
    const csv = [
      "Status,Symbol,Size,Open Date,Close Date,Open Time,Close Time,Entry Price,Exit Price,Return $,Return %,R-Multiple",
      "WIN,AAPL,100,Feb 12 2026,Feb 12 2026,09:35:00,10:15:00,185.50,187.20,170.00,0.92,1.5",
    ].join("\n");

    const result = importFile(csv, "trade_data.csv");

    expect(result.format).toBe("tradersync");
    expect(result.inserted).toBe(2);
    expect(importTraderSyncCSV).toHaveBeenCalledWith(csv);
  });

  it("routes Holly alert CSV to the Holly importer", () => {
    const csv = [
      "Entry Time,Symbol,Strategy,Entry Price,Stop Price,Shares,Last Price",
      "09:35:00,MSFT,Breakout,350.00,348.00,50,351.20",
    ].join("\n");

    const result = importFile(csv, "alerts.csv");

    expect(result.format).toBe("holly_alerts");
    expect(result.inserted).toBe(3);
    expect(importHollyAlerts).toHaveBeenCalledWith(csv);
  });

  it("routes JSON journal entries", () => {
    const json = JSON.stringify([
      { symbol: "AAPL", reasoning: "Breakout above resistance", setup_type: "breakout" },
      { symbol: "MSFT", reasoning: "Gap and go pattern", tags: ["momentum"] },
    ]);

    const result = importFile(json, "journal.json");

    expect(result.format).toBe("journal");
    expect(result.inserted).toBe(2);
    expect(importJournalEntries).toHaveBeenCalled();
  });

  it("routes JSON watchlist (array of strings)", () => {
    const json = JSON.stringify(["AAPL", "MSFT", "TSLA", "NVDA"]);
    const result = importFile(json, "watchlist.json");
    expect(result.format).toBe("watchlist");
  });

  it("returns error for unknown format", () => {
    const csv = "Name,Age\nAlice,30\n";
    const result = importFile(csv, "random.csv");

    expect(result.format).toBe("unknown");
    expect(result.inserted).toBe(0);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("includes import_id, duration_ms, and source_format", () => {
    const csv = [
      "Status,Symbol,Size,Open Date,Close Date,Open Time,Close Time,Entry Price,Exit Price,Return $,Return %,R-Multiple",
      "WIN,AAPL,100,Feb 12 2026,Feb 12 2026,09:35:00,10:15:00,185.50,187.20,170.00,0.92,1.5",
    ].join("\n");

    const result = importFile(csv, "trade_data.csv");

    expect(result.import_id).toBeTruthy();
    expect(result.import_id.length).toBe(12);
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
    expect(result.source_format).toBeTruthy();
  });
});

describe("importRows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("imports pre-parsed rows with auto-detection", () => {
    const rows = [
      { symbol: "AAPL", reasoning: "Test entry", setup_type: "breakout" },
    ];
    const result = importRows(rows);
    expect(result.format).toBe("journal");
  });

  it("imports with explicit data_type override", () => {
    const rows = [
      { symbol: "AAPL", price: 150, custom_field: "test" },
    ];
    const result = importRows(rows, { dataType: "generic", source: "mcp" });
    expect(result.format).toBe("generic");
    expect(result.source_format).toBe("mcp");
  });
});
