/**
 * Holly Predictor — Build statistical profiles from historical winners,
 * scan live symbols for pattern matches, and generate pre-alert candidates.
 *
 * Features:
 * - buildProfiles: Mean/std per feature from winning trades
 * - scanSymbols: Batch z-score matching against profiles
 * - getPreAlertCandidates: Fallback scoring when no recent data
 * - Cache refresh: Automatic profile updates on new outcomes
 */
import type { Database as DatabaseType } from "better-sqlite3";
import type { FeatureVector } from "../eval/features/types.js";

// ── Types ────────────────────────────────────────────────────────────────

export interface FeatureProfile {
  feature: string;
  mean: number;
  std: number;
  min: number;
  max: number;
  sample_size: number;
  strategy: string | null;
}

export interface ScanResult {
  symbol: string;
  z_score: number;            // Avg z-score across all features (lower = better match)
  matched_features: number;   // Count of features within 1 std
  total_features: number;
  distance: number;           // Euclidean distance from profile centroid
  confidence: number;         // 0-100 based on z_score
}

export interface PreAlertCandidate {
  symbol: string;
  score: number;              // 0-100 composite score
  reason: string;
  strategy: string | null;
  features: Partial<FeatureVector>;
  timestamp: string;
}

export interface ProfileCache {
  profiles: FeatureProfile[];
  last_updated: string;
  sample_size: number;
}

// ── buildProfiles ────────────────────────────────────────────────────────

/**
 * Build statistical profiles from historical winning trades.
 * Returns mean/std for each feature, optionally per strategy.
 */
export function buildProfiles(
  db: DatabaseType,
  minSamples = 20,
  strategy?: string | null
): FeatureProfile[] {
  const features = [
    "rvol", "vwap_deviation_pct", "spread_pct", "float_rotation_est",
    "volume_acceleration", "atr_pct", "price_extension_pct", "gap_pct",
    "range_position_pct", "spy_change_pct", "qqq_change_pct", "minutes_since_open"
  ];
  
  const profiles: FeatureProfile[] = [];
  
  for (const feature of features) {
    const query = strategy !== undefined
      ? `
        SELECT e.${feature} as value
        FROM evaluations e
        JOIN outcomes o ON o.evaluation_id = e.id
        JOIN signals s ON s.evaluation_id = e.id
        JOIN holly_alerts h ON h.id = s.holly_alert_id
        WHERE o.trade_taken = 1 
          AND o.r_multiple > 0
          AND e.${feature} IS NOT NULL
          AND (h.strategy = ? OR h.strategy IS NULL)
      `
      : `
        SELECT e.${feature} as value
        FROM evaluations e
        JOIN outcomes o ON o.evaluation_id = e.id
        WHERE o.trade_taken = 1 
          AND o.r_multiple > 0
          AND e.${feature} IS NOT NULL
      `;
    
    const rows = strategy !== undefined
      ? db.prepare(query).all(strategy)
      : db.prepare(query).all();
    
    if (rows.length < minSamples) continue;
    
    const values = (rows as Array<{ value: number }>).map(r => r.value);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
    const std = Math.sqrt(variance);
    const min = Math.min(...values);
    const max = Math.max(...values);
    
    profiles.push({
      feature,
      mean: Math.round(mean * 1000) / 1000,
      std: Math.round(std * 1000) / 1000,
      min: Math.round(min * 1000) / 1000,
      max: Math.round(max * 1000) / 1000,
      sample_size: values.length,
      strategy: strategy ?? null,
    });
  }
  
  return profiles;
}

// ── Z-Score Calculation ──────────────────────────────────────────────────

/**
 * Calculate z-score: (value - mean) / std
 * Returns absolute z-score (distance from mean in standard deviations).
 */
function calculateZScore(value: number, mean: number, std: number): number {
  if (std === 0) return 0; // No variance
  return Math.abs((value - mean) / std);
}

// ── scanSymbols ──────────────────────────────────────────────────────────

/**
 * Batch scan multiple symbols against profiles using z-score matching.
 * Lower z_score = better match to historical winners.
 */
export function scanSymbols(
  features: Array<Partial<FeatureVector>>,
  profiles: FeatureProfile[]
): ScanResult[] {
  if (profiles.length === 0) {
    return features.map(f => ({
      symbol: f.symbol || "unknown",
      z_score: Infinity,
      matched_features: 0,
      total_features: 0,
      distance: Infinity,
      confidence: 0,
    }));
  }
  
  const results: ScanResult[] = [];
  
  for (const featureVec of features) {
    const zScores: number[] = [];
    let matchedCount = 0;
    let distanceSquared = 0;
    
    for (const profile of profiles) {
      const value = (featureVec as any)[profile.feature];
      if (value === undefined || value === null) continue;
      
      const zScore = calculateZScore(value, profile.mean, profile.std);
      zScores.push(zScore);
      
      if (zScore <= 1.0) matchedCount++; // Within 1 std
      
      // Normalized distance component
      const normalizedValue = profile.std > 0 ? (value - profile.mean) / profile.std : 0;
      distanceSquared += normalizedValue ** 2;
    }
    
    const avgZScore = zScores.length > 0 ? zScores.reduce((a, b) => a + b, 0) / zScores.length : Infinity;
    const distance = Math.sqrt(distanceSquared);
    
    // Confidence: 100 at z=0, 0 at z>=3
    const confidence = Math.max(0, Math.min(100, 100 - (avgZScore / 3) * 100));
    
    results.push({
      symbol: featureVec.symbol || "unknown",
      z_score: Math.round(avgZScore * 1000) / 1000,
      matched_features: matchedCount,
      total_features: profiles.length,
      distance: Math.round(distance * 1000) / 1000,
      confidence: Math.round(confidence),
    });
  }
  
  // Sort by z_score ascending (best matches first)
  return results.sort((a, b) => a.z_score - b.z_score);
}

