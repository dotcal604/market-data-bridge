import { describe, expect, it } from "vitest";
import { classifyRSI, computeRSI } from "../rsi.js";

describe("computeRSI", () => {
  it("returns null when there are fewer than period + 1 closes", () => {
    expect(computeRSI([100, 101, 102], 14)).toBeNull();
  });

  it("returns null for non-positive period", () => {
    expect(computeRSI([100, 101, 102], 0)).toBeNull();
    expect(computeRSI([100, 101, 102], -5)).toBeNull();
  });

  it("returns 100 when all price changes are gains", () => {
    const closes = Array.from({ length: 20 }, (_, i) => 100 + i);
    expect(computeRSI(closes, 14)).toBe(100);
  });

  it("returns 0 when all price changes are losses", () => {
    const closes = Array.from({ length: 20 }, (_, i) => 120 - i);
    expect(computeRSI(closes, 14)).toBe(0);
  });

  it("returns 50 for flat prices (no gains and no losses)", () => {
    const closes = Array.from({ length: 20 }, () => 100);
    expect(computeRSI(closes, 14)).toBe(50);
  });

  it("matches known Wilder RSI reference value for the classic 14-period example", () => {
    const closes = [
      44.34, 44.09, 44.15, 43.61, 44.33,
      44.83, 45.1, 45.42, 45.84, 46.08,
      45.89, 46.03, 45.61, 46.28, 46.28,
    ];
    expect(computeRSI(closes, 14)).toBeCloseTo(70.46, 2);
  });

  it("handles alternating gains/losses around equilibrium", () => {
    const closes = [
      100, 101, 100, 101, 100,
      101, 100, 101, 100, 101,
      100, 101, 100, 101, 100,
      101,
    ];
    expect(computeRSI(closes, 14)).toBeCloseTo(53.57, 2);
  });

  it("supports short custom period", () => {
    const closes = [10, 11, 12, 11, 10, 9, 10, 11, 12, 13, 14];
    const rsi = computeRSI(closes, 5);
    expect(rsi).not.toBeNull();
    expect(rsi!).toBeGreaterThan(0);
    expect(rsi!).toBeLessThan(100);
  });

  it("returns bounded values between 0 and 100 for noisy data", () => {
    const closes = [
      101, 103, 99, 104, 102,
      106, 98, 95, 97, 99,
      101, 100, 102, 104, 103,
      105, 101, 99, 100, 102,
    ];
    const rsi = computeRSI(closes, 14);
    expect(rsi).not.toBeNull();
    expect(rsi!).toBeGreaterThanOrEqual(0);
    expect(rsi!).toBeLessThanOrEqual(100);
  });
});

describe("classifyRSI", () => {
  it("classifies oversold below 30", () => {
    expect(classifyRSI(29.9)).toBe("oversold");
  });

  it("classifies neutral at and above 30 until 70", () => {
    expect(classifyRSI(30)).toBe("neutral");
    expect(classifyRSI(30.1)).toBe("neutral");
    expect(classifyRSI(69.9)).toBe("neutral");
    expect(classifyRSI(70)).toBe("neutral");
  });

  it("classifies overbought above 70", () => {
    expect(classifyRSI(70.1)).toBe("overbought");
  });

  it("classifies extreme values correctly", () => {
    expect(classifyRSI(0)).toBe("oversold");
    expect(classifyRSI(100)).toBe("overbought");
  });
});
