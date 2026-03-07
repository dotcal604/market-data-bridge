/**
 * Walk-forward summary loader — reads analytics/holly_exit/output/walk_forward_summary.json
 * with a 1-hour in-memory cache. Provides typed access to per-strategy walk-forward results.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ── Types ────────────────────────────────────────────────────────────────

export interface WalkForwardWindow {
  train_start: string;
  train_end: string;
  test_start: string;
  test_end: string;
  train_size: number;
  test_size: number;
  test_win_rate: number;
  test_avg_r: number;
  test_sharpe: number;
  optimal_weights: { claude: number; gpt4o: number; gemini: number; k: number };
}

export interface WalkForwardAggregate {
  oos_win_rate: number;
  oos_avg_r: number;
  oos_sharpe: number;
  total_oos_trades: number;
  total_windows: number;
  edge_stable: boolean;
  edge_decay_detected: boolean;
}

export interface StrategyWalkForward {
  windows: WalkForwardWindow[];
  aggregate: WalkForwardAggregate;
}

export interface WalkForwardSummary {
  generated_at: string;
  strategies: Record<string, StrategyWalkForward>;
}

// ── Loader with 1-hour cache ─────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const SUMMARY_PATH = resolve(__dirname, "../../analytics/holly_exit/output/walk_forward_summary.json");

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
let cached: WalkForwardSummary | null = null;
let cachedAt = 0;

function loadFromDisk(): WalkForwardSummary | null {
  if (!existsSync(SUMMARY_PATH)) return null;
  const raw = readFileSync(SUMMARY_PATH, "utf-8");
  return JSON.parse(raw) as WalkForwardSummary;
}

/**
 * Get the full walk-forward summary (all strategies).
 * Returns null if the JSON file doesn't exist yet.
 */
export function getWalkForwardSummary(): WalkForwardSummary | null {
  const now = Date.now();
  if (cached && now - cachedAt < CACHE_TTL_MS) return cached;
  cached = loadFromDisk();
  cachedAt = now;
  return cached;
}

/**
 * Get walk-forward results for a single strategy by name.
 * Returns null if the strategy doesn't exist or the file is missing.
 */
export function getStrategyWalkForward(strategyName: string): StrategyWalkForward | null {
  const summary = getWalkForwardSummary();
  if (!summary) return null;
  return summary.strategies[strategyName] ?? null;
}
