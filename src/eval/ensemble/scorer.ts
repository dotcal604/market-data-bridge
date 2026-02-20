import type { ModelEvaluation, ModelId } from "../models/types.js";
import type { EnsembleScore, EnsembleWeights } from "./types.js";
import { getWeights } from "./weights.js";

/**
 * Core ensemble scoring logic. Accepts explicit weights for simulation,
 * or reads live weights from disk when omitted.
 */
function scoreEnsemble(
  evaluations: ModelEvaluation[],
  weights: { claude: number; gpt4o: number; gemini: number; k: number },
): EnsembleScore {
  const compliant = evaluations.filter((e) => e.compliant && e.output);

  if (compliant.length === 0) {
    return {
      trade_score: 0, trade_score_median: 0, expected_rr: 0, confidence: 0,
      should_trade: false, score_spread: 0, disagreement_penalty: 0,
      unanimous: true, majority_trade: false,
      weights_used: { claude: weights.claude, gpt4o: weights.gpt4o, gemini: weights.gemini },
    };
  }

  const modelWeightMap: Record<ModelId, number> = {
    claude: weights.claude,
    gpt4o: weights.gpt4o,
    gemini: weights.gemini,
  };

  const weightSum = compliant.reduce((s, e) => s + modelWeightMap[e.model_id], 0);
  const normalized = compliant.map((e) => ({
    eval: e,
    weight: modelWeightMap[e.model_id] / weightSum,
  }));

  const weightedScore = normalized.reduce((s, { eval: e, weight }) => s + e.output!.trade_score * weight, 0);
  const weightedRR = normalized.reduce((s, { eval: e, weight }) => s + e.output!.expected_rr * weight, 0);
  const weightedConf = normalized.reduce((s, { eval: e, weight }) => s + e.output!.confidence * weight, 0);

  const scores = compliant.map((e) => e.output!.trade_score).sort((a, b) => a - b);
  const scoreSpread = scores[scores.length - 1] - scores[0];

  const median = scores.length % 2 === 0
    ? (scores[scores.length / 2 - 1] + scores[scores.length / 2]) / 2
    : scores[Math.floor(scores.length / 2)];

  // Quadratic disagreement penalty: k * spread^2 / 10000
  const penalty = weights.k * (scoreSpread * scoreSpread) / 10000;
  const penalizedScore = Math.max(0, weightedScore - penalty);

  const tradeVotes = compliant.filter((e) => e.output!.should_trade).length;
  const majorityTrade = tradeVotes > compliant.length / 2;
  const unanimous = tradeVotes === 0 || tradeVotes === compliant.length;
  const shouldTrade = majorityTrade && penalizedScore >= 40;

  return {
    trade_score: Math.round(penalizedScore * 100) / 100,
    trade_score_median: Math.round(median * 100) / 100,
    expected_rr: Math.round(weightedRR * 100) / 100,
    confidence: Math.round(weightedConf * 100) / 100,
    should_trade: shouldTrade,
    score_spread: Math.round(scoreSpread * 100) / 100,
    disagreement_penalty: Math.round(penalty * 100) / 100,
    unanimous,
    majority_trade: majorityTrade,
    weights_used: { claude: weights.claude, gpt4o: weights.gpt4o, gemini: weights.gemini },
  };
}

/**
 * Compute ensemble score from compliant model evaluations using live weights.
 *
 * Uses weights from disk/memory. If a volatility regime is provided, it attempts
 * to use regime-specific weights. If the weight source is non-default and has
 * fewer than 30 samples, a confidence gate is applied to shrink the trade score
 * to prevent overfitting to small sample sizes.
 *
 * @param {ModelEvaluation[]} evaluations - Array of model evaluations to be scored.
 * @param {string} [regime] - Optional volatility regime string (e.g., "high", "low") to fetch regime-specific weights.
 * @returns {EnsembleScore} The calculated ensemble score, including consensus metrics and any applied confidence gating.
 */
const MIN_CALIBRATION_SAMPLES = 30;

export function computeEnsemble(evaluations: ModelEvaluation[], regime?: string): EnsembleScore {
  const weights = getWeights(regime);
  const score = scoreEnsemble(evaluations, weights);

  // Sample size confidence gate: shrink score when calibration data is thin
  if (weights.sample_size < MIN_CALIBRATION_SAMPLES && weights.source !== "default") {
    const gate = Math.max(0.3, weights.sample_size / MIN_CALIBRATION_SAMPLES);
    score.trade_score = Math.round(score.trade_score * gate * 100) / 100;
    score.should_trade = score.should_trade && score.trade_score >= 40;
    score.confidence_gate = Math.round(gate * 100) / 100;
    score.sample_size = weights.sample_size;
  }

  return score;
}

/**
 * Compute ensemble score using explicitly provided weights.
 *
 * This function is primarily used for simulation and "what-if" analysis to
 * re-score historical evaluations with different weight configurations.
 * It bypasses the live weight loading and confidence gating logic.
 *
 * @param {ModelEvaluation[]} evaluations - Array of model evaluations to be scored.
 * @param {{ claude: number; gpt4o: number; gemini: number; k: number }} weights - The explicit weights to apply (Claude, GPT-4o, Gemini, and penalty factor k).
 * @returns {EnsembleScore} The calculated ensemble score based on the provided weights.
 */
export function computeEnsembleWithWeights(
  evaluations: ModelEvaluation[],
  weights: { claude: number; gpt4o: number; gemini: number; k: number },
): EnsembleScore {
  return scoreEnsemble(evaluations, weights);
}
