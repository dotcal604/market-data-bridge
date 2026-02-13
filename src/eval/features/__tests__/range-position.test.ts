import { describe, it, expect } from "vitest";
import { computeRangePositionPct } from "../range-position.js";

describe("computeRangePositionPct", () => {
  it("should return 50 when high equals low (no range)", () => {
    const result = computeRangePositionPct(100, 100, 100);
    expect(result).toBe(50);
  });

  it("should return 50 when range is negative (high < low)", () => {
    // Invalid data: high < low
    const result = computeRangePositionPct(100, 95, 100);
    expect(result).toBe(50);
  });

  it("should return 0 when price is at the low", () => {
    // Price at low: last = 95, high = 105, low = 95
    // Position = (95 - 95) / (105 - 95) * 100 = 0%
    const result = computeRangePositionPct(95, 105, 95);
    expect(result).toBe(0);
  });

  it("should return 100 when price is at the high", () => {
    // Price at high: last = 105, high = 105, low = 95
    // Position = (105 - 95) / (105 - 95) * 100 = 100%
    const result = computeRangePositionPct(105, 105, 95);
    expect(result).toBe(100);
  });

  it("should return 50 when price is at midpoint", () => {
    // Price at midpoint: last = 100, high = 110, low = 90
    // Position = (100 - 90) / (110 - 90) * 100 = 50%
    const result = computeRangePositionPct(100, 110, 90);
    expect(result).toBe(50);
  });

  it("should calculate 25th percentile correctly", () => {
    // Price at 25%: last = 95, high = 110, low = 90
    // Range = 20, price from low = 5
    // Position = 5 / 20 * 100 = 25%
    const result = computeRangePositionPct(95, 110, 90);
    expect(result).toBe(25);
  });

  it("should calculate 75th percentile correctly", () => {
    // Price at 75%: last = 105, high = 110, low = 90
    // Range = 20, price from low = 15
    // Position = 15 / 20 * 100 = 75%
    const result = computeRangePositionPct(105, 110, 90);
    expect(result).toBe(75);
  });

  it("should handle narrow range with precision", () => {
    // Narrow range: last = 100.05, high = 100.10, low = 100.00
    // Position = (100.05 - 100.00) / (100.10 - 100.00) * 100 = 50%
    const result = computeRangePositionPct(100.05, 100.1, 100.0);
    expect(result).toBe(50);
  });

  it("should handle price outside range (above high)", () => {
    // Price above high (possible with after-hours): last = 115, high = 110, low = 90
    // Position = (115 - 90) / (110 - 90) * 100 = 125%
    const result = computeRangePositionPct(115, 110, 90);
    expect(result).toBe(125);
  });

  it("should handle price outside range (below low)", () => {
    // Price below low (possible with after-hours): last = 85, high = 110, low = 90
    // Position = (85 - 90) / (110 - 90) * 100 = -25%
    const result = computeRangePositionPct(85, 110, 90);
    expect(result).toBe(-25);
  });
});
