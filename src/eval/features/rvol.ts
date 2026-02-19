import type { BarData } from "../types.js";

/**
 * Compute Relative Volume (RVOL) against 20-day average.
 * @param currentVolume Current session volume
 * @param dailyBars Daily OHLCV history
 * @returns RVOL ratio (e.g. 1.5 = 150% of average)
 */
export function computeRVOL(currentVolume: number, dailyBars: BarData[]): number {
  if (dailyBars.length === 0 || currentVolume <= 0) return 0;
  const recent = dailyBars.slice(-20);
  const avgVol = recent.reduce((s, b) => s + b.volume, 0) / recent.length;
  if (avgVol <= 0) return 0;
  return Math.round((currentVolume / avgVol) * 100) / 100;
}
