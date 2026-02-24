import { describe, it, expect } from "vitest";
import { detectFormat } from "../detector.js";

describe("detectFormat", () => {
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

  it("detects Holly alert CSV with alternate column names", () => {
    const csv = [
      "Alert Time,Ticker,Strategy,Price,Smart Stop,Size",
      "09:35:00,MSFT,Breakout,350.00,348.00,50",
    ].join("\n");
    const result = detectFormat(csv);
    expect(result.format).toBe("holly_alerts");
  });

  it("detects Holly trade export from data pattern", () => {
    const csv = [
      'Entry Year,Entry Month,Entry Day,"Entry Time,Exit Year",Exit Month,Exit Day,"Exit Time,Symbol,Shares,..."',
      '2024,Mar,15,"09:35:00,2024",Mar,15,"10:15:00,AAPL,100,185.50,187.20,..."',
    ].join("\n");
    const result = detectFormat(csv);
    expect(result.format).toBe("holly_trades");
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("returns unknown for empty content", () => {
    const result = detectFormat("");
    expect(result.format).toBe("unknown");
    expect(result.confidence).toBe(0);
  });

  it("returns unknown for single-line file", () => {
    const result = detectFormat("just a header");
    expect(result.format).toBe("unknown");
    expect(result.confidence).toBe(0);
  });

  it("returns unknown for unrecognized CSV format", () => {
    const csv = [
      "Name,Age,City,Country",
      "Alice,30,NYC,US",
    ].join("\n");
    const result = detectFormat(csv);
    expect(result.format).toBe("unknown");
  });

  it("handles quoted headers correctly", () => {
    const csv = [
      '"Status","Symbol","Size","Open Date","Close Date","Entry Price","Exit Price","R-Multiple"',
      '"WIN","AAPL","100","Feb 12 2026","Feb 12 2026","185.50","187.20","1.5"',
    ].join("\n");
    const result = detectFormat(csv);
    expect(result.format).toBe("tradersync");
  });
});
