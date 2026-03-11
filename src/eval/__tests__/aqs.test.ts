import { describe, it, expect } from "vitest";
import { computeAQS, AQS_VERSION, type AQSInput } from "../aqs.js";

function makeInput(overrides: Partial<AQSInput> = {}): AQSInput {
  return {
    direction: "long",
    entry_price: 50,
    stop_price: 49,
    market_cap: 1_000_000_000, // $1B — not small cap
    volatility_regime: "normal",
    exchange: "NMS",
    rolling_strat_wr: null,
    news_count_24h: null,
    ...overrides,
  };
}

describe("AQS v2", () => {
  it("returns correct version", () => {
    const result = computeAQS(makeInput());
    expect(result.version).toBe(AQS_VERSION);
  });

  // ── Hard filters ──

  it("Long + small_cap → score 0 with SKIP_LONG_SC", () => {
    const result = computeAQS(makeInput({
      direction: "long",
      market_cap: 200_000_000, // $200M = small cap
    }));
    expect(result.score).toBe(0);
    expect(result.reason_codes).toContain("SKIP_LONG_SC");
  });

  it("OTC exchange → score 0 with SKIP_OTC", () => {
    const result = computeAQS(makeInput({ exchange: "OTC" }));
    expect(result.score).toBe(0);
    expect(result.reason_codes).toContain("SKIP_OTC");
  });

  it("PNK exchange → score 0 with SKIP_OTC", () => {
    const result = computeAQS(makeInput({ exchange: "PNK" }));
    expect(result.score).toBe(0);
    expect(result.reason_codes).toContain("SKIP_OTC");
  });

  // ── Vol regime ──

  it("Long + normal vol → +10 (VOL_ALIGNED)", () => {
    const result = computeAQS(makeInput({ volatility_regime: "normal" }));
    expect(result.components.vol_regime).toBe(10);
    expect(result.reason_codes).toContain("VOL_ALIGNED");
  });

  it("Long + high vol → -10 (VOL_ADVERSE)", () => {
    const result = computeAQS(makeInput({ volatility_regime: "high" }));
    expect(result.components.vol_regime).toBe(-10);
    expect(result.reason_codes).toContain("VOL_ADVERSE");
  });

  it("Short + high vol → +7 (v2 reduced from 10)", () => {
    const result = computeAQS(makeInput({
      direction: "short",
      volatility_regime: "high",
    }));
    expect(result.components.vol_regime).toBe(7);
  });

  it("Short + normal vol → -15", () => {
    const result = computeAQS(makeInput({
      direction: "short",
      volatility_regime: "normal",
    }));
    expect(result.components.vol_regime).toBe(-15);
  });

  // ── Short non-sc penalty ──

  it("Short + non-sc → -3 penalty", () => {
    const result = computeAQS(makeInput({
      direction: "short",
      market_cap: 1_000_000_000,
    }));
    expect(result.components.short_nonsc_penalty).toBe(-3);
    expect(result.reason_codes).toContain("SHORT_NONSC_PEN");
  });

  it("Short + sc → no penalty (bonus instead)", () => {
    const result = computeAQS(makeInput({
      direction: "short",
      market_cap: 200_000_000,
    }));
    expect(result.components.short_nonsc_penalty).toBe(0);
    expect(result.components.short_sc_bonus).toBe(20);
  });

  // ── risk_pct ──

  it("Long + tight stop → +5", () => {
    // risk_pct = |50 - 49.6| / 50 * 100 = 0.8% < 0.85
    const result = computeAQS(makeInput({ entry_price: 50, stop_price: 49.6 }));
    expect(result.components.risk_pct).toBe(5);
    expect(result.reason_codes).toContain("TIGHT_STOP");
  });

  it("Long + wide stop → -5", () => {
    // risk_pct = |50 - 47.5| / 50 * 100 = 5.0% > 4.10
    const result = computeAQS(makeInput({ entry_price: 50, stop_price: 47.5 }));
    expect(result.components.risk_pct).toBe(-5);
    expect(result.reason_codes).toContain("WIDE_STOP");
  });

  it("Short + wide stop → +5 (shorts need room)", () => {
    // risk_pct = |20 - 21| / 20 * 100 = 5.0% > 4.75
    const result = computeAQS(makeInput({
      direction: "short",
      entry_price: 20,
      stop_price: 21,
    }));
    expect(result.components.risk_pct).toBe(5);
  });

  // ── Price bucket ──

  it("Long $50-100 → +5 PRICE_SWEET", () => {
    const result = computeAQS(makeInput({ entry_price: 75, stop_price: 74 }));
    expect(result.components.price_bucket).toBe(5);
    expect(result.reason_codes).toContain("PRICE_SWEET");
  });

  it("Long $10-20 → -5 PRICE_LOW", () => {
    const result = computeAQS(makeInput({ entry_price: 15, stop_price: 14.5 }));
    expect(result.components.price_bucket).toBe(-5);
    expect(result.reason_codes).toContain("PRICE_LOW");
  });

  // ── Short sc bonus ──

  it("Short sc → +20 SHORT_SC_EDGE", () => {
    const result = computeAQS(makeInput({
      direction: "short",
      market_cap: 100_000_000,
      volatility_regime: "high",
    }));
    expect(result.components.short_sc_bonus).toBe(20);
    expect(result.reason_codes).toContain("SHORT_SC_EDGE");
  });

  // ── Rolling WR (Phase 2) ──

  it("rolling_strat_wr > 0.60 → +10", () => {
    const result = computeAQS(makeInput({ rolling_strat_wr: 0.65 }));
    expect(result.components.rolling_wr).toBe(10);
    expect(result.reason_codes).toContain("STRAT_HOT");
  });

  it("rolling_strat_wr < 0.35 → -15", () => {
    const result = computeAQS(makeInput({ rolling_strat_wr: 0.30 }));
    expect(result.components.rolling_wr).toBe(-15);
    expect(result.reason_codes).toContain("STRAT_COLD");
  });

  it("rolling_strat_wr null → 0 + flagged missing", () => {
    const result = computeAQS(makeInput({ rolling_strat_wr: null }));
    expect(result.components.rolling_wr).toBe(0);
    expect(result.missing_inputs).toContain("rolling_strat_wr");
  });

  // ── Composite score tests ──

  it("best Long scenario: non-sc + normal vol + tight stop + $75 + hot strategy", () => {
    const result = computeAQS(makeInput({
      direction: "long",
      entry_price: 75,
      stop_price: 74.5, // 0.67% risk
      market_cap: 5_000_000_000,
      volatility_regime: "normal",
      rolling_strat_wr: 0.65,
      news_count_24h: 12,
    }));
    // 50 + 10(vol) + 5(risk) + 5(price) + 10(rolling) + 10(news) = 90, capped at 100
    expect(result.score).toBe(90);
  });

  it("best Short scenario: sc + high vol + wide stop", () => {
    const result = computeAQS(makeInput({
      direction: "short",
      entry_price: 8,
      stop_price: 8.5, // 6.25% risk
      market_cap: 150_000_000,
      volatility_regime: "high",
      rolling_strat_wr: 0.65,
      news_count_24h: 12,
    }));
    // 50 + 7(vol) + 5(risk) + 20(sc) + 10(rolling) + 10(news) = 102, capped at 100
    // No short_nonsc_penalty because IS small_cap
    expect(result.score).toBe(100);
  });

  it("worst non-skip scenario: Short non-sc + normal vol + tight stop + cold strategy", () => {
    const result = computeAQS(makeInput({
      direction: "short",
      entry_price: 50,
      stop_price: 50.4, // 0.8% risk < 1.0 = tight
      market_cap: 5_000_000_000,
      volatility_regime: "normal",
      rolling_strat_wr: 0.25,
    }));
    // 50 + (-15)(vol) + (-3)(nonsc) + (-5)(tight_short) + (-15)(cold) = 12
    expect(result.score).toBe(12);
  });

  // ── Missing input degradation ──

  it("all nulls → base 50 with full missing list", () => {
    const result = computeAQS({
      direction: "long",
      entry_price: null,
      stop_price: null,
      market_cap: null,
      volatility_regime: null,
      exchange: null,
      rolling_strat_wr: null,
      news_count_24h: null,
    });
    expect(result.score).toBe(50);
    expect(result.missing_inputs).toContain("market_cap");
    expect(result.missing_inputs).toContain("volatility_regime");
    expect(result.missing_inputs).toContain("risk_pct");
    expect(result.missing_inputs).toContain("exchange");
    expect(result.missing_inputs).toContain("rolling_strat_wr");
    expect(result.missing_inputs).toContain("news_count_24h");
  });

  // ── Score bounds ──

  it("score is always 0-100", () => {
    // Test with extreme inputs that might push score negative
    const low = computeAQS(makeInput({
      direction: "short",
      volatility_regime: "normal",
      rolling_strat_wr: 0.20,
      entry_price: 50,
      stop_price: 50.3, // tight stop for short = penalty
    }));
    expect(low.score).toBeGreaterThanOrEqual(0);
    expect(low.score).toBeLessThanOrEqual(100);

    // Test with extreme high inputs
    const high = computeAQS(makeInput({
      direction: "short",
      market_cap: 100_000_000,
      volatility_regime: "high",
      rolling_strat_wr: 0.70,
      news_count_24h: 15,
      entry_price: 8,
      stop_price: 9,
    }));
    expect(high.score).toBeGreaterThanOrEqual(0);
    expect(high.score).toBeLessThanOrEqual(100);
  });

  // ── Monotonicity invariants ──

  it("Long: normal_vol score > high_vol score (all else equal)", () => {
    const base = makeInput();
    const normalVol = computeAQS({ ...base, volatility_regime: "normal" });
    const highVol = computeAQS({ ...base, volatility_regime: "high" });
    expect(normalVol.score).toBeGreaterThan(highVol.score);
  });

  it("Long: tight stop score >= wide stop score", () => {
    const base = makeInput({ entry_price: 50 });
    const tight = computeAQS({ ...base, stop_price: 49.6 }); // 0.8%
    const wide = computeAQS({ ...base, stop_price: 47 });    // 6%
    expect(tight.score).toBeGreaterThanOrEqual(wide.score);
  });

  it("Short: small_cap score > non-small_cap score (all else equal)", () => {
    const base = makeInput({ direction: "short", volatility_regime: "high" });
    const sc = computeAQS({ ...base, market_cap: 100_000_000 });
    const nonSc = computeAQS({ ...base, market_cap: 5_000_000_000 });
    expect(sc.score).toBeGreaterThan(nonSc.score);
  });
});
