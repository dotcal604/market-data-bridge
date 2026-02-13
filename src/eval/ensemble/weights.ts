import { readFileSync, watchFile, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { EnsembleWeights } from "./types.js";
import { logger } from "../../logging.js";

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
    };
    logger.info(`[Weights] Loaded: claude=${currentWeights.claude} gpt4o=${currentWeights.gpt4o} gemini=${currentWeights.gemini} k=${currentWeights.k} (n=${currentWeights.sample_size})`);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error(`[Weights] Failed to load weights.json: ${msg}`);
  }
}

export function initWeights(): void {
  loadFromDisk();
  if (existsSync(WEIGHTS_PATH)) {
    watchFile(WEIGHTS_PATH, { interval: 5000 }, () => {
      logger.info("[Weights] weights.json changed, reloading...");
      loadFromDisk();
    });
  }
}

export function getWeights(): EnsembleWeights {
  return { ...currentWeights };
}
