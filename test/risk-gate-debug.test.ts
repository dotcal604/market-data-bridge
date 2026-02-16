import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { checkRisk, resetSession, type RiskCheckParams } from "../src/ibkr/risk-gate.js";

describe("Risk Gate Debug", () => {
  let testStartTime = new Date("2025-01-06T15:00:00Z").getTime();

  beforeEach(() => {
    vi.useFakeTimers();
    testStartTime += 120_000;
    vi.setSystemTime(testStartTime);
    resetSession();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should allow orders at exactly max order size", () => {
    const params: RiskCheckParams = {
      symbol: "AAPL",
      action: "BUY",
      orderType: "LMT",
      totalQuantity: 1000, // Default max from env
      lmtPrice: 10,
      estimatedPrice: 10,
    };

    const result = checkRisk(params);
    
    console.log("Test time:", new Date().toISOString());
    console.log("Result:", result);
    
    if (!result.allowed) {
      console.error("REJECTED:", result.reason);
    }

    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("should allow normal market order with valid parameters", () => {
    const params: RiskCheckParams = {
      symbol: "AAPL",
      action: "BUY",
      orderType: "MKT",
      totalQuantity: 100,
      estimatedPrice: 150,
    };

    const result = checkRisk(params);
    
    console.log("Test time:", new Date().toISOString());
    console.log("Result:", result);
    
    if (!result.allowed) {
      console.error("REJECTED:", result.reason);
    }

    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });
});
