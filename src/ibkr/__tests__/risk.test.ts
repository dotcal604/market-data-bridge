import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { calculatePositionSize } from "../risk.js";
import * as account from "../account.js";

// Mock the account module
vi.mock("../account.js", () => ({
  getAccountSummary: vi.fn(),
}));

// Mock the database module — return empty rows so RISK_CONFIG_DEFAULTS apply
// (max_position_pct=0.50, volatility_scalar=1.0)
vi.mock("../../db/database.js", () => ({
  getRiskConfigRows: vi.fn().mockReturnValue([]),
}));

/**
 * With the tuned risk config wired in, four constraints now compete:
 *   byRisk, byCapital, byMargin, byConfig
 *
 * byConfig = floor(netLiq * max_position_pct / entryPrice)
 *          = floor(50000 * 0.50 / 200)  = 125  (at $200)
 *
 * After binding constraint, regime scaling applies:
 *   default regime = "normal" → regimeScalar = 0.75
 *   default volatility_scalar = 1.0
 *   combined = 0.75
 *   recommendedShares = floor(binding.shares * 0.75)
 *
 * To test individual constraints in isolation, pass volatilityRegime: "low"
 * (scalar 1.0, no reduction) where regime scaling would obscure the test.
 */
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
    it("should calculate position size with byRisk as binding constraint", async () => {
      const result = await calculatePositionSize({
        symbol: "AAPL",
        entryPrice: 200,
        stopPrice: 195,
        riskPercent: 1.0,
        maxCapitalPercent: 50.0,
        volatilityRegime: "low", // scalar=1.0, no reduction
      });

      // byRisk  = floor(500 / 5) = 100  ← binding
      // byCap   = floor(50000*50%/200) = 125
      // byMargin= floor(45000/(200*0.25)) = 900
      // byConfig= floor(50000*0.50/200) = 125
      expect(result.sizing.byRisk).toBe(100);
      expect(result.sizing.byCapital).toBe(125);
      expect(result.sizing.byConfig).toBe(125);
      expect(result.sizing.binding).toBe("byRisk");
      expect(result.recommendedShares).toBe(100); // low regime, no scaling
      expect(result.riskPerShare).toBe(5);
      expect(result.regime).toBe("low");
      expect(result.volatilityScalar).toBe(1.0);
    });

    it("should apply normal regime scaling (0.75x) by default", async () => {
      const result = await calculatePositionSize({
        symbol: "AAPL",
        entryPrice: 200,
        stopPrice: 195,
        riskPercent: 1.0,
        maxCapitalPercent: 50.0,
        // no volatilityRegime → defaults to "normal" (0.75)
      });

      // byRisk = 100 (binding), then floor(100 * 0.75) = 75
      expect(result.sizing.byConfig).toBe(125);
      expect(result.sizing.binding).toBe("byRisk");
      expect(result.recommendedShares).toBe(75);
      expect(result.regime).toBe("normal");
      expect(result.volatilityScalar).toBe(0.75);
    });

    it("should calculate position size based on capital constraint", async () => {
      // Use a cheap stock so byConfig is large and byCapital wins
      const result = await calculatePositionSize({
        symbol: "PENNY",
        entryPrice: 5,
        stopPrice: 4.99,
        riskPercent: 5.0,
        maxCapitalPercent: 2.0, // very restrictive capital cap
        volatilityRegime: "low",
      });

      // byRisk   = floor((50000*5%)/0.01) = 250000000 (huge)
      // byCap    = floor(50000*2%/5) = 200  ← binding
      // byConfig = floor(50000*0.50/5) = 5000
      // byMargin = floor(45000/(5*0.25)) = 36000
      expect(result.sizing.byCapital).toBe(200);
      expect(result.sizing.binding).toBe("byCapital");
      expect(result.recommendedShares).toBe(200);
    });

    it("should calculate position size based on margin constraint", async () => {
      vi.mocked(account.getAccountSummary).mockResolvedValue({
        ...mockAccountSummary,
        availableFunds: 100, // Very limited funds
      });

      const result = await calculatePositionSize({
        symbol: "AAPL",
        entryPrice: 200,
        stopPrice: 195,
        riskPercent: 5.0,
        maxCapitalPercent: 50.0,
        volatilityRegime: "low",
      });

      // byMargin = floor(100/(200*0.25)) = 2  ← binding
      // byConfig = 12
      expect(result.sizing.byMargin).toBe(2);
      expect(result.sizing.binding).toBe("byMargin");
      expect(result.recommendedShares).toBe(2);
    });

    it("should use riskAmount override instead of riskPercent", async () => {
      // Use cheap stock so byConfig doesn't dominate
      const result = await calculatePositionSize({
        symbol: "XYZ",
        entryPrice: 10,
        stopPrice: 9,
        riskAmount: 50,
        maxCapitalPercent: 50.0,
        volatilityRegime: "low",
      });

      // byRisk  = floor(50 / 1) = 50
      // byCap   = floor(50000*50%/10) = 2500
      // byConfig= floor(50000*0.05/10) = 250
      // byMargin= floor(45000/(10*0.25)) = 18000
      // binding = byRisk = 50
      expect(result.sizing.byRisk).toBe(50);
      expect(result.sizing.binding).toBe("byRisk");
      expect(result.recommendedShares).toBe(50);
      expect(result.totalRisk).toBe(50);
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
      expect(result.regime).toBe("normal");
      expect(result.volatilityScalar).toBe(1);
      expect(result.sizing.byConfig).toBe(0);
      expect(result.warnings).toContain("Stop price equals entry price - no risk buffer defined");
    });

    it("should handle stopPrice > entryPrice (short position)", async () => {
      const result = await calculatePositionSize({
        symbol: "AAPL",
        entryPrice: 200,
        stopPrice: 205,
        riskPercent: 1.0,
        maxCapitalPercent: 50.0,
        volatilityRegime: "low",
      });

      // Risk per share = abs(200 - 205) = 5
      // byRisk = 100 (binding), byConfig = 125
      expect(result.riskPerShare).toBe(5);
      expect(result.sizing.byRisk).toBe(100);
      expect(result.sizing.binding).toBe("byRisk");
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
      ).rejects.toThrow("Risk percent must be a positive number between 0 (exclusive) and 100");

      await expect(
        calculatePositionSize({
          symbol: "AAPL",
          entryPrice: 200,
          stopPrice: 195,
          riskPercent: 101,
        })
      ).rejects.toThrow("Risk percent must be a positive number between 0 (exclusive) and 100");
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
        volatilityRegime: "low",
      });

      // Original shares by risk = (50000 * 2%) / 50 = 20
      // After 50% gap reduction = 10
      // byConfig = floor(50000*0.05/200) = 12 — NOT binding (10 < 12)
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
      expect(result.warnings).toContain("Stop price equals entry price - no risk buffer defined");
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

  describe("Regime Scaling", () => {
    it("should apply high-vol regime scaling (0.5x)", async () => {
      const result = await calculatePositionSize({
        symbol: "XYZ",
        entryPrice: 10,
        stopPrice: 9,
        riskPercent: 1.0,
        maxCapitalPercent: 50.0,
        volatilityRegime: "high",
      });

      // byRisk   = floor(500/1) = 500 ← binding
      // byConfig = floor(50000*0.50/10) = 2500
      // high regime: floor(500 * 0.5) = 250
      expect(result.sizing.binding).toBe("byRisk");
      expect(result.recommendedShares).toBe(250);
      expect(result.regime).toBe("high");
      expect(result.volatilityScalar).toBe(0.5);
    });

    it("should not scale in low-vol regime (1.0x)", async () => {
      const result = await calculatePositionSize({
        symbol: "XYZ",
        entryPrice: 10,
        stopPrice: 9,
        riskPercent: 1.0,
        maxCapitalPercent: 50.0,
        volatilityRegime: "low",
      });

      // byRisk   = floor(500/1) = 500 ← binding
      // byConfig = floor(50000*0.50/10) = 2500
      // low regime: scalar=1.0, no reduction
      expect(result.recommendedShares).toBe(500);
      expect(result.regime).toBe("low");
      expect(result.volatilityScalar).toBe(1.0);
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
      expect(result.sizing).toHaveProperty("byConfig");
      expect(result.sizing).toHaveProperty("binding");
      expect(result).toHaveProperty("regime");
      expect(result).toHaveProperty("volatilityScalar");
      expect(result).toHaveProperty("warnings");
      expect(result).toHaveProperty("netLiquidation");
      expect(Array.isArray(result.warnings)).toBe(true);
    });

    it("should calculate percentOfEquity correctly", async () => {
      // Use cheap stock so byConfig allows enough shares for meaningful equity%
      const result = await calculatePositionSize({
        symbol: "XYZ",
        entryPrice: 10,
        stopPrice: 9,
        riskPercent: 1.0,
        maxCapitalPercent: 50.0,
        volatilityRegime: "low",
      });

      // byRisk   = floor(500/1) = 500 (binding)
      // byConfig = floor(50000*0.50/10) = 2500
      // 500 shares * $10 = $5000
      // $5000 / $50000 = 10%
      expect(result.recommendedShares).toBe(500);
      expect(result.totalCapital).toBe(5000);
      expect(result.percentOfEquity).toBe(10);
    });
  });

  describe("Default Values", () => {
    it("should use default riskPercent of 1%", async () => {
      const result = await calculatePositionSize({
        symbol: "XYZ",
        entryPrice: 10,
        stopPrice: 9,
        maxCapitalPercent: 50.0,
        volatilityRegime: "low",
      });

      // Default risk = 1% of 50000 = 500
      // byRisk = floor(500/1) = 500 (binding)
      // byConfig = floor(50000*0.50/10) = 2500
      // totalRisk = 500 * 1 = 500
      expect(result.sizing.byRisk).toBe(500);
      expect(result.recommendedShares).toBe(500);
      expect(result.totalRisk).toBe(500);
    });

    it("should use default maxCapitalPercent of 10%", async () => {
      const result = await calculatePositionSize({
        symbol: "AAPL",
        entryPrice: 200,
        stopPrice: 199,
        riskPercent: 10.0, // High risk to make capital the constraint
        volatilityRegime: "low",
      });

      // Max capital = 10% of 50000 = 5000
      // Shares by capital = 5000 / 200 = 25  ← binding
      // byConfig = floor(50000*0.50/200) = 125
      expect(result.sizing.byCapital).toBe(25);
      expect(result.sizing.byConfig).toBe(125);
      // byCapital is binding at 25
      expect(result.sizing.binding).toBe("byCapital");
    });
  });
});
