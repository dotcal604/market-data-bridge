import { describe, it, expect } from "vitest";
import { computeATR } from "../atr.js";
import type { BarData } from "../../types.js";

describe("computeATR", () => {
  it("should return zeros when bars array has less than 2 bars", () => {
    expect(computeATR([], 100)).toEqual({ atr_14: 0, atr_pct: 0 });
    expect(computeATR([{ time: "2024-01-01", open: 100, high: 105, low: 95, close: 102, volume: 1000 }], 100)).toEqual({
      atr_14: 0,
      atr_pct: 0,
    });
  });

  it("should calculate ATR for 2 bars", () => {
    const bars: BarData[] = [
      { time: "2024-01-01", open: 100, high: 105, low: 95, close: 102, volume: 1000 },
      { time: "2024-01-02", open: 102, high: 108, low: 100, close: 106, volume: 1200 },
    ];
    // TR for bar 2 = max(108-100, |108-102|, |100-102|) = max(8, 6, 2) = 8
    // ATR = 8 / 1 = 8
    // ATR% = (8 / 106) * 100 = 7.55%
    const result = computeATR(bars, 106);
    expect(result.atr_14).toBe(8);
    expect(result.atr_pct).toBe(7.55);
  });

  it("should calculate ATR for normal bars", () => {
    const bars: BarData[] = [
      { time: "2024-01-01", open: 100, high: 105, low: 95, close: 102, volume: 1000 },
      { time: "2024-01-02", open: 102, high: 108, low: 100, close: 106, volume: 1200 },
      { time: "2024-01-03", open: 106, high: 110, low: 104, close: 108, volume: 1100 },
    ];
    // TR1 (bar 2) = max(108-100, |108-102|, |100-102|) = 8
    // TR2 (bar 3) = max(110-104, |110-106|, |104-106|) = 6
    // ATR = (8 + 6) / 2 = 7
    // ATR% = (7 / 108) * 100 = 6.48%
    const result = computeATR(bars, 108);
    expect(result.atr_14).toBe(7);
    expect(result.atr_pct).toBe(6.48);
  });

  it("should use last 14 TRs when more than 14 bars available", () => {
    const bars: BarData[] = [];
    for (let i = 0; i < 20; i++) {
      bars.push({
        time: `2024-01-${i + 1}`,
        open: 100,
        high: 110,
        low: 90,
        close: 100,
        volume: 1000,
      });
    }
    // Each TR = max(110-90, |110-100|, |90-100|) = 20
    // ATR = 20 (average of 14 bars with TR=20)
    const result = computeATR(bars, 100);
    expect(result.atr_14).toBe(20);
    expect(result.atr_pct).toBe(20);
  });

  it("should handle zero-range bars", () => {
    const bars: BarData[] = [
      { time: "2024-01-01", open: 100, high: 100, low: 100, close: 100, volume: 1000 },
      { time: "2024-01-02", open: 100, high: 100, low: 100, close: 100, volume: 1000 },
    ];
    // TR = max(0, 0, 0) = 0
    // ATR = 0
    const result = computeATR(bars, 100);
    expect(result.atr_14).toBe(0);
    expect(result.atr_pct).toBe(0);
  });

  it("should handle gaps between bars", () => {
    const bars: BarData[] = [
      { time: "2024-01-01", open: 100, high: 105, low: 95, close: 100, volume: 1000 },
      { time: "2024-01-02", open: 110, high: 115, low: 108, close: 112, volume: 1200 }, // Gap up
    ];
    // TR = max(115-108, |115-100|, |108-100|) = max(7, 15, 8) = 15
    const result = computeATR(bars, 112);
    expect(result.atr_14).toBe(15);
    expect(result.atr_pct).toBeCloseTo(13.39, 2);
  });

  it("should return 0 ATR% when last price is 0", () => {
    const bars: BarData[] = [
      { time: "2024-01-01", open: 100, high: 105, low: 95, close: 102, volume: 1000 },
      { time: "2024-01-02", open: 102, high: 108, low: 100, close: 106, volume: 1200 },
    ];
    const result = computeATR(bars, 0);
    expect(result.atr_14).toBe(8);
    expect(result.atr_pct).toBe(0);
  });

  it("should round results to 2 decimal places", () => {
    const bars: BarData[] = [
      { time: "2024-01-01", open: 100, high: 105, low: 95, close: 102, volume: 1000 },
      { time: "2024-01-02", open: 102, high: 107.77, low: 100.11, close: 105.55, volume: 1200 },
    ];
    // TR = max(107.77-100.11, |107.77-102|, |100.11-102|) = max(7.66, 5.77, 1.89) = 7.66
    const result = computeATR(bars, 105.55);
    expect(result.atr_14).toBe(7.66);
    expect(result.atr_pct).toBeCloseTo(7.26, 2);
  });

  it("should handle large volatility spikes", () => {
    const bars: BarData[] = [
      { time: "2024-01-01", open: 100, high: 105, low: 95, close: 100, volume: 1000 },
      { time: "2024-01-02", open: 100, high: 150, low: 50, close: 120, volume: 5000 }, // Extreme volatility
    ];
    // TR = max(150-50, |150-100|, |50-100|) = 100
    const result = computeATR(bars, 120);
    expect(result.atr_14).toBe(100);
    expect(result.atr_pct).toBeCloseTo(83.33, 2);
  });
});
