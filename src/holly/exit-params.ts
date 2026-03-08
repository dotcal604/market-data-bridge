/**
 * Exit Parameters Loader — reads analytics/holly_exit/output/exit_params.json
 * with a 1-hour in-memory cache. Provides typed access to per-strategy
 * optimal stop/target/timing parameters from the Python analytics pipeline.
 *
 * Pipeline: analytics/holly_exit/ → daily_exit_refresh.py → exit_params.json → this loader
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ── Types ────────────────────────────────────────────────────────────────

export interface OptimalStop {
  /** "atr" or "fixed_pct" */
  method: "atr" | "fixed_pct";
  /** ATR multiplier for stop distance (null if method=fixed_pct) */
  atr_multiple: number | null;
  /** Fixed percentage stop (null if method=atr) */
  fixed_pct: number | null;
  /** Average stop distance as % of price across sample */
  avg_stop_distance_pct: number;
}

export interface OptimalTargets {
  /** First take-profit level in R-multiples */
  tp1_r: number;
  /** Fraction of position to close at tp1 (0-1) */
  tp1_qty_pct: number;
  /** Second take-profit level in R-multiples */
  tp2_r: number;
  /** Fraction of position to close at tp2 (0-1) */
  tp2_qty_pct: number;
  /** Trailing stop percentage for runner portion */
  runner_trail_pct: number;
}

export interface ExitTiming {
  /** Average minutes from entry to maximum favorable excursion */
  avg_time_to_mfe_min: number;
  /** Average total hold time in minutes */
  avg_hold_minutes: number;
  /** Optimal time-based stop in minutes */
  optimal_time_stop_min: number;
  /** Best entry time window */
  best_entry_window: string;
}

export interface RegimeScalars {
  /** Position size multiplier */
  size_scalar: number;
  /** Target distance multiplier */
  target_scalar: number;
  /** Stop distance multiplier */
  stop_scalar: number;
}

export interface StrategyExitParams {
  /** Number of historical trades used for optimization */
  trades_analyzed: number;
  /** Win rate of those trades */
  win_rate: number;
  /** Average R-multiple */
  avg_r: number;
  /** Optimal stop configuration */
  optimal_stop: OptimalStop;
  /** Optimal take-profit targets */
  optimal_targets: OptimalTargets;
  /** Timing-based exit parameters */
  timing: ExitTiming;
  /** Regime-based scaling adjustments */
  regime_adjustments: Record<string, RegimeScalars>;
}

export interface ExitParamsFile {
  /** When the analytics pipeline last ran */
  generated_at: string;
  /** Lookback window in days */
  lookback_days: number;
  /** Per-strategy optimized exit parameters */
  strategies: Record<string, StrategyExitParams>;
}

// ── Loader with 1-hour cache ─────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXIT_PARAMS_PATH = resolve(__dirname, "../../analytics/holly_exit/output/exit_params.json");

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
let cached: ExitParamsFile | null = null;
let cachedAt = 0;

function loadFromDisk(): ExitParamsFile | null {
  if (!existsSync(EXIT_PARAMS_PATH)) return null;
  const raw = readFileSync(EXIT_PARAMS_PATH, "utf-8");
  return JSON.parse(raw) as ExitParamsFile;
}

/**
 * Get all exit parameters (all strategies).
 * Returns null if the JSON file doesn't exist yet.
 */
export function getExitParams(): ExitParamsFile | null {
  const now = Date.now();
  if (cached && now - cachedAt < CACHE_TTL_MS) return cached;
  cached = loadFromDisk();
  cachedAt = now;
  return cached;
}

/**
 * Get exit parameters for a single strategy by name.
 * Returns null if the strategy doesn't exist or the file is missing.
 */
export function getStrategyExitParams(strategyName: string): StrategyExitParams | null {
  const params = getExitParams();
  if (!params) return null;
  return params.strategies[strategyName] ?? null;
}

/**
 * List all available strategy names with exit params.
 */
export function listExitParamStrategies(): string[] {
  const params = getExitParams();
  if (!params) return [];
  return Object.keys(params.strategies);
}
