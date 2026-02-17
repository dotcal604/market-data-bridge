import { describe, it, expect } from "vitest";
import { extractStructuredReasoning, type StructuredReasoning } from "./extractor.js";

/**
 * Test suite for structured reasoning extractor
 * Tests: extractStructuredReasoning function
 * Requirements:
 * - Feature keyword matching (rvol, spread, vwap, atr, gap, float_rotation, time_of_day, market_alignment, liquidity, volatility_regime)
 * - Conviction inference: high (≥75), medium (≥45), low (<45) based on confidence score
 * - Direction inference: bullish/bearish/neutral from keyword matching
 * - Risk factor and uncertainty phrase extraction (3-80 char bounds)
 * - Edge cases: null/empty reasoning, no matching features, mixed bullish+bearish keywords
 * Min: 20 test cases
 */

describe("extractStructuredReasoning", () => {
  describe("Feature keyword matching", () => {
    it("should extract rvol feature", () => {
      const result = extractStructuredReasoning(
        "High rvol above 3x average",
        70,
        75
      );

      expect(result.key_drivers.length).toBeGreaterThanOrEqual(1);
      expect(result.key_drivers[0].feature).toBe("rvol");
      expect(result.key_drivers[0].weight).toBe(1.0); // First mentioned = primary
    });

    it("should extract relative volume as rvol", () => {
      const result = extractStructuredReasoning(
        "Relative volume indicates interest",
        60,
        65
      );

      expect(result.key_drivers.length).toBeGreaterThanOrEqual(1);
      expect(result.key_drivers[0].feature).toBe("rvol");
    });

    it("should extract spread feature", () => {
      const result = extractStructuredReasoning(
        "Tight spread on the ticker",
        70,
        75
      );

      expect(result.key_drivers.length).toBeGreaterThanOrEqual(1);
      expect(result.key_drivers[0].feature).toBe("spread_pct");
    });

    it("should extract vwap feature", () => {
      const result = extractStructuredReasoning(
        "Price holding above VWAP level",
        65,
        70
      );

      expect(result.key_drivers.length).toBeGreaterThanOrEqual(1);
      expect(result.key_drivers[0].feature).toBe("vwap_deviation_pct");
    });

    it("should extract atr feature", () => {
      const result = extractStructuredReasoning(
        "ATR expansion noted on the chart",
        60,
        65
      );

      expect(result.key_drivers.length).toBeGreaterThanOrEqual(1);
      expect(result.key_drivers[0].feature).toBe("atr_pct");
    });

    it("should extract gap feature", () => {
      const result = extractStructuredReasoning(
        "Large gap up this morning",
        75,
        80
      );

      expect(result.key_drivers.length).toBeGreaterThanOrEqual(1);
      expect(result.key_drivers[0].feature).toBe("gap_pct");
    });

    it("should extract float_rotation feature", () => {
      const result = extractStructuredReasoning(
        "Float rotation suggests institutional interest",
        70,
        75
      );

      expect(result.key_drivers).toHaveLength(1);
      expect(result.key_drivers[0].feature).toBe("float_rotation_est");
    });

    it("should extract time_of_day feature", () => {
      const result = extractStructuredReasoning(
        "Open drive pattern forming here",
        65,
        70
      );

      expect(result.key_drivers.length).toBeGreaterThanOrEqual(1);
      expect(result.key_drivers[0].feature).toBe("time_of_day");
    });

    it("should extract market_alignment with SPY mention", () => {
      const result = extractStructuredReasoning(
        "Strong alignment with SPY trend",
        70,
        75
      );

      expect(result.key_drivers).toHaveLength(1);
      expect(result.key_drivers[0].feature).toBe("market_alignment");
    });

    it("should extract market_alignment with QQQ mention", () => {
      const result = extractStructuredReasoning(
        "Following QQQ closely",
        70,
        75
      );

      expect(result.key_drivers).toHaveLength(1);
      expect(result.key_drivers[0].feature).toBe("market_alignment");
    });

    it("should extract liquidity feature", () => {
      const result = extractStructuredReasoning(
        "Good liquidity supports the move",
        65,
        70
      );

      expect(result.key_drivers).toHaveLength(1);
      expect(result.key_drivers[0].feature).toBe("liquidity_bucket");
    });

    it("should extract volatility_regime feature", () => {
      const result = extractStructuredReasoning(
        "High volatility regime requires wider stops",
        60,
        65
      );

      expect(result.key_drivers).toHaveLength(1);
      expect(result.key_drivers[0].feature).toBe("volatility_regime");
    });

    it("should extract multiple features with correct weights", () => {
      const result = extractStructuredReasoning(
        "High rvol with tight spread and VWAP deviation noted",
        70,
        75
      );

      // rvol (first match), volume (from "high" context), spread_pct, vwap_deviation_pct may all match
      // plus "support" keyword matches support feature. Use >= to handle regex overlaps.
      expect(result.key_drivers.length).toBeGreaterThanOrEqual(3);
      expect(result.key_drivers[0].feature).toBe("rvol");
      expect(result.key_drivers[0].weight).toBe(1.0); // First = primary
      // All subsequent features get 0.5
      for (let i = 1; i < result.key_drivers.length; i++) {
        expect(result.key_drivers[i].weight).toBe(0.5);
      }
    });

    it("should not duplicate features", () => {
      const result = extractStructuredReasoning(
        "High rvol and rvol acceleration above 3x",
        70,
        75
      );

      expect(result.key_drivers).toHaveLength(1);
      expect(result.key_drivers[0].feature).toBe("rvol");
    });
  });

  describe("Direction inference", () => {
    it("should infer bullish direction from strong keyword", () => {
      const result = extractStructuredReasoning(
        "Strong rvol with breakout momentum",
        70,
        75
      );

      expect(result.key_drivers[0].direction).toBe("bullish");
    });

    it("should infer bullish direction from support keyword", () => {
      const result = extractStructuredReasoning(
        "VWAP provides solid support level",
        65,
        70
      );

      expect(result.key_drivers[0].direction).toBe("bullish");
    });

    it("should infer bullish direction from buying pressure", () => {
      const result = extractStructuredReasoning(
        "Heavy buying pressure on gap",
        75,
        80
      );

      expect(result.key_drivers[0].direction).toBe("bullish");
    });

    it("should infer bearish direction from weak keyword", () => {
      const result = extractStructuredReasoning(
        "Weak rvol suggests fading interest",
        40,
        45
      );

      expect(result.key_drivers[0].direction).toBe("bearish");
    });

    it("should infer bearish direction from resistance keyword", () => {
      const result = extractStructuredReasoning(
        "Price hitting resistance at VWAP",
        40,
        45
      );

      expect(result.key_drivers[0].direction).toBe("bearish");
    });

    it("should infer bearish direction from overextended keyword", () => {
      const result = extractStructuredReasoning(
        "ATR shows overextended move, reversal risk",
        35,
        40
      );

      expect(result.key_drivers[0].direction).toBe("bearish");
    });

    it("should infer neutral direction when no keywords present", () => {
      const result = extractStructuredReasoning(
        "Standard rvol pattern observed",
        50,
        55
      );

      expect(result.key_drivers[0].direction).toBe("neutral");
    });

    it("should handle mixed bullish and bearish keywords - bullish takes precedence", () => {
      const result = extractStructuredReasoning(
        "Strong momentum but facing resistance overhead",
        60,
        65
      );

      // Bullish is checked first, so it takes precedence
      expect(result.key_drivers[0].direction).toBe("bullish");
    });
  });

  describe("Conviction inference", () => {
    it("should return high conviction when confidence >= 75", () => {
      const result = extractStructuredReasoning(
        "Clear setup with high rvol",
        75,
        80
      );

      expect(result.conviction).toBe("high");
    });

    it("should return high conviction when confidence = 90", () => {
      const result = extractStructuredReasoning(
        "Perfect setup conditions",
        90,
        95
      );

      expect(result.conviction).toBe("high");
    });

    it("should return medium conviction when confidence >= 45 and < 75", () => {
      const result = extractStructuredReasoning(
        "Decent setup with some concerns",
        50,
        55
      );

      expect(result.conviction).toBe("medium");
    });

    it("should return medium conviction when confidence = 45 (boundary)", () => {
      const result = extractStructuredReasoning(
        "Marginal setup",
        45,
        50
      );

      expect(result.conviction).toBe("medium");
    });

    it("should return low conviction when confidence < 45", () => {
      const result = extractStructuredReasoning(
        "Uncertain setup with multiple risks",
        30,
        35
      );

      expect(result.conviction).toBe("low");
    });

    it("should fallback to tradeScore when confidence is null", () => {
      const result = extractStructuredReasoning(
        "Setup with trade score only",
        null,
        75
      );

      expect(result.conviction).toBe("high"); // tradeScore >= 70
    });

    it("should use medium conviction from tradeScore fallback", () => {
      const result = extractStructuredReasoning(
        "Setup with moderate score",
        null,
        50
      );

      expect(result.conviction).toBe("medium"); // tradeScore >= 40 and < 70
    });

    it("should use low conviction from tradeScore fallback", () => {
      const result = extractStructuredReasoning(
        "Weak setup",
        null,
        25
      );

      expect(result.conviction).toBe("low"); // tradeScore < 40
    });

    it("should return null conviction when both confidence and tradeScore are null", () => {
      const result = extractStructuredReasoning(
        "Setup with no scores",
        null,
        null
      );

      expect(result.conviction).toBeNull();
    });
  });

  describe("Risk factor extraction", () => {
    it("should extract overextended risk factor", () => {
      const result = extractStructuredReasoning(
        "Setup looks good but price is overextended",
        60,
        65
      );

      expect(result.risk_factors.length).toBeGreaterThanOrEqual(1);
      expect(result.risk_factors.some(f => /overextend/i.test(f))).toBe(true);
    });

    it("should extract illiquid risk factor", () => {
      const result = extractStructuredReasoning(
        "Strong momentum but illiquid stock",
        55,
        60
      );

      expect(result.risk_factors.length).toBeGreaterThanOrEqual(1);
      expect(result.risk_factors.some(f => /illiquid/i.test(f))).toBe(true);
    });

    it("should extract wide spread risk factor", () => {
      const result = extractStructuredReasoning(
        "High rvol but wide spread is concerning",
        50,
        55
      );

      expect(result.risk_factors.length).toBeGreaterThanOrEqual(1);
      expect(result.risk_factors.some(f => /wide\s*spread/i.test(f))).toBe(true);
    });

    it("should extract reversal risk factor", () => {
      const result = extractStructuredReasoning(
        "Breakout looks good but reversal risk near high of day",
        60,
        65
      );

      expect(result.risk_factors.length).toBeGreaterThanOrEqual(1);
      expect(result.risk_factors.some(f => /reversal\s*risk/i.test(f))).toBe(true);
    });

    it("should respect 3-80 character bounds for risk factors", () => {
      const result = extractStructuredReasoning(
        "Setup has risk of mean reversion due to overextension",
        55,
        60
      );

      result.risk_factors.forEach(factor => {
        expect(factor.length).toBeGreaterThan(3);
        expect(factor.length).toBeLessThan(80);
      });
    });

    it("should not duplicate risk factors", () => {
      const result = extractStructuredReasoning(
        "High risk setup with risk of reversal and caution advised due to risk",
        40,
        45
      );

      // Should not have duplicate phrases
      const uniqueFactors = new Set(result.risk_factors);
      expect(result.risk_factors.length).toBe(uniqueFactors.size);
    });

    it("should extract multiple risk factors", () => {
      const result = extractStructuredReasoning(
        "Overextended price with wide spread and reversal risk",
        45,
        50
      );

      expect(result.risk_factors.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("Uncertainty phrase extraction", () => {
    it("should extract ambiguous uncertainty", () => {
      const result = extractStructuredReasoning(
        "Setup is somewhat ambiguous with mixed signals",
        50,
        55
      );

      expect(result.uncertainties.length).toBeGreaterThanOrEqual(1);
      expect(result.uncertainties.some(u => /ambig/i.test(u))).toBe(true);
    });

    it("should extract mixed signal uncertainty", () => {
      const result = extractStructuredReasoning(
        "Pattern shows mixed signals from market",
        45,
        50
      );

      expect(result.uncertainties.length).toBeGreaterThanOrEqual(1);
      expect(result.uncertainties.some(u => /mixed\s*signal/i.test(u))).toBe(true);
    });

    it("should extract unclear uncertainty", () => {
      const result = extractStructuredReasoning(
        "The direction is unclear at this point",
        40,
        45
      );

      expect(result.uncertainties.length).toBeGreaterThanOrEqual(1);
      expect(result.uncertainties.some(u => /unclear/i.test(u))).toBe(true);
    });

    it("should extract low confidence uncertainty", () => {
      const result = extractStructuredReasoning(
        "Setup has low confidence due to limited data",
        35,
        40
      );

      expect(result.uncertainties.length).toBeGreaterThanOrEqual(1);
      expect(result.uncertainties.some(u => /low\s*confidence/i.test(u))).toBe(true);
    });

    it("should respect 3-80 character bounds for uncertainties", () => {
      const result = extractStructuredReasoning(
        "Uncertain direction with borderline signals",
        40,
        45
      );

      result.uncertainties.forEach(uncertainty => {
        expect(uncertainty.length).toBeGreaterThan(3);
        expect(uncertainty.length).toBeLessThan(80);
      });
    });

    it("should not duplicate uncertainty phrases", () => {
      const result = extractStructuredReasoning(
        "Uncertain setup with unclear direction and uncertain outcome",
        35,
        40
      );

      const uniqueUncertainties = new Set(result.uncertainties);
      expect(result.uncertainties.length).toBe(uniqueUncertainties.size);
    });
  });

  describe("Edge cases", () => {
    it("should handle null reasoning", () => {
      const result = extractStructuredReasoning(null, 70, 75);

      expect(result.key_drivers).toEqual([]);
      expect(result.risk_factors).toEqual([]);
      expect(result.uncertainties).toEqual([]);
      expect(result.conviction).toBeNull(); // Early return for null reasoning
    });

    it("should handle empty string reasoning", () => {
      const result = extractStructuredReasoning("", 60, 65);

      expect(result.key_drivers).toEqual([]);
      expect(result.risk_factors).toEqual([]);
      expect(result.uncertainties).toEqual([]);
      expect(result.conviction).toBeNull(); // Early return for empty reasoning
    });

    it("should handle whitespace-only reasoning", () => {
      const result = extractStructuredReasoning("   \n\t  ", 50, 55);

      expect(result.key_drivers).toEqual([]);
      expect(result.risk_factors).toEqual([]);
      expect(result.uncertainties).toEqual([]);
      expect(result.conviction).toBeNull(); // Early return for whitespace-only
    });

    it("should handle reasoning with no matching features", () => {
      const result = extractStructuredReasoning(
        "This is a generic comment with no specific features",
        55,
        60
      );

      expect(result.key_drivers).toEqual([]);
      expect(result.conviction).toBe("medium");
    });

    it("should handle reasoning with only punctuation", () => {
      const result = extractStructuredReasoning("...", 70, 75);

      expect(result.key_drivers).toEqual([]);
      expect(result.risk_factors).toEqual([]);
      expect(result.uncertainties).toEqual([]);
    });

    it("should handle very long reasoning text", () => {
      const longText = "Strong rvol with high volume ".repeat(50);
      const result = extractStructuredReasoning(longText, 75, 80);

      expect(result.key_drivers.length).toBeGreaterThan(0);
      expect(result.conviction).toBe("high");
    });

    it("should return empty structure when all scores are null", () => {
      const result = extractStructuredReasoning(
        "Some reasoning text",
        null,
        null
      );

      expect(result.conviction).toBeNull();
    });

    it("should handle reasoning with case variations", () => {
      const result = extractStructuredReasoning(
        "RVOL and VWAP and ATR are all elevated",
        65,
        70
      );

      expect(result.key_drivers.length).toBeGreaterThanOrEqual(3);
      expect(result.key_drivers.some(d => d.feature === "rvol")).toBe(true);
      expect(result.key_drivers.some(d => d.feature === "vwap_deviation_pct")).toBe(true);
      expect(result.key_drivers.some(d => d.feature === "atr_pct")).toBe(true);
    });
  });

  describe("Complex scenarios", () => {
    it("should handle comprehensive analysis with all components", () => {
      const result = extractStructuredReasoning(
        "Strong rvol above 5x with tight spread and VWAP support. High of day resistance is a risk factor. Market alignment with SPY is unclear.",
        75,
        80
      );

      expect(result.key_drivers.length).toBeGreaterThanOrEqual(3);
      expect(result.risk_factors.length).toBeGreaterThanOrEqual(1);
      expect(result.uncertainties.length).toBeGreaterThanOrEqual(1);
      expect(result.conviction).toBe("high");
    });

    it("should handle bearish setup with low conviction", () => {
      const result = extractStructuredReasoning(
        "Weak volume declining, facing overhead resistance. Mixed signals from volatility regime. Reversal risk is high.",
        30,
        35
      );

      expect(result.key_drivers.length).toBeGreaterThan(0);
      // "Weak" is checked after bullish words — but no bullish words here, so bearish matches
      expect(result.key_drivers[0].direction).toBe("bearish");
      expect(result.conviction).toBe("low");
      expect(result.risk_factors.length).toBeGreaterThan(0);
      expect(result.uncertainties.length).toBeGreaterThan(0);
    });

    it("should prioritize confidence score over trade score for conviction", () => {
      const result = extractStructuredReasoning(
        "Standard setup",
        80, // High confidence
        20  // Low trade score
      );

      expect(result.conviction).toBe("high"); // Should use confidence, not trade score
    });

    it("should handle special characters in reasoning", () => {
      const result = extractStructuredReasoning(
        "RVOL @ 3.5x | Spread < 0.1% | VWAP +2%",
        70,
        75
      );

      expect(result.key_drivers.length).toBeGreaterThanOrEqual(3);
    });

    it("should extract time-of-day variants correctly", () => {
      const result = extractStructuredReasoning(
        "Open drive setup in power hour with midday consolidation",
        65,
        70
      );

      const timeOfDayDrivers = result.key_drivers.filter(d => d.feature === "time_of_day");
      expect(timeOfDayDrivers.length).toBe(1); // Should deduplicate
    });
  });
});
