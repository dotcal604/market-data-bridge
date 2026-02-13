import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { calculatePositionSize } from "../risk.js";
import * as account from "../account.js";

// Mock the account module
vi.mock("../account.js", () => ({
  getAccountSummary: vi.fn(),
}));

describe("calculatePositionSize", () => {
  const mockAccountSummary = {
    account: "TEST123",
    netLiquidation: 50000,
    totalCashValue: 45000,
    settledCash: 40000,
    buyingPower: 100000,
    grossPositionValue: 5000,
    maintMarginReq: 1250,
    excessLiquidity: 48750,
    availableFunds: 45000,
    currency: "USD",
    timestamp: new Date().toISOString(),
  };

  beforeEach(() => {
    vi.mocked(account.getAccountSummary).mockResolvedValue(mockAccountSummary);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Basic Calculations", () => {
    it("should calculate position size based on risk constraint", async () => {
      const result = await calculatePositionSize({
        symbol: "AAPL",
        entryPrice: 200,
        stopPrice: 195,
        riskPercent: 1.0,
        maxCapitalPercent: 50.0, // High enough to not be limiting
      });

      // Risk budget = 50000 * 1% = 500
      // Risk per share = 200 - 195 = 5
      // Shares by risk = 500 / 5 = 100
      expect(result.recommendedShares).toBe(100);
      expect(result.riskPerShare).toBe(5);
      expect(result.totalRisk).toBe(500);
      expect(result.sizing.byRisk).toBe(100);
      expect(result.sizing.binding).toBe("byRisk");
    });

    it("should calculate position size based on capital constraint", async () => {
      const result = await calculatePositionSize({
        symbol: "AAPL",
        entryPrice: 200,
        stopPrice: 199,
        riskPercent: 5.0, // Very high risk tolerance
        maxCapitalPercent: 10.0,
      });

      // Capital budget = 50000 * 10% = 5000
      // Shares by capital = 5000 / 200 = 25
      expect(result.recommendedShares).toBe(25);
      expect(result.sizing.byCapital).toBe(25);
      expect(result.sizing.binding).toBe("byCapital");
    });

    it("should calculate position size based on margin constraint", async () => {
      vi.mocked(account.getAccountSummary).mockResolvedValue({
        ...mockAccountSummary,
        availableFunds: 1000, // Very limited funds
      });

      const result = await calculatePositionSize({
        symbol: "AAPL",
        entryPrice: 200,
        stopPrice: 195,
        riskPercent: 5.0,
        maxCapitalPercent: 50.0,
      });

      // Available funds = 1000
      // Margin = 200 * 0.25 = 50
      // Shares by margin = 1000 / 50 = 20
      expect(result.recommendedShares).toBe(20);
      expect(result.sizing.byMargin).toBe(20);
      expect(result.sizing.binding).toBe("byMargin");
    });

    it("should use riskAmount override instead of riskPercent", async () => {
      const result = await calculatePositionSize({
        symbol: "AAPL",
        entryPrice: 200,
        stopPrice: 195,
        riskPercent: 1.0, // Would give 100 shares
        riskAmount: 250, // Should override to 50 shares
        maxCapitalPercent: 50.0, // High enough to not be limiting
      });

      // Risk amount = 250
      // Risk per share = 5
      // Shares by risk = 250 / 5 = 50
      expect(result.recommendedShares).toBe(50);
      expect(result.sizing.byRisk).toBe(50);
      expect(result.totalRisk).toBe(250);
    });
  });

  describe("Edge Cases", () => {
    it("should handle stopPrice = entryPrice (zero risk per share)", async () => {
      const result = await calculatePositionSize({
        symbol: "AAPL",
        entryPrice: 200,
        stopPrice: 200,
      });

      expect(result.recommendedShares).toBe(0);
      expect(result.riskPerShare).toBe(0);
      expect(result.totalRisk).toBe(0);
      expect(result.warnings).toContain("Position too risky for current account size");
    });

    it("should handle stopPrice > entryPrice (short position)", async () => {
      const result = await calculatePositionSize({
        symbol: "AAPL",
        entryPrice: 200,
        stopPrice: 205,
        riskPercent: 1.0,
        maxCapitalPercent: 50.0, // High enough to not be limiting
      });

      // Risk per share = abs(200 - 205) = 5
      expect(result.riskPerShare).toBe(5);
      expect(result.recommendedShares).toBe(100);
    });

    it("should throw error for non-positive entry price", async () => {
      await expect(
        calculatePositionSize({
          symbol: "AAPL",
          entryPrice: 0,
          stopPrice: 195,
        })
      ).rejects.toThrow("Entry price must be positive");
    });

    it("should throw error for negative stop price", async () => {
      await expect(
        calculatePositionSize({
          symbol: "AAPL",
          entryPrice: 200,
          stopPrice: -5,
        })
      ).rejects.toThrow("Stop price must be non-negative");
    });

    it("should throw error for invalid risk percent", async () => {
      await expect(
        calculatePositionSize({
          symbol: "AAPL",
          entryPrice: 200,
          stopPrice: 195,
          riskPercent: 0,
        })
      ).rejects.toThrow("Risk percent must be between 0 and 100");

      await expect(
        calculatePositionSize({
          symbol: "AAPL",
          entryPrice: 200,
          stopPrice: 195,
          riskPercent: 101,
        })
      ).rejects.toThrow("Risk percent must be between 0 and 100");
    });

    it("should throw error for invalid max capital percent", async () => {
      await expect(
        calculatePositionSize({
          symbol: "AAPL",
          entryPrice: 200,
          stopPrice: 195,
          maxCapitalPercent: 0,
        })
      ).rejects.toThrow("Max capital percent must be between 0 and 100");
    });

    it("should throw error for zero net liquidation", async () => {
      vi.mocked(account.getAccountSummary).mockResolvedValue({
        ...mockAccountSummary,
        netLiquidation: 0,
      });

      await expect(
        calculatePositionSize({
          symbol: "AAPL",
          entryPrice: 200,
          stopPrice: 195,
        })
      ).rejects.toThrow("Net liquidation value must be positive");
    });
  });

  describe("Warning Generation", () => {
    it("should warn when gap > 20% and reduce size by 50%", async () => {
      const result = await calculatePositionSize({
        symbol: "AAPL",
        entryPrice: 200,
        stopPrice: 150, // 25% gap
        riskPercent: 2.0,
      });

      // Original shares by risk = (50000 * 2%) / 50 = 20
      // After 50% reduction = 10
      expect(result.sizing.byRisk).toBe(10);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain("Large gap detected");
      expect(result.warnings[0]).toContain("25.0%");
      expect(result.warnings[0]).toContain("reduced by 50%");
    });

    it("should warn when recommended shares = 0", async () => {
      const result = await calculatePositionSize({
        symbol: "AAPL",
        entryPrice: 200,
        stopPrice: 200,
      });

      expect(result.recommendedShares).toBe(0);
      expect(result.warnings).toContain("Position too risky for current account size");
    });

    it("should warn when available funds < entry price", async () => {
      vi.mocked(account.getAccountSummary).mockResolvedValue({
        ...mockAccountSummary,
        availableFunds: 100, // Less than entry price
      });

      const result = await calculatePositionSize({
        symbol: "AAPL",
        entryPrice: 200,
        stopPrice: 195,
      });

      expect(result.warnings).toContain("Insufficient available funds");
    });

    it("should not warn for gaps <= 20%", async () => {
      const result = await calculatePositionSize({
        symbol: "AAPL",
        entryPrice: 200,
        stopPrice: 165, // 17.5% gap
        riskPercent: 1.0,
      });

      const gapWarnings = result.warnings.filter(w => w.includes("Large gap"));
      expect(gapWarnings.length).toBe(0);
    });
  });

  describe("Response Structure", () => {
    it("should return complete response structure", async () => {
      const result = await calculatePositionSize({
        symbol: "AAPL",
        entryPrice: 195.00,
        stopPrice: 190.00,
        riskPercent: 1.0,
        maxCapitalPercent: 10,
      });

      expect(result).toHaveProperty("symbol");
      expect(result).toHaveProperty("recommendedShares");
      expect(result).toHaveProperty("riskPerShare");
      expect(result).toHaveProperty("totalRisk");
      expect(result).toHaveProperty("totalCapital");
      expect(result).toHaveProperty("percentOfEquity");
      expect(result).toHaveProperty("sizing");
      expect(result.sizing).toHaveProperty("byRisk");
      expect(result.sizing).toHaveProperty("byCapital");
      expect(result.sizing).toHaveProperty("byMargin");
      expect(result.sizing).toHaveProperty("binding");
      expect(result).toHaveProperty("warnings");
      expect(result).toHaveProperty("netLiquidation");
      expect(Array.isArray(result.warnings)).toBe(true);
    });

    it("should calculate percentOfEquity correctly", async () => {
      const result = await calculatePositionSize({
        symbol: "AAPL",
        entryPrice: 200,
        stopPrice: 195,
        riskPercent: 1.0,
        maxCapitalPercent: 50.0, // High enough to allow 100 shares
      });

      // 100 shares * $200 = $20,000
      // $20,000 / $50,000 = 40%
      expect(result.totalCapital).toBe(20000);
      expect(result.percentOfEquity).toBe(40);
    });
  });

  describe("Default Values", () => {
    it("should use default riskPercent of 1%", async () => {
      const result = await calculatePositionSize({
        symbol: "AAPL",
        entryPrice: 200,
        stopPrice: 195,
        maxCapitalPercent: 50.0, // High enough to not be limiting
      });

      // Default risk = 1% of 50000 = 500
      expect(result.totalRisk).toBe(500);
    });

    it("should use default maxCapitalPercent of 10%", async () => {
      const result = await calculatePositionSize({
        symbol: "AAPL",
        entryPrice: 200,
        stopPrice: 199,
        riskPercent: 10.0, // High risk to make capital the constraint
      });

      // Max capital = 10% of 50000 = 5000
      // Shares = 5000 / 200 = 25
      expect(result.sizing.byCapital).toBe(25);
    });
  });
});
