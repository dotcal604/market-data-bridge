import { describe, it, expect } from "vitest";
import { computeVWAPDeviation } from "../vwap.js";
import type { BarData } from "../../types.js";

describe("computeVWAPDeviation", () => {
  it("should return 0 when intraday bars array is empty", () => {
    const result = computeVWAPDeviation([], 100);
    expect(result).toBe(0);
  });

  it("should return 0 when last price is 0 or negative", () => {
    const bars: BarData[] = [
      { time: "09:30", open: 100, high: 102, low: 98, close: 101, volume: 1000 },
    ];
    expect(computeVWAPDeviation(bars, 0)).toBe(0);
    expect(computeVWAPDeviation(bars, -10)).toBe(0);
  });

  it("should return 0 when total volume is 0", () => {
    const bars: BarData[] = [
      { time: "09:30", open: 100, high: 102, low: 98, close: 101, volume: 0 },
      { time: "09:35", open: 101, high: 103, low: 99, close: 102, volume: 0 },
    ];
    const result = computeVWAPDeviation(bars, 100);
    expect(result).toBe(0);
  });

  it("should return 0 when price equals VWAP", () => {
    const bars: BarData[] = [
      { time: "09:30", open: 100, high: 102, low: 98, close: 100, volume: 1000 },
    ];
    // Typical price = (102 + 98 + 100) / 3 = 100
    // VWAP = 100 * 1000 / 1000 = 100
    const result = computeVWAPDeviation(bars, 100);
    expect(result).toBe(0);
  });

  it("should return positive deviation when price is above VWAP", () => {
    const bars: BarData[] = [
      { time: "09:30", open: 100, high: 102, low: 98, close: 100, volume: 1000 },
    ];
    // VWAP = 100, current price = 105
    // Deviation = ((105 - 100) / 100) * 100 = 5%
    const result = computeVWAPDeviation(bars, 105);
    expect(result).toBe(5);
  });

  it("should return negative deviation when price is below VWAP", () => {
    const bars: BarData[] = [
      { time: "09:30", open: 100, high: 102, low: 98, close: 100, volume: 1000 },
    ];
    // VWAP = 100, current price = 95
    // Deviation = ((95 - 100) / 100) * 100 = -5%
    const result = computeVWAPDeviation(bars, 95);
    expect(result).toBe(-5);
  });

  it("should calculate VWAP correctly with multiple bars", () => {
    const bars: BarData[] = [
      { time: "09:30", open: 100, high: 102, low: 98, close: 100, volume: 1000 },
      { time: "09:35", open: 100, high: 104, low: 96, close: 102, volume: 2000 },
      { time: "09:40", open: 102, high: 106, low: 100, close: 104, volume: 1000 },
    ];
    // Bar 1 typical: (102+98+100)/3 = 100, PV = 100000
    // Bar 2 typical: (104+96+102)/3 = 100.67, PV = 201333
    // Bar 3 typical: (106+100+104)/3 = 103.33, PV = 103333
    // Total PV = 404666, Total V = 4000
    // VWAP = 404666 / 4000 = 101.17
    // Price = 105, Deviation = (105 - 101.17) / 101.17 * 100 = 3.78%
    const result = computeVWAPDeviation(bars, 105);
    expect(result).toBeCloseTo(3.78, 1);
  });

  it("should round result to 2 decimal places", () => {
    const bars: BarData[] = [
      { time: "09:30", open: 100, high: 102, low: 98, close: 100, volume: 1000 },
    ];
    // VWAP = 100, price = 100.123
    // Deviation = 0.123%, should round to 0.12
    const result = computeVWAPDeviation(bars, 100.123);
    expect(result).toBe(0.12);
  });
});
