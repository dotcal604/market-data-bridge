import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGenerateContent = vi.fn();

vi.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: class {
    constructor(_apiKey: string) {}

    getGenerativeModel() {
      return {
        generateContent: mockGenerateContent,
      };
    }
  },
}));

import { config } from "../../config.js";
import { analyzeMarket, generateContent, scoreSetup } from "../gemini.js";

describe("Gemini provider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    config.gemini.enabled = true;
    config.gemini.apiKey = "test-key";
  });

  it("generateContent returns Gemini text", async () => {
    mockGenerateContent.mockResolvedValue({ response: "Hello from Gemini" });

    const result = await generateContent("Test prompt");

    expect(result).toBe("Hello from Gemini");
    expect(mockGenerateContent).toHaveBeenCalledWith("Test prompt");
  });

  it("analyzeMarket builds prompt with symbols and context", async () => {
    mockGenerateContent.mockResolvedValue({ response: "Market analysis" });

    const result = await analyzeMarket(["AAPL", "MSFT"], { marketSession: "regular" });

    expect(result).toBe("Market analysis");
    expect(mockGenerateContent).toHaveBeenCalledOnce();
    const prompt = mockGenerateContent.mock.calls[0]?.[0] as string;
    expect(prompt).toContain("AAPL, MSFT");
    expect(prompt).toContain("marketSession");
  });

  it("scoreSetup builds scoring prompt", async () => {
    mockGenerateContent.mockResolvedValue({ response: "Score: 78/100" });

    const result = await scoreSetup({ rvol: 1.8, atrPct: 2.1 }, "Opening Range Breakout");

    expect(result).toBe("Score: 78/100");
    const prompt = mockGenerateContent.mock.calls[0]?.[0] as string;
    expect(prompt).toContain("Opening Range Breakout");
    expect(prompt).toContain("rvol");
  });

  it("throws when provider is disabled", async () => {
    config.gemini.enabled = false;

    await expect(generateContent("Prompt")).rejects.toThrow("disabled");
  });

  it("throws when Gemini returns empty response", async () => {
    mockGenerateContent.mockResolvedValue({ response: "" });

    await expect(generateContent("Prompt")).rejects.toThrow("empty response");
  });
});
