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
 * - API key is at least 16 characters (warning if shorter)
 * - Holly watch path exists if set
 * - Drift thresholds are in valid range (0-1)
 * - REST port and IBKR port don't conflict
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
