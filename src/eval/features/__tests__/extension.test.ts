import { describe, it, expect } from "vitest";
import { computePriceExtension } from "../extension.js";

describe("computePriceExtension", () => {
  it("should return 0 when ATR is 0 or negative", () => {
    expect(computePriceExtension(105, 100, 100, 0)).toBe(0);
    expect(computePriceExtension(105, 100, 100, -1)).toBe(0);
  });

  it("should return 0 when price equals both close and open", () => {
    // No extension from either reference point
    const result = computePriceExtension(100, 100, 100, 5);
    expect(result).toBe(0);
  });

  it("should calculate extension from previous close", () => {
    // Price at 110, prev close at 100, open at 100, ATR = 5
    // Distance from close = |110 - 100| = 10
    // Distance from open = |110 - 100| = 10
    // Max = 10, Extension = 10 / 5 = 2.0 ATR
    const result = computePriceExtension(110, 100, 100, 5);
    expect(result).toBe(2.0);
  });

  it("should calculate extension from open", () => {
    // Price at 115, prev close at 100, open at 105, ATR = 5
    // Distance from close = |115 - 100| = 15
    // Distance from open = |115 - 105| = 10
    // Max = 15, Extension = 15 / 5 = 3.0 ATR
    const result = computePriceExtension(115, 100, 105, 5);
    expect(result).toBe(3.0);
  });

  it("should use maximum of two distances", () => {
    // Price at 95, prev close at 100, open at 110, ATR = 5
    // Distance from close = |95 - 100| = 5
    // Distance from open = |95 - 110| = 15
    // Max = 15, Extension = 15 / 5 = 3.0 ATR
    const result = computePriceExtension(95, 100, 110, 5);
    expect(result).toBe(3.0);
  });

  it("should handle downward extension", () => {
    // Price at 90, prev close at 100, open at 100, ATR = 5
    // Distance = |90 - 100| = 10
    // Extension = 10 / 5 = 2.0 ATR
    const result = computePriceExtension(90, 100, 100, 5);
    expect(result).toBe(2.0);
  });

  it("should handle small extensions", () => {
    // Price at 101, prev close at 100, open at 100, ATR = 5
    // Distance = |101 - 100| = 1
    // Extension = 1 / 5 = 0.2 ATR
    const result = computePriceExtension(101, 100, 100, 5);
    expect(result).toBe(0.2);
  });

  it("should handle large extensions", () => {
    // Price at 150, prev close at 100, open at 100, ATR = 5
    // Distance = |150 - 100| = 50
    // Extension = 50 / 5 = 10.0 ATR
    const result = computePriceExtension(150, 100, 100, 5);
    expect(result).toBe(10.0);
  });

  it("should round result to 2 decimal places", () => {
    // Price at 103.33, prev close at 100, open at 100, ATR = 5
    // Distance = 3.33
    // Extension = 3.33 / 5 = 0.666, rounded to 0.67
    const result = computePriceExtension(103.33, 100, 100, 5);
    expect(result).toBe(0.67);
  });

  it("should handle gap scenarios", () => {
    // Gap up: price at 115, prev close at 100, open at 110, ATR = 5
    // Distance from close = 15, distance from open = 5
    // Max = 15, Extension = 15 / 5 = 3.0 ATR
    const result = computePriceExtension(115, 100, 110, 5);
    expect(result).toBe(3.0);
  });

  it("should handle gap down scenarios", () => {
    // Gap down: price at 85, prev close at 100, open at 90, ATR = 5
    // Distance from close = 15, distance from open = 5
    // Max = 15, Extension = 15 / 5 = 3.0 ATR
    const result = computePriceExtension(85, 100, 90, 5);
    expect(result).toBe(3.0);
  });

  it("should handle very small ATR", () => {
    // Price at 100.5, prev close at 100, open at 100, ATR = 0.1
    // Distance = 0.5
    // Extension = 0.5 / 0.1 = 5.0 ATR
    const result = computePriceExtension(100.5, 100, 100, 0.1);
    expect(result).toBe(5.0);
  });
});
