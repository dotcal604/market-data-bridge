import type { BarData } from "../types.js";

/**
 * Compute price deviation from VWAP in basis points.
 * @param intradayBars Intraday bar history
 * @param last Current price
 * @returns Deviation in percentage points (e.g. 0.5 = 0.5%)
 */
export function computeVWAPDeviation(intradayBars: BarData[], last: number): number {
  if (intradayBars.length === 0 || last <= 0) return 0;
  let sumPV = 0;
  let sumV = 0;
  for (const bar of intradayBars) {
    const typical = (bar.high + bar.low + bar.close) / 3;
    sumPV += typical * bar.volume;
    sumV += bar.volume;
  }
  if (sumV <= 0) return 0;
  const vwap = sumPV / sumV;
  return Math.round(((last - vwap) / vwap) * 10000) / 100;
}
