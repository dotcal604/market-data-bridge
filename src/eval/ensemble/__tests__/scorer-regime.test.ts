import { describe, it, expect, vi, beforeEach } from "vitest";
import { computeEnsemble } from "../scorer.js";
import type { ModelEvaluation } from "../../models/types.js";

// Mock the weights module with support for regime-conditioned weights
vi.mock("../weights.js", () => ({
  getWeights: vi.fn((regime?: string) => {
    const baseWeights = {
      claude: 0.35,
      gpt4o: 0.35,
      gemini: 0.30,
      k: 1.0,
      updated_at: "2024-01-01T00:00:00.000Z",
      sample_size: 100,
      source: "test",
      regime_overrides: {
        high: { claude: 0.40, gpt4o: 0.30, gemini: 0.30, k: 1.5 },
        low: { claude: 0.30, gpt4o: 0.40, gemini: 0.30, k: 0.5 },
      },
    };

    // Apply regime overrides if provided
    if (regime === "high" && baseWeights.regime_overrides?.high) {
      const override = baseWeights.regime_overrides.high;
      return { ...baseWeights, ...override };
    }
    if (regime === "low" && baseWeights.regime_overrides?.low) {
      const override = baseWeights.regime_overrides.low;
      return { ...baseWeights, ...override };
    }

    return baseWeights;
  }),
}));

