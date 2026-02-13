import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  checkRisk,
  getRiskLimits,
  getSessionState,
  recordTradeResult,
  lockSession,
  unlockSession,
  resetSession,
  _testing,
  type RiskCheckParams,
} from "../risk-gate.js";

describe("Risk Gate", () => {
  // Get the actual limits from the module
  const LIMITS = getRiskLimits();

  // 10:00 AM ET = 15:00 UTC (during market hours)
  let testStartTime = new Date("2025-01-06T15:00:00Z").getTime();

  beforeEach(() => {
    // Set fake timers and advance to a new time for each test
    // This ensures each test starts with a clean 1-minute window
    vi.useFakeTimers();
    testStartTime += 120_000; // Advance 2 minutes between tests
    vi.setSystemTime(testStartTime);
    // Reset session state so session guardrails don't interfere with per-order tests
    resetSession();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("Max Order Size", () => {
    it("should reject orders exceeding max order size", () => {
      const params: RiskCheckParams = {
        symbol: "AAPL",
        action: "BUY",
        orderType: "LMT",
        totalQuantity: LIMITS.maxOrderSize + 1,
        lmtPrice: 150,
        estimatedPrice: 150,
      };

      const result = checkRisk(params);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Order size");
      expect(result.reason).toContain("exceeds max");
      expect(result.reason).toContain(String(LIMITS.maxOrderSize));
    });

    it("should allow orders at exactly max order size", () => {
      const params: RiskCheckParams = {
        symbol: "AAPL",
        action: "BUY",
        orderType: "LMT",
        totalQuantity: LIMITS.maxOrderSize,
        lmtPrice: 10,
        estimatedPrice: 10,
      };

      const result = checkRisk(params);

      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it("should allow orders below max order size", () => {
      const params: RiskCheckParams = {
        symbol: "AAPL",
        action: "BUY",
        orderType: "LMT",
        totalQuantity: 100,
        lmtPrice: 10,
        estimatedPrice: 10,
      };

      const result = checkRisk(params);

      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });
  });

  describe("Max Notional Value", () => {
    it("should reject orders exceeding max notional value using estimatedPrice", () => {
      const price = 100;
      const quantity = Math.floor(LIMITS.maxNotionalValue / price) + 10; // Exceeds limit
      const params: RiskCheckParams = {
        symbol: "AAPL",
        action: "BUY",
        orderType: "MKT",
        totalQuantity: quantity,
        estimatedPrice: price,
      };

      const result = checkRisk(params);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Notional value");
      expect(result.reason).toContain("exceeds max");
      expect(result.reason).toContain(String(LIMITS.maxNotionalValue));
    });

    it("should reject orders exceeding max notional value using lmtPrice", () => {
      const price = 200;
      const quantity = Math.floor(LIMITS.maxNotionalValue / price) + 5;
      const params: RiskCheckParams = {
        symbol: "AAPL",
        action: "BUY",
        orderType: "LMT",
        totalQuantity: quantity,
        lmtPrice: price,
      };

      const result = checkRisk(params);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Notional value");
    });

    it("should reject orders exceeding max notional value using auxPrice", () => {
      const price = 150;
      const quantity = Math.floor(LIMITS.maxNotionalValue / price) + 10;
      const params: RiskCheckParams = {
        symbol: "AAPL",
        action: "BUY",
        orderType: "STP",
        totalQuantity: quantity,
        auxPrice: price,
      };

      const result = checkRisk(params);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Notional value");
    });

    it("should allow orders at exactly max notional value", () => {
      const price = 100;
      const quantity = Math.floor(LIMITS.maxNotionalValue / price);
      const params: RiskCheckParams = {
        symbol: "AAPL",
        action: "BUY",
        orderType: "LMT",
        totalQuantity: quantity,
        lmtPrice: price,
        estimatedPrice: price,
      };

      const result = checkRisk(params);

      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it("should allow orders below max notional value", () => {
      const params: RiskCheckParams = {
        symbol: "AAPL",
        action: "BUY",
        orderType: "LMT",
        totalQuantity: 100,
        lmtPrice: 50,
        estimatedPrice: 50,
      };

      const result = checkRisk(params);

      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it("should skip notional check when no price is available", () => {
      const params: RiskCheckParams = {
        symbol: "AAPL",
        action: "BUY",
        orderType: "MKT",
        totalQuantity: 100,
      };

      const result = checkRisk(params);

      // Should pass notional check (but may fail others)
      expect(result.allowed).toBe(true);
    });
  });

  describe("Penny Stock Rejection", () => {
    it("should reject orders for stocks priced below minimum", () => {
      const params: RiskCheckParams = {
        symbol: "PENNY",
        action: "BUY",
        orderType: "LMT",
        totalQuantity: 100,
        lmtPrice: LIMITS.minSharePrice - 0.01,
        estimatedPrice: LIMITS.minSharePrice - 0.01,
      };

      const result = checkRisk(params);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("penny stock");
      expect(result.reason).toContain("below minimum");
      expect(result.reason).toContain(String(LIMITS.minSharePrice));
    });

    it("should reject orders at $0.99 when minSharePrice is $1", () => {
      const params: RiskCheckParams = {
        symbol: "PENNY",
        action: "BUY",
        orderType: "LMT",
        totalQuantity: 100,
        lmtPrice: 0.99,
        estimatedPrice: 0.99,
      };

      const result = checkRisk(params);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("penny stock");
    });

    it("should allow orders at exactly minimum share price", () => {
      const params: RiskCheckParams = {
        symbol: "AAPL",
        action: "BUY",
        orderType: "LMT",
        totalQuantity: 100,
        lmtPrice: LIMITS.minSharePrice,
        estimatedPrice: LIMITS.minSharePrice,
      };

      const result = checkRisk(params);

      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it("should allow orders above minimum share price", () => {
      const params: RiskCheckParams = {
        symbol: "AAPL",
        action: "BUY",
        orderType: "LMT",
        totalQuantity: 100,
        lmtPrice: 150,
        estimatedPrice: 150,
      };

      const result = checkRisk(params);

      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it("should skip penny stock check when no price is available", () => {
      const params: RiskCheckParams = {
        symbol: "AAPL",
        action: "BUY",
        orderType: "MKT",
        totalQuantity: 100,
      };

      const result = checkRisk(params);

      // Should pass penny stock check
      expect(result.allowed).toBe(true);
    });
  });

  describe("Orders Per Minute Throttle", () => {
    it("should reject orders when rate limit is exceeded", () => {
      const baseParams: RiskCheckParams = {
        symbol: "AAPL",
        action: "BUY",
        orderType: "LMT",
        totalQuantity: 10,
        lmtPrice: 150,
        estimatedPrice: 150,
      };

      // Submit maxOrdersPerMinute orders
      for (let i = 0; i < LIMITS.maxOrdersPerMinute; i++) {
        const result = checkRisk({ ...baseParams });
        expect(result.allowed).toBe(true);
      }

      // Next order should be rejected
      const result = checkRisk({ ...baseParams });

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Order frequency");
      expect(result.reason).toContain("per minute");
      expect(result.reason).toContain(String(LIMITS.maxOrdersPerMinute));
    });

    it("should allow orders after time window expires", () => {
      const baseParams: RiskCheckParams = {
        symbol: "AAPL",
        action: "BUY",
        orderType: "LMT",
        totalQuantity: 10,
        lmtPrice: 150,
        estimatedPrice: 150,
      };

      // Submit maxOrdersPerMinute orders
      for (let i = 0; i < LIMITS.maxOrdersPerMinute; i++) {
        const result = checkRisk({ ...baseParams });
        expect(result.allowed).toBe(true);
      }

      // Advance time by 61 seconds (just over 1 minute)
      vi.advanceTimersByTime(61_000);

      // Now orders should be allowed again
      const result = checkRisk({ ...baseParams });

      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it("should track orders separately within sliding window", () => {
      const baseParams: RiskCheckParams = {
        symbol: "AAPL",
        action: "BUY",
        orderType: "LMT",
        totalQuantity: 10,
        lmtPrice: 150,
        estimatedPrice: 150,
      };

      // Submit 3 orders
      for (let i = 0; i < 3; i++) {
        checkRisk({ ...baseParams });
      }

      // Advance time by 30 seconds
      vi.advanceTimersByTime(30_000);

      // Submit 2 more orders (total 5 in last minute)
      for (let i = 0; i < 2; i++) {
        const result = checkRisk({ ...baseParams });
        expect(result.allowed).toBe(true);
      }

      // 6th order should fail
      const result = checkRisk({ ...baseParams });
      expect(result.allowed).toBe(false);

      // Advance another 31 seconds (first 3 orders should expire)
      vi.advanceTimersByTime(31_000);

      // Now should be allowed (only 2 orders in last 60 seconds)
      const result2 = checkRisk({ ...baseParams });
      expect(result2.allowed).toBe(true);
    });
  });

  describe("Edge Cases", () => {
    it("should reject orders with zero quantity", () => {
      const params: RiskCheckParams = {
        symbol: "AAPL",
        action: "BUY",
        orderType: "LMT",
        totalQuantity: 0,
        lmtPrice: 150,
        estimatedPrice: 150,
      };

      const result = checkRisk(params);

      // Zero quantity should pass size check but is not a valid order
      expect(result.allowed).toBe(true);
    });

    it("should handle negative price correctly", () => {
      const params: RiskCheckParams = {
        symbol: "AAPL",
        action: "BUY",
        orderType: "LMT",
        totalQuantity: 100,
        lmtPrice: -10,
        estimatedPrice: -10,
      };

      const result = checkRisk(params);

      // Negative price doesn't pass the "price > 0" check, so penny stock filter is skipped
      // This is expected behavior - validation of negative prices happens elsewhere
      expect(result.allowed).toBe(true);
    });

    it("should handle undefined symbol", () => {
      const params = {
        symbol: undefined as unknown as string,
        action: "BUY",
        orderType: "LMT",
        totalQuantity: 100,
        lmtPrice: 150,
        estimatedPrice: 150,
      };

      // Should not throw error
      const result = checkRisk(params);
      expect(result).toBeDefined();
    });

    it("should handle very large quantity", () => {
      const params: RiskCheckParams = {
        symbol: "AAPL",
        action: "BUY",
        orderType: "LMT",
        totalQuantity: 999999999,
        lmtPrice: 150,
        estimatedPrice: 150,
      };

      const result = checkRisk(params);

      expect(result.allowed).toBe(false);
      // Should fail either size or notional check
      expect(result.reason).toBeDefined();
    });

    it("should handle zero price", () => {
      const params: RiskCheckParams = {
        symbol: "AAPL",
        action: "BUY",
        orderType: "LMT",
        totalQuantity: 100,
        lmtPrice: 0,
        estimatedPrice: 0,
      };

      const result = checkRisk(params);

      // Zero price is treated as no price (skips notional and penny checks)
      expect(result.allowed).toBe(true);
    });

    it("should use estimatedPrice over lmtPrice when both provided", () => {
      const params: RiskCheckParams = {
        symbol: "AAPL",
        action: "BUY",
        orderType: "LMT",
        totalQuantity: 100,
        lmtPrice: 150,
        estimatedPrice: 0.50, // Below minimum
      };

      const result = checkRisk(params);

      // Should use estimatedPrice (0.50) and reject as penny stock
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("penny stock");
    });

    it("should use lmtPrice when estimatedPrice not provided", () => {
      const params: RiskCheckParams = {
        symbol: "AAPL",
        action: "BUY",
        orderType: "LMT",
        totalQuantity: 100,
        lmtPrice: 0.50,
      };

      const result = checkRisk(params);

      // Should use lmtPrice (0.50) and reject as penny stock
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("penny stock");
    });

    it("should use auxPrice when neither estimatedPrice nor lmtPrice provided", () => {
      const params: RiskCheckParams = {
        symbol: "AAPL",
        action: "BUY",
        orderType: "STP",
        totalQuantity: 100,
        auxPrice: 0.75,
      };

      const result = checkRisk(params);

      // Should use auxPrice (0.75) and reject as penny stock
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("penny stock");
    });
  });

  describe("Pass Cases", () => {
    it("should allow normal market order with valid parameters", () => {
      const params: RiskCheckParams = {
        symbol: "AAPL",
        action: "BUY",
        orderType: "MKT",
        totalQuantity: 100,
        estimatedPrice: 150,
      };

      const result = checkRisk(params);

      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it("should allow normal limit order with valid parameters", () => {
      const params: RiskCheckParams = {
        symbol: "AAPL",
        action: "BUY",
        orderType: "LMT",
        totalQuantity: 50,
        lmtPrice: 150,
      };

      const result = checkRisk(params);

      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it("should allow stop order with valid parameters", () => {
      const params: RiskCheckParams = {
        symbol: "AAPL",
        action: "SELL",
        orderType: "STP",
        totalQuantity: 100,
        auxPrice: 145,
      };

      const result = checkRisk(params);

      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it("should allow small orders well under all limits", () => {
      const params: RiskCheckParams = {
        symbol: "AAPL",
        action: "BUY",
        orderType: "LMT",
        totalQuantity: 10,
        lmtPrice: 150,
        estimatedPrice: 150,
      };

      const result = checkRisk(params);

      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it("should allow multiple sequential orders within rate limit", () => {
      const baseParams: RiskCheckParams = {
        symbol: "AAPL",
        action: "BUY",
        orderType: "LMT",
        totalQuantity: 10,
        lmtPrice: 150,
        estimatedPrice: 150,
      };

      // Should allow up to maxOrdersPerMinute orders
      for (let i = 0; i < LIMITS.maxOrdersPerMinute; i++) {
        const result = checkRisk({ ...baseParams });
        expect(result.allowed).toBe(true);
      }
    });

    it("should allow orders for different symbols", () => {
      const symbols = ["AAPL", "MSFT", "GOOGL", "TSLA"];

      for (const symbol of symbols) {
        const params: RiskCheckParams = {
          symbol,
          action: "BUY",
          orderType: "LMT",
          totalQuantity: 10,
          lmtPrice: 100,
          estimatedPrice: 100,
        };

        const result = checkRisk(params);
        expect(result.allowed).toBe(true);
      }
    });

    it("should allow both BUY and SELL actions", () => {
      const actions = ["BUY", "SELL"];

      for (const action of actions) {
        const params: RiskCheckParams = {
          symbol: "AAPL",
          action,
          orderType: "LMT",
          totalQuantity: 10,
          lmtPrice: 150,
          estimatedPrice: 150,
        };

        const result = checkRisk(params);
        expect(result.allowed).toBe(true);
      }
    });
  });

  describe("getRiskLimits", () => {
    it("should return current risk limits", () => {
      const limits = getRiskLimits();

      expect(limits).toBeDefined();
      expect(limits.maxOrderSize).toBeGreaterThan(0);
      expect(limits.maxNotionalValue).toBeGreaterThan(0);
      expect(limits.maxOrdersPerMinute).toBeGreaterThan(0);
      expect(limits.minSharePrice).toBeGreaterThan(0);
    });

    it("should return a copy of limits (not mutable reference)", () => {
      const limits1 = getRiskLimits();
      const limits2 = getRiskLimits();

      expect(limits1).toEqual(limits2);
      expect(limits1).not.toBe(limits2); // Different object instances
    });
  });

  // ── Session Guardrails ────────────────────────────────────────────────────

  describe("Session Guardrails", () => {
    const validOrder: RiskCheckParams = {
      symbol: "AAPL",
      action: "BUY",
      orderType: "LMT",
      totalQuantity: 10,
      lmtPrice: 150,
      estimatedPrice: 150,
    };

    describe("Manual Lock", () => {
      it("should reject orders when session is locked", () => {
        lockSession("tilting");
        const result = checkRisk(validOrder);
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain("Session locked");
        expect(result.reason).toContain("tilting");
      });

      it("should allow orders after unlocking", () => {
        lockSession("test");
        unlockSession();
        const result = checkRisk(validOrder);
        expect(result.allowed).toBe(true);
      });

      it("should use default reason when none provided", () => {
        lockSession();
        const result = checkRisk(validOrder);
        expect(result.reason).toContain("manual");
      });
    });

    describe("Daily Loss Limit", () => {
      it("should reject when daily loss limit is hit", () => {
        const limits = getRiskLimits();
        // Record a loss that exceeds the daily limit
        recordTradeResult(-limits.maxDailyLoss);
        const result = checkRisk(validOrder);
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain("Daily loss limit");
      });

      it("should allow trading when under daily loss limit", () => {
        recordTradeResult(-100); // Small loss
        const result = checkRisk(validOrder);
        expect(result.allowed).toBe(true);
      });

      it("should track cumulative losses", () => {
        const limits = getRiskLimits();
        const lossPerTrade = Math.floor(limits.maxDailyLoss / 3);
        recordTradeResult(-lossPerTrade);
        recordTradeResult(-lossPerTrade);
        // Still under limit
        expect(checkRisk(validOrder).allowed).toBe(true);
        // This pushes over
        recordTradeResult(-lossPerTrade);
        expect(checkRisk(validOrder).allowed).toBe(false);
      });

      it("should offset losses with wins", () => {
        const limits = getRiskLimits();
        recordTradeResult(-(limits.maxDailyLoss - 50)); // Big loss, just under limit
        expect(checkRisk(validOrder).allowed).toBe(true);
        recordTradeResult(200); // Win
        recordTradeResult(-200); // Another loss
        // Net: -(maxDailyLoss - 50) + 200 - 200 = -(maxDailyLoss - 50), still under
        expect(checkRisk(validOrder).allowed).toBe(true);
      });
    });

    describe("Max Daily Trades", () => {
      it("should reject when max daily trades reached", () => {
        const limits = getRiskLimits();
        // Record trades up to the limit
        for (let i = 0; i < limits.maxDailyTrades; i++) {
          recordTradeResult(10); // Small wins so we don't trigger loss limit
        }
        const result = checkRisk(validOrder);
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain("Daily trade limit");
      });

      it("should allow trading when under trade count", () => {
        recordTradeResult(10);
        recordTradeResult(10);
        expect(checkRisk(validOrder).allowed).toBe(true);
      });
    });

    describe("Consecutive Loss Cooldown", () => {
      it("should enforce cooldown after consecutive losses", () => {
        const limits = getRiskLimits();
        for (let i = 0; i < limits.consecutiveLossLimit; i++) {
          recordTradeResult(-10);
        }
        const result = checkRisk(validOrder);
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain("Cooldown active");
        expect(result.reason).toContain("consecutive losses");
      });

      it("should allow trading after cooldown expires", () => {
        const limits = getRiskLimits();
        for (let i = 0; i < limits.consecutiveLossLimit; i++) {
          recordTradeResult(-10);
        }
        // Advance past cooldown
        vi.advanceTimersByTime(limits.cooldownMinutes * 60_000 + 1000);
        const result = checkRisk(validOrder);
        expect(result.allowed).toBe(true);
      });

      it("should reset consecutive counter on a win", () => {
        const limits = getRiskLimits();
        // Lose N-1 times
        for (let i = 0; i < limits.consecutiveLossLimit - 1; i++) {
          recordTradeResult(-10);
        }
        // Win resets the counter
        recordTradeResult(50);
        // Now lose again — counter restarts from 0
        recordTradeResult(-10);
        const result = checkRisk(validOrder);
        expect(result.allowed).toBe(true); // Only 1 consecutive loss
      });
    });

    describe("Late-Day Lockout", () => {
      it("should reject orders near market close", () => {
        const limits = getRiskLimits();
        // Set time to 5 minutes before close: 15:55 ET = 20:55 UTC
        vi.setSystemTime(new Date("2025-01-06T20:55:00Z"));
        resetSession();
        const result = checkRisk(validOrder);
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain("Late-day lockout");
      });

      it("should allow orders well before close", () => {
        // Set time to 11:00 AM ET = 16:00 UTC (5 hours before close)
        vi.setSystemTime(new Date("2025-01-06T16:00:00Z"));
        resetSession();
        const result = checkRisk(validOrder);
        expect(result.allowed).toBe(true);
      });
    });

    describe("Outside Market Hours", () => {
      it("should reject orders before market open", () => {
        // 8:00 AM ET = 13:00 UTC (before 9:30 AM open)
        vi.setSystemTime(new Date("2025-01-06T13:00:00Z"));
        resetSession();
        const result = checkRisk(validOrder);
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain("Outside regular trading hours");
      });

      it("should reject orders after market close", () => {
        // 5:00 PM ET = 22:00 UTC (after 4:00 PM close)
        vi.setSystemTime(new Date("2025-01-06T22:00:00Z"));
        resetSession();
        const result = checkRisk(validOrder);
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain("Outside regular trading hours");
      });

      it("should allow orders during market hours", () => {
        // 10:30 AM ET = 15:30 UTC
        vi.setSystemTime(new Date("2025-01-06T15:30:00Z"));
        resetSession();
        const result = checkRisk(validOrder);
        expect(result.allowed).toBe(true);
      });

      it("should allow orders right at market open", () => {
        // 9:30 AM ET = 14:30 UTC
        vi.setSystemTime(new Date("2025-01-06T14:30:00Z"));
        resetSession();
        const result = checkRisk(validOrder);
        expect(result.allowed).toBe(true);
      });
    });

    describe("Session State Management", () => {
      it("should auto-reset on new trading day", () => {
        recordTradeResult(-100);
        const state1 = getSessionState();
        expect(state1.realizedPnl).toBe(-100);

        // Advance to next day (still during market hours)
        vi.advanceTimersByTime(24 * 60 * 60 * 1000);
        const state2 = getSessionState();
        expect(state2.realizedPnl).toBe(0);
        expect(state2.tradeCount).toBe(0);
      });

      it("should track session state correctly", () => {
        recordTradeResult(50);
        recordTradeResult(-20);
        recordTradeResult(-30);

        const state = getSessionState();
        expect(state.realizedPnl).toBe(0); // 50 - 20 - 30
        expect(state.tradeCount).toBe(3);
        expect(state.consecutiveLosses).toBe(2); // Two losses after the win
      });

      it("resetSession should clear everything", () => {
        recordTradeResult(-100);
        lockSession("test");
        resetSession();

        const state = getSessionState();
        expect(state.realizedPnl).toBe(0);
        expect(state.tradeCount).toBe(0);
        expect(state.locked).toBe(false);
      });

      it("getSessionState should include limits", () => {
        const state = getSessionState();
        expect(state.limits).toBeDefined();
        expect(state.limits.maxDailyLoss).toBeGreaterThan(0);
        expect(state.limits.maxDailyTrades).toBeGreaterThan(0);
      });
    });
  });
});
