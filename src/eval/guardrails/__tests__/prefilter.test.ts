import { describe, it, expect } from "vitest";
import { runPrefilters, type PrefilterResult } from "../prefilter.js";
import type { FeatureVector } from "../../features/types.js";

// Helper to create a mock FeatureVector
function createMockFeatures(overrides?: Partial<FeatureVector>): FeatureVector {
  return {
    symbol: "TEST",
    timestamp: "2024-01-15T10:30:00Z",
    last: 100.0,
    bid: 99.9,
    ask: 100.1,
    open: 99.5,
    high: 101.0,
    low: 99.0,
    close_prev: 98.0,
    volume: 50000,
    rvol: 1.5,
    vwap_deviation_pct: 0.5,
    spread_pct: 0.2,
    float_rotation_est: 0.01,
    volume_acceleration: 1.2,
    atr_14: 2.5,
    atr_pct: 2.5,
    price_extension_pct: 1.0,
    gap_pct: 2.04,
    range_position_pct: 50,
    volatility_regime: "normal",
    liquidity_bucket: "large",
    spy_change_pct: 0.5,
    qqq_change_pct: 0.6,
    market_alignment: "aligned_bull",
    time_of_day: "morning",
    minutes_since_open: 60,
    data_source: "yahoo",
    bridge_latency_ms: 100,
    ...overrides,
  };
}

