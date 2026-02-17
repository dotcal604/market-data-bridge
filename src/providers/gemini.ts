import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { config } from "../config.js";
import { logger } from "../logging.js";

const log = logger.child({ module: "providers/gemini" });

const GeminiScoreSchema = z.object({
  trade_score: z.number().min(0).max(100),
  confidence: z.number().min(0).max(1).optional(),
  reasoning: z.string().min(1).optional(),
});

export interface GeminiTradeScore {
  readonly trade_score: number;
  readonly confidence?: number;
  readonly reasoning?: string;
}

let geminiClient: GoogleGenAI | null = null;

function getGeminiClient(): GoogleGenAI {
  if (!geminiClient) {
    geminiClient = new GoogleGenAI({ apiKey: config.gemini.apiKey });
  }
  return geminiClient;
}

export async function getGeminiTradeScore(symbol: string, features: Record<string, unknown>): Promise<GeminiTradeScore> {
  if (!config.gemini.apiKey) {
    throw new Error("GOOGLE_AI_API_KEY is not configured");
  }

  const prompt = [
    "Return JSON only with keys: trade_score (0-100), confidence (0-1 optional), reasoning (optional).",
    `Symbol: ${symbol}`,
    `Features: ${JSON.stringify(features)}`,
  ].join("\n");

  const response = await getGeminiClient().models.generateContent({
    model: config.gemini.model,
    contents: prompt,
    config: {
      temperature: 0,
      responseMimeType: "application/json",
    },
  });

  const raw = typeof response.text === "string" ? response.text : "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    log.error({ symbol, raw, error: message }, "Gemini returned invalid JSON");
    throw new Error("Gemini response was not valid JSON");
  }

  const validated = GeminiScoreSchema.safeParse(parsed);
  if (!validated.success) {
    log.error({ symbol, issues: validated.error.issues }, "Gemini response failed schema validation");
    throw new Error("Gemini response did not match expected schema");
  }

  return validated.data;
}
