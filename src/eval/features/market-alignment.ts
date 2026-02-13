import { getQuote } from "../../providers/yahoo.js";

export type MarketAlignment = "aligned_bull" | "aligned_bear" | "mixed" | "neutral";

export interface MarketContext {
  spy_change_pct: number;
  qqq_change_pct: number;
  market_alignment: MarketAlignment;
}

/**
 * Fetch SPY and QQQ quotes to determine market alignment.
 * Uses direct Yahoo provider import (no HTTP hop).
 */
export async function computeMarketAlignment(direction: string): Promise<MarketContext> {
  const [spyQuote, qqqQuote] = await Promise.all([
    getQuote("SPY").catch(() => null),
    getQuote("QQQ").catch(() => null),
  ]);

  const spyChange = spyQuote?.changePercent ?? 0;
  const qqqChange = qqqQuote?.changePercent ?? 0;

  const threshold = 0.2;
  const spyBull = spyChange > threshold;
  const spyBear = spyChange < -threshold;
  const qqqBull = qqqChange > threshold;
  const qqqBear = qqqChange < -threshold;

  let alignment: MarketAlignment;

  if (spyBull && qqqBull) {
    alignment = direction === "long" ? "aligned_bull" : "mixed";
  } else if (spyBear && qqqBear) {
    alignment = direction === "short" ? "aligned_bear" : "mixed";
  } else if ((spyBull && qqqBear) || (spyBear && qqqBull)) {
    alignment = "mixed";
  } else {
    alignment = "neutral";
  }

  return {
    spy_change_pct: Math.round(spyChange * 100) / 100,
    qqq_change_pct: Math.round(qqqChange * 100) / 100,
    market_alignment: alignment,
  };
}
