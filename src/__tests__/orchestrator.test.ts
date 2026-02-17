import { describe, expect, it } from "vitest";
import { createOrchestrator, formatDisagreements, getConsensusVerdict, type ProviderScore } from "../orchestrator.js";

describe("orchestrator", () => {
  it("collectEnsembleScores computes weighted score and agreement", async () => {
    const sut = createOrchestrator({
      queryGpt: async () => ({ provider: "gpt", score: 80 }),
      queryGemini: async () => ({ provider: "gemini", score: 50 }),
      queryClaude: async () => ({ provider: "claude", score: 20 }),
    });

    const result = await sut.collectEnsembleScores("AAPL", { trend: "up" });

    expect(result.scores).toHaveLength(3);
    expect(result.weightedScore).toBeCloseTo(53, 5);
    expect(result.consensus).toBe("neutral");
    expect(result.meetsRequiredAgreement).toBe(false);
  });

  it("collectEnsembleScores returns available providers when one fails", async () => {
    const sut = createOrchestrator({
      queryGpt: async () => ({ provider: "gpt", score: 72 }),
      queryGemini: async () => ({ provider: "gemini", score: 68 }),
      queryClaude: async () => {
        throw new Error("MCP session unavailable");
      },
    });

    const result = await sut.collectEnsembleScores("MSFT", {});

    expect(result.scores).toHaveLength(2);
    expect(result.consensus).toBe("buy");
  });

  it("getConsensusVerdict maps score bands", () => {
    const strongSell: ProviderScore[] = [{ provider: "gpt", score: 10 }];
    const sell: ProviderScore[] = [{ provider: "gpt", score: 25 }];
    const neutral: ProviderScore[] = [{ provider: "gpt", score: 45 }];
    const buy: ProviderScore[] = [{ provider: "gpt", score: 65 }];
    const strongBuy: ProviderScore[] = [{ provider: "gpt", score: 90 }];

    expect(getConsensusVerdict(strongSell)).toBe("strong_sell");
    expect(getConsensusVerdict(sell)).toBe("sell");
    expect(getConsensusVerdict(neutral)).toBe("neutral");
    expect(getConsensusVerdict(buy)).toBe("buy");
    expect(getConsensusVerdict(strongBuy)).toBe("strong_buy");
  });

  it("formatDisagreements flags large spread", () => {
    const notes = formatDisagreements([
      { provider: "gpt", score: 88 },
      { provider: "gemini", score: 45 },
      { provider: "claude", score: 18 },
    ]);

    expect(notes.some((line) => line.includes("High score spread"))).toBe(true);
    expect(notes.some((line) => line.includes("bullish"))).toBe(true);
    expect(notes.some((line) => line.includes("bearish"))).toBe(true);
  });
});
