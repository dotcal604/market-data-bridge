import { describe, it, expect } from "vitest";
import { calculateATR, calculateBeta } from "../portfolio.js";
import type { BarData } from "../../providers/yahoo.js";

describe("Portfolio Functions", () => {
  describe("calculateATR", () => {
    it("should calculate ATR correctly with sufficient data", () => {
      const bars: BarData[] = [
        { time: "2025-01-01", open: 100, high: 105, low: 98, close: 102, volume: 1000 },
        { time: "2025-01-02", open: 102, high: 108, low: 101, close: 107, volume: 1200 },
        { time: "2025-01-03", open: 107, high: 110, low: 105, close: 106, volume: 1100 },
        { time: "2025-01-04", open: 106, high: 109, low: 104, close: 108, volume: 1300 },
        { time: "2025-01-05", open: 108, high: 112, low: 107, close: 111, volume: 1400 },
      ];

      const atr = calculateATR(bars, 14);
      
      // ATR should be a positive number
      expect(atr).toBeGreaterThan(0);
      expect(typeof atr).toBe("number");
      expect(Number.isFinite(atr)).toBe(true);
    });

    it("should return 0 for empty bars", () => {
      const atr = calculateATR([], 14);
      expect(atr).toBe(0);
    });

    it("should return 0 for single bar", () => {
      const bars: BarData[] = [
        { time: "2025-01-01", open: 100, high: 105, low: 98, close: 102, volume: 1000 },
      ];
      const atr = calculateATR(bars, 14);
      expect(atr).toBe(0);
    });

    it("should handle custom period parameter", () => {
      const bars: BarData[] = [
        { time: "2025-01-01", open: 100, high: 105, low: 98, close: 102, volume: 1000 },
        { time: "2025-01-02", open: 102, high: 108, low: 101, close: 107, volume: 1200 },
        { time: "2025-01-03", open: 107, high: 110, low: 105, close: 106, volume: 1100 },
        { time: "2025-01-04", open: 106, high: 109, low: 104, close: 108, volume: 1300 },
        { time: "2025-01-05", open: 108, high: 112, low: 107, close: 111, volume: 1400 },
        { time: "2025-01-06", open: 111, high: 115, low: 110, close: 114, volume: 1500 },
        { time: "2025-01-07", open: 114, high: 118, low: 113, close: 117, volume: 1600 },
      ];

      const atr5 = calculateATR(bars, 5);
      const atr3 = calculateATR(bars, 3);
      
      // Both should be positive and finite
      expect(atr5).toBeGreaterThan(0);
      expect(atr3).toBeGreaterThan(0);
      expect(Number.isFinite(atr5)).toBe(true);
      expect(Number.isFinite(atr3)).toBe(true);
    });

    it("should calculate true range correctly including gaps", () => {
      // Create bars with a gap down
      const bars: BarData[] = [
        { time: "2025-01-01", open: 100, high: 105, low: 98, close: 102, volume: 1000 },
        { time: "2025-01-02", open: 90, high: 92, low: 88, close: 91, volume: 1200 }, // Gap down from 102 to 90
      ];

      const atr = calculateATR(bars, 14);
      
      // With the gap, true range should be higher than simple high-low
      expect(atr).toBeGreaterThan(0);
      // True range for bar 2 = max(92-88, |92-102|, |88-102|) = max(4, 10, 14) = 14
      expect(atr).toBe(14);
    });
  });

  describe("calculateBeta", () => {
    // Note: calculateBeta is async and makes network calls, so we'll test it only for basic behavior
    // Full integration testing would require mocking getHistoricalBars

    it("should return a number", async () => {
      // This test will make actual network calls in a real environment
      // In a production test suite, you'd want to mock getHistoricalBars
      
      // For now, just test that it returns a valid default on error
      const beta = await calculateBeta("INVALID_SYMBOL_12345", 20);
      
      // Should return default beta of 1.0 on error
      expect(typeof beta).toBe("number");
      expect(Number.isFinite(beta)).toBe(true);
    });

    it("should handle different day parameters", async () => {
      // Test with different day periods
      const beta10 = await calculateBeta("INVALID_SYMBOL_12345", 10);
      const beta20 = await calculateBeta("INVALID_SYMBOL_12345", 20);
      
      expect(typeof beta10).toBe("number");
      expect(typeof beta20).toBe("number");
      expect(Number.isFinite(beta10)).toBe(true);
      expect(Number.isFinite(beta20)).toBe(true);
    });
  });
});
