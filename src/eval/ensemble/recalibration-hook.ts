/**
 * Recalibration Hook — Wires Bayesian weight updates into the outcome recording flow.
 *
 * Two calibration strategies:
 *   1. Incremental (Bayesian) — on every recorded outcome, nudge model weights
 *   2. Batch — after every N outcomes, compute Brier-based recalibration
 *
 * Persistence: Bayesian priors stored in data/bayesian-state.json, hot-loaded on init.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "../../logging.js";
import {
  getModelOutputsForEval,
  getEvaluationById,
} from "../../db/database.js";
import { bayesianUpdater, type ModelId, type MarketRegime } from "./bayesian-updater.js";
import { updateWeights, getWeights } from "./weights.js";
import type { EnsembleWeights } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_PATH = join(__dirname, "..", "..", "..", "data", "bayesian-state.json");

const log = logger.child({ subsystem: "recalibration" });

// Recalibration thresholds
const BATCH_RECALIBRATION_INTERVAL = 50; // outcomes between batch recalibrations
const MIN_WEIGHT_CHANGE = 0.01; // suppress updates smaller than this
const MAX_WEIGHT_DELTA = 0.10; // cap single Bayesian update to prevent wild swings

let outcomeSinceLastRecal = 0;

// ── Persistence ────────────────────────────────────────────────────────────

function loadBayesianState(): void {
  try {
    if (!existsSync(STATE_PATH)) return;
    const raw = readFileSync(STATE_PATH, "utf-8");
    bayesianUpdater.fromJSON(raw);
    log.info("Bayesian priors loaded from disk");
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    log.warn({ err: msg }, "Failed to load bayesian-state.json, using default priors");
  }
}

function saveBayesianState(): void {
  try {
    writeFileSync(STATE_PATH, bayesianUpdater.toJSON(), "utf-8");
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error({ err: msg }, "Failed to save bayesian-state.json");
  }
}

// ── Model ID mapping ───────────────────────────────────────────────────────

/** Map model_id from model_outputs table to BayesianUpdater's ModelId */
function toModelId(modelId: string): ModelId | null {
  const lower = modelId.toLowerCase();
  if (lower.includes("claude") || lower.includes("anthropic")) return "claude";
  if (lower.includes("gpt") || lower.includes("openai")) return "openai";
  if (lower.includes("gemini") || lower.includes("google")) return "gemini";
  return null;
}

/** Map volatility_regime from evaluation to MarketRegime */
function toMarketRegime(regime: string | null | undefined): MarketRegime {
  if (!regime) return "TRENDING";
  const lower = regime.toLowerCase();
  if (lower === "high" || lower === "extreme") return "VOLATILE";
  if (lower === "low") return "CHOP";
  return "TRENDING"; // "normal" → TRENDING
}

// ── Incremental Bayesian Update ────────────────────────────────────────────

/**
 * Called after every outcome recording. Reads the eval's model outputs,
 * determines which models predicted correctly, and nudges Bayesian priors.
 * @param evaluationId Evaluation ID
 * @param rMultiple Trade result (R-multiple)
 * @param tradeTaken Whether the trade was taken
 */
