import type { BarData } from "../types.js";

export type LiquidityBucket = "small" | "mid" | "large";

/**
 * Classify stock liquidity based on 30-day average dollar volume.
 * @param dailyBars Daily OHLCV bars
 * @param last Current price
 * @returns "small", "mid", or "large"
 */
export function classifyLiquidity(dailyBars: BarData[], last: number): LiquidityBucket {
  if (dailyBars.length === 0 || last <= 0) return "small";
  const recent = dailyBars.slice(-30);
  const avgDollarVol =
    recent.reduce((s, b) => {
      const typicalPrice = (b.high + b.low + b.close) / 3;
      return s + typicalPrice * b.volume;
    }, 0) / recent.length;
  if (avgDollarVol < 10_000_000) return "small";
  if (avgDollarVol <= 100_000_000) return "mid";
  return "large";
}
