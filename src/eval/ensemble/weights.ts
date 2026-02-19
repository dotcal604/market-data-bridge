import { readFileSync, writeFileSync, watchFile, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { EnsembleWeights } from "./types.js";
import { logger } from "../../logging.js";
import { insertWeightHistory } from "../../db/database.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEIGHTS_PATH = join(__dirname, "..", "..", "..", "data", "weights.json");

const DEFAULT_WEIGHTS: EnsembleWeights = {
  claude: 0.333,
  gpt4o: 0.333,
  gemini: 0.334,
  k: 1.5,
  updated_at: new Date().toISOString(),
  sample_size: 0,
  source: "default",
};

let currentWeights: EnsembleWeights = { ...DEFAULT_WEIGHTS };

function loadFromDisk(): void {
  try {
    if (!existsSync(WEIGHTS_PATH)) {
      logger.warn("weights.json not found, using defaults");
      return;
    }
    const raw = readFileSync(WEIGHTS_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    currentWeights = {
      claude: parsed.claude ?? DEFAULT_WEIGHTS.claude,
      gpt4o: parsed.gpt4o ?? DEFAULT_WEIGHTS.gpt4o,
      gemini: parsed.gemini ?? DEFAULT_WEIGHTS.gemini,
      k: parsed.k ?? DEFAULT_WEIGHTS.k,
      updated_at: parsed.updated_at ?? DEFAULT_WEIGHTS.updated_at,
      sample_size: parsed.sample_size ?? 0,
      source: parsed.source ?? "file",
      regime_overrides: parsed.regime_overrides,
    };
    logger.info(`[Weights] Loaded: claude=${currentWeights.claude} gpt4o=${currentWeights.gpt4o} gemini=${currentWeights.gemini} k=${currentWeights.k} (n=${currentWeights.sample_size})`);
    if (currentWeights.regime_overrides) {
      logger.info(`[Weights] Regime overrides loaded: ${Object.keys(currentWeights.regime_overrides).join(", ")}`);
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error(`[Weights] Failed to load weights.json: ${msg}`);
  }
}

/**
 * Initialize weights subsystem (load from disk + watch for changes).
 */
export function initWeights(): void {
  loadFromDisk();
  if (existsSync(WEIGHTS_PATH)) {
    watchFile(WEIGHTS_PATH, { interval: 5000 }, () => {
      logger.info("[Weights] weights.json changed, reloading...");
      loadFromDisk();
    });
  }
}

/**
 * Get weights for ensemble scoring. If regime is provided and overrides exist,
 * returns regime-specific weights. Otherwise returns default weights.
 * @param regime - Volatility regime: "low", "normal", or "high"
 * @returns Active ensemble weights
 */
export function getWeights(regime?: string): EnsembleWeights {
  const baseWeights = { ...currentWeights };
  
  // If regime is provided and overrides exist, apply them
  if (regime && baseWeights.regime_overrides) {
    const override = regime === "high" 
      ? baseWeights.regime_overrides.high
      : regime === "low"
      ? baseWeights.regime_overrides.low
      : null;
    
    if (override) {
      return {
        ...baseWeights,
        claude: override.claude,
        gpt4o: override.gpt4o,
        gemini: override.gemini,
        k: override.k,
      };
    }
  }
  
  return baseWeights;
}

/**
 * Update weights (writes to disk, updates in-memory, records in weight_history).
 * @param newWeights - Partial weights object (missing fields use current values)
 * @param source - Source of the update (e.g., "manual", "recalibration", "simulation")
 * @returns Updated weights object
 */
export function updateWeights(
  newWeights: Partial<Pick<EnsembleWeights, "claude" | "gpt4o" | "gemini" | "k" | "sample_size">>,
  source: string = "manual"
): EnsembleWeights {
  const updated: EnsembleWeights = {
    claude: newWeights.claude ?? currentWeights.claude,
    gpt4o: newWeights.gpt4o ?? currentWeights.gpt4o,
    gemini: newWeights.gemini ?? currentWeights.gemini,
    k: newWeights.k ?? currentWeights.k,
    sample_size: newWeights.sample_size ?? currentWeights.sample_size,
    updated_at: new Date().toISOString(),
    source,
  };

  // Validate weights sum to ~1.0
  const sum = updated.claude + updated.gpt4o + updated.gemini;
  if (Math.abs(sum - 1.0) > 0.01) {
    throw new Error(`Weights must sum to 1.0 (got ${sum.toFixed(3)})`);
  }

  // Write to disk
  writeFileSync(WEIGHTS_PATH, JSON.stringify(updated, null, 2), "utf-8");
  logger.info(`[Weights] Updated: claude=${updated.claude} gpt4o=${updated.gpt4o} gemini=${updated.gemini} k=${updated.k} source=${source}`);

  // Update in-memory (file watcher will also trigger, but this is immediate)
  currentWeights = updated;

  // Record in history (spread to plain object for DB function)
  insertWeightHistory({ ...updated }, source);

  return updated;
}
