import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const clearEnv = () => {
  const keys = [
    "IBKR_PORT",
    "REST_PORT",
    "REST_API_KEY",
    "RISK_PERCENT",
    "MAX_POSITION_PERCENT",
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "GOOGLE_AI_API_KEY",
    "GOOGLE_API_KEY",
    "AUTO_EVAL_ENABLED",
    "DRIFT_ALERTS_ENABLED",
    "DIVOOM_ENABLED",
  ];
  for (const key of keys) {
    delete process.env[key];
  }
};

const loadConfig = async () => {
  const module = await import("../config.js");
  return module.config;
};

describe("config", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    clearEnv();
  });

  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    clearEnv();
  });

  it("uses paper trading defaults when IBKR_PORT is not set", async () => {
    const cfg = await loadConfig();
    expect(cfg.ibkr.port).toBe(7497);
    expect(cfg.rest.port).toBe(3000);
  });

  it("reads REST_API_KEY into rest.apiKey", async () => {
    vi.stubEnv("REST_API_KEY", "super-secret");
    const cfg = await loadConfig();
    expect(cfg.rest.apiKey).toBe("super-secret");
  });

  it("uses IBKR_PORT environment override when provided", async () => {
    vi.stubEnv("IBKR_PORT", "7500");
    const cfg = await loadConfig();
    expect(cfg.ibkr.port).toBe(7500);
  });

  it("applies risk defaults of 1% risk and 10% max position", async () => {
    const cfg = await loadConfig();
    expect(cfg.risk.riskPercent).toBe(1);
    expect(cfg.risk.maxPositionPercent).toBe(10);
  });

  it("reads model API keys from environment variables", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "anthropic-key");
    vi.stubEnv("OPENAI_API_KEY", "openai-key");
    vi.stubEnv("GOOGLE_API_KEY", "google-key");
    const cfg = await loadConfig();
    expect(cfg.models.anthropicApiKey).toBe("anthropic-key");
    expect(cfg.models.openaiApiKey).toBe("openai-key");
    expect(cfg.models.googleApiKey).toBe("google-key");
    expect(cfg.gemini.apiKey).toBe("google-key");
  });

  it("parses boolean-like environment variables correctly", async () => {
    vi.stubEnv("DRIFT_ALERTS_ENABLED", "false");
    vi.stubEnv("AUTO_EVAL_ENABLED", "true");
    vi.stubEnv("DIVOOM_ENABLED", "true");
    const cfg = await loadConfig();
    expect(cfg.drift.enabled).toBe(false);
    expect(cfg.autoEval.enabled).toBe(true);
    expect(cfg.divoom.enabled).toBe(true);
  });
});