describe("prefilter guardrails", () => {
  describe("runPrefilters", () => {
    it("should pass clean features with no warnings", () => {
      const features = createMockFeatures();
      const result = runPrefilters(features);

      expect(result.passed).toBe(true);
      expect(result.flags).toHaveLength(0);
    });

    // Hard failure tests - spread > 2%
    it("should hard fail when spread > 2% (extremely wide)", () => {
      const features = createMockFeatures({
        spread_pct: 2.5,
        liquidity_bucket: "small", // Use small cap to isolate the >2% rule
      });
      const result = runPrefilters(features);

      expect(result.passed).toBe(false);
      expect(result.flags).toHaveLength(1);
      expect(result.flags[0]).toContain("extremely wide");
      expect(result.flags[0]).toContain("2.50");
      expect(result.flags[0]).toContain("illiquid");
    });

    it("should not hard fail at exact 2.0% spread threshold", () => {
      const features = createMockFeatures({
        spread_pct: 2.0,
        liquidity_bucket: "small", // Use small cap to isolate the >2% rule
      });
      const result = runPrefilters(features);

      // Should NOT fail at exactly 2.0 (> 2.0 required)
      expect(result.passed).toBe(true);
      expect(result.flags).toHaveLength(0);
    });

    it("should hard fail at 2.01% spread (just over threshold)", () => {
      const features = createMockFeatures({
        spread_pct: 2.01,
        liquidity_bucket: "small", // Use small cap to isolate the >2% rule
      });
      const result = runPrefilters(features);

      expect(result.passed).toBe(false);
      expect(result.flags.some((f) => f.includes("extremely wide"))).toBe(true);
    });

    // Hard failure tests - premarket negligible volume
    it("should hard fail when premarket with negligible volume < 1000", () => {
      const features = createMockFeatures({
        time_of_day: "premarket",
        volume: 500,
      });
      const result = runPrefilters(features);

      expect(result.passed).toBe(false);
      expect(result.flags).toHaveLength(1);
      expect(result.flags[0]).toContain("negligible volume");
      expect(result.flags[0]).toContain("Premarket");
    });

    it("should hard fail when premarket with volume exactly 999", () => {
      const features = createMockFeatures({
        time_of_day: "premarket",
        volume: 999,
      });
      const result = runPrefilters(features);

      expect(result.passed).toBe(false);
      expect(result.flags[0]).toContain("negligible volume");
    });

    it("should pass when premarket with volume >= 1000", () => {
      const features = createMockFeatures({
        time_of_day: "premarket",
        volume: 1000,
      });
      const result = runPrefilters(features);

      expect(result.passed).toBe(true);
      expect(result.flags).toHaveLength(0);
    });

    it("should pass when premarket with high volume", () => {
      const features = createMockFeatures({
        time_of_day: "premarket",
        volume: 50000,
      });
      const result = runPrefilters(features);

      expect(result.passed).toBe(true);
      expect(result.flags).toHaveLength(0);
    });

    // Soft warning tests - large cap with spread > 0.8%
    it("should warn (soft fail) when large cap has spread > 0.8%", () => {
      const features = createMockFeatures({
        liquidity_bucket: "large",
        spread_pct: 1.0,
      });
      const result = runPrefilters(features);

      expect(result.passed).toBe(true); // Soft warning, not hard fail
      expect(result.flags).toHaveLength(1);
      expect(result.flags[0]).toContain("too wide for large cap");
      expect(result.flags[0]).toContain("1.00");
    });

    it("should not warn when large cap has spread <= 0.8%", () => {
      const features = createMockFeatures({
        liquidity_bucket: "large",
        spread_pct: 0.8,
      });
      const result = runPrefilters(features);

      expect(result.passed).toBe(true);
      expect(result.flags).toHaveLength(0);
    });

    it("should not warn when small cap has wide spread", () => {
      const features = createMockFeatures({
        liquidity_bucket: "small",
        spread_pct: 1.5,
      });
      const result = runPrefilters(features);

      // No large cap rule triggered, but also no hard fail (< 2%)
      expect(result.passed).toBe(true);
      expect(result.flags).toHaveLength(0);
    });

    // Soft warning tests - midday chop
    it("should warn when midday with low rvol < 1.2", () => {
      const features = createMockFeatures({
        time_of_day: "midday",
        rvol: 1.0,
      });
      const result = runPrefilters(features);

      expect(result.passed).toBe(true); // Soft warning
      expect(result.flags).toHaveLength(1);
      expect(result.flags[0]).toContain("Midday");
      expect(result.flags[0]).toContain("chop");
      expect(result.flags[0]).toContain("1");
    });

    it("should not warn when midday with rvol >= 1.2", () => {
      const features = createMockFeatures({
        time_of_day: "midday",
        rvol: 1.2,
      });
      const result = runPrefilters(features);

      expect(result.passed).toBe(true);
      expect(result.flags).toHaveLength(0);
    });

    it("should not warn when morning with low rvol", () => {
      const features = createMockFeatures({
        time_of_day: "morning",
        rvol: 0.8,
      });
      const result = runPrefilters(features);

      // Low rvol is only flagged during midday
      expect(result.passed).toBe(true);
      expect(result.flags).toHaveLength(0);
    });

    // Soft warning tests - extension mismatch
    it("should warn when price extension > 2.5 ATR with low rvol < 1.5", () => {
      const features = createMockFeatures({
        price_extension_pct: 3.0,
        rvol: 1.2,
      });
      const result = runPrefilters(features);

      expect(result.passed).toBe(true); // Soft warning
      expect(result.flags).toHaveLength(1);
      expect(result.flags[0]).toContain("Extended");
      expect(result.flags[0]).toContain("3");
      expect(result.flags[0]).toContain("ATR");
      expect(result.flags[0]).toContain("1.2");
    });

    it("should not warn when price extension > 2.5 ATR with high rvol >= 1.5", () => {
      const features = createMockFeatures({
        price_extension_pct: 3.0,
        rvol: 1.5,
      });
      const result = runPrefilters(features);

      expect(result.passed).toBe(true);
      expect(result.flags).toHaveLength(0);
    });

    it("should not warn when price extension <= 2.5 ATR even with low rvol", () => {
      const features = createMockFeatures({
        price_extension_pct: 2.5,
        rvol: 1.0,
      });
      const result = runPrefilters(features);

      expect(result.passed).toBe(true);
      expect(result.flags).toHaveLength(0);
    });

    // Multiple soft failures
    it("should collect multiple soft warnings but still pass", () => {
      const features = createMockFeatures({
        liquidity_bucket: "large",
        spread_pct: 1.0, // Soft warning: large cap wide spread
        time_of_day: "midday",
        rvol: 1.0, // Soft warning: midday chop
        price_extension_pct: 3.0, // Soft warning: extension mismatch
      });
      const result = runPrefilters(features);

      expect(result.passed).toBe(true); // All soft warnings
      expect(result.flags).toHaveLength(3);
      expect(result.flags.some((f) => f.includes("too wide for large cap"))).toBe(true);
      expect(result.flags.some((f) => f.includes("Midday"))).toBe(true);
      expect(result.flags.some((f) => f.includes("Extended"))).toBe(true);
    });

    // Mixed hard and soft failures
    it("should fail when one hard failure mixed with soft warnings", () => {
      const features = createMockFeatures({
        spread_pct: 2.5, // Hard fail: extremely wide + soft: large cap >0.8%
        time_of_day: "midday",
        rvol: 1.0, // Soft warning: midday chop
      });
      const result = runPrefilters(features);

      expect(result.passed).toBe(false); // Hard fail overrides soft warnings
      // 3 flags: large-cap wide spread (soft), extremely wide (hard), midday chop (soft)
      expect(result.flags).toHaveLength(3);
      expect(result.flags.some((f) => f.includes("extremely wide"))).toBe(true);
      expect(result.flags.some((f) => f.includes("Midday"))).toBe(true);
      expect(result.flags.some((f) => f.includes("too wide for large cap"))).toBe(true);
    });

    it("should fail when premarket negligible volume mixed with other warnings", () => {
      const features = createMockFeatures({
        time_of_day: "premarket",
        volume: 500, // Hard fail: negligible volume
        liquidity_bucket: "large",
        spread_pct: 1.0, // Soft warning: large cap wide spread
      });
      const result = runPrefilters(features);

      expect(result.passed).toBe(false); // Hard fail overrides soft warnings
      expect(result.flags).toHaveLength(2);
      expect(result.flags.some((f) => f.includes("negligible volume"))).toBe(true);
      expect(result.flags.some((f) => f.includes("too wide for large cap"))).toBe(true);
    });

    it("should fail when both hard failures present", () => {
      const features = createMockFeatures({
        spread_pct: 2.5, // Hard fail: extremely wide + soft: large cap >0.8%
        time_of_day: "premarket",
        volume: 800, // Hard fail: negligible volume
      });
      const result = runPrefilters(features);

      expect(result.passed).toBe(false);
      // 3 flags: large-cap wide spread (soft), extremely wide (hard), negligible volume (hard)
      expect(result.flags).toHaveLength(3);
      expect(result.flags.some((f) => f.includes("extremely wide"))).toBe(true);
      expect(result.flags.some((f) => f.includes("negligible volume"))).toBe(true);
      expect(result.flags.some((f) => f.includes("too wide for large cap"))).toBe(true);
    });

    // Edge cases
    it("should handle mid cap with wide spread (no large cap warning)", () => {
      const features = createMockFeatures({
        liquidity_bucket: "mid",
        spread_pct: 1.5,
      });
      const result = runPrefilters(features);

      // Mid cap doesn't trigger the large cap rule, and < 2% so no hard fail
      expect(result.passed).toBe(true);
      expect(result.flags).toHaveLength(0);
    });

    it("should handle regular session with low volume (no premarket check)", () => {
      const features = createMockFeatures({
        time_of_day: "morning",
        volume: 500,
      });
      const result = runPrefilters(features);

      // Low volume only matters in premarket
      expect(result.passed).toBe(true);
      expect(result.flags).toHaveLength(0);
    });

    it("should handle power_hour time slot correctly", () => {
      const features = createMockFeatures({
        time_of_day: "power_hour",
        rvol: 0.8,
      });
      const result = runPrefilters(features);

      // Low rvol is only flagged during midday
      expect(result.passed).toBe(true);
      expect(result.flags).toHaveLength(0);
    });

    it("should handle close time slot correctly", () => {
      const features = createMockFeatures({
        time_of_day: "close",
        rvol: 0.9,
      });
      const result = runPrefilters(features);

      // Low rvol is only flagged during midday
      expect(result.passed).toBe(true);
      expect(result.flags).toHaveLength(0);
    });

    it("should format decimal values correctly in flags", () => {
      const features = createMockFeatures({
        spread_pct: 2.456,
      });
      const result = runPrefilters(features);

      expect(result.passed).toBe(false);
      expect(result.flags[0]).toContain("2.46"); // Should be formatted to 2 decimal places
    });
  });
});
