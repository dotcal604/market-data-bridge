import { existsSync } from "node:fs";
import type { config } from "./config.js";

/**
 * Validation result with errors (fatal) and warnings (non-fatal).
 */
export interface ValidationResult {
  errors: string[];
  warnings: string[];
}

/**
 * Validates configuration values.
 * 
 * Checks:
 * - REST port is in valid range (1-65535)
 * - IBKR port is in valid range (1-65535)
 * - IBKR host is set
 * - API key is at least 16 characters (warning if shorter)
 * - Holly watch path exists if set
 * - Drift thresholds are in valid range (0-1)
 * - REST port and IBKR port don't conflict
 * - autoEval.maxConcurrent is in valid range (1-20)
 * - autoEval.dedupWindowMin is positive
 * - ibkr.orderTimeoutMs is positive
 * - ibkr.executionTimeoutMs is positive and >= orderTimeoutMs
 * - ibkr.clientId is in valid range (0-32)
 * - gemini.timeoutMs is positive
 * - Risk defaults are in valid range (0-100)
 * - At least one model API key is configured (warning)
 * 
 * @param cfg - Configuration object from config.ts
 * @returns ValidationResult with arrays of error and warning messages
 */
export function validateConfig(cfg: typeof config): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Validate REST port range
  if (!isValidPort(cfg.rest.port)) {
    errors.push(`REST port must be between 1 and 65535, got ${cfg.rest.port}`);
  }

  if (!cfg.ibkr.host) {
    errors.push("IBKR host is required");
  }

  // Validate IBKR port range
  if (!isValidPort(cfg.ibkr.port)) {
    errors.push(`IBKR port must be between 1 and 65535, got ${cfg.ibkr.port}`);
  }

  // Check for port conflicts
  if (cfg.rest.port === cfg.ibkr.port) {
    errors.push(`REST port (${cfg.rest.port}) and IBKR port (${cfg.ibkr.port}) must be different`);
  }

  // Warn if API key is too short (non-fatal, but insecure)
  if (cfg.rest.apiKey && cfg.rest.apiKey.length < 16) {
    warnings.push(`REST API key is only ${cfg.rest.apiKey.length} characters (recommended: at least 16)`);
  }

  // Check Holly watch path exists if set
  if (cfg.holly.watchPath && !existsSync(cfg.holly.watchPath)) {
    warnings.push(`Holly watch path does not exist: ${cfg.holly.watchPath}`);
  }

  // Validate drift accuracy threshold
  if (!isValidThreshold(cfg.drift.accuracyThreshold)) {
    errors.push(`Drift accuracy threshold must be between 0 and 1, got ${cfg.drift.accuracyThreshold}`);
  }

  // Validate drift calibration threshold
  if (!isValidThreshold(cfg.drift.calibrationThreshold)) {
    errors.push(`Drift calibration threshold must be between 0 and 1, got ${cfg.drift.calibrationThreshold}`);
  }

  // Validate autoEval.maxConcurrent
  if (!Number.isInteger(cfg.autoEval.maxConcurrent) || cfg.autoEval.maxConcurrent < 1 || cfg.autoEval.maxConcurrent > 20) {
    errors.push(`autoEval.maxConcurrent must be between 1 and 20, got ${cfg.autoEval.maxConcurrent}`);
  }

  // Validate autoEval.dedupWindowMin
  if (!Number.isInteger(cfg.autoEval.dedupWindowMin) || cfg.autoEval.dedupWindowMin <= 0) {
    errors.push(`autoEval.dedupWindowMin must be positive, got ${cfg.autoEval.dedupWindowMin}`);
  }

  // Validate ibkr.orderTimeoutMs
  if (!Number.isInteger(cfg.ibkr.orderTimeoutMs) || cfg.ibkr.orderTimeoutMs <= 0) {
    errors.push(`ibkr.orderTimeoutMs must be positive, got ${cfg.ibkr.orderTimeoutMs}`);
  }

  // Validate ibkr.executionTimeoutMs
  if (!Number.isInteger(cfg.ibkr.executionTimeoutMs) || cfg.ibkr.executionTimeoutMs <= 0) {
    errors.push(`ibkr.executionTimeoutMs must be positive, got ${cfg.ibkr.executionTimeoutMs}`);
  }

  // Validate executionTimeoutMs >= orderTimeoutMs
  if (cfg.ibkr.executionTimeoutMs < cfg.ibkr.orderTimeoutMs) {
    errors.push(`ibkr.executionTimeoutMs (${cfg.ibkr.executionTimeoutMs}) must be >= ibkr.orderTimeoutMs (${cfg.ibkr.orderTimeoutMs})`);
  }

  // Validate ibkr.clientId
  if (!Number.isInteger(cfg.ibkr.clientId) || cfg.ibkr.clientId < 0 || cfg.ibkr.clientId > 32) {
    errors.push(`ibkr.clientId must be between 0 and 32, got ${cfg.ibkr.clientId}`);
  }

  // Validate gemini.timeoutMs
  if (!Number.isInteger(cfg.gemini.timeoutMs) || cfg.gemini.timeoutMs <= 0) {
    errors.push(`gemini.timeoutMs must be positive, got ${cfg.gemini.timeoutMs}`);
  }

  // Validate risk defaults
  if (!isValidPercentage(cfg.risk.riskPercent)) {
    errors.push(`risk.riskPercent must be between 0 and 100, got ${cfg.risk.riskPercent}`);
  }

  if (!isValidPercentage(cfg.risk.maxPositionPercent)) {
    errors.push(
      `risk.maxPositionPercent must be between 0 and 100, got ${cfg.risk.maxPositionPercent}`
    );
  }

  // Warn if no model API keys are configured
  if (!cfg.models.anthropicApiKey && !cfg.models.openaiApiKey && !cfg.models.googleApiKey) {
    warnings.push("No model API keys configured (Anthropic/OpenAI/Gemini) — Yahoo fallback only");
  }

  return { errors, warnings };
}

/**
 * Checks if a port number is in the valid range (1-65535).
 */
function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

/**
 * Checks if a threshold value is in the valid range (0-1).
 */
function isValidThreshold(threshold: number): boolean {
  return !isNaN(threshold) && threshold >= 0 && threshold <= 1;
}

function isValidPercentage(value: number): boolean {
  return !isNaN(value) && value > 0 && value <= 100;
}
