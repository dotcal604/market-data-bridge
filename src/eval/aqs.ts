/**
 * Alert Quality Score (AQS) v2.0
 *
 * Deterministic pre-trade quality score for Holly alerts.
 * Based on validated research (28,875 trades, 6 phases, p=0.000000 for key effects).
 *
 * This is a PURE function — no DB calls, no API calls, no side effects.
 * Runs alongside (not inside) the LLM ensemble scorer.
 *
 * Research artifacts: analysis/holly_edge_probe/ in brave-chebyshev worktree
 * Formula: AQS v2 (Fix C) — short vol bonus reduced, non-sc penalty added
 */

// ── Types ────────────────────────────────────────────────────────────────

export interface AQSInput {
  direction: "long" | "short";
  entry_price: number | null;
  stop_price: number | null;
  /** Market cap in dollars. null = unknown (degrades gracefully). */
  market_cap: number | null;
  /** From FeatureVector.volatility_regime */
  volatility_regime: "low" | "normal" | "high" | null;
  // Phase 2 inputs (nullable — formula degrades gracefully)
  /** Exchange string, e.g. "NMS", "NYQ", "OTC". null = skip OTC check. */
  exchange: string | null;
  /** Rolling win rate of this strategy over last 100 completed trades. */
  rolling_strat_wr: number | null;
  /** Count of news items for this symbol in prior 24h. */
  news_count_24h: number | null;
}

export interface AQSComponents {
  base: 50;
  sc_filter: number;
  vol_regime: number;
  risk_pct: number;
  price_bucket: number;
  short_sc_bonus: number;
  short_nonsc_penalty: number;
  rolling_wr: number;
  news: number;
  otc_filter: number;
}

export interface AQSResult {
  score: number;
  version: string;
  reason_codes: string[];
  missing_inputs: string[];
  components: AQSComponents;
}

export const AQS_VERSION = "v2.0";

// ── Thresholds (from research, percentile-derived) ───────────────────────

const SMALL_CAP_THRESHOLD = 300_000_000; // $300M

// risk_pct thresholds (Q1/Q5 boundaries from 28,875-trade dataset)
const LONG_RISK_TIGHT = 0.85;   // Q1 boundary
const LONG_RISK_WIDE = 4.10;    // Q5 boundary
const SHORT_RISK_WIDE = 4.75;   // Q5 boundary
const SHORT_RISK_TIGHT = 1.00;  // Q1 boundary

// ── Core scoring function ────────────────────────────────────────────────

/**
 * Compute AQS v2 score for a Holly alert.
 *
 * Score range: 0 (hard skip) to ~85 (best possible with available inputs).
 * Missing inputs degrade gracefully — the component is scored as 0 and flagged.
 *
 * @param input Pre-trade features available at alert time
 * @returns Score, version, reason codes, missing inputs, and component breakdown
 */
