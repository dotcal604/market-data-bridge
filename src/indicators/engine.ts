/**
 * Streaming Indicator Engine
 *
 * Incrementally computes the feature snapshot for a symbol using trading-signals.
 * Fed by 5-second real-time bars from subscriptions.ts — no array recomputation.
 *
 * Architecture:
 * - One SymbolEngine per tracked symbol
 * - Each engine holds streaming indicator instances (.add() per bar)
 * - IndicatorEngine manages symbol engines + exposes snapshots via getSnapshot()
 * - Integrates with existing subscription system — call feedBar() from subscriptions
 */
import {
  EMA,
  RSI,
  MACD,
  BollingerBands,
  ATR,
} from "trading-signals";
import {
  type FeatureSnapshot,
  type FeatureFlag,
  INDICATOR_CONFIG,
  emptySnapshot,
} from "./schema.js";
import { logger } from "../logging.js";

const log = logger.child({ subsystem: "indicators" });

// ── VWAP (not in trading-signals — simple streaming impl) ───────────────────

class StreamingVWAP {
  private cumulativeTPV = 0;  // sum(typicalPrice * volume)
  private cumulativeVol = 0;  // sum(volume)

  reset(): void {
    this.cumulativeTPV = 0;
    this.cumulativeVol = 0;
  }

  update(high: number, low: number, close: number, volume: number): number | null {
    if (volume <= 0) return this.cumulativeVol > 0 ? this.cumulativeTPV / this.cumulativeVol : null;
    const tp = (high + low + close) / 3;
    this.cumulativeTPV += tp * volume;
    this.cumulativeVol += volume;
    return this.cumulativeTPV / this.cumulativeVol;
  }

  get value(): number | null {
    return this.cumulativeVol > 0 ? this.cumulativeTPV / this.cumulativeVol : null;
  }
}

// ── Per-Symbol Engine ───────────────────────────────────────────────────────

interface BarInput {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

class SymbolEngine {
  readonly symbol: string;
  private snapshot: FeatureSnapshot;

  // Streaming indicator instances
  private ema9: EMA;
  private ema21: EMA;
  private rsi14: RSI;
  private macd: MACD;
  private bbands: BollingerBands;
  private atr14: ATR;
  private vwap: StreamingVWAP;

  // Day tracking
  private highOfDay = -Infinity;
  private lowOfDay = Infinity;
  private cumulativeVolume = 0;
  private barCount = 0;
  private lastBarDay = -1;

  // 1-minute bar aggregation from 5s bars
  private currentMinute = -1;
  private minuteBar: BarInput | null = null;

  constructor(symbol: string) {
    this.symbol = symbol.toUpperCase();
    this.snapshot = emptySnapshot(this.symbol);

    const cfg = INDICATOR_CONFIG;
    this.ema9 = new EMA(cfg.ema.periods[0]);
    this.ema21 = new EMA(cfg.ema.periods[1]);
    this.rsi14 = new RSI(cfg.rsi.period);
    this.macd = new MACD(
      new EMA(cfg.macd.fast),
      new EMA(cfg.macd.slow),
      new EMA(cfg.macd.signal),
    );
    this.bbands = new BollingerBands(cfg.bollinger.period, cfg.bollinger.stdDev);
    this.atr14 = new ATR(cfg.atr.period);
    this.vwap = new StreamingVWAP();
  }

