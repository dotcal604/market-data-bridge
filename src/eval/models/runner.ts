import type { ModelFeatureVector } from "../features/types.js";
import type { ModelEvaluation } from "./types.js";
import { buildUserPrompt, hashPrompt } from "./prompt.js";
import { evaluateWithClaude } from "./providers/claude.js";
import { evaluateWithGPT } from "./providers/openai.js";
import { evaluateWithGemini } from "./providers/gemini.js";
import { logger } from "../../logging.js";

export interface RunnerResult {
  evaluations: ModelEvaluation[];
  userPrompt: string;
  promptHash: string;
}

/**
 * Run all 3 models in parallel with identical prompt.
 * Uses Promise.allSettled — one model failing doesn't block others.
 */
export async function evaluateAllModels(
  symbol: string,
  direction: string,
  entryPrice: number | null,
  stopPrice: number | null,
  features: ModelFeatureVector,
): Promise<RunnerResult> {
  const userPrompt = buildUserPrompt(symbol, direction, entryPrice, stopPrice, features);
  const promptHash = hashPrompt(userPrompt);

  logger.info(`[Eval Runner] Evaluating ${symbol} across 3 models (hash=${promptHash})`);

  const results = await Promise.allSettled([
    evaluateWithClaude(userPrompt, promptHash),
    evaluateWithGPT(userPrompt, promptHash),
    evaluateWithGemini(userPrompt, promptHash),
  ]);

  const evaluations: ModelEvaluation[] = results.map((r) => {
    if (r.status === "fulfilled") return r.value;
    return {
      model_id: "claude" as const,
      output: null,
      raw_response: "",
      latency_ms: 0,
      error: r.reason?.message ?? "Unknown error",
      compliant: false,
      model_version: "",
      prompt_hash: promptHash,
      token_count: 0,
      api_response_id: "",
      timestamp: new Date().toISOString(),
    };
  });

  const compliant = evaluations.filter((e) => e.compliant);
  logger.info(`[Eval Runner] ${compliant.length}/3 models returned compliant responses`);

  for (const e of evaluations) {
    if (e.compliant) {
      logger.info(`  ${e.model_id}: score=${e.output!.trade_score} conf=${e.output!.confidence} trade=${e.output!.should_trade} (${e.latency_ms}ms)`);
    } else {
      logger.warn(`  ${e.model_id}: FAILED — ${e.error} (${e.latency_ms}ms)`);
    }
  }

  return { evaluations, userPrompt, promptHash };
}
