import { getQuote, getHistoricalBars, getStockDetails } from "../../providers/yahoo.js";
import type { FeatureVector } from "./types.js";
import { computeRVOL } from "./rvol.js";
import { computeVWAPDeviation } from "./vwap.js";
import { computeSpreadPct } from "./spread.js";
import { computeFloatRotation } from "./float-rotation.js";
import { computeVolumeAcceleration } from "./volume-acceleration.js";
import { computeATR } from "./atr.js";
import { computePriceExtension } from "./extension.js";
import { computeGapPct } from "./gap.js";
import { computeRangePositionPct } from "./range-position.js";
import { computeMarketAlignment } from "./market-alignment.js";
import { classifyTimeOfDay, minutesSinceOpen } from "./time-classification.js";
import { classifyVolatilityRegime } from "./volatility-regime.js";
import { classifyLiquidity } from "./liquidity.js";
import { computeTickVelocity } from "./tick-velocity.js";
import { logger } from "../../logging.js";

export interface ComputeResult {
  features: FeatureVector;
  latencyMs: number;
}

export async function computeFeatures(
  symbol: string,
  direction: string = "long",
): Promise<ComputeResult> {
  const start = Date.now();
  const sym = symbol.toUpperCase();

  // Parallel data fetches — direct provider calls, no HTTP hop
  const [quote, dailyBars, intradayBars, details] = await Promise.all([
    getQuote(sym),
    getHistoricalBars(sym, "1mo", "1d"),
    getHistoricalBars(sym, "1d", "5m"),
    getStockDetails(sym).catch(() => null),
  ]);

  const now = new Date();
  const last = quote.last ?? 0;
  const bid = quote.bid ?? 0;
  const ask = quote.ask ?? 0;
  const open = quote.open ?? 0;
  const high = quote.high ?? 0;
  const low = quote.low ?? 0;
  const closePrev = quote.close ?? 0;
  const volume = quote.volume ?? 0;
  const marketCap = quote.marketCap ?? details?.marketCap ?? null;

  const rvol = computeRVOL(volume, dailyBars);
  const vwap_deviation_pct = computeVWAPDeviation(intradayBars, last);
  const spread_pct = computeSpreadPct(bid, ask, last);
  const float_rotation_est = computeFloatRotation(volume, marketCap, last);
  const volume_acceleration = computeVolumeAcceleration(intradayBars);
  const { atr_14, atr_pct } = computeATR(dailyBars, last);
  const price_extension_pct = computePriceExtension(last, closePrev, open, atr_14);
  const gap_pct = computeGapPct(open, closePrev);
  const range_position_pct = computeRangePositionPct(last, high, low);
  const volatility_regime = classifyVolatilityRegime(atr_pct);
  const liquidity_bucket = classifyLiquidity(dailyBars, last);
  
  const tickData = computeTickVelocity();
  const tick_velocity = tickData?.velocity ?? null;
  const tick_acceleration = tickData?.acceleration ?? null;

  const marketCtx = await computeMarketAlignment(direction);

  const time_of_day = classifyTimeOfDay(now);
  const minutes_since_open = minutesSinceOpen(now);

  const latencyMs = Date.now() - start;

  const features: FeatureVector = {
    symbol: sym,
    timestamp: now.toISOString(),
    last, bid, ask, open, high, low,
    close_prev: closePrev,
    volume,
    rvol,
    vwap_deviation_pct,
    spread_pct,
    float_rotation_est,
    volume_acceleration,
    atr_14,
    atr_pct,
    price_extension_pct,
    gap_pct,
    range_position_pct,
    tick_velocity,
    tick_acceleration,
    volatility_regime,
    liquidity_bucket,
    spy_change_pct: marketCtx.spy_change_pct,
    qqq_change_pct: marketCtx.qqq_change_pct,
    market_alignment: marketCtx.market_alignment,
    time_of_day,
    minutes_since_open,
    data_source: "yahoo",
    bridge_latency_ms: latencyMs,
  };

  logger.info(`[Features] Computed ${sym} in ${latencyMs}ms: rvol=${rvol} atr%=${atr_pct} spread=${spread_pct}%`);
  return { features, latencyMs };
}
