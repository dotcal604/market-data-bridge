import type { BarData } from "../types.js";

export interface StochasticResult {
    k: number;
    d: number;
}

/**
 * Compute Stochastic oscillator (%K and %D).
 *
 * %K = ((close - lowest_low) / (highest_high - lowest_low)) * 100
 *   over `period` bars (default 14).
 *
 * %D = simple moving average of the last `smoothD` %K values (default 3).
 *
 * @param bars  OHLCV bar data (chronological order)
 * @param period  Lookback window for %K (default 14)
 * @param smoothD  SMA period for %D (default 3)
 * @returns { k, d } both 0-100, or null if insufficient data
 */
export function computeStochastic(
    bars: readonly BarData[],
    period: number = 14,
    smoothD: number = 3,
): StochasticResult | null {
    if (period <= 0 || smoothD <= 0) return null;

    // Need at least `period + smoothD - 1` bars:
    //   `period` bars for the first %K, then `smoothD - 1` more for the %D SMA
    const minBars = period + smoothD - 1;
    if (bars.length < minBars) return null;

    // Compute raw %K for each bar starting at index `period - 1`
    const kValues: number[] = [];

    for (let i = period - 1; i < bars.length; i += 1) {
        const window = bars.slice(i - period + 1, i + 1);

        let lowestLow = Infinity;
        let highestHigh = -Infinity;

        for (const bar of window) {
            if (bar.low < lowestLow) lowestLow = bar.low;
            if (bar.high > highestHigh) highestHigh = bar.high;
        }

        const range = highestHigh - lowestLow;
        if (range === 0) {
            // Flat range — price is at both high and low, define as 50
            kValues.push(50);
        } else {
            const k = ((bars[i].close - lowestLow) / range) * 100;
            kValues.push(Math.round(k * 100) / 100);
        }
    }

    // %D = SMA of last `smoothD` %K values
    if (kValues.length < smoothD) return null;

    const lastK = kValues[kValues.length - 1];
    const dSlice = kValues.slice(-smoothD);
    const d = dSlice.reduce((sum, v) => sum + v, 0) / smoothD;

    return {
        k: Math.round(lastK * 100) / 100,
        d: Math.round(d * 100) / 100,
    };
}
