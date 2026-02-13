import type { FeatureVector } from "../features/types.js";

export interface PrefilterResult {
  passed: boolean;
  flags: string[];
}

/**
 * Structural pre-filters that reject a trade BEFORE spending on model calls.
 */
export function runPrefilters(features: FeatureVector): PrefilterResult {
  const flags: string[] = [];

  if (features.liquidity_bucket === "large" && features.spread_pct > 0.8) {
    flags.push(`Spread ${features.spread_pct.toFixed(2)}% too wide for large cap`);
  }

  if (features.spread_pct > 2.0) {
    flags.push(`Spread ${features.spread_pct.toFixed(2)}% extremely wide — illiquid`);
  }

  if (features.time_of_day === "midday" && features.rvol < 1.2) {
    flags.push(`Midday with RVOL ${features.rvol} — likely chop`);
  }

  if (features.price_extension_pct > 2.5 && features.rvol < 1.5) {
    flags.push(`Extended ${features.price_extension_pct} ATR with RVOL only ${features.rvol}`);
  }

  if (features.time_of_day === "premarket" && features.volume < 1000) {
    flags.push("Premarket with negligible volume");
  }

  // Hard fails: spread > 2% and premarket negligible volume
  const hardFails = flags.filter((f) =>
    f.includes("extremely wide") || f.includes("negligible volume"),
  );

  return { passed: hardFails.length === 0, flags };
}
