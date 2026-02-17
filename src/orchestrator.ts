import { z } from "zod";
import { config } from "./config.js";
import { logger } from "./logging.js";
import { getGeminiTradeScore } from "./providers/gemini.js";

const log = logger.child({ module: "orchestrator" });

export type ProviderId = "gpt" | "gemini" | "claude";
export type ConsensusVerdict = "strong_buy" | "buy" | "neutral" | "sell" | "strong_sell";

export interface ProviderScore {
  readonly provider: ProviderId;
  readonly score: number;
  readonly confidence?: number;
  readonly reasoning?: string;
  readonly error?: string;
}

export interface EnsembleResult {
  readonly symbol: string;
  readonly scores: readonly ProviderScore[];
  readonly weightedScore: number;
  readonly consensus: ConsensusVerdict;
  readonly agreement: number;
  readonly meetsRequiredAgreement: boolean;
}

export interface OrchestratorDeps {
  readonly queryGpt: (symbol: string, features: Record<string, unknown>) => Promise<ProviderScore>;
  readonly queryGemini: (symbol: string, features: Record<string, unknown>) => Promise<ProviderScore>;
  readonly queryClaude: (symbol: string, features: Record<string, unknown>) => Promise<ProviderScore>;
}

const ScoreSchema = z.object({
  provider: z.enum(["gpt", "gemini", "claude"]),
  score: z.number().min(0).max(100),
  confidence: z.number().min(0).max(1).optional(),
  reasoning: z.string().optional(),
  error: z.string().optional(),
});

export const ProviderScoresSchema = z.array(ScoreSchema).min(1);

async function queryGptScore(symbol: string, _features: Record<string, unknown>): Promise<ProviderScore> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  throw new Error(`GPT provider integration is not configured for symbol ${symbol}`);
}

async function queryClaudeScore(symbol: string, _features: Record<string, unknown>): Promise<ProviderScore> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }

  throw new Error(`Claude MCP bridge integration is not configured for symbol ${symbol}`);
}

async function queryGeminiScore(symbol: string, features: Record<string, unknown>): Promise<ProviderScore> {
  const gemini = await getGeminiTradeScore(symbol, features);
  return {
    provider: "gemini",
    score: gemini.trade_score,
    confidence: gemini.confidence,
    reasoning: gemini.reasoning,
  };
}

const defaultDeps: OrchestratorDeps = {
  queryGpt: queryGptScore,
  queryGemini: queryGeminiScore,
  queryClaude: queryClaudeScore,
};

function getProviderWeight(provider: ProviderId): number {
  return config.orchestrator.weights[provider];
}

function getAgreement(scores: readonly ProviderScore[]): number {
  const weightTotal = scores.reduce((sum, score) => sum + getProviderWeight(score.provider), 0);
  if (weightTotal <= 0) {
    return 0;
  }

  let bullishWeight = 0;
  let neutralWeight = 0;
  let bearishWeight = 0;

  for (const score of scores) {
    const weight = getProviderWeight(score.provider);
    if (score.score >= 60) {
      bullishWeight += weight;
    } else if (score.score <= 40) {
      bearishWeight += weight;
    } else {
      neutralWeight += weight;
    }
  }

  const dominantWeight = Math.max(bullishWeight, neutralWeight, bearishWeight);
  return dominantWeight / weightTotal;
}

export function createOrchestrator(deps: OrchestratorDeps = defaultDeps) {
  async function collectEnsembleScores(symbol: string, features: Record<string, unknown>): Promise<EnsembleResult> {
    const requests: Array<Promise<ProviderScore>> = [
      deps.queryGpt(symbol, features),
      deps.queryGemini(symbol, features),
      deps.queryClaude(symbol, features),
    ];

    const settled = await Promise.allSettled(requests);

    const scores: ProviderScore[] = [];
    for (const item of settled) {
      if (item.status === "fulfilled") {
        const parsed = ScoreSchema.safeParse(item.value);
        if (parsed.success) {
          scores.push(parsed.data);
        }
      }
    }

    if (scores.length === 0) {
      throw new Error("No model providers were available for ensemble scoring");
    }

    const weightedDenominator = scores.reduce((sum, score) => sum + getProviderWeight(score.provider), 0);
    const weightedNumerator = scores.reduce((sum, score) => sum + score.score * getProviderWeight(score.provider), 0);
    const weightedScore = weightedDenominator > 0 ? weightedNumerator / weightedDenominator : 0;
    const agreement = getAgreement(scores);

    for (const item of settled) {
      if (item.status === "rejected") {
        log.warn({ symbol, error: item.reason instanceof Error ? item.reason.message : String(item.reason) }, "Provider unavailable during ensemble collection");
      }
    }

    return {
      symbol,
      scores,
      weightedScore,
      consensus: getConsensusVerdict(scores),
      agreement,
      meetsRequiredAgreement: agreement >= config.orchestrator.requiredAgreement,
    };
  }

  return {
    collectEnsembleScores,
    getConsensusVerdict,
    formatDisagreements,
  };
}

export function getConsensusVerdict(scores: readonly ProviderScore[]): ConsensusVerdict {
  const validated = ProviderScoresSchema.safeParse(scores);
  if (!validated.success) {
    throw new Error("scores must include at least one valid provider score");
  }

  const denominator = validated.data.reduce((sum, score) => sum + getProviderWeight(score.provider), 0);
  const weightedScore = validated.data.reduce((sum, score) => sum + score.score * getProviderWeight(score.provider), 0) / denominator;

  if (weightedScore >= 80) return "strong_buy";
  if (weightedScore >= 60) return "buy";
  if (weightedScore >= 40) return "neutral";
  if (weightedScore >= 20) return "sell";
  return "strong_sell";
}

export function formatDisagreements(scores: readonly ProviderScore[]): string[] {
  const validated = ProviderScoresSchema.safeParse(scores);
  if (!validated.success) {
    throw new Error("scores must include at least one valid provider score");
  }

  const messages: string[] = [];
  const sorted = [...validated.data].sort((a, b) => b.score - a.score);

  const top = sorted[0];
  const bottom = sorted[sorted.length - 1];
  const spread = top.score - bottom.score;

  if (spread >= 25) {
    messages.push(`High score spread: ${top.provider}=${top.score.toFixed(1)} vs ${bottom.provider}=${bottom.score.toFixed(1)} (${spread.toFixed(1)} points).`);
  }

  for (const score of sorted) {
    if (score.score >= 70) {
      messages.push(`${score.provider} is bullish (${score.score.toFixed(1)}).`);
    } else if (score.score <= 30) {
      messages.push(`${score.provider} is bearish (${score.score.toFixed(1)}).`);
    }
  }

  if (messages.length === 0) {
    messages.push("Providers are broadly aligned; no major disagreement detected.");
  }

  return messages;
}

export const orchestrator = createOrchestrator();
