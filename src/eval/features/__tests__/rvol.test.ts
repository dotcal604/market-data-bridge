import { describe, it, expect } from "vitest";
import { computeRVOL } from "../rvol.js";
import type { BarData } from "../../types.js";

describe("computeRVOL", () => {
  it("should return 0 when current volume is 0", () => {
    const dailyBars: BarData[] = [
      { time: "2024-01-01", open: 100, high: 105, low: 95, close: 102, volume: 1000000 },
      { time: "2024-01-02", open: 102, high: 108, low: 100, close: 105, volume: 1200000 },
    ];
    const result = computeRVOL(0, dailyBars);
    expect(result).toBe(0);
  });

  it("should return 0 when daily bars array is empty", () => {
    const result = computeRVOL(1000000, []);
    expect(result).toBe(0);
  });

  it("should return 1.0 when volume equals average", () => {
    const dailyBars: BarData[] = [
      { time: "2024-01-01", open: 100, high: 105, low: 95, close: 102, volume: 1000000 },
      { time: "2024-01-02", open: 102, high: 108, low: 100, close: 105, volume: 1000000 },
    ];
    const avgVolume = 1000000;
    const result = computeRVOL(avgVolume, dailyBars);
    expect(result).toBe(1.0);
  });

  it("should return 5.0 when volume is 5x average", () => {
    const dailyBars: BarData[] = [
      { time: "2024-01-01", open: 100, high: 105, low: 95, close: 102, volume: 1000000 },
      { time: "2024-01-02", open: 102, high: 108, low: 100, close: 105, volume: 1000000 },
    ];
    const avgVolume = 1000000;
    const result = computeRVOL(5 * avgVolume, dailyBars);
    expect(result).toBe(5.0);
  });

  it("should use only last 20 bars for average calculation", () => {
    const dailyBars: BarData[] = [];
    for (let i = 0; i < 30; i++) {
      dailyBars.push({
        time: `2024-01-${i + 1}`,
        open: 100,
        high: 105,
        low: 95,
        close: 102,
        volume: i < 10 ? 500000 : 1000000, // First 10 have lower volume
      });
    }
    // Average of last 20 should be 1000000
    const result = computeRVOL(2000000, dailyBars);
    expect(result).toBe(2.0);
  });

  it("should return 0 when average volume is 0", () => {
    const dailyBars: BarData[] = [
      { time: "2024-01-01", open: 100, high: 105, low: 95, close: 102, volume: 0 },
      { time: "2024-01-02", open: 102, high: 108, low: 100, close: 105, volume: 0 },
    ];
    const result = computeRVOL(1000000, dailyBars);
    expect(result).toBe(0);
  });

  it("should handle negative current volume", () => {
    const dailyBars: BarData[] = [
      { time: "2024-01-01", open: 100, high: 105, low: 95, close: 102, volume: 1000000 },
    ];
    const result = computeRVOL(-1000, dailyBars);
    expect(result).toBe(0);
  });

  it("should round to 2 decimal places", () => {
    const dailyBars: BarData[] = [
      { time: "2024-01-01", open: 100, high: 105, low: 95, close: 102, volume: 1000000 },
    ];
    const result = computeRVOL(1234567, dailyBars);
    expect(result).toBe(1.23); // 1.234567 rounded to 1.23
  });
});
