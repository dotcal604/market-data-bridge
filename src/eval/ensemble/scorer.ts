import type { ModelEvaluation, ModelId } from "../models/types.js";
import type { EnsembleScore } from "./types.js";
import { getWeights } from "./weights.js";

/**
 * Compute ensemble score from compliant model evaluations.
 * Weighted mean with quadratic disagreement penalty.
 */
export function computeEnsemble(evaluations: ModelEvaluation[]): EnsembleScore {
  const weights = getWeights();
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
