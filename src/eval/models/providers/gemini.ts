import { GoogleGenerativeAI } from "@google/generative-ai";
import { evalConfig } from "../../config.js";
import { SYSTEM_PROMPT } from "../prompt.js";
import type { ModelEvaluation } from "../types.js";
import { ModelOutputSchema } from "../schema.js";
import { withTimeout } from "../../retry.js";

let genAI: GoogleGenerativeAI | null = null;

function getGenAI(): GoogleGenerativeAI {
  if (!genAI) {
    genAI = new GoogleGenerativeAI(evalConfig.googleAiApiKey);
  }
  return genAI;
}

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
    const model = getGenAI().getGenerativeModel({
      model: evalConfig.geminiModel,
      systemInstruction: SYSTEM_PROMPT,
      generationConfig: {
        temperature: evalConfig.modelTemperature,
        maxOutputTokens: 1024,
        responseMimeType: "application/json",
      },
    });

    const response = await withTimeout(
      model.generateContent(userPrompt),
      evalConfig.modelTimeoutMs,
      "gemini",
    );

    const raw = response.response.text();
    const usage = response.response.usageMetadata;
    const tokenCount = (usage?.promptTokenCount ?? 0) + (usage?.candidatesTokenCount ?? 0);

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
