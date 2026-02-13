import Anthropic from "@anthropic-ai/sdk";
import { evalConfig } from "../../config.js";
import { SYSTEM_PROMPT } from "../prompt.js";
import type { ModelEvaluation } from "../types.js";
import { ModelOutputSchema } from "../schema.js";
import { withTimeout } from "../../retry.js";

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: evalConfig.anthropicApiKey });
  }
  return client;
}

export async function evaluateWithClaude(
  userPrompt: string,
  promptHash: string,
): Promise<ModelEvaluation> {
  const start = Date.now();
  const timestamp = new Date().toISOString();

  if (!evalConfig.anthropicApiKey) {
    return {
      model_id: "claude",
      output: null,
      raw_response: "",
      latency_ms: Date.now() - start,
      error: "ANTHROPIC_API_KEY not configured",
      compliant: false,
      model_version: evalConfig.claudeModel,
      prompt_hash: promptHash,
      token_count: 0,
      api_response_id: "",
      timestamp,
    };
  }

  try {
    const response = await withTimeout(
      getClient().messages.create({
        model: evalConfig.claudeModel,
        max_tokens: 1024,
        temperature: evalConfig.modelTemperature,
        system: [
          {
            type: "text",
            text: SYSTEM_PROMPT,
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [{ role: "user", content: userPrompt }],
      }),
      evalConfig.modelTimeoutMs,
      "claude",
    );

    const raw = response.content[0]?.type === "text" ? response.content[0].text : "";
    const tokenCount = (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0);

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { model_id: "claude", output: null, raw_response: raw, latency_ms: Date.now() - start, error: "JSON parse failed", compliant: false, model_version: evalConfig.claudeModel, prompt_hash: promptHash, token_count: tokenCount, api_response_id: response.id ?? "", timestamp };
    }

    const result = ModelOutputSchema.safeParse(parsed);
    if (!result.success) {
      return { model_id: "claude", output: null, raw_response: raw, latency_ms: Date.now() - start, error: `Schema validation failed: ${result.error.message}`, compliant: false, model_version: evalConfig.claudeModel, prompt_hash: promptHash, token_count: tokenCount, api_response_id: response.id ?? "", timestamp };
    }

    return { model_id: "claude", output: result.data, raw_response: raw, latency_ms: Date.now() - start, error: null, compliant: true, model_version: evalConfig.claudeModel, prompt_hash: promptHash, token_count: tokenCount, api_response_id: response.id ?? "", timestamp };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { model_id: "claude", output: null, raw_response: "", latency_ms: Date.now() - start, error: msg, compliant: false, model_version: evalConfig.claudeModel, prompt_hash: promptHash, token_count: 0, api_response_id: "", timestamp };
  }
}
