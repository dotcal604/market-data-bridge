import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from "vitest";

// Prevent dotenv from re-reading .env file on module re-import
vi.mock("dotenv", () => ({ default: { config: () => {} }, config: () => {} }));

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

  // ── REST_API_KEY startup validation ──────────────────────────────────

  describe("REST_API_KEY startup validation", () => {
    let consoleErrorSpy: MockInstance;

    beforeEach(() => {
      consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
      consoleErrorSpy.mockRestore();
    });

    it("throws in production when REST_API_KEY is not set", async () => {
      vi.stubEnv("NODE_ENV", "production");
      // REST_API_KEY is deleted by clearEnv() in the outer beforeEach
      await expect(loadConfig()).rejects.toThrow("FATAL: REST_API_KEY");
    });

    it("throws in production when REST_API_KEY is fewer than 16 characters", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("REST_API_KEY", "short-key");
      await expect(loadConfig()).rejects.toThrow("FATAL: REST_API_KEY");
    });

    it("does not throw in production when REST_API_KEY is exactly 16 characters", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("REST_API_KEY", "1234567890abcdef"); // exactly 16 chars
      const cfg = await loadConfig();
      expect(cfg.rest.apiKey).toBe("1234567890abcdef");
    });

    it("does not throw in production when REST_API_KEY is longer than 16 characters", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("REST_API_KEY", "a-long-valid-api-key-for-production");
      const cfg = await loadConfig();
      expect(cfg.rest.apiKey).toBe("a-long-valid-api-key-for-production");
    });

    it("logs a warning in dev mode when REST_API_KEY is not set", async () => {
      vi.stubEnv("NODE_ENV", "development");
      const cfg = await loadConfig();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("WARNING: REST_API_KEY"),
      );
      expect(cfg.rest.apiKey).toBe("");
    });

    it("logs a warning in dev mode when REST_API_KEY is fewer than 16 characters", async () => {
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("REST_API_KEY", "short");
      const cfg = await loadConfig();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("WARNING: REST_API_KEY"),
      );
      expect(cfg.rest.apiKey).toBe("short");
    });

    it("does not warn in dev mode when REST_API_KEY meets the minimum length", async () => {
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("REST_API_KEY", "a-valid-dev-key-16");
      await loadConfig();
      const warningCalls = consoleErrorSpy.mock.calls.filter((args) =>
        String(args[0]).includes("WARNING: REST_API_KEY"),
      );
      expect(warningCalls).toHaveLength(0);
    });
  });
});

