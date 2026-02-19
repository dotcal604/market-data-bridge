export type VolatilityRegime = "low" | "normal" | "high";

/**
 * Classify volatility regime based on ATR %.
 * @param atrPct ATR as percentage of price
 * @returns "low" (<2%), "normal" (2-5%), "high" (>5%)
 */
export function classifyVolatilityRegime(atrPct: number): VolatilityRegime {
  if (atrPct < 2) return "low";
  if (atrPct <= 5) return "normal";
  return "high";
}
