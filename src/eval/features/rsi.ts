/**
 * Compute Relative Strength Index (RSI) using Wilder's smoothing.
 * @param closes Array of closing prices
 * @param period Lookback period (default 14)
 * @returns RSI value (0-100) or null
 */
export function computeRSI(closes: readonly number[], period: number = 14): number | null {
  if (period <= 0) return null;
  if (closes.length < period + 1) return null;

  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 1; i <= period; i += 1) {
    const delta = closes[i] - closes[i - 1];
    if (delta > 0) {
      avgGain += delta;
    } else {
      avgLoss += Math.abs(delta);
    }
  }

  avgGain /= period;
  avgLoss /= period;

  for (let i = period + 1; i < closes.length; i += 1) {
    const delta = closes[i] - closes[i - 1];
    const gain = delta > 0 ? delta : 0;
    const loss = delta < 0 ? Math.abs(delta) : 0;

    // Wilder's smoothing:
    // avg = ((prevAvg * (period - 1)) + currentValue) / period
    avgGain = ((avgGain * (period - 1)) + gain) / period;
    avgLoss = ((avgLoss * (period - 1)) + loss) / period;
  }

  if (avgGain === 0 && avgLoss === 0) return 50;
  if (avgLoss === 0) return 100;
  if (avgGain === 0) return 0;

  const rs = avgGain / avgLoss;
  const rsi = 100 - (100 / (1 + rs));

  return Math.round(rsi * 100) / 100;
}

/**
 * Classify RSI value into buckets.
 * @param rsi RSI value
 * @returns "oversold", "overbought", or "neutral"
 */
export function classifyRSI(rsi: number): "oversold" | "neutral" | "overbought" {
  if (rsi < 30) return "oversold";
  if (rsi > 70) return "overbought";
  return "neutral";
}
