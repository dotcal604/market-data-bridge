import { describe, it, expect } from "vitest";
import { classifyLiquidity } from "../liquidity.js";
import type { BarData } from "../../types.js";

describe("classifyLiquidity", () => {
  it("should return 'small' when daily bars array is empty", () => {
    const result = classifyLiquidity([], 100);
    expect(result).toBe("small");
  });

  it("should return 'small' when last price is 0 or negative", () => {
    const bars: BarData[] = [
      { time: "2024-01-01", open: 100, high: 105, low: 95, close: 102, volume: 1000000 },
    ];
    expect(classifyLiquidity(bars, 0)).toBe("small");
    expect(classifyLiquidity(bars, -10)).toBe("small");
  });

  it("should classify as 'small' for low dollar volume", () => {
    const bars: BarData[] = [];
    for (let i = 0; i < 30; i++) {
      bars.push({
        time: `2024-01-${i + 1}`,
        open: 10,
        high: 11,
        low: 9,
        close: 10,
        volume: 500000, // ~$5M daily
      });
    }
    // Average typical price = 10, average dollar volume = $5M
    const result = classifyLiquidity(bars, 10);
    expect(result).toBe("small");
  });

  it("should classify as 'mid' for medium dollar volume", () => {
    const bars: BarData[] = [];
    for (let i = 0; i < 30; i++) {
      bars.push({
        time: `2024-01-${i + 1}`,
        open: 50,
        high: 52,
        low: 48,
        close: 50,
        volume: 1000000, // ~$50M daily
      });
    }
    // Average typical price = 50, average dollar volume = $50M
    const result = classifyLiquidity(bars, 50);
    expect(result).toBe("mid");
  });

  it("should classify as 'large' for high dollar volume", () => {
    const bars: BarData[] = [];
    for (let i = 0; i < 30; i++) {
      bars.push({
        time: `2024-01-${i + 1}`,
        open: 100,
        high: 105,
        low: 95,
        close: 100,
        volume: 2000000, // ~$200M daily
      });
    }
    // Average typical price = 100, average dollar volume = $200M
    const result = classifyLiquidity(bars, 100);
    expect(result).toBe("large");
  });

  it("should use last 30 bars for calculation", () => {
    const bars: BarData[] = [];
    // First 20 bars with low volume
    for (let i = 0; i < 20; i++) {
      bars.push({
        time: `2024-01-${i + 1}`,
        open: 10,
        high: 11,
        low: 9,
        close: 10,
        volume: 100000, // $1M daily
      });
    }
    // Last 30 bars with high volume
    for (let i = 20; i < 50; i++) {
      bars.push({
        time: `2024-01-${i + 1}`,
        open: 100,
        high: 105,
        low: 95,
        close: 100,
        volume: 2000000, // $200M daily
      });
    }
    // Should only use last 30 bars (high volume), result = 'large'
    const result = classifyLiquidity(bars, 100);
    expect(result).toBe("large");
  });

  it("should handle boundary at $10M (small/mid)", () => {
    const bars: BarData[] = [];
    for (let i = 0; i < 30; i++) {
      bars.push({
        time: `2024-01-${i + 1}`,
        open: 10,
        high: 11,
        low: 9,
        close: 10,
        volume: 999999, // Just under $10M
      });
    }
    expect(classifyLiquidity(bars, 10)).toBe("small");

    const bars2: BarData[] = [];
    for (let i = 0; i < 30; i++) {
      bars2.push({
        time: `2024-01-${i + 1}`,
        open: 10,
        high: 11,
        low: 9,
        close: 10,
        volume: 1000001, // Just over $10M
      });
    }
    expect(classifyLiquidity(bars2, 10)).toBe("mid");
  });

  it("should handle boundary at $100M (mid/large)", () => {
    const bars: BarData[] = [];
    for (let i = 0; i < 30; i++) {
      bars.push({
        time: `2024-01-${i + 1}`,
        open: 100,
        high: 105,
        low: 95,
        close: 100,
        volume: 1000000, // $100M
      });
    }
    expect(classifyLiquidity(bars, 100)).toBe("mid");

    const bars2: BarData[] = [];
    for (let i = 0; i < 30; i++) {
      bars2.push({
        time: `2024-01-${i + 1}`,
        open: 100,
        high: 105,
        low: 95,
        close: 100,
        volume: 1000001, // Just over $100M
      });
    }
    expect(classifyLiquidity(bars2, 100)).toBe("large");
  });

  it("should calculate typical price as (high + low + close) / 3", () => {
    const bars: BarData[] = [];
    for (let i = 0; i < 30; i++) {
      bars.push({
        time: `2024-01-${i + 1}`,
        open: 90,
        high: 120,
        low: 60,
        close: 90,
        volume: 100000,
      });
    }
    // Typical price = (120 + 60 + 90) / 3 = 90
    // Dollar volume = 90 * 100000 = $9M
    const result = classifyLiquidity(bars, 100);
    expect(result).toBe("small");
  });

  it("should handle penny stocks", () => {
    const bars: BarData[] = [];
    for (let i = 0; i < 30; i++) {
      bars.push({
        time: `2024-01-${i + 1}`,
        open: 1,
        high: 1.1,
        low: 0.9,
        close: 1,
        volume: 50000000, // 50M shares, but only $50M dollar volume
      });
    }
    const result = classifyLiquidity(bars, 1);
    expect(result).toBe("mid");
  });

  it("should handle high-priced stocks", () => {
    const bars: BarData[] = [];
    for (let i = 0; i < 30; i++) {
      bars.push({
        time: `2024-01-${i + 1}`,
        open: 1000,
        high: 1050,
        low: 950,
        close: 1000,
        volume: 500000, // Only 500K shares, but $500M dollar volume
      });
    }
    const result = classifyLiquidity(bars, 1000);
    expect(result).toBe("large");
  });
});
