/**
 * Holly Pre-Alert Predictor
 *
 * Learns feature distribution profiles from historical Holly alerts that have
 * been evaluated (holly_alerts JOIN evaluations). For each strategy, builds a
 * profile of mean/stddev for key numeric features. Then, given a symbol's
 * current features, scores how well it matches each profile using Mahalanobis-
 * like z-score distance.
 *
 * Use case: detect conditions that will trigger Holly AI before it fires,
 * giving a head-start on ensemble evaluation and position preparation.
 */

import { getDb } from "../db/database.js";
import { computeFeatures } from "../eval/features/compute.js";
import { logger } from "../logging.js";

const log = logger.child({ module: "holly-predictor" });

// ── Types ────────────────────────────────────────────────────────────────

export interface FeatureProfile {
  strategy: string;
  sample_count: number;
  features: Record<string, { mean: number; std: number; min: number; max: number }>;
  win_rate: number;         // % of alerts that became should_trade=1
  avg_ensemble_score: number;
}

export interface PreAlertSignal {
  symbol: string;
  strategy: string;
  match_score: number;       // 0-100, higher = better match to Holly profile
  distance: number;          // raw z-score distance (lower = closer match)
  feature_matches: Record<string, { value: number; z_score: number; in_range: boolean }>;
  profile_sample_count: number;
  profile_win_rate: number;
  profile_avg_score: number;
}

export interface PredictorStatus {
  profiles_built: number;
  strategies: string[];
  total_historical_alerts: number;
  last_profile_build: string | null;
}

// ── Feature Keys ─────────────────────────────────────────────────────────
// Numeric features from evaluations table used for profile matching.
// These are the features that most distinguish Holly-alertable setups.

const PROFILE_FEATURES = [
  "rvol",
  "vwap_deviation_pct",
  "spread_pct",
  "volume_acceleration",
  "atr_pct",
  "gap_pct",
  "range_position_pct",
  "price_extension_pct",
  "spy_change_pct",
  "qqq_change_pct",
  "minutes_since_open",
  "ensemble_trade_score",
] as const;

type ProfileFeature = typeof PROFILE_FEATURES[number];

// ── Profile Cache ────────────────────────────────────────────────────────

let _profiles: Map<string, FeatureProfile> = new Map();
let _lastBuild: string | null = null;

// ── Profile Builder ──────────────────────────────────────────────────────

/**
 * Build feature profiles from historical Holly alerts that have evaluations.
 * Groups by strategy and computes mean/std for each numeric feature.
 */
export function buildProfiles(minSamples: number = 5): {
  profiles: FeatureProfile[];
  total_alerts: number;
} {
  const db = getDb();

  // Join holly_alerts → evaluations to get feature vectors at alert time
  const rows = db.prepare(`
    SELECT
      h.strategy,
      e.rvol,
      e.vwap_deviation_pct,
      e.spread_pct,
      e.volume_acceleration,
      e.atr_pct,
      e.gap_pct,
      e.range_position_pct,
      e.price_extension_pct,
      e.spy_change_pct,
      e.qqq_change_pct,
      e.minutes_since_open,
      e.ensemble_trade_score,
      e.ensemble_should_trade
    FROM holly_alerts h
    JOIN evaluations e ON e.holly_alert_id = h.id
    WHERE e.prefilter_passed = 1
    ORDER BY h.strategy
  `).all() as Array<Record<string, unknown>>;

  if (rows.length === 0) {
    _profiles = new Map();
    _lastBuild = new Date().toISOString();
    return { profiles: [], total_alerts: 0 };
  }

  // Group by strategy
  const groups = new Map<string, Array<Record<string, unknown>>>();
  for (const row of rows) {
    const strat = (row.strategy as string) ?? "unknown";
    if (!groups.has(strat)) groups.set(strat, []);
    groups.get(strat)!.push(row);
  }

  const profiles: FeatureProfile[] = [];

  for (const [strategy, stratRows] of groups) {
    if (stratRows.length < minSamples) continue;

    const featureStats: Record<string, { mean: number; std: number; min: number; max: number }> = {};

    for (const feat of PROFILE_FEATURES) {
      const values = stratRows
        .map((r) => r[feat] as number | null)
        .filter((v): v is number => v != null && Number.isFinite(v));

      if (values.length < 3) continue;

      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
      const std = Math.sqrt(variance);
      const min = Math.min(...values);
      const max = Math.max(...values);

      featureStats[feat] = { mean, std, min, max };
    }

    // Win rate: % of alerts where ensemble said should_trade
    const shouldTrade = stratRows.filter((r) => r.ensemble_should_trade === 1).length;
    const win_rate = shouldTrade / stratRows.length;

    // Avg ensemble score
    const scores = stratRows
      .map((r) => r.ensemble_trade_score as number | null)
      .filter((v): v is number => v != null);
    const avg_ensemble_score = scores.length > 0
      ? scores.reduce((a, b) => a + b, 0) / scores.length
      : 0;

    const profile: FeatureProfile = {
      strategy,
      sample_count: stratRows.length,
      features: featureStats,
      win_rate,
      avg_ensemble_score,
    };

    profiles.push(profile);
  }

  // Update cache
  _profiles = new Map(profiles.map((p) => [p.strategy, p]));
  _lastBuild = new Date().toISOString();

  log.info(
    { strategies: profiles.map((p) => p.strategy), total: rows.length },
    "Holly profiles built",
  );

  return { profiles, total_alerts: rows.length };
}