  /** Feed a 5-second real-time bar */
  feedBar(bar: BarInput): void {
    this.barCount++;

    // Day boundary detection — reset intraday state
    const barDay = new Date(bar.time * 1000).getUTCDate();
    if (this.lastBarDay !== -1 && barDay !== this.lastBarDay) {
      this.resetDay();
    }
    this.lastBarDay = barDay;

    // Update day tracking
    if (bar.high > this.highOfDay) this.highOfDay = bar.high;
    if (bar.low < this.lowOfDay) this.lowOfDay = bar.low;
    this.cumulativeVolume += bar.volume;

    // Feed streaming indicators with close price
    this.ema9.add(bar.close);
    this.ema21.add(bar.close);
    this.rsi14.add(bar.close);
    this.macd.add(bar.close);
    this.bbands.add(bar.close);
    this.atr14.add({ high: bar.high, low: bar.low, close: bar.close });

    // VWAP
    this.vwap.update(bar.high, bar.low, bar.close, bar.volume);

    // Aggregate into 1-minute bars
    const barMinute = Math.floor(bar.time / 60);
    if (barMinute !== this.currentMinute) {
      this.currentMinute = barMinute;
      this.minuteBar = { ...bar };
    } else if (this.minuteBar) {
      this.minuteBar.high = Math.max(this.minuteBar.high, bar.high);
      this.minuteBar.low = Math.min(this.minuteBar.low, bar.low);
      this.minuteBar.close = bar.close;
      this.minuteBar.volume += bar.volume;
    }

    // Update snapshot
    this.updateSnapshot(bar);
  }

  /** Set quote data (bid/ask/last) from snapshot quotes */
  setQuote(bid: number | null, ask: number | null, last: number | null): void {
    this.snapshot.price_bid = bid;
    this.snapshot.price_ask = ask;
    if (last !== null) this.snapshot.price_last = last;
    if (bid !== null && ask !== null && last !== null && last > 0) {
      this.snapshot.spread_pct = ((ask - bid) / last) * 100;
    }
    this.updateFlags();
  }

  /** Set prior close for gap calculation */
  setPriorClose(priorClose: number): void {
    this.snapshot.prior_close = priorClose;
    if (this.snapshot.price_last !== null && priorClose > 0) {
      this.snapshot.gap_pct = ((this.snapshot.price_last - priorClose) / priorClose) * 100;
    }
  }

  /** Set average volume for relative volume calculation */
  setAvgVolume(avgVolume: number): void {
    if (avgVolume > 0) {
      this.snapshot.rvol_20d = this.cumulativeVolume / avgVolume;
    }
  }

  /** Get current feature snapshot (immutable copy) */
  getSnapshot(): FeatureSnapshot {
    return { ...this.snapshot, flags: [...this.snapshot.flags] };
  }

  private updateSnapshot(bar: BarInput): void {
    const s = this.snapshot;
    s.ts_et = new Date().toISOString();
    s.price_last = bar.close;

    // 1-min bar
    if (this.minuteBar) {
      s.bar_1m_open = this.minuteBar.open;
      s.bar_1m_high = this.minuteBar.high;
      s.bar_1m_low = this.minuteBar.low;
      s.bar_1m_close = this.minuteBar.close;
      s.bar_1m_volume = this.minuteBar.volume;
    }

    // Volume
    s.volume_cumulative = this.cumulativeVolume;

    // Trend — safely read indicator values
    s.ema_9 = safeNumber(this.ema9);
    s.ema_21 = safeNumber(this.ema21);
    s.vwap = this.vwap.value;
    if (s.vwap !== null && s.price_last !== null && s.vwap > 0) {
      s.vwap_dev_pct = ((s.price_last - s.vwap) / s.vwap) * 100;
    }

    // Momentum
    s.rsi_14 = safeNumber(this.rsi14);
    const macdResult = safeMACD(this.macd);
    if (macdResult) {
      s.macd_line = macdResult.macd;
      s.macd_signal = macdResult.signal;
      s.macd_histogram = macdResult.histogram;
    }

    // Volatility
    const atrVal = safeNumber(this.atr14);
    if (atrVal !== null && s.price_last > 0) {
      s.atr_14_pct = (atrVal / s.price_last) * 100;
    }
    const bbResult = safeBB(this.bbands);
    if (bbResult) {
      s.bollinger_upper = bbResult.upper;
      s.bollinger_lower = bbResult.lower;
      const middle = (bbResult.upper + bbResult.lower) / 2;
      if (middle > 0) {
        s.bb_width_pct = ((bbResult.upper - bbResult.lower) / middle) * 100;
      }
    }

    // Range
    s.high_of_day = this.highOfDay === -Infinity ? null : this.highOfDay;
    s.low_of_day = this.lowOfDay === Infinity ? null : this.lowOfDay;
    if (s.high_of_day !== null && s.low_of_day !== null && s.low_of_day > 0) {
      s.range_pct = ((s.high_of_day - s.low_of_day) / s.low_of_day) * 100;
      const range = s.high_of_day - s.low_of_day;
      s.range_position = range > 0 ? (bar.close - s.low_of_day) / range : 0.5;
    }

    // Gap
    if (s.prior_close !== null && s.price_last !== null && s.prior_close > 0) {
      s.gap_pct = ((s.price_last - s.prior_close) / s.prior_close) * 100;
    }

    this.updateFlags();
  }

