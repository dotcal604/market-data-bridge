import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock dependencies
vi.mock("@google/genai", () => {
  const mockGenerateContent = vi.fn();
  
  return {
    GoogleGenAI: vi.fn().mockImplementation(() => ({
      models: {
        generateContent: mockGenerateContent,
      },
    })),
    _mockGenerateContent: mockGenerateContent,
  };
});

vi.mock("../logging.js", () => ({
  logger: {
    child: () => ({
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
    }),
  },
}));

vi.mock("../config.js", () => ({
  config: {
    orchestrator: {
      weights: {
        gpt: 0.4,
        gemini: 0.3,
        claude: 0.3,
      },
      requiredAgreement: 0.6,
    },
  },
}));

import { GoogleGenAI } from "@google/genai";
import { getGeminiTradeScore } from "../providers/gemini.js";
import { createOrchestrator, type ProviderScore } from "../orchestrator.js";

describe("Gemini Provider", () => {
  let mockGenerateContent: any;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = process.env;
    process.env = { ...originalEnv };
    
    // Get the mock function from the module
    const module = vi.mocked(await import("@google/genai"));
    mockGenerateContent = (module as any)._mockGenerateContent;
    
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("getGeminiTradeScore", () => {
    it("should return Gemini score with correct parameters", async () => {
      process.env.GOOGLE_AI_API_KEY = "test-key";
      process.env.GEMINI_MODEL = "gemini-2.0-flash";

      const mockResponse = {
        text: JSON.stringify({
          trade_score: 75,
          confidence: 0.85,
          reasoning: "Strong bullish momentum",
        }),
      };

      mockGenerateContent.mockResolvedValue(mockResponse);

      const features = {
        price: 150.25,
        volume: 1000000,
        trend: "up",
      };

      const result = await getGeminiTradeScore("AAPL", features);

      expect(result).toEqual({
        trade_score: 75,
        confidence: 0.85,
        reasoning: "Strong bullish momentum",
      });

      expect(mockGenerateContent).toHaveBeenCalledWith({
        model: "gemini-2.0-flash",
        contents: expect.stringContaining("Symbol: AAPL"),
        config: {
          temperature: 0,
          responseMimeType: "application/json",
        },
      });
    });

    it("should gracefully handle missing GOOGLE_AI_API_KEY", async () => {
      delete process.env.GOOGLE_AI_API_KEY;

      const features = { price: 150 };

      await expect(getGeminiTradeScore("AAPL", features)).rejects.toThrow(
        "GOOGLE_AI_API_KEY is not configured"
      );

      expect(mockGenerateContent).not.toHaveBeenCalled();
    });

    it("should use default model when GEMINI_MODEL is not set", async () => {
      process.env.GOOGLE_AI_API_KEY = "test-key";
      delete process.env.GEMINI_MODEL;

      const mockResponse = {
        text: JSON.stringify({
          trade_score: 50,
        }),
      };

      mockGenerateContent.mockResolvedValue(mockResponse);

      await getGeminiTradeScore("AAPL", {});

      expect(mockGenerateContent).toHaveBeenCalledWith({
        model: "gemini-2.5-flash",
        contents: expect.any(String),
        config: {
          temperature: 0,
          responseMimeType: "application/json",
        },
      });
    });

    it("should handle invalid JSON response", async () => {
      process.env.GOOGLE_AI_API_KEY = "test-key";

      const mockResponse = {
        text: "Invalid JSON {]",
      };

      mockGenerateContent.mockResolvedValue(mockResponse);

      await expect(getGeminiTradeScore("AAPL", {})).rejects.toThrow(
        "Gemini response was not valid JSON"
      );
    });

    it("should handle schema validation failure", async () => {
      process.env.GOOGLE_AI_API_KEY = "test-key";

      const mockResponse = {
        text: JSON.stringify({
          trade_score: 150, // Invalid: exceeds max of 100
          confidence: 1.5, // Invalid: exceeds max of 1
        }),
      };

      mockGenerateContent.mockResolvedValue(mockResponse);

      await expect(getGeminiTradeScore("AAPL", {})).rejects.toThrow(
        "Gemini response did not match expected schema"
      );
    });

    it("should handle missing trade_score in response", async () => {
      process.env.GOOGLE_AI_API_KEY = "test-key";

      const mockResponse = {
        text: JSON.stringify({
          confidence: 0.8,
          reasoning: "Some reasoning",
          // Missing trade_score
        }),
      };

      mockGenerateContent.mockResolvedValue(mockResponse);

      await expect(getGeminiTradeScore("AAPL", {})).rejects.toThrow(
        "Gemini response did not match expected schema"
      );
    });

    it("should accept optional confidence and reasoning", async () => {
      process.env.GOOGLE_AI_API_KEY = "test-key";

      const mockResponse = {
        text: JSON.stringify({
          trade_score: 60,
          // No confidence or reasoning
        }),
      };

      mockGenerateContent.mockResolvedValue(mockResponse);

      const result = await getGeminiTradeScore("AAPL", {});

      expect(result).toEqual({
        trade_score: 60,
      });
    });

    it("should handle network timeout", async () => {
      process.env.GOOGLE_AI_API_KEY = "test-key";

      mockGenerateContent.mockRejectedValue(new Error("Network timeout"));

      await expect(getGeminiTradeScore("AAPL", {})).rejects.toThrow(
        "Network timeout"
      );
    });

    it("should pass features in prompt", async () => {
      process.env.GOOGLE_AI_API_KEY = "test-key";

      const mockResponse = {
        text: JSON.stringify({ trade_score: 70 }),
      };

      mockGenerateContent.mockResolvedValue(mockResponse);

      const features = {
        rsi: 65,
        volume: 2000000,
        trend: "bullish",
      };

      await getGeminiTradeScore("TSLA", features);

      const callArgs = mockGenerateContent.mock.calls[0][0];
      expect(callArgs.contents).toContain("Symbol: TSLA");
      expect(callArgs.contents).toContain(JSON.stringify(features));
    });
  });

  describe("Orchestrator Gemini Integration", () => {
    it("should call Gemini provider with correct params in ensemble", async () => {
      process.env.GOOGLE_AI_API_KEY = "test-key";

      const mockResponse = {
        text: JSON.stringify({
          trade_score: 72,
          confidence: 0.9,
          reasoning: "Gemini analysis",
        }),
      };

      mockGenerateContent.mockResolvedValue(mockResponse);

      const queryGeminiSpy = vi.fn(async (symbol: string, features: Record<string, unknown>): Promise<ProviderScore> => {
        const gemini = await getGeminiTradeScore(symbol, features);
        return {
          provider: "gemini",
          score: gemini.trade_score,
          confidence: gemini.confidence,
          reasoning: gemini.reasoning,
        };
      });

      const orchestrator = createOrchestrator({
        queryGpt: async () => ({ provider: "gpt", score: 70 }),
        queryGemini: queryGeminiSpy,
        queryClaude: async () => ({ provider: "claude", score: 68 }),
      });

      const features = { momentum: "strong" };
      const result = await orchestrator.collectEnsembleScores("AAPL", features);

      expect(queryGeminiSpy).toHaveBeenCalledWith("AAPL", features);
      expect(result.scores).toContainEqual(
        expect.objectContaining({
          provider: "gemini",
          score: 72,
          confidence: 0.9,
          reasoning: "Gemini analysis",
        })
      );
    });

    it("should handle Gemini failure gracefully in ensemble", async () => {
      const orchestrator = createOrchestrator({
        queryGpt: async () => ({ provider: "gpt", score: 80 }),
        queryGemini: async () => {
          throw new Error("Gemini API unavailable");
        },
        queryClaude: async () => ({ provider: "claude", score: 75 }),
      });

      const result = await orchestrator.collectEnsembleScores("MSFT", {});

      expect(result.scores).toHaveLength(2);
      expect(result.scores).toContainEqual(
        expect.objectContaining({ provider: "gpt" })
      );
      expect(result.scores).toContainEqual(
        expect.objectContaining({ provider: "claude" })
      );
      expect(result.scores).not.toContainEqual(
        expect.objectContaining({ provider: "gemini" })
      );
    });

    it("should compute consensus with 2/3 providers when Gemini fails", async () => {
      const orchestrator = createOrchestrator({
        queryGpt: async () => ({ provider: "gpt", score: 70 }),
        queryGemini: async () => {
          throw new Error("GOOGLE_AI_API_KEY is not configured");
        },
        queryClaude: async () => ({ provider: "claude", score: 72 }),
      });

      const result = await orchestrator.collectEnsembleScores("NVDA", {});

      expect(result.scores).toHaveLength(2);
      expect(result.consensus).toBe("buy");
      expect(result.weightedScore).toBeCloseTo(71, 5);
    });

    it("should compute consensus with 2/3 providers when GPT fails", async () => {
      process.env.GOOGLE_AI_API_KEY = "test-key";

      const mockResponse = {
        text: JSON.stringify({ trade_score: 65 }),
      };

      mockGenerateContent.mockResolvedValue(mockResponse);

      const queryGemini = async (symbol: string, features: Record<string, unknown>): Promise<ProviderScore> => {
        const gemini = await getGeminiTradeScore(symbol, features);
        return {
          provider: "gemini",
          score: gemini.trade_score,
        };
      };

      const orchestrator = createOrchestrator({
        queryGpt: async () => {
          throw new Error("OPENAI_API_KEY is not configured");
        },
        queryGemini,
        queryClaude: async () => ({ provider: "claude", score: 63 }),
      });

      const result = await orchestrator.collectEnsembleScores("AMD", {});

      expect(result.scores).toHaveLength(2);
      expect(result.scores).toContainEqual(
        expect.objectContaining({ provider: "gemini", score: 65 })
      );
      expect(result.scores).toContainEqual(
        expect.objectContaining({ provider: "claude", score: 63 })
      );
    });

    it("should fail when all providers are unavailable", async () => {
      const orchestrator = createOrchestrator({
        queryGpt: async () => {
          throw new Error("GPT unavailable");
        },
        queryGemini: async () => {
          throw new Error("Gemini unavailable");
        },
        queryClaude: async () => {
          throw new Error("Claude unavailable");
        },
      });

      await expect(
        orchestrator.collectEnsembleScores("FAIL", {})
      ).rejects.toThrow("No model providers were available for ensemble scoring");
    });

    it("should validate Gemini score with schema before including in ensemble", async () => {
      const orchestrator = createOrchestrator({
        queryGpt: async () => ({ provider: "gpt", score: 70 }),
        queryGemini: async () => ({
          provider: "gemini",
          score: 999, // Invalid score > 100
          confidence: 0.8,
        } as ProviderScore),
        queryClaude: async () => ({ provider: "claude", score: 68 }),
      });

      const result = await orchestrator.collectEnsembleScores("BAD", {});

      // Invalid Gemini score should be filtered out
      expect(result.scores).toHaveLength(2);
      expect(result.scores).not.toContainEqual(
        expect.objectContaining({ provider: "gemini" })
      );
    });

    it("should handle Gemini returning malformed score object", async () => {
      const orchestrator = createOrchestrator({
        queryGpt: async () => ({ provider: "gpt", score: 70 }),
        queryGemini: async () => {
          // Missing provider field
          return { score: 75 } as ProviderScore;
        },
        queryClaude: async () => ({ provider: "claude", score: 68 }),
      });

      const result = await orchestrator.collectEnsembleScores("MALFORMED", {});

      // Malformed Gemini response should be filtered out
      expect(result.scores).toHaveLength(2);
    });

    it("should compute weighted score correctly with Gemini included", async () => {
      const orchestrator = createOrchestrator({
        queryGpt: async () => ({ provider: "gpt", score: 80 }), // weight: 0.4
        queryGemini: async () => ({ provider: "gemini", score: 50 }), // weight: 0.3
        queryClaude: async () => ({ provider: "claude", score: 20 }), // weight: 0.3
      });

      const result = await orchestrator.collectEnsembleScores("WEIGHTED", {});

      // (80*0.4 + 50*0.3 + 20*0.3) / (0.4+0.3+0.3) = (32 + 15 + 6) / 1.0 = 53
      expect(result.weightedScore).toBeCloseTo(53, 5);
    });
  });

  describe("Timeout Handling", () => {
    it("should handle Gemini API timeout", async () => {
      process.env.GOOGLE_AI_API_KEY = "test-key";

      mockGenerateContent.mockImplementation(
        () => new Promise((_, reject) => {
          setTimeout(() => reject(new Error("Request timeout")), 100);
        })
      );

      await expect(getGeminiTradeScore("TIMEOUT", {})).rejects.toThrow(
        "Request timeout"
      );
    });

    it("should handle slow Gemini response in ensemble", async () => {
      const slowGemini = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return { provider: "gemini", score: 60 } as ProviderScore;
      });

      const orchestrator = createOrchestrator({
        queryGpt: async () => ({ provider: "gpt", score: 70 }),
        queryGemini: slowGemini,
        queryClaude: async () => ({ provider: "claude", score: 65 }),
      });

      const result = await orchestrator.collectEnsembleScores("SLOW", {});

      expect(slowGemini).toHaveBeenCalled();
      expect(result.scores).toHaveLength(3);
      expect(result.scores).toContainEqual(
        expect.objectContaining({ provider: "gemini" })
      );
    });
  });
});
