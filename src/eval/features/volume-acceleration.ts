import type { BarData } from "../types.js";

/**
 * Compute volume acceleration (ratio of last bar vol to previous bar vol).
 * @param intradayBars Intraday bar history
 * @returns Volume ratio (>1 means acceleration)
 */
export function computeVolumeAcceleration(intradayBars: BarData[]): number {
  if (intradayBars.length < 2) return 1;
  const last = intradayBars[intradayBars.length - 1];
  const prev = intradayBars[intradayBars.length - 2];
  if (prev.volume <= 0) return last.volume > 0 ? 10 : 1;
  return Math.round((last.volume / prev.volume) * 100) / 100;
}