  private updateFlags(): void {
    const flags: FeatureFlag[] = [];
    const s = this.snapshot;

    if (s.spread_pct !== null && s.spread_pct > 0.50) flags.push("spread_wide");
    if (s.rvol_20d !== null && s.rvol_20d < 1.0) flags.push("rvol_low");
    if (flags.includes("spread_wide") && flags.includes("rvol_low")) flags.push("illiquid");

    s.flags = flags;
  }

  private resetDay(): void {
    this.highOfDay = -Infinity;
    this.lowOfDay = Infinity;
    this.cumulativeVolume = 0;
    this.vwap.reset();
    log.info({ symbol: this.symbol }, "Day boundary — reset intraday state");
  }
}

// ── Safe value extraction from trading-signals ──────────────────────────────

function safeNumber(indicator: { isStable: boolean; getResult: () => unknown }): number | null {
  try {
    if (!indicator.isStable) return null;
    const val = indicator.getResult();
    if (val === undefined || val === null) return null;
    const num = Number(val);
    return isFinite(num) ? num : null;
  } catch {
    return null;
  }
}

function safeMACD(macd: MACD): { macd: number; signal: number; histogram: number } | null {
  try {
    if (!macd.isStable) return null;
    const result = macd.getResult();
    if (!result) return null;
    const m = Number(result.macd);
    const s = Number(result.signal);
    const h = Number(result.histogram);
    if (!isFinite(m) || !isFinite(s) || !isFinite(h)) return null;
    return { macd: m, signal: s, histogram: h };
  } catch {
    return null;
  }
}

function safeBB(bb: BollingerBands): { upper: number; lower: number } | null {
  try {
    if (!bb.isStable) return null;
    const result = bb.getResult();
    if (!result) return null;
    const upper = Number(result.upper);
    const lower = Number(result.lower);
    if (!isFinite(upper) || !isFinite(lower)) return null;
    return { upper, lower };
  } catch {
    return null;
  }
}

// ── Indicator Engine (singleton manager) ────────────────────────────────────

const engines = new Map<string, SymbolEngine>();

/**
 * Get or create a SymbolEngine for a symbol.
 */
export function getEngine(symbol: string): SymbolEngine {
  const key = symbol.toUpperCase();
  let engine = engines.get(key);
  if (!engine) {
    engine = new SymbolEngine(key);
    engines.set(key, engine);
    log.info({ symbol: key }, "Created indicator engine");
  }
  return engine;
}

/**
 * Feed a 5-second bar into the indicator engine for a symbol.
 * Called from subscriptions.ts when a real-time bar arrives.
 */
export function feedBar(symbol: string, bar: BarInput): void {
  getEngine(symbol).feedBar(bar);
}

/**
 * Get the current feature snapshot for a symbol.
 * Returns null if no engine exists (no bars fed yet).
 */
export function getSnapshot(symbol: string): FeatureSnapshot | null {
  const engine = engines.get(symbol.toUpperCase());
  return engine ? engine.getSnapshot() : null;
}

/**
 * Get snapshots for all tracked symbols.
 */
export function getAllSnapshots(): FeatureSnapshot[] {
  return Array.from(engines.values()).map((e) => e.getSnapshot());
}

/**
 * List symbols currently being tracked.
 */
export function getTrackedSymbols(): string[] {
  return Array.from(engines.keys());
}

/**
 * Remove a symbol engine (when subscription is cancelled).
 */
export function removeEngine(symbol: string): boolean {
  return engines.delete(symbol.toUpperCase());
}

/**
 * Reset all engines. Used for testing.
 */
export function _resetForTesting(): void {
  engines.clear();
}
