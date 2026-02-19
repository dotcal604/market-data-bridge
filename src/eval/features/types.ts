export interface FeatureVector {
  symbol: string;
  timestamp: string;
  last: number;
  bid: number;
  ask: number;
  open: number;
  high: number;
  low: number;
  close_prev: number;
  volume: number;
  rvol: number;
  vwap_deviation_pct: number;
  spread_pct: number;
  float_rotation_est: number;
  volume_acceleration: number;
  atr_14: number;
  atr_pct: number;
  price_extension_pct: number;
  gap_pct: number;
  range_position_pct: number;
  rsi: number | null;
  rsi_regime: "oversold" | "neutral" | "overbought";
  volatility_regime: "low" | "normal" | "high";
  liquidity_bucket: "small" | "mid" | "large";
  spy_change_pct: number;
  qqq_change_pct: number;
  market_alignment: "aligned_bull" | "aligned_bear" | "mixed" | "neutral";
  time_of_day: "premarket" | "open_drive" | "morning" | "midday" | "power_hour" | "close";
  minutes_since_open: number;
  data_source: "ibkr" | "yahoo";
  bridge_latency_ms: number;
}

export type ModelFeatureVector = Omit<FeatureVector, "data_source" | "bridge_latency_ms">;

/**
 * Remove metadata fields to prepare feature vector for LLM consumption.
 * @param fv Full feature vector
 * @returns Clean feature vector
 */
export function stripMetadata(fv: FeatureVector): ModelFeatureVector {
  const { data_source, bridge_latency_ms, ...rest } = fv;
  return rest;
}
