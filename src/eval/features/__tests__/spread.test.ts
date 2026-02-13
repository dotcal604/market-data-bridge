import { describe, it, expect } from "vitest";
import { computeSpreadPct } from "../spread.js";

describe("computeSpreadPct", () => {
  it("should return 0 when bid is null", () => {
    const result = computeSpreadPct(null, 101, 100);
    expect(result).toBe(0);
  });

  it("should return 0 when ask is null", () => {
    const result = computeSpreadPct(99, null, 100);
    expect(result).toBe(0);
  });

  it("should return 0 when last price is 0 or negative", () => {
    expect(computeSpreadPct(99, 101, 0)).toBe(0);
    expect(computeSpreadPct(99, 101, -10)).toBe(0);
  });

  it("should return 0 when bid is 0 or negative", () => {
    expect(computeSpreadPct(0, 101, 100)).toBe(0);
    expect(computeSpreadPct(-1, 101, 100)).toBe(0);
  });

  it("should return 0 when ask is 0 or negative", () => {
    expect(computeSpreadPct(99, 0, 100)).toBe(0);
    expect(computeSpreadPct(99, -1, 100)).toBe(0);
  });

  it("should calculate tight spread correctly", () => {
    // Bid: 99.50, Ask: 100.50, Last: 100
    // Spread = (100.50 - 99.50) / 100 * 100 = 1%
    const result = computeSpreadPct(99.5, 100.5, 100);
    expect(result).toBe(1);
  });

  it("should calculate wide spread correctly", () => {
    // Bid: 95, Ask: 105, Last: 100
    // Spread = (105 - 95) / 100 * 100 = 10%
    const result = computeSpreadPct(95, 105, 100);
    expect(result).toBe(10);
  });

  it("should return 0 when bid equals ask", () => {
    // Locked market: bid = ask = 100
    const result = computeSpreadPct(100, 100, 100);
    expect(result).toBe(0);
  });

  it("should handle negative spread (crossed market) when bid > ask", () => {
    // Crossed market: bid = 101, ask = 99
    // Spread = (99 - 101) / 100 * 100 = -2%
    const result = computeSpreadPct(101, 99, 100);
    expect(result).toBe(-2);
  });

  it("should handle penny stocks with tight absolute spreads", () => {
    // Penny stock: Bid: 0.99, Ask: 1.01, Last: 1.00
    // Spread = (1.01 - 0.99) / 1.00 * 100 = 2%
    const result = computeSpreadPct(0.99, 1.01, 1.0);
    expect(result).toBeCloseTo(2, 5);
  });

  it("should handle high-priced stocks", () => {
    // High price: Bid: 1990, Ask: 2010, Last: 2000
    // Spread = (2010 - 1990) / 2000 * 100 = 1%
    const result = computeSpreadPct(1990, 2010, 2000);
    expect(result).toBe(1);
  });

  it("should handle very tight spreads with precision", () => {
    // Very tight: Bid: 99.99, Ask: 100.01, Last: 100
    // Spread = (100.01 - 99.99) / 100 * 100 = 0.02%
    const result = computeSpreadPct(99.99, 100.01, 100);
    expect(result).toBeCloseTo(0.02, 2);
  });
});
