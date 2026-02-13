import { describe, it, expect } from "vitest";
import { computeFloatRotation } from "../float-rotation.js";

describe("computeFloatRotation", () => {
  it("should return 0 when market cap is null", () => {
    const result = computeFloatRotation(1000000, null, 100);
    expect(result).toBe(0);
  });

  it("should return 0 when market cap is 0 or negative", () => {
    expect(computeFloatRotation(1000000, 0, 100)).toBe(0);
    expect(computeFloatRotation(1000000, -1000000, 100)).toBe(0);
  });

  it("should return 0 when last price is 0 or negative", () => {
    expect(computeFloatRotation(1000000, 1000000, 0)).toBe(0);
    expect(computeFloatRotation(1000000, 1000000, -10)).toBe(0);
  });

  it("should return 0 when volume is 0 or negative", () => {
    expect(computeFloatRotation(0, 1000000, 100)).toBe(0);
    expect(computeFloatRotation(-1000, 1000000, 100)).toBe(0);
  });

  it("should calculate normal float rotation", () => {
    // Market cap = $10M, price = $100
    // Shares outstanding = 10,000,000 / 100 = 100,000
    // Estimated float = 100,000 * 0.8 = 80,000
    // Volume = 40,000
    // Float rotation = 40,000 / 80,000 = 0.5 (50% of float traded)
    const result = computeFloatRotation(40000, 10000000, 100);
    expect(result).toBe(0.5);
  });

  it("should calculate high float rotation", () => {
    // Market cap = $10M, price = $100
    // Float = 80,000
    // Volume = 160,000 (2x float)
    // Float rotation = 160,000 / 80,000 = 2.0
    const result = computeFloatRotation(160000, 10000000, 100);
    expect(result).toBe(2.0);
  });

  it("should calculate low float rotation", () => {
    // Market cap = $10M, price = $100
    // Float = 80,000
    // Volume = 8,000 (10% of float)
    // Float rotation = 8,000 / 80,000 = 0.1
    const result = computeFloatRotation(8000, 10000000, 100);
    expect(result).toBe(0.1);
  });

  it("should use 80% of shares as estimated float", () => {
    // This tests that the formula uses 0.8 multiplier
    // Market cap = $1M, price = $10
    // Shares = 100,000
    // Float = 80,000
    // Volume = 80,000 (should equal 1.0 rotation)
    const result = computeFloatRotation(80000, 1000000, 10);
    expect(result).toBe(1.0);
  });

  it("should handle penny stocks", () => {
    // Market cap = $1M, price = $1
    // Shares = 1,000,000
    // Float = 800,000
    // Volume = 400,000
    // Float rotation = 400,000 / 800,000 = 0.5
    const result = computeFloatRotation(400000, 1000000, 1);
    expect(result).toBe(0.5);
  });

  it("should handle high-priced stocks", () => {
    // Market cap = $1B, price = $1000
    // Shares = 1,000,000
    // Float = 800,000
    // Volume = 100,000
    // Float rotation = 100,000 / 800,000 = 0.125
    const result = computeFloatRotation(100000, 1000000000, 1000);
    expect(result).toBe(0.125);
  });

  it("should round result to 3 decimal places", () => {
    // Market cap = $10M, price = $100
    // Float = 80,000
    // Volume = 33,333
    // Float rotation = 33,333 / 80,000 = 0.41666..., rounded to 0.417
    const result = computeFloatRotation(33333, 10000000, 100);
    expect(result).toBe(0.417);
  });

  it("should handle very high rotation (volume > float)", () => {
    // Market cap = $10M, price = $100
    // Float = 80,000
    // Volume = 800,000 (10x float)
    // Float rotation = 10.0
    const result = computeFloatRotation(800000, 10000000, 100);
    expect(result).toBe(10.0);
  });

  it("should handle small cap stocks", () => {
    // Market cap = $50M, price = $5
    // Shares = 10,000,000
    // Float = 8,000,000
    // Volume = 2,000,000
    // Float rotation = 2,000,000 / 8,000,000 = 0.25
    const result = computeFloatRotation(2000000, 50000000, 5);
    expect(result).toBe(0.25);
  });
});