export function computeAQS(input: AQSInput): AQSResult {
  const reasons: string[] = [];
  const missing: string[] = [];
  const components: AQSComponents = {
    base: 50,
    sc_filter: 0,
    vol_regime: 0,
    risk_pct: 0,
    price_bucket: 0,
    short_sc_bonus: 0,
    short_nonsc_penalty: 0,
    rolling_wr: 0,
    news: 0,
    otc_filter: 0,
  };

  const isSmallCap = input.market_cap != null && input.market_cap < SMALL_CAP_THRESHOLD;
  const isLong = input.direction === "long";
  const isShort = input.direction === "short";

  // ── HARD FILTERS ──

  // Long + small_cap → SKIP (18.1% WR, p=0.000000, 36x noise ceiling)
  if (isLong && isSmallCap) {
    components.sc_filter = -50;
    reasons.push("SKIP_LONG_SC");
    return { score: 0, version: AQS_VERSION, reason_codes: reasons, missing_inputs: missing, components };
  }

  // OTC Link → SKIP (23.0% WR) — requires exchange field
  if (input.exchange != null) {
    const ex = input.exchange.toUpperCase();
    if (ex.includes("OTC") || ex === "PNK") {
      components.otc_filter = -50;
      reasons.push("SKIP_OTC");
      return { score: 0, version: AQS_VERSION, reason_codes: reasons, missing_inputs: missing, components };
    }
  } else {
    missing.push("exchange");
  }

  // Track market_cap availability
  if (input.market_cap == null) {
    missing.push("market_cap");
  }

  // ── VOL REGIME (±10 Long, +7/-15 Short) ──

  if (input.volatility_regime != null) {
    if (isLong) {
      if (input.volatility_regime === "normal" || input.volatility_regime === "low") {
        components.vol_regime = 10;
        reasons.push("VOL_ALIGNED");
      } else if (input.volatility_regime === "high") {
        components.vol_regime = -10;
        reasons.push("VOL_ADVERSE");
      }
    } else if (isShort) {
      if (input.volatility_regime === "high") {
        components.vol_regime = 7; // v2: reduced from 10
        reasons.push("VOL_ALIGNED");
      } else if (input.volatility_regime === "normal") {
        components.vol_regime = -15;
        reasons.push("VOL_ADVERSE");
      }
    }
  } else {
    missing.push("volatility_regime");
  }

  // ── SHORT NON-SC PENALTY (v2 addition: -3) ──

  if (isShort && !isSmallCap) {
    components.short_nonsc_penalty = -3;
    reasons.push("SHORT_NONSC_PEN");
  }

  // ── RISK STRUCTURE (±5) ──

  if (input.entry_price != null && input.stop_price != null && input.entry_price > 0) {
    const riskPct = Math.abs(input.entry_price - input.stop_price) / input.entry_price * 100;

    if (isLong) {
      if (riskPct < LONG_RISK_TIGHT) {
        components.risk_pct = 5;
        reasons.push("TIGHT_STOP");
      } else if (riskPct > LONG_RISK_WIDE) {
        components.risk_pct = -5;
        reasons.push("WIDE_STOP");
      }
    } else if (isShort) {
      if (riskPct > SHORT_RISK_WIDE) {
        components.risk_pct = 5;
        reasons.push("WIDE_STOP_SHORT"); // shorts need room
      } else if (riskPct < SHORT_RISK_TIGHT) {
        components.risk_pct = -5;
        reasons.push("TIGHT_STOP_SHORT");
      }
    }
  } else {
    missing.push("risk_pct");
  }

  // ── PRICE BUCKET (Longs only, ±5) ──

  if (isLong && input.entry_price != null) {
    if (input.entry_price >= 50 && input.entry_price <= 100) {
      components.price_bucket = 5;
      reasons.push("PRICE_SWEET");
    } else if (input.entry_price < 20 && input.entry_price >= 5) {
      components.price_bucket = -5;
      reasons.push("PRICE_LOW");
    }
  }

  // ── SHORT SMALL_CAP BONUS (+20) ──

  if (isShort && isSmallCap) {
    components.short_sc_bonus = 20;
    reasons.push("SHORT_SC_EDGE");
  }

  // ── ROLLING STRATEGY WR (Phase 2, ±10/−15) ──

  if (input.rolling_strat_wr != null) {
    if (input.rolling_strat_wr > 0.60) {
      components.rolling_wr = 10;
      reasons.push("STRAT_HOT");
    } else if (input.rolling_strat_wr < 0.35) {
      components.rolling_wr = -15;
      reasons.push("STRAT_COLD");
    }
  } else {
    missing.push("rolling_strat_wr");
  }

  // ── NEWS (Phase 2, +5/+10) ──

  if (input.news_count_24h != null) {
    if (input.news_count_24h > 10) {
      components.news = 10;
      reasons.push("NEWS_HIGH");
    } else if (input.news_count_24h > 5) {
      components.news = 5;
      reasons.push("NEWS_MOD");
    }
  } else {
    missing.push("news_count_24h");
  }

  // ── FINAL SCORE ──

  const raw = components.base
    + components.sc_filter
    + components.vol_regime
    + components.risk_pct
    + components.price_bucket
    + components.short_sc_bonus
    + components.short_nonsc_penalty
    + components.rolling_wr
    + components.news
    + components.otc_filter;

  const score = Math.max(0, Math.min(100, raw));

  return { score, version: AQS_VERSION, reason_codes: reasons, missing_inputs: missing, components };
}