// ── Scanner ──────────────────────────────────────────────────────────────

/**
 * Score a symbol's current features against all Holly strategy profiles.
 * Returns match signals sorted by match_score descending (best matches first).
 *
 * match_score = 100 - (avg_z_score * scaling_factor), clamped 0-100
 * A score of 80+ means the symbol's features closely match a Holly profile.
 */
export async function scanSymbol(
  symbol: string,
  threshold: number = 50,
): Promise<PreAlertSignal[]> {
  if (_profiles.size === 0) {
    buildProfiles();
    if (_profiles.size === 0) return [];
  }

  // Compute current features
  const { features } = await computeFeatures(symbol);

  const signals: PreAlertSignal[] = [];

  for (const [strategy, profile] of _profiles) {
    const featureMatches: Record<string, { value: number; z_score: number; in_range: boolean }> = {};
    const zScores: number[] = [];

    for (const feat of PROFILE_FEATURES) {
      const stats = profile.features[feat];
      if (!stats) continue;

      const value = (features as unknown as Record<string, unknown>)[feat];
      if (typeof value !== "number" || !Number.isFinite(value)) continue;

      // Z-score: how many standard deviations from the profile mean
      const z = stats.std > 0 ? Math.abs(value - stats.mean) / stats.std : 0;
      const inRange = value >= stats.min && value <= stats.max;

      featureMatches[feat] = { value, z_score: Math.round(z * 100) / 100, in_range: inRange };
      zScores.push(z);
    }

    if (zScores.length < 3) continue; // not enough feature overlap

    // Average z-score distance — lower means closer match
    const avgZ = zScores.reduce((a, b) => a + b, 0) / zScores.length;

    // Convert to 0-100 match score: z=0 → 100, z=2 → 50, z=4 → 0
    const matchScore = Math.max(0, Math.min(100, Math.round(100 - avgZ * 25)));

    if (matchScore >= threshold) {
      signals.push({
        symbol: symbol.toUpperCase(),
        strategy,
        match_score: matchScore,
        distance: Math.round(avgZ * 1000) / 1000,
        feature_matches: featureMatches,
        profile_sample_count: profile.sample_count,
        profile_win_rate: Math.round(profile.win_rate * 1000) / 1000,
        profile_avg_score: Math.round(profile.avg_ensemble_score * 100) / 100,
      });
    }
  }

  // Sort by match_score descending
  signals.sort((a, b) => b.match_score - a.match_score);

  return signals;
}

/**
 * Scan multiple symbols in parallel (with concurrency limit).
 * Returns all pre-alert signals above threshold, sorted by match_score.
 */
export async function scanSymbols(
  symbols: string[],
  threshold: number = 50,
  maxConcurrent: number = 5,
): Promise<PreAlertSignal[]> {
  if (_profiles.size === 0) {
    buildProfiles();
    if (_profiles.size === 0) return [];
  }

  const allSignals: PreAlertSignal[] = [];

  // Process in batches to avoid overwhelming Yahoo
  for (let i = 0; i < symbols.length; i += maxConcurrent) {
    const batch = symbols.slice(i, i + maxConcurrent);
    const results = await Promise.allSettled(
      batch.map((sym) => scanSymbol(sym, threshold)),
    );

    for (const result of results) {
      if (result.status === "fulfilled") {
        allSignals.push(...result.value);
      }
    }
  }

  allSignals.sort((a, b) => b.match_score - a.match_score);
  return allSignals;
}

/**
 * Get all strategy profiles that have been built.
 */
export function getProfiles(): FeatureProfile[] {
  return [..._profiles.values()];
}

/**
 * Get predictor status.
 */
export function getPredictorStatus(): PredictorStatus {
  return {
    profiles_built: _profiles.size,
    strategies: [..._profiles.keys()],
    total_historical_alerts: [..._profiles.values()].reduce((s, p) => s + p.sample_count, 0),
    last_profile_build: _lastBuild,
  };
}

/**
 * Force rebuild profiles. Call after new Holly alerts are imported and evaluated.
 */
export function refreshProfiles(minSamples: number = 5): { profiles: FeatureProfile[]; total_alerts: number } {
  return buildProfiles(minSamples);
}

// ── Top Pre-Alert Candidates ─────────────────────────────────────────────

/**
 * Convenience: get the latest Holly symbols and scan them all for pre-alert
 * conditions. Useful for "what would Holly pick right now?" analysis.
 *
 * Optionally accepts a custom symbol list (e.g., from a watchlist or screener).
 */
export async function getPreAlertCandidates(opts: {
  symbols?: string[];
  threshold?: number;
  limit?: number;
} = {}): Promise<{
  candidates: PreAlertSignal[];
  profiles_used: number;
  symbols_scanned: number;
}> {
  const { threshold = 50, limit = 20 } = opts;
  let symbols = opts.symbols;

  if (!symbols || symbols.length === 0) {
    // Fall back to recent Holly symbols
    const db = getDb();
    symbols = db.prepare(`
      SELECT DISTINCT symbol FROM holly_alerts
      ORDER BY alert_time DESC
      LIMIT 50
    `).all().map((r: any) => r.symbol as string);
  }

  if (symbols.length === 0) return { candidates: [], profiles_used: 0, symbols_scanned: 0 };

  const candidates = await scanSymbols(symbols, threshold);

  return {
    candidates: candidates.slice(0, limit),
    profiles_used: _profiles.size,
    symbols_scanned: symbols.length,
  };
}