export function onOutcomeRecorded(
  evaluationId: string,
  rMultiple: number | null,
  tradeTaken: boolean,
): void {
  if (!tradeTaken || rMultiple == null) return;

  try {
    const evaluation = getEvaluationById(evaluationId) as any;
    if (!evaluation) return;

    const modelOutputs = getModelOutputsForEval(evaluationId) as Array<{
      model_id: string;
      trade_score: number;
      should_trade: number;
      direction?: string;
    }>;

    if (modelOutputs.length === 0) return;

    const actualDirection = rMultiple > 0 ? 1 : -1;
    const regime = toMarketRegime(evaluation.volatility_regime);

    // Build predictions map
    const predictions: Record<ModelId, number> = { claude: 0, gemini: 0, openai: 0 };
    for (const mo of modelOutputs) {
      const mid = toModelId(mo.model_id);
      if (!mid) continue;
      // Model predicted direction: score > 50 + should_trade → bullish (1), else bearish (-1)
      if (mo.should_trade && mo.trade_score > 50) {
        predictions[mid] = evaluation.direction === "short" ? -1 : 1;
      } else {
        predictions[mid] = evaluation.direction === "short" ? 1 : -1;
      }
    }

    bayesianUpdater.updatePriors(regime, rMultiple, predictions, actualDirection);
    saveBayesianState();

    // Check if Bayesian weights have diverged enough to apply
    const bayesianWeights = bayesianUpdater.getWeights(regime);
    const currentWeights = getWeights();
    const deltas = {
      claude: Math.abs(bayesianWeights.claude - currentWeights.claude),
      gpt4o: Math.abs(bayesianWeights.openai - currentWeights.gpt4o),
      gemini: Math.abs(bayesianWeights.gemini - currentWeights.gemini),
    };
    const maxDelta = Math.max(deltas.claude, deltas.gpt4o, deltas.gemini);

    log.debug(
      { regime, rMultiple, maxDelta: maxDelta.toFixed(3), bayesianWeights },
      "Bayesian update applied",
    );

    // Track outcomes for batch recalibration
    outcomeSinceLastRecal++;
    if (outcomeSinceLastRecal >= BATCH_RECALIBRATION_INTERVAL) {
      triggerBatchRecalibration();
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error({ err: msg, evaluationId }, "Failed to apply Bayesian update");
  }
}

// ── Batch Recalibration ────────────────────────────────────────────────────

/**
 * Triggered after every N outcomes. Computes Bayesian-derived weights
 * and applies them if they differ meaningfully from current weights.
 * Caps the delta per update to prevent wild swings.
 */
function triggerBatchRecalibration(): void {
  try {
    outcomeSinceLastRecal = 0;
    const current = getWeights();

    // Get Bayesian weights for the default regime (TRENDING = normal market)
    const bayesian = bayesianUpdater.getWeights("TRENDING");

    // Blend: move current weights 30% toward Bayesian weights (conservative)
    const blendFactor = 0.3;
    const blended = {
      claude: current.claude + blendFactor * (bayesian.claude - current.claude),
      gpt4o: current.gpt4o + blendFactor * (bayesian.openai - current.gpt4o),
      gemini: current.gemini + blendFactor * (bayesian.gemini - current.gemini),
    };

    // Cap per-model delta
    blended.claude = clampDelta(current.claude, blended.claude, MAX_WEIGHT_DELTA);
    blended.gpt4o = clampDelta(current.gpt4o, blended.gpt4o, MAX_WEIGHT_DELTA);
    blended.gemini = clampDelta(current.gemini, blended.gemini, MAX_WEIGHT_DELTA);

    // Normalize to sum to 1.0
    const sum = blended.claude + blended.gpt4o + blended.gemini;
    blended.claude /= sum;
    blended.gpt4o /= sum;
    blended.gemini /= sum;

    // Check if change is meaningful
    const totalDelta =
      Math.abs(blended.claude - current.claude) +
      Math.abs(blended.gpt4o - current.gpt4o) +
      Math.abs(blended.gemini - current.gemini);

    if (totalDelta < MIN_WEIGHT_CHANGE) {
      log.info({ totalDelta: totalDelta.toFixed(4) }, "Batch recalibration: weights unchanged (below threshold)");
      return;
    }

    updateWeights(
      {
        claude: Number(blended.claude.toFixed(4)),
        gpt4o: Number(blended.gpt4o.toFixed(4)),
        gemini: Number(blended.gemini.toFixed(4)),
        sample_size: (current.sample_size ?? 0) + BATCH_RECALIBRATION_INTERVAL,
      },
      "bayesian_recalibration",
    );

    log.info(
      {
        from: { claude: current.claude, gpt4o: current.gpt4o, gemini: current.gemini },
        to: blended,
        totalDelta: totalDelta.toFixed(4),
      },
      "Batch recalibration applied",
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error({ err: msg }, "Batch recalibration failed");
  }
}

function clampDelta(current: number, target: number, maxDelta: number): number {
  const delta = target - current;
  if (Math.abs(delta) > maxDelta) {
    return current + Math.sign(delta) * maxDelta;
  }
  return target;
}

// ── Initialization ─────────────────────────────────────────────────────────

/**
 * Initialize the recalibration subsystem (load priors).
 */
export function initRecalibration(): void {
  loadBayesianState();
  log.info("Recalibration hook initialized");
}

/**
 * Get current recalibration status for diagnostics.
 * @returns Status object
 */
export function getRecalibrationStatus(): Record<string, unknown> {
  return {
    outcomes_since_last_recal: outcomeSinceLastRecal,
    batch_interval: BATCH_RECALIBRATION_INTERVAL,
    bayesian_weights: {
      trending: bayesianUpdater.getWeights("TRENDING"),
      chop: bayesianUpdater.getWeights("CHOP"),
      volatile: bayesianUpdater.getWeights("VOLATILE"),
    },
    state_file: STATE_PATH,
    state_file_exists: existsSync(STATE_PATH),
  };
}
