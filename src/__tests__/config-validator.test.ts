import { describe, it, expect } from "vitest";
import { validateConfig } from "../config-validator.js";
import { config as baseConfig } from "../config.js";

type ConfigShape = typeof baseConfig;

const makeConfig = (overrides: Partial<ConfigShape>): ConfigShape => ({
  ...baseConfig,
  ...overrides,
  ibkr: { ...baseConfig.ibkr, ...overrides.ibkr },
  rest: { ...baseConfig.rest, ...overrides.rest },
  holly: { ...baseConfig.holly, ...overrides.holly },
  drift: { ...baseConfig.drift, ...overrides.drift },
  autoEval: { ...baseConfig.autoEval, ...overrides.autoEval },
  orchestrator: { ...baseConfig.orchestrator, ...overrides.orchestrator },
  divoom: { ...baseConfig.divoom, ...overrides.divoom },
  ops: { ...baseConfig.ops, ...overrides.ops },
  risk: { ...baseConfig.risk, ...overrides.risk },
  models: { ...baseConfig.models, ...overrides.models },
  gemini: { ...baseConfig.gemini, ...overrides.gemini },
  inbox: { ...baseConfig.inbox, ...overrides.inbox },
});

describe("config-validator", () => {
  it("returns no errors for a valid configuration", () => {
    const result = validateConfig(
      makeConfig({ models: { anthropicApiKey: "anthropic-key" } })
    );
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it("returns an error when IBKR host is missing", () => {
    const cfg = makeConfig({ ibkr: { host: "" } });
    const result = validateConfig(cfg);
    expect(result.errors).toContain("IBKR host is required");
  });

  it("returns errors for invalid port values", () => {
    const cfg = makeConfig({ rest: { port: 0 }, ibkr: { port: -1 } });
    const result = validateConfig(cfg);
    expect(result.errors).toContain("REST port must be between 1 and 65535, got 0");
    expect(result.errors).toContain("IBKR port must be between 1 and 65535, got -1");
  });

  it("returns an error when riskPercent exceeds 100", () => {
    const cfg = makeConfig({ risk: { riskPercent: 150 } });
    const result = validateConfig(cfg);
    expect(result.errors).toContain("risk.riskPercent must be between 0 and 100, got 150");
  });

  it("warns when no model API keys are configured", () => {
    const cfg = makeConfig({
      models: { anthropicApiKey: "", openaiApiKey: "", googleApiKey: "" },
    });
    const result = validateConfig(cfg);
    expect(result.warnings).toContain(
      "No model API keys configured (Anthropic/OpenAI/Gemini) — Yahoo fallback only"
    );
  });

  it("returns an error for non-numeric ports", () => {
    const cfg = makeConfig({ rest: { port: Number.NaN } });
    const result = validateConfig(cfg);
    expect(result.errors).toContain("REST port must be between 1 and 65535, got NaN");
  });
});