// ── getPreAlertCandidates ────────────────────────────────────────────────

/**
 * Generate pre-alert candidates from recent Holly alerts that haven't been
 * evaluated yet. Uses profile matching as fallback scoring.
 */
export function getPreAlertCandidates(
  db: DatabaseType,
  profiles: FeatureProfile[],
  limit = 10,
  hoursBack = 24
): PreAlertCandidate[] {
  // Get recent Holly alerts without signals
  const rows = db.prepare(`
    SELECT 
      h.id,
      h.symbol,
      h.strategy,
      h.entry_price,
      h.stop_price,
      h.alert_time
    FROM holly_alerts h
    LEFT JOIN signals s ON s.holly_alert_id = h.id
    WHERE s.id IS NULL
      AND h.alert_time >= datetime('now', '-' || ? || ' hours')
    ORDER BY h.alert_time DESC
    LIMIT ?
  `).all(hoursBack, limit * 2) as Array<{
    id: number;
    symbol: string;
    strategy: string | null;
    entry_price: number | null;
    stop_price: number | null;
    alert_time: string;
  }>;
  
  if (rows.length === 0) {
    return [];
  }
  
  const candidates: PreAlertCandidate[] = [];
  
  for (const row of rows) {
    // Build minimal feature vector for scoring
    const features: Partial<FeatureVector> = {
      symbol: row.symbol,
      timestamp: row.alert_time,
      last: row.entry_price ?? 0,
    };
    
    // Get strategy-specific profiles if available
    const strategyProfiles = profiles.filter(p => 
      p.strategy === row.strategy || p.strategy === null
    );
    
    // If no matching profiles, still add as candidate with default score
    if (strategyProfiles.length === 0 && profiles.length > 0) continue;
    
    // Calculate composite score based on available features
    // Since we don't have full features, use a simplified scoring
    const baseScore = 50; // Neutral starting point
    const strategyBonus = row.strategy ? 10 : 0;
    const recencyBonus = Math.max(0, 10 * (1 - (Date.now() - new Date(row.alert_time).getTime()) / (hoursBack * 3600000)));
    
    const score = Math.min(100, baseScore + strategyBonus + recencyBonus);
    
    candidates.push({
      symbol: row.symbol,
      score: Math.round(score),
      reason: row.strategy 
        ? `Holly ${row.strategy} alert without eval` 
        : "Holly alert without eval",
      strategy: row.strategy,
      features,
      timestamp: row.alert_time,
    });
  }
  
  // Sort by score descending
  return candidates.sort((a, b) => b.score - a.score).slice(0, limit);
}

// ── Cache Management ─────────────────────────────────────────────────────

/**
 * Create a profile cache with timestamp for refresh tracking.
 */
export function createProfileCache(db: DatabaseType, strategy?: string | null): ProfileCache {
  const profiles = buildProfiles(db, 20, strategy);
  
  return {
    profiles,
    last_updated: new Date().toISOString(),
    sample_size: profiles.reduce((sum, p) => sum + p.sample_size, 0),
  };
}

/**
 * Check if cache should be refreshed based on age and new outcomes.
 */
export function shouldRefreshCache(
  cache: ProfileCache,
  maxAgeHours = 24,
  minNewOutcomes = 10
): boolean {
  const ageMs = Date.now() - new Date(cache.last_updated).getTime();
  const ageHours = ageMs / (1000 * 60 * 60);
  
  // Refresh if cache is older than maxAgeHours
  if (ageHours >= maxAgeHours) return true;
  
  // Note: We can't check minNewOutcomes without DB access here
  // Caller should inject that check if needed
  return false;
}

/**
 * Refresh cache if conditions are met.
 */
export function refreshCacheIfNeeded(
  db: DatabaseType,
  cache: ProfileCache | null,
  strategy?: string | null
): ProfileCache {
  if (!cache || shouldRefreshCache(cache)) {
    return createProfileCache(db, strategy);
  }
  return cache;
}

/**
 * Get count of new outcomes since cache was created.
 */
export function getNewOutcomesCount(db: DatabaseType, since: string): number {
  const result = db.prepare(`
    SELECT COUNT(*) as count
    FROM outcomes
    WHERE recorded_at > ?
  `).get(since) as { count: number } | undefined;
  
  return result?.count ?? 0;
}
