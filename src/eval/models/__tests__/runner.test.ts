import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ModelEvaluation } from "../types.js";
import type { ModelFeatureVector } from "../../features/types.js";
import { evaluateAllModels } from "../runner.js";

const { evaluateWithClaudeMock, evaluateWithGPTMock, evaluateWithGeminiMock } = vi.hoisted(() => ({
  evaluateWithClaudeMock: vi.fn(),
  evaluateWithGPTMock: vi.fn(),
  evaluateWithGeminiMock: vi.fn(),
}));

vi.mock("../providers/claude.js", () => ({
  evaluateWithClaude: evaluateWithClaudeMock,
}));

vi.mock("../providers/openai.js", () => ({
  evaluateWithGPT: evaluateWithGPTMock,
}));

vi.mock("../providers/gemini.js", () => ({
  evaluateWithGemini: evaluateWithGeminiMock,
}));

const baseFeatures: ModelFeatureVector = {
  symbol: "AAPL",
  timestamp: "2025-01-01T14:30:00.000Z",
  last: 220,
  bid: 219.95,
  ask: 220.05,
  open: 218,
  high: 221,
  low: 217.5,
  close_prev: 217,
  volume: 5_000_000,
  rvol: 1.8,
  vwap_deviation_pct: 0.4,
  spread_pct: 0.05,
  float_rotation_est: 0.12,
  volume_acceleration: 1.5,
  atr_14: 3.1,
  atr_pct: 1.4,
  price_extension_pct: 0.8,
  gap_pct: 0.5,
  range_position_pct: 72,
  volatility_regime: "normal",
  liquidity_bucket: "large",
  spy_change_pct: 0.2,
  qqq_change_pct: 0.3,
  market_alignment: "aligned_bull",
  time_of_day: "morning",
  minutes_since_open: 60,
};

function compliantEvaluation(modelId: ModelEvaluation["model_id"]): ModelEvaluation {
  return {
    model_id: modelId,
    output: {
      trade_score: 70,
      extension_risk: 30,
      exhaustion_risk: 25,
      float_rotation_risk: 15,
      market_alignment: 40,
      expected_rr: 2,
      confidence: 75,
      should_trade: true,
      reasoning: "Strong trend and liquidity.",
    },
    raw_response: "{}",
    latency_ms: 100,
    error: null,
    compliant: true,
    model_version: `${modelId}-test`,
    prompt_hash: "testhash",
    token_count: 100,
    api_response_id: `${modelId}-resp`,
    timestamp: "2025-01-01T14:30:00.000Z",
  };
}

