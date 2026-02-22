/**
 * Feature Snapshot Schema — the stable contract between the bridge and consumers.
 *
 * This is Tier 0: the canonical shape of computed features exposed via MCP/REST/WS.
 * All indicator computation targets this schema. Consumers (Claude, dashboards,
 * research scripts) depend on these fields — change them deliberately.
 *
 * Design principles:
 * - Computed in-bridge (TS, single-process) from real-time bars
 * - Incrementally updated (streaming .add() style, not array recomputation)
 * - Flat structure — no nested objects, easy to serialize/log/query
 * - Source-tagged — always know where the data came from
 */

// ── Core Feature Snapshot ───────────────────────────────────────────────────

export interface FeatureSnapshot {
  // ── Identity ──
  symbol: string;
  /** Eastern Time ISO string of last update */
  ts_et: string;
  /** Data source: "ibkr" | "yahoo" */
  source: "ibkr" | "yahoo";

  // ── Price ──
  price_last: number | null;
  price_bid: number | null;
  price_ask: number | null;
  /** (ask - bid) / last * 100 */
  spread_pct: number | null;

  // ── Current Bar (1-minute aggregated from 5s bars) ──
  bar_1m_open: number | null;
  bar_1m_high: number | null;
  bar_1m_low: number | null;
  bar_1m_close: number | null;
  bar_1m_volume: number | null;

  // ── Volume ──
  volume_cumulative: number | null;
  /** Current volume / 20-day average volume */
  rvol_20d: number | null;

  // ── Trend ──
  ema_9: number | null;
  ema_21: number | null;
  vwap: number | null;
  /** (price - vwap) / vwap * 100 */
  vwap_dev_pct: number | null;

  // ── Momentum ──
  rsi_14: number | null;
  macd_line: number | null;
  macd_signal: number | null;
  macd_histogram: number | null;

  // ── Volatility ──
  /** ATR(14) as % of price */
  atr_14_pct: number | null;
  bollinger_upper: number | null;
  bollinger_lower: number | null;
  /** (upper - lower) / middle * 100 */
  bb_width_pct: number | null;

  // ── Range ──
  high_of_day: number | null;
  low_of_day: number | null;
  /** (high - low) / low * 100 */
  range_pct: number | null;
  /** Where price sits in today's range: 0 = LOD, 1 = HOD */
  range_position: number | null;

  // ── Gap ──
  prior_close: number | null;
  /** (price - prior_close) / prior_close * 100 */
  gap_pct: number | null;

  // ── Flags (actionable risk signals) ──
  flags: FeatureFlag[];
}

/** Risk/quality flags — consumed by MCP tools for scan filtering + warnings */
export type FeatureFlag =
  | "spread_wide"       // spread_pct > 0.50%
  | "rvol_low"          // rvol_20d < 1.0
  | "small_cap"         // market cap < $300M
  | "illiquid"          // spread_wide + rvol_low combined
  | "extended_hours"    // pre-market or after-hours session
  | "atr_elevated";     // ATR > 2x 20-day average ATR

// ── Indicator Configuration ─────────────────────────────────────────────────

/** The indicators we actually compute. No more, no less. */
export const INDICATOR_CONFIG = {
  ema: { periods: [9, 21] },
  rsi: { period: 14 },
  macd: { fast: 12, slow: 26, signal: 9 },
  atr: { period: 14 },
  bollinger: { period: 20, stdDev: 2 },
} as const;

/**
 * Number of 5-second bars to retain per symbol.
 * 300 bars = 25 minutes of history — enough for all indicator warm-up.
 */
export const BAR_BUFFER_SIZE = 300;

/**
 * Number of 1-minute bars aggregated from 5s bars.
 * 60 bars = 1 hour of 1-min bars for chart rendering.
 */
export const ONE_MIN_BAR_BUFFER = 60;

// ── Factory ─────────────────────────────────────────────────────────────────

/** Create an empty feature snapshot for a symbol */
export function emptySnapshot(symbol: string): FeatureSnapshot {
  return {
    symbol: symbol.toUpperCase(),
    ts_et: new Date().toISOString(),
    source: "ibkr",
    price_last: null,
    price_bid: null,
    price_ask: null,
    spread_pct: null,
    bar_1m_open: null,
    bar_1m_high: null,
    bar_1m_low: null,
    bar_1m_close: null,
    bar_1m_volume: null,
    volume_cumulative: null,
    rvol_20d: null,
    ema_9: null,
    ema_21: null,
    vwap: null,
    vwap_dev_pct: null,
    rsi_14: null,
    macd_line: null,
    macd_signal: null,
    macd_histogram: null,
    atr_14_pct: null,
    bollinger_upper: null,
    bollinger_lower: null,
    bb_width_pct: null,
    high_of_day: null,
    low_of_day: null,
    range_pct: null,
    range_position: null,
    prior_close: null,
    gap_pct: null,
    flags: [],
  };
}
