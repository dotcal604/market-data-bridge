import OpenAI from "openai";
import { evalConfig } from "../../config.js";
import { SYSTEM_PROMPT } from "../prompt.js";
import type { ModelEvaluation } from "../types.js";
import { ModelOutputSchema } from "../schema.js";
import { withTimeout } from "../../retry.js";

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({ apiKey: evalConfig.openaiApiKey });
  }
  return client;
}

/**
 * Evaluate a trade with GPT-4o (OpenAI).
 * @param userPrompt The user prompt string
 * @param promptHash Hash of the prompt for drift detection
 * @returns Promise resolving to a ModelEvaluation object
 */
export async function evaluateWithGPT(
  userPrompt: string,
  promptHash: string,
): Promise<ModelEvaluation> {
  const start = Date.now();
  const timestamp = new Date().toISOString();

  if (!evalConfig.openaiApiKey) {
    return { model_id: "gpt4o", output: null, raw_response: "", latency_ms: Date.now() - start, error: "OPENAI_API_KEY not configured", compliant: false, model_version: evalConfig.openaiModel, prompt_hash: promptHash, token_count: 0, api_response_id: "", timestamp };
  }

  try {
    const response = await withTimeout(
      getClient().chat.completions.create({
        model: evalConfig.openaiModel,
        temperature: evalConfig.modelTemperature,
        max_tokens: 1024,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
      }),
      evalConfig.modelTimeoutMs,
      "gpt4o",
    );

    const raw = response.choices[0]?.message?.content ?? "";
    const tokenCount = (response.usage?.prompt_tokens ?? 0) + (response.usage?.completion_tokens ?? 0);

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { model_id: "gpt4o", output: null, raw_response: raw, latency_ms: Date.now() - start, error: "JSON parse failed", compliant: false, model_version: evalConfig.openaiModel, prompt_hash: promptHash, token_count: tokenCount, api_response_id: response.id ?? "", timestamp };
    }

    const result = ModelOutputSchema.safeParse(parsed);
    if (!result.success) {
      return { model_id: "gpt4o", output: null, raw_response: raw, latency_ms: Date.now() - start, error: `Schema validation failed: ${result.error.message}`, compliant: false, model_version: evalConfig.openaiModel, prompt_hash: promptHash, token_count: tokenCount, api_response_id: response.id ?? "", timestamp };
    }

    return { model_id: "gpt4o", output: result.data, raw_response: raw, latency_ms: Date.now() - start, error: null, compliant: true, model_version: evalConfig.openaiModel, prompt_hash: promptHash, token_count: tokenCount, api_response_id: response.id ?? "", timestamp };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { model_id: "gpt4o", output: null, raw_response: "", latency_ms: Date.now() - start, error: msg, compliant: false, model_version: evalConfig.openaiModel, prompt_hash: promptHash, token_count: 0, api_response_id: "", timestamp };
  }
}
