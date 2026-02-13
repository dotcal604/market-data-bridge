import { describe, it, expect } from "vitest";
import { computeGapPct } from "../gap.js";

describe("computeGapPct", () => {
  it("should return 0 when previous close is 0 or negative", () => {
    expect(computeGapPct(100, 0)).toBe(0);
    expect(computeGapPct(100, -10)).toBe(0);
  });

  it("should return 0 when there is no gap", () => {
    // Open = previous close, no gap
    const result = computeGapPct(100, 100);
    expect(result).toBe(0);
  });

  it("should calculate positive gap up correctly", () => {
    // Gap up: open at 105, prev close at 100
    // Gap = (105 - 100) / 100 * 100 = 5%
    const result = computeGapPct(105, 100);
    expect(result).toBe(5);
  });

  it("should calculate negative gap down correctly", () => {
    // Gap down: open at 95, prev close at 100
    // Gap = (95 - 100) / 100 * 100 = -5%
    const result = computeGapPct(95, 100);
    expect(result).toBe(-5);
  });

  it("should handle large gap up", () => {
    // Large gap up: open at 150, prev close at 100
    // Gap = (150 - 100) / 100 * 100 = 50%
    const result = computeGapPct(150, 100);
    expect(result).toBe(50);
  });

  it("should handle large gap down", () => {
    // Large gap down: open at 50, prev close at 100
    // Gap = (50 - 100) / 100 * 100 = -50%
    const result = computeGapPct(50, 100);
    expect(result).toBe(-50);
  });

  it("should handle small gaps with precision", () => {
    // Small gap: open at 100.25, prev close at 100
    // Gap = (100.25 - 100) / 100 * 100 = 0.25%
    const result = computeGapPct(100.25, 100);
    expect(result).toBe(0.25);
  });

  it("should handle penny stocks", () => {
    // Penny stock gap: open at 1.10, prev close at 1.00
    // Gap = (1.10 - 1.00) / 1.00 * 100 = 10%
    const result = computeGapPct(1.1, 1.0);
    expect(result).toBeCloseTo(10, 5);
  });

  it("should handle high-priced stocks", () => {
    // High price gap: open at 2020, prev close at 2000
    // Gap = (2020 - 2000) / 2000 * 100 = 1%
    const result = computeGapPct(2020, 2000);
    expect(result).toBe(1);
  });
});
