import { describe, it, expect } from "vitest";
import { detectFormat, detectFromRows } from "../detector.js";

describe("detectFormat — CSV", () => {
  it("detects TraderSync CSV from column headers", () => {
    const csv = [
      "Status,Symbol,Size,Open Date,Close Date,Open Time,Close Time,Entry Price,Exit Price,Return $,Return %,R-Multiple",
      "WIN,AAPL,100,Feb 12 2026,Feb 12 2026,09:35:00,10:15:00,185.50,187.20,170.00,0.92,1.5",
    ].join("\n");
    const result = detectFormat(csv);
    expect(result.format).toBe("tradersync");
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it("detects Holly alert CSV from column headers", () => {
    const csv = [
      "Entry Time,Symbol,Strategy,Entry Price,Stop Price,Shares,Last Price",
      "09:35:00,MSFT,Breakout,350.00,348.00,50,351.20",
    ].join("\n");
    const result = detectFormat(csv);
    expect(result.format).toBe("holly_alerts");
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it("detects Holly trade export from data pattern", () => {
    const csv = [
      'Entry Year,Entry Month,Entry Day,"Entry Time,Exit Year",Exit Month,Exit Day,"Exit Time,Symbol,Shares,..."',
      '2024,Mar,15,"09:35:00,2024",Mar,15,"10:15:00,AAPL,100,185.50,187.20,..."',
    ].join("\n");
    const result = detectFormat(csv);
    expect(result.format).toBe("holly_trades");
  });

  it("detects simple watchlist CSV", () => {
    const csv = "Symbol\nAAPL\nMSFT\nTSLA\nNVDA\n";
    const result = detectFormat(csv);
    expect(result.format).toBe("watchlist");
  });

  it("returns unknown for empty content", () => {
    expect(detectFormat("").format).toBe("unknown");
  });

  it("returns unknown for single-line file", () => {
    expect(detectFormat("just a header").format).toBe("unknown");
  });

  it("returns unknown for unrecognized CSV format", () => {
    const csv = "Name,Age,City,Country\nAlice,30,NYC,US\n";
    expect(detectFormat(csv).format).toBe("unknown");
  });
});

describe("detectFormat — JSON", () => {
  it("detects JSON watchlist (array of strings)", () => {
    const json = JSON.stringify(["AAPL", "MSFT", "TSLA"]);
    const result = detectFormat(json);
    expect(result.format).toBe("watchlist");
    expect(result.confidence).toBeGreaterThan(0.8);
    expect(result.parsedData).toHaveLength(3);
  });

  it("detects journal entries from JSON", () => {
    const json = JSON.stringify([
      { symbol: "AAPL", reasoning: "Breakout above resistance", setup_type: "breakout" },
    ]);
    const result = detectFormat(json);
    expect(result.format).toBe("journal");
  });

  it("detects eval outcomes from JSON", () => {
    const json = JSON.stringify([
      { evaluation_id: "abc123", trade_taken: true, r_multiple: 1.5, exit_reason: "target" },
    ]);
    const result = detectFormat(json);
    expect(result.format).toBe("eval_outcomes");
  });

  it("detects screener snapshots from JSON", () => {
    const json = JSON.stringify([
      { symbol: "AAPL", price: 185, change_pct: 2.5, volume: 50000000 },
    ]);
    const result = detectFormat(json);
    expect(result.format).toBe("screener_snapshot");
  });

  it("detects generic data with _type hint", () => {
    const json = JSON.stringify([
      { _type: "custom_signal", symbol: "AAPL", score: 85, source: "tradingview" },
    ]);
    const result = detectFormat(json);
    expect(result.format).toBe("generic");
  });

  it("returns unknown for invalid JSON", () => {
    expect(detectFormat("{invalid json").format).toBe("unknown");
  });

  it("returns unknown for empty JSON array", () => {
    expect(detectFormat("[]").format).toBe("unknown");
  });
});

describe("detectFromRows", () => {
  it("detects journal from pre-parsed rows", () => {
    const rows = [{ symbol: "AAPL", reasoning: "Test", tags: ["momentum"] }];
    expect(detectFromRows(rows).format).toBe("journal");
  });

  it("respects explicit _type hint", () => {
    const rows = [{ _type: "watchlist", symbol: "AAPL", extra: "data" }];
    expect(detectFromRows(rows).format).toBe("watchlist");
    expect(detectFromRows(rows).confidence).toBe(1);
  });

  it("detects TraderSync-style rows", () => {
    const rows = [{ symbol: "AAPL", entry_price: 185, exit_price: 187, open_date: "2026-02-12", side: "LONG" }];
    expect(detectFromRows(rows).format).toBe("tradersync_json");
  });

  it("falls back to generic for unknown structure", () => {
    const rows = [{ foo: 1, bar: "hello", baz: true, qux: 42, extra: "stuff" }];
    expect(detectFromRows(rows).format).toBe("generic");
  });

  it("returns unknown for empty rows", () => {
    expect(detectFromRows([]).format).toBe("unknown");
  });
});
