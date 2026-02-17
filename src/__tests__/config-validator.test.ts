import { describe, it, expect } from "vitest";
import { validateConfig } from "../config-validator.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("validateConfig", () => {
  it("should pass validation for a valid config", () => {
    const validConfig = {
      ibkr: {
        host: "127.0.0.1",
        port: 7496,
        clientId: 0,
        maxClientIdRetries: 5,
        orderTimeoutMs: 10000,
        executionTimeoutMs: 15000,
      },
      rest: {
        port: 3000,
        apiKey: "this-is-a-secure-api-key-with-16-chars",
      },
      holly: {
        watchPath: "",
        pollIntervalMs: 5000,
      },
      drift: {
        accuracyThreshold: 0.55,
        calibrationThreshold: 0.15,
        enabled: true,
      },
      autoEval: { enabled: false, dedupWindowMin: 5, maxConcurrent: 3 },
      orchestrator: { weights: { gpt: 0.4, gemini: 0.3, claude: 0.3 }, requiredAgreement: 0.6 },
      divoom: { enabled: false, deviceIp: "", refreshIntervalMs: 10000, brightness: 80 },
      gemini: { apiKey: "", model: "gemini-2.0-flash", timeoutMs: 10000 },
    };

    const result = validateConfig(validConfig);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("should return error for invalid REST port (too low)", () => {
    const config = {
      ibkr: { host: "127.0.0.1", port: 7496, clientId: 0, maxClientIdRetries: 5, orderTimeoutMs: 10000, executionTimeoutMs: 15000 },
      rest: { port: 0, apiKey: "secure-api-key-16+" },
      holly: { watchPath: "", pollIntervalMs: 5000 },
      drift: { accuracyThreshold: 0.55, calibrationThreshold: 0.15, enabled: true },
      autoEval: { enabled: false, dedupWindowMin: 5, maxConcurrent: 3 },
    };

    const result = validateConfig(config);
    expect(result.errors).toContain("REST port must be between 1 and 65535, got 0");
  });

  it("should return error for invalid REST port (too high)", () => {
    const config = {
      ibkr: { host: "127.0.0.1", port: 7496, clientId: 0, maxClientIdRetries: 5, orderTimeoutMs: 10000, executionTimeoutMs: 15000 },
      rest: { port: 65536, apiKey: "secure-api-key-16+" },
      holly: { watchPath: "", pollIntervalMs: 5000 },
      drift: { accuracyThreshold: 0.55, calibrationThreshold: 0.15, enabled: true },
      autoEval: { enabled: false, dedupWindowMin: 5, maxConcurrent: 3 },
    };

    const result = validateConfig(config);
    expect(result.errors).toContain("REST port must be between 1 and 65535, got 65536");
  });

  it("should return error for invalid IBKR port", () => {
    const config = {
      ibkr: { host: "127.0.0.1", port: -1, clientId: 0, maxClientIdRetries: 5, orderTimeoutMs: 10000, executionTimeoutMs: 15000 },
      rest: { port: 3000, apiKey: "secure-api-key-16+" },
      holly: { watchPath: "", pollIntervalMs: 5000 },
      drift: { accuracyThreshold: 0.55, calibrationThreshold: 0.15, enabled: true },
      autoEval: { enabled: false, dedupWindowMin: 5, maxConcurrent: 3 },
    };

    const result = validateConfig(config);
    expect(result.errors).toContain("IBKR port must be between 1 and 65535, got -1");
  });

  it("should return warning for short API key", () => {
    const config = {
      ibkr: { host: "127.0.0.1", port: 7496, clientId: 0, maxClientIdRetries: 5, orderTimeoutMs: 10000, executionTimeoutMs: 15000 },
      rest: { port: 3000, apiKey: "short" },
      holly: { watchPath: "", pollIntervalMs: 5000 },
      drift: { accuracyThreshold: 0.55, calibrationThreshold: 0.15, enabled: true },
      autoEval: { enabled: false, dedupWindowMin: 5, maxConcurrent: 3 },
    };

    const result = validateConfig(config);
    expect(result.warnings).toContain("REST API key is only 5 characters (recommended: at least 16)");
    expect(result.errors).toEqual([]);
  });

  it("should return warning for nonexistent Holly watch path", () => {
    const config = {
      ibkr: { host: "127.0.0.1", port: 7496, clientId: 0, maxClientIdRetries: 5, orderTimeoutMs: 10000, executionTimeoutMs: 15000 },
      rest: { port: 3000, apiKey: "secure-api-key-16+" },
      holly: { watchPath: "/nonexistent/path/to/holly.csv", pollIntervalMs: 5000 },
      drift: { accuracyThreshold: 0.55, calibrationThreshold: 0.15, enabled: true },
      autoEval: { enabled: false, dedupWindowMin: 5, maxConcurrent: 3 },
    };

    const result = validateConfig(config);
    expect(result.warnings).toContain("Holly watch path does not exist: /nonexistent/path/to/holly.csv");
    expect(result.errors).toEqual([]);
  });

  it("should not warn when Holly watch path is valid", () => {
    // Create a temporary directory
    const tempDir = mkdtempSync(join(tmpdir(), "config-test-"));
    
    try {
      const config = {
        ibkr: { host: "127.0.0.1", port: 7496, clientId: 0, maxClientIdRetries: 5, orderTimeoutMs: 10000, executionTimeoutMs: 15000 },
        rest: { port: 3000, apiKey: "secure-api-key-16+" },
        holly: { watchPath: tempDir, pollIntervalMs: 5000 },
        drift: { accuracyThreshold: 0.55, calibrationThreshold: 0.15, enabled: true },
        autoEval: { enabled: false, dedupWindowMin: 5, maxConcurrent: 3 },
      };

      const result = validateConfig(config);
      expect(result.warnings).toEqual([]);
      expect(result.errors).toEqual([]);
    } finally {
      // Clean up
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("should return error for drift threshold greater than 1", () => {
    const config = {
      ibkr: { host: "127.0.0.1", port: 7496, clientId: 0, maxClientIdRetries: 5, orderTimeoutMs: 10000, executionTimeoutMs: 15000 },
      rest: { port: 3000, apiKey: "secure-api-key-16+" },
      holly: { watchPath: "", pollIntervalMs: 5000 },
      drift: { accuracyThreshold: 1.5, calibrationThreshold: 0.15, enabled: true },
      autoEval: { enabled: false, dedupWindowMin: 5, maxConcurrent: 3 },
    };

    const result = validateConfig(config);
    expect(result.errors).toContain("Drift accuracy threshold must be between 0 and 1, got 1.5");
  });

  it("should return error for negative drift threshold", () => {
    const config = {
      ibkr: { host: "127.0.0.1", port: 7496, clientId: 0, maxClientIdRetries: 5, orderTimeoutMs: 10000, executionTimeoutMs: 15000 },
      rest: { port: 3000, apiKey: "secure-api-key-16+" },
      holly: { watchPath: "", pollIntervalMs: 5000 },
      drift: { accuracyThreshold: 0.55, calibrationThreshold: -0.1, enabled: true },
      autoEval: { enabled: false, dedupWindowMin: 5, maxConcurrent: 3 },
    };

    const result = validateConfig(config);
    expect(result.errors).toContain("Drift calibration threshold must be between 0 and 1, got -0.1");
  });

  it("should return error for conflicting ports", () => {
    const config = {
      ibkr: { host: "127.0.0.1", port: 3000, clientId: 0, maxClientIdRetries: 5, orderTimeoutMs: 10000, executionTimeoutMs: 15000 },
      rest: { port: 3000, apiKey: "secure-api-key-16+" },
      holly: { watchPath: "", pollIntervalMs: 5000 },
      drift: { accuracyThreshold: 0.55, calibrationThreshold: 0.15, enabled: true },
      autoEval: { enabled: false, dedupWindowMin: 5, maxConcurrent: 3 },
    };

    const result = validateConfig(config);
    expect(result.errors).toContain("REST port (3000) and IBKR port (3000) must be different");
  });

  it("should not error when optional fields are missing (empty string)", () => {
    const config = {
      ibkr: { host: "127.0.0.1", port: 7496, clientId: 0, maxClientIdRetries: 5, orderTimeoutMs: 10000, executionTimeoutMs: 15000 },
      rest: { port: 3000, apiKey: "" },
      holly: { watchPath: "", pollIntervalMs: 5000 },
      drift: { accuracyThreshold: 0.55, calibrationThreshold: 0.15, enabled: true },
      autoEval: { enabled: false, dedupWindowMin: 5, maxConcurrent: 3 },
    };

    const result = validateConfig(config);
    expect(result.errors).toEqual([]);
    // Should not warn about empty API key (it's optional)
    expect(result.warnings).toEqual([]);
  });

  it("should handle multiple errors and warnings simultaneously", () => {
    const config = {
      ibkr: { host: "127.0.0.1", port: 100000, clientId: 0, maxClientIdRetries: 5, orderTimeoutMs: 10000, executionTimeoutMs: 15000 },
      rest: { port: -5, apiKey: "short" },
      holly: { watchPath: "/fake/path", pollIntervalMs: 5000 },
      drift: { accuracyThreshold: 2.0, calibrationThreshold: -0.5, enabled: true },
      autoEval: { enabled: false, dedupWindowMin: 5, maxConcurrent: 3 },
    };

    const result = validateConfig(config);
    
    // Should have multiple errors
    expect(result.errors.length).toBeGreaterThan(2);
    expect(result.errors).toContain("REST port must be between 1 and 65535, got -5");
    expect(result.errors).toContain("IBKR port must be between 1 and 65535, got 100000");
    expect(result.errors).toContain("Drift accuracy threshold must be between 0 and 1, got 2");
    expect(result.errors).toContain("Drift calibration threshold must be between 0 and 1, got -0.5");
    
    // Should have warnings
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings).toContain("REST API key is only 5 characters (recommended: at least 16)");
    expect(result.warnings).toContain("Holly watch path does not exist: /fake/path");
  });

  it("should validate boundary values for ports", () => {
    const validLowPort = {
      ibkr: { host: "127.0.0.1", port: 7496, clientId: 0, maxClientIdRetries: 5, orderTimeoutMs: 10000, executionTimeoutMs: 15000 },
      rest: { port: 1, apiKey: "secure-api-key-16+" },
      holly: { watchPath: "", pollIntervalMs: 5000 },
      drift: { accuracyThreshold: 0.55, calibrationThreshold: 0.15, enabled: true },
      autoEval: { enabled: false, dedupWindowMin: 5, maxConcurrent: 3 },
    };
    expect(validateConfig(validLowPort).errors).toEqual([]);

    const validHighPort = {
      ibkr: { host: "127.0.0.1", port: 7496, clientId: 0, maxClientIdRetries: 5, orderTimeoutMs: 10000, executionTimeoutMs: 15000 },
      rest: { port: 65535, apiKey: "secure-api-key-16+" },
      holly: { watchPath: "", pollIntervalMs: 5000 },
      drift: { accuracyThreshold: 0.55, calibrationThreshold: 0.15, enabled: true },
      autoEval: { enabled: false, dedupWindowMin: 5, maxConcurrent: 3 },
    };
    expect(validateConfig(validHighPort).errors).toEqual([]);
  });

  it("should validate boundary values for drift thresholds", () => {
    const validZeroThreshold = {
      ibkr: { host: "127.0.0.1", port: 7496, clientId: 0, maxClientIdRetries: 5, orderTimeoutMs: 10000, executionTimeoutMs: 15000 },
      rest: { port: 3000, apiKey: "secure-api-key-16+" },
      holly: { watchPath: "", pollIntervalMs: 5000 },
      drift: { accuracyThreshold: 0.0, calibrationThreshold: 0.0, enabled: true },
      autoEval: { enabled: false, dedupWindowMin: 5, maxConcurrent: 3 },
    };
    expect(validateConfig(validZeroThreshold).errors).toEqual([]);

    const validMaxThreshold = {
      ibkr: { host: "127.0.0.1", port: 7496, clientId: 0, maxClientIdRetries: 5, orderTimeoutMs: 10000, executionTimeoutMs: 15000 },
      rest: { port: 3000, apiKey: "secure-api-key-16+" },
      holly: { watchPath: "", pollIntervalMs: 5000 },
      drift: { accuracyThreshold: 1.0, calibrationThreshold: 1.0, enabled: true },
      autoEval: { enabled: false, dedupWindowMin: 5, maxConcurrent: 3 },
    };
    expect(validateConfig(validMaxThreshold).errors).toEqual([]);
  });

  // autoEval validation tests
  it("should return error when autoEval.maxConcurrent is too low", () => {
    const config = {
      ibkr: { host: "127.0.0.1", port: 7496, clientId: 0, maxClientIdRetries: 5, orderTimeoutMs: 10000, executionTimeoutMs: 15000 },
      rest: { port: 3000, apiKey: "secure-api-key-16+" },
      holly: { watchPath: "", pollIntervalMs: 5000 },
      drift: { accuracyThreshold: 0.55, calibrationThreshold: 0.15, enabled: true },
      autoEval: { enabled: false, dedupWindowMin: 5, maxConcurrent: 0 },
    };

    const result = validateConfig(config);
    expect(result.errors).toContain("autoEval.maxConcurrent must be between 1 and 20, got 0");
  });

  it("should return error when autoEval.maxConcurrent is too high", () => {
    const config = {
      ibkr: { host: "127.0.0.1", port: 7496, clientId: 0, maxClientIdRetries: 5, orderTimeoutMs: 10000, executionTimeoutMs: 15000 },
      rest: { port: 3000, apiKey: "secure-api-key-16+" },
      holly: { watchPath: "", pollIntervalMs: 5000 },
      drift: { accuracyThreshold: 0.55, calibrationThreshold: 0.15, enabled: true },
      autoEval: { enabled: false, dedupWindowMin: 5, maxConcurrent: 21 },
    };

    const result = validateConfig(config);
    expect(result.errors).toContain("autoEval.maxConcurrent must be between 1 and 20, got 21");
  });

  it("should validate boundary values for autoEval.maxConcurrent", () => {
    const validMinConcurrent = {
      ibkr: { host: "127.0.0.1", port: 7496, clientId: 0, maxClientIdRetries: 5, orderTimeoutMs: 10000, executionTimeoutMs: 15000 },
      rest: { port: 3000, apiKey: "secure-api-key-16+" },
      holly: { watchPath: "", pollIntervalMs: 5000 },
      drift: { accuracyThreshold: 0.55, calibrationThreshold: 0.15, enabled: true },
      autoEval: { enabled: false, dedupWindowMin: 5, maxConcurrent: 1 },
    };
    expect(validateConfig(validMinConcurrent).errors).toEqual([]);

    const validMaxConcurrent = {
      ibkr: { host: "127.0.0.1", port: 7496, clientId: 0, maxClientIdRetries: 5, orderTimeoutMs: 10000, executionTimeoutMs: 15000 },
      rest: { port: 3000, apiKey: "secure-api-key-16+" },
      holly: { watchPath: "", pollIntervalMs: 5000 },
      drift: { accuracyThreshold: 0.55, calibrationThreshold: 0.15, enabled: true },
      autoEval: { enabled: false, dedupWindowMin: 5, maxConcurrent: 20 },
    };
    expect(validateConfig(validMaxConcurrent).errors).toEqual([]);
  });

  it("should return error when autoEval.dedupWindowMin is zero", () => {
    const config = {
      ibkr: { host: "127.0.0.1", port: 7496, clientId: 0, maxClientIdRetries: 5, orderTimeoutMs: 10000, executionTimeoutMs: 15000 },
      rest: { port: 3000, apiKey: "secure-api-key-16+" },
      holly: { watchPath: "", pollIntervalMs: 5000 },
      drift: { accuracyThreshold: 0.55, calibrationThreshold: 0.15, enabled: true },
      autoEval: { enabled: false, dedupWindowMin: 0, maxConcurrent: 3 },
    };

    const result = validateConfig(config);
    expect(result.errors).toContain("autoEval.dedupWindowMin must be positive, got 0");
  });

  it("should return error when autoEval.dedupWindowMin is negative", () => {
    const config = {
      ibkr: { host: "127.0.0.1", port: 7496, clientId: 0, maxClientIdRetries: 5, orderTimeoutMs: 10000, executionTimeoutMs: 15000 },
      rest: { port: 3000, apiKey: "secure-api-key-16+" },
      holly: { watchPath: "", pollIntervalMs: 5000 },
      drift: { accuracyThreshold: 0.55, calibrationThreshold: 0.15, enabled: true },
      autoEval: { enabled: false, dedupWindowMin: -5, maxConcurrent: 3 },
    };

    const result = validateConfig(config);
    expect(result.errors).toContain("autoEval.dedupWindowMin must be positive, got -5");
  });

  // IBKR timeout validation tests
  it("should return error when ibkr.orderTimeoutMs is zero", () => {
    const config = {
      ibkr: { host: "127.0.0.1", port: 7496, clientId: 0, maxClientIdRetries: 5, orderTimeoutMs: 0, executionTimeoutMs: 15000 },
      rest: { port: 3000, apiKey: "secure-api-key-16+" },
      holly: { watchPath: "", pollIntervalMs: 5000 },
      drift: { accuracyThreshold: 0.55, calibrationThreshold: 0.15, enabled: true },
      autoEval: { enabled: false, dedupWindowMin: 5, maxConcurrent: 3 },
    };

    const result = validateConfig(config);
    expect(result.errors).toContain("ibkr.orderTimeoutMs must be positive, got 0");
  });

  it("should return error when ibkr.orderTimeoutMs is negative", () => {
    const config = {
      ibkr: { host: "127.0.0.1", port: 7496, clientId: 0, maxClientIdRetries: 5, orderTimeoutMs: -1000, executionTimeoutMs: 15000 },
      rest: { port: 3000, apiKey: "secure-api-key-16+" },
      holly: { watchPath: "", pollIntervalMs: 5000 },
      drift: { accuracyThreshold: 0.55, calibrationThreshold: 0.15, enabled: true },
      autoEval: { enabled: false, dedupWindowMin: 5, maxConcurrent: 3 },
    };

    const result = validateConfig(config);
    expect(result.errors).toContain("ibkr.orderTimeoutMs must be positive, got -1000");
  });

  it("should return error when ibkr.executionTimeoutMs is zero", () => {
    const config = {
      ibkr: { host: "127.0.0.1", port: 7496, clientId: 0, maxClientIdRetries: 5, orderTimeoutMs: 10000, executionTimeoutMs: 0 },
      rest: { port: 3000, apiKey: "secure-api-key-16+" },
      holly: { watchPath: "", pollIntervalMs: 5000 },
      drift: { accuracyThreshold: 0.55, calibrationThreshold: 0.15, enabled: true },
      autoEval: { enabled: false, dedupWindowMin: 5, maxConcurrent: 3 },
    };

    const result = validateConfig(config);
    expect(result.errors).toContain("ibkr.executionTimeoutMs must be positive, got 0");
  });

  it("should return error when ibkr.executionTimeoutMs is negative", () => {
    const config = {
      ibkr: { host: "127.0.0.1", port: 7496, clientId: 0, maxClientIdRetries: 5, orderTimeoutMs: 10000, executionTimeoutMs: -5000 },
      rest: { port: 3000, apiKey: "secure-api-key-16+" },
      holly: { watchPath: "", pollIntervalMs: 5000 },
      drift: { accuracyThreshold: 0.55, calibrationThreshold: 0.15, enabled: true },
      autoEval: { enabled: false, dedupWindowMin: 5, maxConcurrent: 3 },
    };

    const result = validateConfig(config);
    expect(result.errors).toContain("ibkr.executionTimeoutMs must be positive, got -5000");
  });

  it("should return error when ibkr.executionTimeoutMs is less than orderTimeoutMs", () => {
    const config = {
      ibkr: { host: "127.0.0.1", port: 7496, clientId: 0, maxClientIdRetries: 5, orderTimeoutMs: 10000, executionTimeoutMs: 5000 },
      rest: { port: 3000, apiKey: "secure-api-key-16+" },
      holly: { watchPath: "", pollIntervalMs: 5000 },
      drift: { accuracyThreshold: 0.55, calibrationThreshold: 0.15, enabled: true },
      autoEval: { enabled: false, dedupWindowMin: 5, maxConcurrent: 3 },
    };

    const result = validateConfig(config);
    expect(result.errors).toContain("ibkr.executionTimeoutMs (5000) must be >= ibkr.orderTimeoutMs (10000)");
  });

  it("should pass validation when ibkr.executionTimeoutMs equals orderTimeoutMs", () => {
    const config = {
      ibkr: { host: "127.0.0.1", port: 7496, clientId: 0, maxClientIdRetries: 5, orderTimeoutMs: 10000, executionTimeoutMs: 10000 },
      rest: { port: 3000, apiKey: "secure-api-key-16+" },
      holly: { watchPath: "", pollIntervalMs: 5000 },
      drift: { accuracyThreshold: 0.55, calibrationThreshold: 0.15, enabled: true },
      autoEval: { enabled: false, dedupWindowMin: 5, maxConcurrent: 3 },
    };

    const result = validateConfig(config);
    expect(result.errors).toEqual([]);
  });

  // IBKR clientId validation tests
  it("should return error when ibkr.clientId is negative", () => {
    const config = {
      ibkr: { host: "127.0.0.1", port: 7496, clientId: -1, maxClientIdRetries: 5, orderTimeoutMs: 10000, executionTimeoutMs: 15000 },
      rest: { port: 3000, apiKey: "secure-api-key-16+" },
      holly: { watchPath: "", pollIntervalMs: 5000 },
      drift: { accuracyThreshold: 0.55, calibrationThreshold: 0.15, enabled: true },
      autoEval: { enabled: false, dedupWindowMin: 5, maxConcurrent: 3 },
    };

    const result = validateConfig(config);
    expect(result.errors).toContain("ibkr.clientId must be between 0 and 32, got -1");
  });

  it("should return error when ibkr.clientId is too high", () => {
    const config = {
      ibkr: { host: "127.0.0.1", port: 7496, clientId: 33, maxClientIdRetries: 5, orderTimeoutMs: 10000, executionTimeoutMs: 15000 },
      rest: { port: 3000, apiKey: "secure-api-key-16+" },
      holly: { watchPath: "", pollIntervalMs: 5000 },
      drift: { accuracyThreshold: 0.55, calibrationThreshold: 0.15, enabled: true },
      autoEval: { enabled: false, dedupWindowMin: 5, maxConcurrent: 3 },
    };

    const result = validateConfig(config);
    expect(result.errors).toContain("ibkr.clientId must be between 0 and 32, got 33");
  });

  it("should validate boundary values for ibkr.clientId", () => {
    const validMinClientId = {
      ibkr: { host: "127.0.0.1", port: 7496, clientId: 0, maxClientIdRetries: 5, orderTimeoutMs: 10000, executionTimeoutMs: 15000 },
      rest: { port: 3000, apiKey: "secure-api-key-16+" },
      holly: { watchPath: "", pollIntervalMs: 5000 },
      drift: { accuracyThreshold: 0.55, calibrationThreshold: 0.15, enabled: true },
      autoEval: { enabled: false, dedupWindowMin: 5, maxConcurrent: 3 },
    };
    expect(validateConfig(validMinClientId).errors).toEqual([]);

    const validMaxClientId = {
      ibkr: { host: "127.0.0.1", port: 7496, clientId: 32, maxClientIdRetries: 5, orderTimeoutMs: 10000, executionTimeoutMs: 15000 },
      rest: { port: 3000, apiKey: "secure-api-key-16+" },
      holly: { watchPath: "", pollIntervalMs: 5000 },
      drift: { accuracyThreshold: 0.55, calibrationThreshold: 0.15, enabled: true },
      autoEval: { enabled: false, dedupWindowMin: 5, maxConcurrent: 3 },
    };
    expect(validateConfig(validMaxClientId).errors).toEqual([]);
  });

  // Gemini timeout validation tests
  it("should return error when gemini.timeoutMs is zero", () => {
    const config = {
      ibkr: { host: "127.0.0.1", port: 7496, clientId: 0, maxClientIdRetries: 5, orderTimeoutMs: 10000, executionTimeoutMs: 15000 },
      rest: { port: 3000, apiKey: "secure-api-key-16+" },
      holly: { watchPath: "", pollIntervalMs: 5000 },
      drift: { accuracyThreshold: 0.55, calibrationThreshold: 0.15, enabled: true },
      autoEval: { enabled: false, dedupWindowMin: 5, maxConcurrent: 3 },
      orchestrator: { weights: { gpt: 0.4, gemini: 0.3, claude: 0.3 }, requiredAgreement: 0.6 },
      divoom: { enabled: false, deviceIp: "", refreshIntervalMs: 10000, brightness: 80 },
      gemini: { apiKey: "", model: "gemini-2.0-flash", timeoutMs: 0 },
    };

    const result = validateConfig(config);
    expect(result.errors).toContain("gemini.timeoutMs must be positive, got 0");
  });

  it("should return error when gemini.timeoutMs is negative", () => {
    const config = {
      ibkr: { host: "127.0.0.1", port: 7496, clientId: 0, maxClientIdRetries: 5, orderTimeoutMs: 10000, executionTimeoutMs: 15000 },
      rest: { port: 3000, apiKey: "secure-api-key-16+" },
      holly: { watchPath: "", pollIntervalMs: 5000 },
      drift: { accuracyThreshold: 0.55, calibrationThreshold: 0.15, enabled: true },
      autoEval: { enabled: false, dedupWindowMin: 5, maxConcurrent: 3 },
      orchestrator: { weights: { gpt: 0.4, gemini: 0.3, claude: 0.3 }, requiredAgreement: 0.6 },
      divoom: { enabled: false, deviceIp: "", refreshIntervalMs: 10000, brightness: 80 },
      gemini: { apiKey: "", model: "gemini-2.0-flash", timeoutMs: -1000 },
    };

    const result = validateConfig(config);
    expect(result.errors).toContain("gemini.timeoutMs must be positive, got -1000");
  });

  it("should pass validation when gemini.timeoutMs is positive", () => {
    const config = {
      ibkr: { host: "127.0.0.1", port: 7496, clientId: 0, maxClientIdRetries: 5, orderTimeoutMs: 10000, executionTimeoutMs: 15000 },
      rest: { port: 3000, apiKey: "secure-api-key-16+" },
      holly: { watchPath: "", pollIntervalMs: 5000 },
      drift: { accuracyThreshold: 0.55, calibrationThreshold: 0.15, enabled: true },
      autoEval: { enabled: false, dedupWindowMin: 5, maxConcurrent: 3 },
      orchestrator: { weights: { gpt: 0.4, gemini: 0.3, claude: 0.3 }, requiredAgreement: 0.6 },
      divoom: { enabled: false, deviceIp: "", refreshIntervalMs: 10000, brightness: 80 },
      gemini: { apiKey: "", model: "gemini-2.0-flash", timeoutMs: 10000 },
    };

    const result = validateConfig(config);
    expect(result.errors).toEqual([]);
  });
});
