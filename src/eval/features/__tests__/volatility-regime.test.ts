import { describe, it, expect } from "vitest";
import { classifyVolatilityRegime } from "../volatility-regime.js";

describe("classifyVolatilityRegime", () => {
  it("should classify as 'low' when ATR% is below 2", () => {
    expect(classifyVolatilityRegime(0)).toBe("low");
    expect(classifyVolatilityRegime(0.5)).toBe("low");
    expect(classifyVolatilityRegime(1.0)).toBe("low");
    expect(classifyVolatilityRegime(1.5)).toBe("low");
    expect(classifyVolatilityRegime(1.99)).toBe("low");
  });

  it("should classify as 'normal' when ATR% is between 2 and 5", () => {
    expect(classifyVolatilityRegime(2)).toBe("normal");
    expect(classifyVolatilityRegime(2.5)).toBe("normal");
    expect(classifyVolatilityRegime(3.0)).toBe("normal");
    expect(classifyVolatilityRegime(4.0)).toBe("normal");
    expect(classifyVolatilityRegime(5.0)).toBe("normal");
  });

  it("should classify as 'high' when ATR% is above 5", () => {
    expect(classifyVolatilityRegime(5.01)).toBe("high");
    expect(classifyVolatilityRegime(6.0)).toBe("high");
    expect(classifyVolatilityRegime(10.0)).toBe("high");
    expect(classifyVolatilityRegime(20.0)).toBe("high");
    expect(classifyVolatilityRegime(50.0)).toBe("high");
  });

  it("should handle boundary at 2.0 (low/normal)", () => {
    expect(classifyVolatilityRegime(1.999)).toBe("low");
    expect(classifyVolatilityRegime(2.0)).toBe("normal");
    expect(classifyVolatilityRegime(2.001)).toBe("normal");
  });

  it("should handle boundary at 5.0 (normal/high)", () => {
    expect(classifyVolatilityRegime(4.999)).toBe("normal");
    expect(classifyVolatilityRegime(5.0)).toBe("normal");
    expect(classifyVolatilityRegime(5.001)).toBe("high");
  });

  it("should handle negative ATR% (edge case)", () => {
    // Although ATR% should never be negative in practice,
    // the function should handle it gracefully
    expect(classifyVolatilityRegime(-1)).toBe("low");
    expect(classifyVolatilityRegime(-10)).toBe("low");
  });

  it("should handle very low volatility", () => {
    expect(classifyVolatilityRegime(0.01)).toBe("low");
    expect(classifyVolatilityRegime(0.1)).toBe("low");
  });

  it("should handle extreme volatility", () => {
    expect(classifyVolatilityRegime(100)).toBe("high");
    expect(classifyVolatilityRegime(1000)).toBe("high");
  });

  it("should handle typical low volatility stock (1.5% ATR)", () => {
    expect(classifyVolatilityRegime(1.5)).toBe("low");
  });

  it("should handle typical normal volatility stock (3.5% ATR)", () => {
    expect(classifyVolatilityRegime(3.5)).toBe("normal");
  });

  it("should handle typical high volatility stock (8% ATR)", () => {
    expect(classifyVolatilityRegime(8)).toBe("high");
  });
});
