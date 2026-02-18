export const evalConfig = {
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  googleAiApiKey: process.env.GOOGLE_AI_API_KEY ?? "",

  claudeModel: process.env.CLAUDE_MODEL ?? "claude-sonnet-4-20250514",
  openaiModel: process.env.OPENAI_MODEL ?? "gpt-4o",
  geminiModel: process.env.GEMINI_MODEL ?? "gemini-2.5-flash",

  modelTemperature: parseFloat(process.env.MODEL_TEMPERATURE ?? "0"),
  modelTimeoutMs: parseInt(process.env.MODEL_TIMEOUT_MS ?? "30000", 10),

  // Ensemble
  disagreementPenaltyK: 1.5,
  minModelWeight: 0.15,

  // Guardrails
  tradingWindowStart: 9 * 60 + 30, // 9:30 ET in minutes
  tradingWindowEnd: 15 * 60 + 55,  // 15:55 ET
  maxConsecutiveLosses: 3,
  minOutcomesSoft: parseInt(process.env.MIN_OUTCOMES_SOFT ?? "30", 10),
  minOutcomesHard: parseInt(process.env.MIN_OUTCOMES_HARD ?? "10", 10),
} as const;
