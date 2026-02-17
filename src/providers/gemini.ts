import { GoogleGenerativeAI } from "@google/generative-ai";
import { z } from "zod";
import { config } from "../config.js";
import { logger } from "../logging.js";

const log = logger.child({ module: "provider-gemini" });

const AnalyzeMarketInputSchema = z.object({
  symbols: z.array(z.string().min(1)).min(1),
  context: z.record(z.unknown()),
});

const ScoreSetupInputSchema = z.object({
  features: z.record(z.unknown()),
  strategy: z.string().min(1),
});

const GeminiTextResponseSchema = z.object({
  response: z.string().min(1),
});

let client: GoogleGenerativeAI | null = null;

function getClient(): GoogleGenerativeAI {
  if (!client) {
    client = new GoogleGenerativeAI(config.gemini.apiKey);
  }
  return client;
}

function getModel(model?: string) {
  return getClient().getGenerativeModel({ model: model ?? config.gemini.model });
}

function assertGeminiEnabled(): void {
  if (!config.gemini.enabled) {
    throw new Error("Gemini provider is disabled");
  }
  if (!config.gemini.apiKey) {
    throw new Error("GEMINI_API_KEY is not configured");
  }
}

function extractText(response: unknown): string {
  if (!response || typeof response !== "object" || !("response" in response)) {
    return "";
  }

  const parsed = GeminiTextResponseSchema.safeParse(response);
  if (!parsed.success) {
    return "";
  }

  return parsed.data.response;
}

export async function generateContent(prompt: string, model?: string): Promise<string> {
  assertGeminiEnabled();
  const promptValue = z.string().min(1).parse(prompt);

  const result = await getModel(model).generateContent(promptValue);
  const text = extractText(result);

  if (!text) {
    log.warn({ model: model ?? config.gemini.model }, "Gemini returned an empty response");
    throw new Error("Gemini returned an empty response");
  }

  return text;
}

export async function analyzeMarket(symbols: readonly string[], context: Record<string, unknown>): Promise<string> {
  const input = AnalyzeMarketInputSchema.parse({ symbols, context });
  const prompt = [
    "You are a market analyst assistant.",
    `Analyze current market conditions for: ${input.symbols.join(", ")}.`,
    "Use this context (JSON):",
    JSON.stringify(input.context),
    "Return a concise analysis with key risks and opportunities.",
  ].join("\n\n");

  return generateContent(prompt);
}

export async function scoreSetup(features: Record<string, unknown>, strategy: string): Promise<string> {
  const input = ScoreSetupInputSchema.parse({ features, strategy });
  const prompt = [
    "You are a trading setup scoring assistant.",
    `Strategy: ${input.strategy}`,
    "Evaluate this setup feature payload (JSON):",
    JSON.stringify(input.features),
    "Provide a setup score from 0-100 and short rationale.",
  ].join("\n\n");

  return generateContent(prompt);
}
