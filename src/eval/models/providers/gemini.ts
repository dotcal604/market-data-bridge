import { GoogleGenAI } from "@google/genai";
import { evalConfig } from "../../config.js";
import { SYSTEM_PROMPT } from "../prompt.js";
import type { ModelEvaluation } from "../types.js";
import { ModelOutputSchema } from "../schema.js";
import { withTimeout } from "../../retry.js";

let genAI: GoogleGenAI | null = null;
const SYSTEM_PROMPT_CACHE_TTL_MS = 5 * 60 * 1000;

interface CachedSystemPromptRef {
  readonly name: string;
  readonly expiresAtMs: number;
}

let cachedSystemPromptRef: CachedSystemPromptRef | null = null;

function getGenAI(): GoogleGenAI {
  if (!genAI) {
    genAI = new GoogleGenAI({ apiKey: evalConfig.googleAiApiKey });
  }
  return genAI;
}

async function getCachedSystemPromptName(): Promise<string | null> {
  const now = Date.now();
  if (cachedSystemPromptRef && cachedSystemPromptRef.expiresAtMs > now) {
    return cachedSystemPromptRef.name;
  }

  const cachedContent = await getGenAI().caches.create({
    model: evalConfig.geminiModel,
    config: {
      systemInstruction: SYSTEM_PROMPT,
      ttl: "300s",
    },
  });

  if (!cachedContent.name) {
    return null;
  }

  cachedSystemPromptRef = {
    name: cachedContent.name,
    expiresAtMs: now + SYSTEM_PROMPT_CACHE_TTL_MS,
  };
  return cachedSystemPromptRef.name;
}

function extractText(response: unknown): string {
  if (typeof response === "object" && response !== null && "text" in response) {
    const maybeText = (response as { text: unknown }).text;
    if (typeof maybeText === "string") {
      return maybeText;
    }
  }
  return "";
}

function extractTokenCount(response: unknown): number {
  if (typeof response !== "object" || response === null || !('usageMetadata' in response)) {
    return 0;
  }

  const usage = (response as { usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; inputTokenCount?: number; outputTokenCount?: number } }).usageMetadata;
  if (!usage) {
    return 0;
  }

  const promptTokens = usage.promptTokenCount ?? usage.inputTokenCount ?? 0;
  const outputTokens = usage.candidatesTokenCount ?? usage.outputTokenCount ?? 0;
  return promptTokens + outputTokens;
}

/**
 * Evaluate a trade with Gemini (Google GenAI).
 * @param userPrompt The user prompt string
 * @param promptHash Hash of the prompt for drift detection
 * @returns Promise resolving to a ModelEvaluation object
 */
export async function evaluateWithGemini(
  userPrompt: string,
  promptHash: string,
): Promise<ModelEvaluation> {
  const start = Date.now();
  const timestamp = new Date().toISOString();

  if (!evalConfig.googleAiApiKey) {
    return { model_id: "gemini", output: null, raw_response: "", latency_ms: Date.now() - start, error: "GOOGLE_AI_API_KEY not configured", compliant: false, model_version: evalConfig.geminiModel, prompt_hash: promptHash, token_count: 0, api_response_id: "", timestamp };
  }

  try {
    const cachedSystemPromptName = await getCachedSystemPromptName();

    const response = await withTimeout(
      getGenAI().models.generateContent({
        model: evalConfig.geminiModel,
        contents: userPrompt,
        config: {
          ...(cachedSystemPromptName
            ? { cachedContent: cachedSystemPromptName }
            : { systemInstruction: SYSTEM_PROMPT }),
          temperature: evalConfig.modelTemperature,
          maxOutputTokens: 1024,
          responseMimeType: "application/json",
        },
      }),
      evalConfig.modelTimeoutMs,
      "gemini",
    );

    const raw = extractText(response);
    const tokenCount = extractTokenCount(response);

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { model_id: "gemini", output: null, raw_response: raw, latency_ms: Date.now() - start, error: "JSON parse failed", compliant: false, model_version: evalConfig.geminiModel, prompt_hash: promptHash, token_count: tokenCount, api_response_id: "", timestamp };
    }

    const result = ModelOutputSchema.safeParse(parsed);
    if (!result.success) {
      return { model_id: "gemini", output: null, raw_response: raw, latency_ms: Date.now() - start, error: `Schema validation failed: ${result.error.message}`, compliant: false, model_version: evalConfig.geminiModel, prompt_hash: promptHash, token_count: tokenCount, api_response_id: "", timestamp };
    }

    return { model_id: "gemini", output: result.data, raw_response: raw, latency_ms: Date.now() - start, error: null, compliant: true, model_version: evalConfig.geminiModel, prompt_hash: promptHash, token_count: tokenCount, api_response_id: "", timestamp };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { model_id: "gemini", output: null, raw_response: "", latency_ms: Date.now() - start, error: msg, compliant: false, model_version: evalConfig.geminiModel, prompt_hash: promptHash, token_count: 0, api_response_id: "", timestamp };
  }
}
