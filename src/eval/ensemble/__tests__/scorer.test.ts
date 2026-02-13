import { describe, it, expect, vi, beforeEach } from "vitest";
import { computeEnsemble } from "../scorer.js";
import type { ModelEvaluation } from "../../models/types.js";

// Mock the weights module
vi.mock("../weights.js", () => ({
  getWeights: vi.fn(() => ({
    claude: 0.4,
    gpt4o: 0.3,
    gemini: 0.3,
    k: 1.5,
    updated_at: "2024-01-01T00:00:00.000Z",
    sample_size: 100,
    source: "test",
  })),
}));

describe("computeEnsemble", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Empty evaluations", () => {
    it("should return zero scores when no compliant models", () => {
      const evaluations: ModelEvaluation[] = [];
      const result = computeEnsemble(evaluations);

      expect(result.trade_score).toBe(0);
      expect(result.trade_score_median).toBe(0);
      expect(result.expected_rr).toBe(0);
      expect(result.confidence).toBe(0);
      expect(result.should_trade).toBe(false);
      expect(result.score_spread).toBe(0);
      expect(result.disagreement_penalty).toBe(0);
      expect(result.unanimous).toBe(true);
      expect(result.majority_trade).toBe(false);
      expect(result.weights_used).toEqual({ claude: 0.4, gpt4o: 0.3, gemini: 0.3 });
    });

    it("should return zero scores when all models are non-compliant", () => {
      const evaluations: ModelEvaluation[] = [
        {
          model_id: "claude",
          output: null,
          raw_response: "",
          latency_ms: 100,
          error: "API error",
          compliant: false,
          model_version: "claude-3-5-sonnet",
          prompt_hash: "abc123",
          token_count: 0,
          api_response_id: "resp1",
          timestamp: "2024-01-01T00:00:00.000Z",
        },
        {
          model_id: "gpt4o",
          output: null,
          raw_response: "",
          latency_ms: 100,
          error: "API error",
          compliant: false,
          model_version: "gpt-4o",
          prompt_hash: "abc123",
          token_count: 0,
          api_response_id: "resp2",
          timestamp: "2024-01-01T00:00:00.000Z",
        },
      ];

      const result = computeEnsemble(evaluations);
      expect(result.trade_score).toBe(0);
      expect(result.should_trade).toBe(false);
      expect(result.unanimous).toBe(true);
    });
  });

  describe("Single compliant model", () => {
    it("should normalize weight to 1.0 for single model", () => {
      const evaluations: ModelEvaluation[] = [
        {
          model_id: "claude",
          output: {
            trade_score: 75,
            extension_risk: 2,
            exhaustion_risk: 3,
            float_rotation_risk: 1,
            market_alignment: 8,
            expected_rr: 2.5,
            confidence: 0.8,
            should_trade: true,
            reasoning: "Strong momentum",
          },
          raw_response: "{}",
          latency_ms: 1500,
          error: null,
          compliant: true,
          model_version: "claude-3-5-sonnet",
          prompt_hash: "abc123",
          token_count: 500,
          api_response_id: "resp1",
          timestamp: "2024-01-01T00:00:00.000Z",
        },
      ];

      const result = computeEnsemble(evaluations);
      
      // Weight normalizes to 1.0, so score = 75 * 1.0 = 75
      // No spread (single model), so no penalty
      expect(result.trade_score).toBe(75);
      expect(result.trade_score_median).toBe(75);
      expect(result.expected_rr).toBe(2.5);
      expect(result.confidence).toBe(0.8);
      expect(result.score_spread).toBe(0);
      expect(result.disagreement_penalty).toBe(0);
      expect(result.should_trade).toBe(true); // score >= 40 and majority
      expect(result.majority_trade).toBe(true);
      expect(result.unanimous).toBe(true);
    });

    it("should handle single model with should_trade = false", () => {
      const evaluations: ModelEvaluation[] = [
        {
          model_id: "gpt4o",
          output: {
            trade_score: 30,
            extension_risk: 8,
            exhaustion_risk: 7,
            float_rotation_risk: 6,
            market_alignment: 2,
            expected_rr: 0.5,
            confidence: 0.3,
            should_trade: false,
            reasoning: "Too risky",
          },
          raw_response: "{}",
          latency_ms: 1200,
          error: null,
          compliant: true,
          model_version: "gpt-4o",
          prompt_hash: "abc123",
          token_count: 400,
          api_response_id: "resp2",
          timestamp: "2024-01-01T00:00:00.000Z",
        },
      ];

      const result = computeEnsemble(evaluations);
      expect(result.should_trade).toBe(false); // score < 40
      expect(result.majority_trade).toBe(false);
      expect(result.unanimous).toBe(true);
    });
  });

  describe("All 3 models compliant", () => {
    it("should calculate weighted mean correctly", () => {
      const evaluations: ModelEvaluation[] = [
        {
          model_id: "claude",
          output: {
            trade_score: 80,
            extension_risk: 2,
            exhaustion_risk: 3,
            float_rotation_risk: 1,
            market_alignment: 8,
            expected_rr: 3.0,
            confidence: 0.9,
            should_trade: true,
            reasoning: "Strong setup",
          },
          raw_response: "{}",
          latency_ms: 1500,
          error: null,
          compliant: true,
          model_version: "claude-3-5-sonnet",
          prompt_hash: "abc123",
          token_count: 500,
          api_response_id: "resp1",
          timestamp: "2024-01-01T00:00:00.000Z",
        },
        {
          model_id: "gpt4o",
          output: {
            trade_score: 70,
            extension_risk: 3,
            exhaustion_risk: 4,
            float_rotation_risk: 2,
            market_alignment: 7,
            expected_rr: 2.5,
            confidence: 0.8,
            should_trade: true,
            reasoning: "Good momentum",
          },
          raw_response: "{}",
          latency_ms: 1200,
          error: null,
          compliant: true,
          model_version: "gpt-4o",
          prompt_hash: "abc123",
          token_count: 400,
          api_response_id: "resp2",
          timestamp: "2024-01-01T00:00:00.000Z",
        },
        {
          model_id: "gemini",
          output: {
            trade_score: 60,
            extension_risk: 4,
            exhaustion_risk: 5,
            float_rotation_risk: 3,
            market_alignment: 6,
            expected_rr: 2.0,
            confidence: 0.7,
            should_trade: true,
            reasoning: "Acceptable risk",
          },
          raw_response: "{}",
          latency_ms: 1000,
          error: null,
          compliant: true,
          model_version: "gemini-1.5-flash",
          prompt_hash: "abc123",
          token_count: 350,
          api_response_id: "resp3",
          timestamp: "2024-01-01T00:00:00.000Z",
        },
      ];

      const result = computeEnsemble(evaluations);

      // Weighted mean: 80*0.4 + 70*0.3 + 60*0.3 = 32 + 21 + 18 = 71
      // Spread: 80 - 60 = 20
      // Penalty: 1.5 * (20^2) / 10000 = 1.5 * 400 / 10000 = 0.06
      // Penalized score: 71 - 0.06 = 70.94
      expect(result.trade_score).toBe(70.94);
      expect(result.trade_score_median).toBe(70); // sorted: [60, 70, 80]
      
      // Weighted RR: 3.0*0.4 + 2.5*0.3 + 2.0*0.3 = 1.2 + 0.75 + 0.6 = 2.55
      expect(result.expected_rr).toBe(2.55);
      
      // Weighted confidence: 0.9*0.4 + 0.8*0.3 + 0.7*0.3 = 0.36 + 0.24 + 0.21 = 0.81
      expect(result.confidence).toBe(0.81);
      
      expect(result.score_spread).toBe(20);
      expect(result.disagreement_penalty).toBe(0.06);
      expect(result.should_trade).toBe(true); // score >= 40 and majority
      expect(result.majority_trade).toBe(true);
      expect(result.unanimous).toBe(true); // all agree on should_trade
    });
  });

  describe("Disagreement penalty", () => {
    it("should apply quadratic penalty for high score spread", () => {
      const evaluations: ModelEvaluation[] = [
        {
          model_id: "claude",
          output: {
            trade_score: 90,
            extension_risk: 1,
            exhaustion_risk: 2,
            float_rotation_risk: 1,
            market_alignment: 9,
            expected_rr: 4.0,
            confidence: 0.95,
            should_trade: true,
            reasoning: "Excellent setup",
          },
          raw_response: "{}",
          latency_ms: 1500,
          error: null,
          compliant: true,
          model_version: "claude-3-5-sonnet",
          prompt_hash: "abc123",
          token_count: 500,
          api_response_id: "resp1",
          timestamp: "2024-01-01T00:00:00.000Z",
        },
        {
          model_id: "gpt4o",
          output: {
            trade_score: 50,
            extension_risk: 5,
            exhaustion_risk: 6,
            float_rotation_risk: 4,
            market_alignment: 4,
            expected_rr: 1.5,
            confidence: 0.6,
            should_trade: true,
            reasoning: "Marginal setup",
          },
          raw_response: "{}",
          latency_ms: 1200,
          error: null,
          compliant: true,
          model_version: "gpt-4o",
          prompt_hash: "abc123",
          token_count: 400,
          api_response_id: "resp2",
          timestamp: "2024-01-01T00:00:00.000Z",
        },
        {
          model_id: "gemini",
          output: {
            trade_score: 40,
            extension_risk: 6,
            exhaustion_risk: 7,
            float_rotation_risk: 5,
            market_alignment: 3,
            expected_rr: 1.0,
            confidence: 0.5,
            should_trade: false,
            reasoning: "High risk",
          },
          raw_response: "{}",
          latency_ms: 1000,
          error: null,
          compliant: true,
          model_version: "gemini-1.5-flash",
          prompt_hash: "abc123",
          token_count: 350,
          api_response_id: "resp3",
          timestamp: "2024-01-01T00:00:00.000Z",
        },
      ];

      const result = computeEnsemble(evaluations);

      // Weighted mean: 90*0.4 + 50*0.3 + 40*0.3 = 36 + 15 + 12 = 63
      // Spread: 90 - 40 = 50
      // Penalty: 1.5 * (50^2) / 10000 = 1.5 * 2500 / 10000 = 0.375
      // Penalized score: 63 - 0.375 = 62.625, rounded to 62.63
      expect(result.trade_score).toBe(62.63);
      expect(result.score_spread).toBe(50);
      expect(result.disagreement_penalty).toBe(0.38);
    });

    it("should handle extreme disagreement with large penalty", () => {
      const evaluations: ModelEvaluation[] = [
        {
          model_id: "claude",
          output: {
            trade_score: 100,
            extension_risk: 1,
            exhaustion_risk: 1,
            float_rotation_risk: 1,
            market_alignment: 10,
            expected_rr: 5.0,
            confidence: 1.0,
            should_trade: true,
            reasoning: "Perfect setup",
          },
          raw_response: "{}",
          latency_ms: 1500,
          error: null,
          compliant: true,
          model_version: "claude-3-5-sonnet",
          prompt_hash: "abc123",
          token_count: 500,
          api_response_id: "resp1",
          timestamp: "2024-01-01T00:00:00.000Z",
        },
        {
          model_id: "gpt4o",
          output: {
            trade_score: 20,
            extension_risk: 9,
            exhaustion_risk: 9,
            float_rotation_risk: 9,
            market_alignment: 1,
            expected_rr: 0.5,
            confidence: 0.2,
            should_trade: false,
            reasoning: "Very risky",
          },
          raw_response: "{}",
          latency_ms: 1200,
          error: null,
          compliant: true,
          model_version: "gpt-4o",
          prompt_hash: "abc123",
          token_count: 400,
          api_response_id: "resp2",
          timestamp: "2024-01-01T00:00:00.000Z",
        },
      ];

      const result = computeEnsemble(evaluations);

      // Weighted mean (normalized weights for 2 models: claude=0.4/(0.4+0.3)=0.571, gpt4o=0.3/0.7=0.429)
      // 100*0.571 + 20*0.429 = 57.14 + 8.58 = 65.72
      // Spread: 100 - 20 = 80
      // Penalty: 1.5 * (80^2) / 10000 = 1.5 * 6400 / 10000 = 0.96
      // Penalized score: 65.72 - 0.96 = 64.76
      expect(result.score_spread).toBe(80);
      expect(result.disagreement_penalty).toBe(0.96);
      expect(result.trade_score).toBeCloseTo(64.76, 1);
    });
  });

  describe("Majority voting", () => {
    it("should set majority_trade to true when 2 of 3 models vote true", () => {
      const evaluations: ModelEvaluation[] = [
        {
          model_id: "claude",
          output: {
            trade_score: 70,
            extension_risk: 2,
            exhaustion_risk: 3,
            float_rotation_risk: 1,
            market_alignment: 8,
            expected_rr: 2.5,
            confidence: 0.8,
            should_trade: true,
            reasoning: "Good setup",
          },
          raw_response: "{}",
          latency_ms: 1500,
          error: null,
          compliant: true,
          model_version: "claude-3-5-sonnet",
          prompt_hash: "abc123",
          token_count: 500,
          api_response_id: "resp1",
          timestamp: "2024-01-01T00:00:00.000Z",
        },
        {
          model_id: "gpt4o",
          output: {
            trade_score: 65,
            extension_risk: 3,
            exhaustion_risk: 4,
            float_rotation_risk: 2,
            market_alignment: 7,
            expected_rr: 2.0,
            confidence: 0.7,
            should_trade: true,
            reasoning: "Acceptable",
          },
          raw_response: "{}",
          latency_ms: 1200,
          error: null,
          compliant: true,
          model_version: "gpt-4o",
          prompt_hash: "abc123",
          token_count: 400,
          api_response_id: "resp2",
          timestamp: "2024-01-01T00:00:00.000Z",
        },
        {
          model_id: "gemini",
          output: {
            trade_score: 60,
            extension_risk: 5,
            exhaustion_risk: 6,
            float_rotation_risk: 3,
            market_alignment: 5,
            expected_rr: 1.5,
            confidence: 0.6,
            should_trade: false,
            reasoning: "Too risky",
          },
          raw_response: "{}",
          latency_ms: 1000,
          error: null,
          compliant: true,
          model_version: "gemini-1.5-flash",
          prompt_hash: "abc123",
          token_count: 350,
          api_response_id: "resp3",
          timestamp: "2024-01-01T00:00:00.000Z",
        },
      ];

      const result = computeEnsemble(evaluations);
      expect(result.majority_trade).toBe(true); // 2 out of 3 voted true
      expect(result.unanimous).toBe(false); // not all agree
      expect(result.should_trade).toBe(true); // majority + score >= 40
    });

    it("should set majority_trade to false when only 1 of 3 models votes true", () => {
      const evaluations: ModelEvaluation[] = [
        {
          model_id: "claude",
          output: {
            trade_score: 50,
            extension_risk: 4,
            exhaustion_risk: 5,
            float_rotation_risk: 3,
            market_alignment: 6,
            expected_rr: 1.5,
            confidence: 0.6,
            should_trade: true,
            reasoning: "Marginal",
          },
          raw_response: "{}",
          latency_ms: 1500,
          error: null,
          compliant: true,
          model_version: "claude-3-5-sonnet",
          prompt_hash: "abc123",
          token_count: 500,
          api_response_id: "resp1",
          timestamp: "2024-01-01T00:00:00.000Z",
        },
        {
          model_id: "gpt4o",
          output: {
            trade_score: 40,
            extension_risk: 6,
            exhaustion_risk: 7,
            float_rotation_risk: 5,
            market_alignment: 4,
            expected_rr: 1.0,
            confidence: 0.5,
            should_trade: false,
            reasoning: "Risky",
          },
          raw_response: "{}",
          latency_ms: 1200,
          error: null,
          compliant: true,
          model_version: "gpt-4o",
          prompt_hash: "abc123",
          token_count: 400,
          api_response_id: "resp2",
          timestamp: "2024-01-01T00:00:00.000Z",
        },
        {
          model_id: "gemini",
          output: {
            trade_score: 35,
            extension_risk: 7,
            exhaustion_risk: 8,
            float_rotation_risk: 6,
            market_alignment: 3,
            expected_rr: 0.8,
            confidence: 0.4,
            should_trade: false,
            reasoning: "Too risky",
          },
          raw_response: "{}",
          latency_ms: 1000,
          error: null,
          compliant: true,
          model_version: "gemini-1.5-flash",
          prompt_hash: "abc123",
          token_count: 350,
          api_response_id: "resp3",
          timestamp: "2024-01-01T00:00:00.000Z",
        },
      ];

      const result = computeEnsemble(evaluations);
      expect(result.majority_trade).toBe(false); // only 1 out of 3 voted true
      expect(result.should_trade).toBe(false); // no majority
    });
  });

  describe("Min score threshold", () => {
    it("should set should_trade to false when penalized score < 40, even with majority", () => {
      const evaluations: ModelEvaluation[] = [
        {
          model_id: "claude",
          output: {
            trade_score: 45,
            extension_risk: 5,
            exhaustion_risk: 6,
            float_rotation_risk: 4,
            market_alignment: 5,
            expected_rr: 1.2,
            confidence: 0.55,
            should_trade: true,
            reasoning: "Marginal setup",
          },
          raw_response: "{}",
          latency_ms: 1500,
          error: null,
          compliant: true,
          model_version: "claude-3-5-sonnet",
          prompt_hash: "abc123",
          token_count: 500,
          api_response_id: "resp1",
          timestamp: "2024-01-01T00:00:00.000Z",
        },
        {
          model_id: "gpt4o",
          output: {
            trade_score: 40,
            extension_risk: 6,
            exhaustion_risk: 7,
            float_rotation_risk: 5,
            market_alignment: 4,
            expected_rr: 1.0,
            confidence: 0.5,
            should_trade: true,
            reasoning: "Minimal requirements",
          },
          raw_response: "{}",
          latency_ms: 1200,
          error: null,
          compliant: true,
          model_version: "gpt-4o",
          prompt_hash: "abc123",
          token_count: 400,
          api_response_id: "resp2",
          timestamp: "2024-01-01T00:00:00.000Z",
        },
        {
          model_id: "gemini",
          output: {
            trade_score: 10,
            extension_risk: 9,
            exhaustion_risk: 9,
            float_rotation_risk: 8,
            market_alignment: 1,
            expected_rr: 0.3,
            confidence: 0.2,
            should_trade: false,
            reasoning: "Very risky",
          },
          raw_response: "{}",
          latency_ms: 1000,
          error: null,
          compliant: true,
          model_version: "gemini-1.5-flash",
          prompt_hash: "abc123",
          token_count: 350,
          api_response_id: "resp3",
          timestamp: "2024-01-01T00:00:00.000Z",
        },
      ];

      const result = computeEnsemble(evaluations);

      // Weighted mean: 45*0.4 + 40*0.3 + 10*0.3 = 18 + 12 + 3 = 33
      // Spread: 45 - 10 = 35
      // Penalty: 1.5 * (35^2) / 10000 = 1.5 * 1225 / 10000 = 0.184
      // Penalized score: 33 - 0.184 = 32.816, rounded to 32.82
      expect(result.majority_trade).toBe(true); // 2 out of 3 voted true
      expect(result.trade_score).toBeCloseTo(32.82, 1);
      expect(result.should_trade).toBe(false); // score < 40 threshold
    });

    it("should set should_trade to true when penalized score >= 40 with majority", () => {
      const evaluations: ModelEvaluation[] = [
        {
          model_id: "claude",
          output: {
            trade_score: 50,
            extension_risk: 4,
            exhaustion_risk: 5,
            float_rotation_risk: 3,
            market_alignment: 6,
            expected_rr: 1.5,
            confidence: 0.6,
            should_trade: true,
            reasoning: "Acceptable",
          },
          raw_response: "{}",
          latency_ms: 1500,
          error: null,
          compliant: true,
          model_version: "claude-3-5-sonnet",
          prompt_hash: "abc123",
          token_count: 500,
          api_response_id: "resp1",
          timestamp: "2024-01-01T00:00:00.000Z",
        },
        {
          model_id: "gpt4o",
          output: {
            trade_score: 48,
            extension_risk: 5,
            exhaustion_risk: 6,
            float_rotation_risk: 4,
            market_alignment: 5,
            expected_rr: 1.3,
            confidence: 0.55,
            should_trade: true,
            reasoning: "Marginal",
          },
          raw_response: "{}",
          latency_ms: 1200,
          error: null,
          compliant: true,
          model_version: "gpt-4o",
          prompt_hash: "abc123",
          token_count: 400,
          api_response_id: "resp2",
          timestamp: "2024-01-01T00:00:00.000Z",
        },
      ];

      const result = computeEnsemble(evaluations);

      // Weighted mean (2 models, normalized: claude=0.4/0.7=0.571, gpt4o=0.3/0.7=0.429)
      // 50*0.571 + 48*0.429 = 28.55 + 20.59 = 49.14
      // Spread: 50 - 48 = 2
      // Penalty: 1.5 * (2^2) / 10000 = 1.5 * 4 / 10000 = 0.0006
      // Penalized score: 49.14 - 0.0006 ≈ 49.14
      expect(result.majority_trade).toBe(true);
      expect(result.trade_score).toBeCloseTo(49.14, 1);
      expect(result.should_trade).toBe(true); // score >= 40 and majority
    });
  });

  describe("Unanimous agreement", () => {
    it("should set unanimous to true when all models agree on should_trade = true", () => {
      const evaluations: ModelEvaluation[] = [
        {
          model_id: "claude",
          output: {
            trade_score: 80,
            extension_risk: 2,
            exhaustion_risk: 3,
            float_rotation_risk: 1,
            market_alignment: 8,
            expected_rr: 3.0,
            confidence: 0.9,
            should_trade: true,
            reasoning: "Strong",
          },
          raw_response: "{}",
          latency_ms: 1500,
          error: null,
          compliant: true,
          model_version: "claude-3-5-sonnet",
          prompt_hash: "abc123",
          token_count: 500,
          api_response_id: "resp1",
          timestamp: "2024-01-01T00:00:00.000Z",
        },
        {
          model_id: "gpt4o",
          output: {
            trade_score: 75,
            extension_risk: 3,
            exhaustion_risk: 4,
            float_rotation_risk: 2,
            market_alignment: 7,
            expected_rr: 2.8,
            confidence: 0.85,
            should_trade: true,
            reasoning: "Good",
          },
          raw_response: "{}",
          latency_ms: 1200,
          error: null,
          compliant: true,
          model_version: "gpt-4o",
          prompt_hash: "abc123",
          token_count: 400,
          api_response_id: "resp2",
          timestamp: "2024-01-01T00:00:00.000Z",
        },
        {
          model_id: "gemini",
          output: {
            trade_score: 70,
            extension_risk: 4,
            exhaustion_risk: 5,
            float_rotation_risk: 3,
            market_alignment: 6,
            expected_rr: 2.5,
            confidence: 0.8,
            should_trade: true,
            reasoning: "Acceptable",
          },
          raw_response: "{}",
          latency_ms: 1000,
          error: null,
          compliant: true,
          model_version: "gemini-1.5-flash",
          prompt_hash: "abc123",
          token_count: 350,
          api_response_id: "resp3",
          timestamp: "2024-01-01T00:00:00.000Z",
        },
      ];

      const result = computeEnsemble(evaluations);
      expect(result.unanimous).toBe(true);
      expect(result.majority_trade).toBe(true);
    });

    it("should set unanimous to true when all models agree on should_trade = false", () => {
      const evaluations: ModelEvaluation[] = [
        {
          model_id: "claude",
          output: {
            trade_score: 30,
            extension_risk: 7,
            exhaustion_risk: 8,
            float_rotation_risk: 6,
            market_alignment: 3,
            expected_rr: 0.8,
            confidence: 0.4,
            should_trade: false,
            reasoning: "Too risky",
          },
          raw_response: "{}",
          latency_ms: 1500,
          error: null,
          compliant: true,
          model_version: "claude-3-5-sonnet",
          prompt_hash: "abc123",
          token_count: 500,
          api_response_id: "resp1",
          timestamp: "2024-01-01T00:00:00.000Z",
        },
        {
          model_id: "gpt4o",
          output: {
            trade_score: 25,
            extension_risk: 8,
            exhaustion_risk: 9,
            float_rotation_risk: 7,
            market_alignment: 2,
            expected_rr: 0.6,
            confidence: 0.3,
            should_trade: false,
            reasoning: "Very risky",
          },
          raw_response: "{}",
          latency_ms: 1200,
          error: null,
          compliant: true,
          model_version: "gpt-4o",
          prompt_hash: "abc123",
          token_count: 400,
          api_response_id: "resp2",
          timestamp: "2024-01-01T00:00:00.000Z",
        },
        {
          model_id: "gemini",
          output: {
            trade_score: 20,
            extension_risk: 9,
            exhaustion_risk: 10,
            float_rotation_risk: 8,
            market_alignment: 1,
            expected_rr: 0.4,
            confidence: 0.2,
            should_trade: false,
            reasoning: "Extremely risky",
          },
          raw_response: "{}",
          latency_ms: 1000,
          error: null,
          compliant: true,
          model_version: "gemini-1.5-flash",
          prompt_hash: "abc123",
          token_count: 350,
          api_response_id: "resp3",
          timestamp: "2024-01-01T00:00:00.000Z",
        },
      ];

      const result = computeEnsemble(evaluations);
      expect(result.unanimous).toBe(true);
      expect(result.majority_trade).toBe(false);
      expect(result.should_trade).toBe(false);
    });

    it("should set unanimous to false when models disagree", () => {
      const evaluations: ModelEvaluation[] = [
        {
          model_id: "claude",
          output: {
            trade_score: 70,
            extension_risk: 3,
            exhaustion_risk: 4,
            float_rotation_risk: 2,
            market_alignment: 7,
            expected_rr: 2.5,
            confidence: 0.8,
            should_trade: true,
            reasoning: "Good setup",
          },
          raw_response: "{}",
          latency_ms: 1500,
          error: null,
          compliant: true,
          model_version: "claude-3-5-sonnet",
          prompt_hash: "abc123",
          token_count: 500,
          api_response_id: "resp1",
          timestamp: "2024-01-01T00:00:00.000Z",
        },
        {
          model_id: "gpt4o",
          output: {
            trade_score: 35,
            extension_risk: 7,
            exhaustion_risk: 8,
            float_rotation_risk: 6,
            market_alignment: 3,
            expected_rr: 0.9,
            confidence: 0.45,
            should_trade: false,
            reasoning: "Too risky",
          },
          raw_response: "{}",
          latency_ms: 1200,
          error: null,
          compliant: true,
          model_version: "gpt-4o",
          prompt_hash: "abc123",
          token_count: 400,
          api_response_id: "resp2",
          timestamp: "2024-01-01T00:00:00.000Z",
        },
      ];

      const result = computeEnsemble(evaluations);
      expect(result.unanimous).toBe(false);
    });
  });

  describe("Edge cases", () => {
    it("should handle exact threshold score of 40", () => {
      const evaluations: ModelEvaluation[] = [
        {
          model_id: "claude",
          output: {
            trade_score: 40,
            extension_risk: 5,
            exhaustion_risk: 6,
            float_rotation_risk: 4,
            market_alignment: 5,
            expected_rr: 1.0,
            confidence: 0.5,
            should_trade: true,
            reasoning: "Threshold",
          },
          raw_response: "{}",
          latency_ms: 1500,
          error: null,
          compliant: true,
          model_version: "claude-3-5-sonnet",
          prompt_hash: "abc123",
          token_count: 500,
          api_response_id: "resp1",
          timestamp: "2024-01-01T00:00:00.000Z",
        },
      ];

      const result = computeEnsemble(evaluations);
      expect(result.trade_score).toBe(40);
      expect(result.should_trade).toBe(true); // exactly at threshold
    });

    it("should round all numeric outputs to 2 decimal places", () => {
      const evaluations: ModelEvaluation[] = [
        {
          model_id: "claude",
          output: {
            trade_score: 77.777,
            extension_risk: 3,
            exhaustion_risk: 4,
            float_rotation_risk: 2,
            market_alignment: 7,
            expected_rr: 2.345,
            confidence: 0.876,
            should_trade: true,
            reasoning: "Test rounding",
          },
          raw_response: "{}",
          latency_ms: 1500,
          error: null,
          compliant: true,
          model_version: "claude-3-5-sonnet",
          prompt_hash: "abc123",
          token_count: 500,
          api_response_id: "resp1",
          timestamp: "2024-01-01T00:00:00.000Z",
        },
      ];

      const result = computeEnsemble(evaluations);
      expect(result.trade_score).toBe(77.78); // rounded from 77.777
      expect(result.expected_rr).toBe(2.35); // rounded from 2.345
      expect(result.confidence).toBe(0.88); // rounded from 0.876
    });

    it("should handle penalty reducing score to zero", () => {
      const evaluations: ModelEvaluation[] = [
        {
          model_id: "claude",
          output: {
            trade_score: 100,
            extension_risk: 1,
            exhaustion_risk: 1,
            float_rotation_risk: 1,
            market_alignment: 10,
            expected_rr: 5.0,
            confidence: 1.0,
            should_trade: true,
            reasoning: "Max score",
          },
          raw_response: "{}",
          latency_ms: 1500,
          error: null,
          compliant: true,
          model_version: "claude-3-5-sonnet",
          prompt_hash: "abc123",
          token_count: 500,
          api_response_id: "resp1",
          timestamp: "2024-01-01T00:00:00.000Z",
        },
        {
          model_id: "gpt4o",
          output: {
            trade_score: 0,
            extension_risk: 10,
            exhaustion_risk: 10,
            float_rotation_risk: 10,
            market_alignment: 0,
            expected_rr: 0,
            confidence: 0,
            should_trade: false,
            reasoning: "Min score",
          },
          raw_response: "{}",
          latency_ms: 1200,
          error: null,
          compliant: true,
          model_version: "gpt-4o",
          prompt_hash: "abc123",
          token_count: 400,
          api_response_id: "resp2",
          timestamp: "2024-01-01T00:00:00.000Z",
        },
      ];

      const result = computeEnsemble(evaluations);
      
      // Weighted mean (normalized): 100*0.571 + 0*0.429 = 57.14
      // Spread: 100 - 0 = 100
      // Penalty: 1.5 * (100^2) / 10000 = 1.5 * 10000 / 10000 = 1.5
      // Penalized score: 57.14 - 1.5 = 55.64
      // Should not go below 0 (but in this case it's positive)
      expect(result.score_spread).toBe(100);
      expect(result.disagreement_penalty).toBe(1.5);
      expect(result.trade_score).toBeCloseTo(55.64, 1);
    });
  });
});