describe("computeEnsemble with regime-conditioned weights", () => {
  const createMockEvaluation = (
    modelId: "claude" | "gpt4o" | "gemini",
    tradeScore: number,
    shouldTrade: boolean,
  ): ModelEvaluation => ({
    model_id: modelId,
    output: {
      trade_score: tradeScore,
      extension_risk: 2,
      exhaustion_risk: 3,
      float_rotation_risk: 1,
      market_alignment: 8,
      expected_rr: 2.5,
      confidence: 0.8,
      should_trade: shouldTrade,
      reasoning: "Test reasoning",
    },
    raw_response: "{}",
    latency_ms: 1500,
    error: null,
    compliant: true,
    model_version: "test-model",
    prompt_hash: "abc123",
    token_count: 500,
    api_response_id: "resp1",
    timestamp: "2024-01-01T00:00:00.000Z",
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Regime parameter handling", () => {
    it("should use default weights when no regime is provided", async () => {
      const { getWeights } = await import("../weights.js");
      const evaluations = [
        createMockEvaluation("claude", 70, true),
        createMockEvaluation("gpt4o", 65, true),
        createMockEvaluation("gemini", 68, true),
      ];

      const result = computeEnsemble(evaluations);

      expect(getWeights).toHaveBeenCalledWith(undefined);
      expect(result.weights_used).toEqual({ claude: 0.35, gpt4o: 0.35, gemini: 0.30 });
    });

    it("should use high-vol weights when regime is 'high'", async () => {
      const { getWeights } = await import("../weights.js");
      const evaluations = [
        createMockEvaluation("claude", 70, true),
        createMockEvaluation("gpt4o", 65, true),
        createMockEvaluation("gemini", 68, true),
      ];

      const result = computeEnsemble(evaluations, "high");

      expect(getWeights).toHaveBeenCalledWith("high");
      expect(result.weights_used).toEqual({ claude: 0.40, gpt4o: 0.30, gemini: 0.30 });
    });

    it("should use low-vol weights when regime is 'low'", async () => {
      const { getWeights } = await import("../weights.js");
      const evaluations = [
        createMockEvaluation("claude", 70, true),
        createMockEvaluation("gpt4o", 65, true),
        createMockEvaluation("gemini", 68, true),
      ];

      const result = computeEnsemble(evaluations, "low");

      expect(getWeights).toHaveBeenCalledWith("low");
      expect(result.weights_used).toEqual({ claude: 0.30, gpt4o: 0.40, gemini: 0.30 });
    });

    it("should use default weights for 'normal' regime", async () => {
      const { getWeights } = await import("../weights.js");
      const evaluations = [
        createMockEvaluation("claude", 70, true),
        createMockEvaluation("gpt4o", 65, true),
        createMockEvaluation("gemini", 68, true),
      ];

      const result = computeEnsemble(evaluations, "normal");

      expect(getWeights).toHaveBeenCalledWith("normal");
      expect(result.weights_used).toEqual({ claude: 0.35, gpt4o: 0.35, gemini: 0.30 });
    });
  });

  describe("Score calculation with regime weights", () => {
    it("should calculate different scores based on regime (high-vol favors Claude)", () => {
      const evaluations = [
        createMockEvaluation("claude", 80, true),
        createMockEvaluation("gpt4o", 60, true),
        createMockEvaluation("gemini", 60, true),
      ];

      // With default weights (0.35/0.35/0.30): weighted score = 80*0.35 + 60*0.35 + 60*0.30 = 67
      const resultDefault = computeEnsemble(evaluations);
      
      // With high-vol weights (0.40/0.30/0.30): weighted score = 80*0.40 + 60*0.30 + 60*0.30 = 68
      const resultHigh = computeEnsemble(evaluations, "high");

      // With low-vol weights (0.30/0.40/0.30): weighted score = 80*0.30 + 60*0.40 + 60*0.30 = 66
      const resultLow = computeEnsemble(evaluations, "low");

      // Calculate expected scores (before penalty)
      // Default: 80*0.35 + 60*0.35 + 60*0.30 = 28 + 21 + 18 = 67
      // High: 80*0.40 + 60*0.30 + 60*0.30 = 32 + 18 + 18 = 68
      // Low: 80*0.30 + 60*0.40 + 60*0.30 = 24 + 24 + 18 = 66
      
      // Penalty calculation: k * spread^2 / 10000
      // Spread = 80 - 60 = 20
      // Default penalty: 1.0 * 20^2 / 10000 = 0.04
      // High penalty: 1.5 * 20^2 / 10000 = 0.06
      // Low penalty: 0.5 * 20^2 / 10000 = 0.02

      expect(resultDefault.trade_score).toBeCloseTo(67 - 0.04, 1);
      expect(resultHigh.trade_score).toBeCloseTo(68 - 0.06, 1);
      expect(resultLow.trade_score).toBeCloseTo(66 - 0.02, 1);
    });

    it("should apply different disagreement penalties based on regime k parameter", () => {
      const evaluations = [
        createMockEvaluation("claude", 80, true),
        createMockEvaluation("gpt4o", 40, true),
        createMockEvaluation("gemini", 40, true),
      ];

      // Large spread = 80 - 40 = 40
      const resultDefault = computeEnsemble(evaluations); // k = 1.0
      const resultHigh = computeEnsemble(evaluations, "high"); // k = 1.5
      const resultLow = computeEnsemble(evaluations, "low"); // k = 0.5

      // Penalty calculation: k * 40^2 / 10000
      // Default: 1.0 * 1600 / 10000 = 0.16
      // High: 1.5 * 1600 / 10000 = 0.24
      // Low: 0.5 * 1600 / 10000 = 0.08

      expect(resultDefault.disagreement_penalty).toBeCloseTo(0.16, 2);
      expect(resultHigh.disagreement_penalty).toBeCloseTo(0.24, 2);
      expect(resultLow.disagreement_penalty).toBeCloseTo(0.08, 2);
    });

    it("should handle edge case where Claude strongly disagrees in high-vol regime", () => {
      // High-vol regime favors Claude (0.40 weight)
      const evaluations = [
        createMockEvaluation("claude", 90, true),
        createMockEvaluation("gpt4o", 50, true),
        createMockEvaluation("gemini", 50, true),
      ];

      const result = computeEnsemble(evaluations, "high");

      // Weighted score: 90*0.40 + 50*0.30 + 50*0.30 = 36 + 15 + 15 = 66
      // Spread: 90 - 50 = 40
      // Penalty: 1.5 * 40^2 / 10000 = 0.24
      // Final: 66 - 0.24 = 65.76

      expect(result.trade_score).toBeCloseTo(65.76, 1);
      expect(result.weights_used.claude).toBe(0.40);
    });

    it("should handle edge case where GPT-4o strongly disagrees in low-vol regime", () => {
      // Low-vol regime favors GPT-4o (0.40 weight)
      const evaluations = [
        createMockEvaluation("claude", 50, true),
        createMockEvaluation("gpt4o", 90, true),
        createMockEvaluation("gemini", 50, true),
      ];

      const result = computeEnsemble(evaluations, "low");

      // Weighted score: 50*0.30 + 90*0.40 + 50*0.30 = 15 + 36 + 15 = 66
      // Spread: 90 - 50 = 40
      // Penalty: 0.5 * 40^2 / 10000 = 0.08
      // Final: 66 - 0.08 = 65.92

      expect(result.trade_score).toBeCloseTo(65.92, 1);
      expect(result.weights_used.gpt4o).toBe(0.40);
    });
  });

  describe("Integration with existing scorer logic", () => {
    it("should still respect should_trade threshold with regime weights", () => {
      const evaluations = [
        createMockEvaluation("claude", 45, true),
        createMockEvaluation("gpt4o", 35, true),
        createMockEvaluation("gemini", 35, false),
      ];

      const resultHigh = computeEnsemble(evaluations, "high");
      
      // Weighted score: 45*0.40 + 35*0.30 + 35*0.30 = 18 + 10.5 + 10.5 = 39
      // Spread: 45 - 35 = 10
      // Penalty: 1.5 * 10^2 / 10000 = 0.015
      // Final: 39 - 0.015 = 38.985 < 40 threshold

      expect(resultHigh.should_trade).toBe(false); // Below 40 threshold
    });

    it("should calculate median correctly regardless of regime", () => {
      const evaluations = [
        createMockEvaluation("claude", 70, true),
        createMockEvaluation("gpt4o", 60, true),
        createMockEvaluation("gemini", 80, true),
      ];

      const resultDefault = computeEnsemble(evaluations);
      const resultHigh = computeEnsemble(evaluations, "high");
      const resultLow = computeEnsemble(evaluations, "low");

      // Median of [60, 70, 80] = 70 regardless of weights
      expect(resultDefault.trade_score_median).toBe(70);
      expect(resultHigh.trade_score_median).toBe(70);
      expect(resultLow.trade_score_median).toBe(70);
    });
  });
});
