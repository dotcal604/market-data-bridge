import { describe, expect, it } from "vitest";
import {
  computeCVaR,
  computeEdgeMetrics,
  computeRecoveryFactor,
  computeSkewness,
  computeUlcerIndex,
} from "../edge-metrics.js";

describe("edge-metrics", () => {
  const outcomes = [1, -0.5, 2, -1, 0.5];

  it("computes recovery factor for normal and edge cases", () => {
    expect(computeRecoveryFactor(outcomes)).toBeCloseTo(4, 6);
    expect(computeRecoveryFactor([1, 2, 3])).toBe(Number.POSITIVE_INFINITY);
    expect(computeRecoveryFactor([])).toBe(0);
  });

  it("computes CVaR for default and custom alpha", () => {
    expect(computeCVaR(outcomes)).toBe(-1);
    expect(computeCVaR(outcomes, 0.4)).toBeCloseTo(-0.75, 6);
    expect(computeCVaR([])).toBe(0);
  });

  it("computes skewness with stable zero-variance behavior", () => {
    expect(computeSkewness(outcomes)).toBeCloseTo(0.13802317, 6);
    expect(computeSkewness([1, 1, 1])).toBe(0);
    expect(computeSkewness([])).toBe(0);
  });

  it("computes ulcer index from drawdown profile", () => {
    expect(computeUlcerIndex(outcomes)).toBeCloseTo(0.3, 6);
    expect(computeUlcerIndex([1, 2, 3])).toBe(0);
    expect(computeUlcerIndex([])).toBe(0);
  });

  it("returns aggregated metrics from computeEdgeMetrics", () => {
    expect(computeEdgeMetrics(outcomes)).toEqual({
      recoveryFactor: 4,
      cvar: -1,
      skewness: expect.closeTo(0.13802317, 6),
      ulcerIndex: expect.closeTo(0.3, 6),
    });
  });
});