describe("evaluateAllModels", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns all compliant model evaluations", async () => {
    evaluateWithClaudeMock.mockResolvedValue(compliantEvaluation("claude"));
    evaluateWithGPTMock.mockResolvedValue(compliantEvaluation("gpt4o"));
    evaluateWithGeminiMock.mockResolvedValue(compliantEvaluation("gemini"));

    const result = await evaluateAllModels("AAPL", "long", 220, 217, baseFeatures);

    expect(result.evaluations).toHaveLength(3);
    expect(result.evaluations.every((e) => e.compliant)).toBe(true);
    expect(result.userPrompt).toContain("Evaluate this potential long trade for AAPL.");
    expect(result.promptHash).toHaveLength(16);
  });

  it("passes the same prompt and hash to all providers", async () => {
    evaluateWithClaudeMock.mockResolvedValue(compliantEvaluation("claude"));
    evaluateWithGPTMock.mockResolvedValue(compliantEvaluation("gpt4o"));
    evaluateWithGeminiMock.mockResolvedValue(compliantEvaluation("gemini"));

    const result = await evaluateAllModels("AAPL", "short", 220, 222, baseFeatures);

    expect(evaluateWithClaudeMock).toHaveBeenCalledTimes(1);
    expect(evaluateWithGPTMock).toHaveBeenCalledTimes(1);
    expect(evaluateWithGeminiMock).toHaveBeenCalledTimes(1);

    const claudeArgs = evaluateWithClaudeMock.mock.calls[0] as [string, string];
    const gptArgs = evaluateWithGPTMock.mock.calls[0] as [string, string];
    const geminiArgs = evaluateWithGeminiMock.mock.calls[0] as [string, string];

    expect(claudeArgs[0]).toBe(result.userPrompt);
    expect(gptArgs[0]).toBe(result.userPrompt);
    expect(geminiArgs[0]).toBe(result.userPrompt);

    expect(claudeArgs[1]).toBe(result.promptHash);
    expect(gptArgs[1]).toBe(result.promptHash);
    expect(geminiArgs[1]).toBe(result.promptHash);
  });

  it("maps a rejected provider to a non-compliant fallback evaluation", async () => {
    evaluateWithClaudeMock.mockResolvedValue(compliantEvaluation("claude"));
    evaluateWithGPTMock.mockRejectedValue(new Error("gpt timeout"));
    evaluateWithGeminiMock.mockResolvedValue(compliantEvaluation("gemini"));

    const result = await evaluateAllModels("AAPL", "long", 220, 217, baseFeatures);

    expect(result.evaluations).toHaveLength(3);
    const failures = result.evaluations.filter((e) => !e.compliant);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.error).toBe("gpt timeout");
    expect(failures[0]?.output).toBeNull();
    expect(failures[0]?.prompt_hash).toBe(result.promptHash);
  });

  it("maps multiple rejected providers to fallback evaluations", async () => {
    evaluateWithClaudeMock.mockRejectedValue(new Error("claude down"));
    evaluateWithGPTMock.mockResolvedValue(compliantEvaluation("gpt4o"));
    evaluateWithGeminiMock.mockRejectedValue(new Error("gemini down"));

    const result = await evaluateAllModels("AAPL", "long", 220, 217, baseFeatures);

    expect(result.evaluations.filter((e) => e.compliant)).toHaveLength(1);
    expect(result.evaluations.filter((e) => !e.compliant)).toHaveLength(2);
    for (const failure of result.evaluations.filter((e) => !e.compliant)) {
      expect(failure.timestamp).toBeTypeOf("string");
      expect(failure.model_id).toBe("claude");
    }
  });

  it("runs provider calls concurrently", async () => {
    let resolveClaude!: (value: ModelEvaluation) => void;
    let resolveGpt!: (value: ModelEvaluation) => void;
    let resolveGemini!: (value: ModelEvaluation) => void;

    evaluateWithClaudeMock.mockReturnValue(new Promise<ModelEvaluation>((resolve) => {
      resolveClaude = resolve;
    }));
    evaluateWithGPTMock.mockReturnValue(new Promise<ModelEvaluation>((resolve) => {
      resolveGpt = resolve;
    }));
    evaluateWithGeminiMock.mockReturnValue(new Promise<ModelEvaluation>((resolve) => {
      resolveGemini = resolve;
    }));

    const pending = evaluateAllModels("AAPL", "long", 220, 217, baseFeatures);

    expect(evaluateWithClaudeMock).toHaveBeenCalledTimes(1);
    expect(evaluateWithGPTMock).toHaveBeenCalledTimes(1);
    expect(evaluateWithGeminiMock).toHaveBeenCalledTimes(1);

    resolveClaude(compliantEvaluation("claude"));
    resolveGpt(compliantEvaluation("gpt4o"));
    resolveGemini(compliantEvaluation("gemini"));

    const result = await pending;
    expect(result.evaluations).toHaveLength(3);
  });

  it("uses unknown error when rejection reason has no message", async () => {
    evaluateWithClaudeMock.mockResolvedValue(compliantEvaluation("claude"));
    evaluateWithGPTMock.mockRejectedValue({});
    evaluateWithGeminiMock.mockResolvedValue(compliantEvaluation("gemini"));

    const result = await evaluateAllModels("AAPL", "long", 220, 217, baseFeatures);
    const failure = result.evaluations.find((e) => !e.compliant);

    expect(failure?.error).toBe("Unknown error");
  });
});
