import { describe, it, expect, beforeEach } from "vitest";
import {
  feedBar,
  getSnapshot,
  getAllSnapshots,
  getTrackedSymbols,
  getEngine,
  removeEngine,
  _resetForTesting,
} from "../engine.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeBar(close: number, time = 1708000000, volume = 1000) {
  return {
    time,
    open: close - 0.5,
    high: close + 1,
    low: close - 1,
    close,
    volume,
  };
}

/** Feed N bars with sequential prices to warm up indicators */
function warmUp(symbol: string, count: number, basePrice = 100) {
  for (let i = 0; i < count; i++) {
    // Oscillate price slightly for realistic indicator computation
    const price = basePrice + Math.sin(i / 5) * 2;
    feedBar(symbol, makeBar(price, 1708000000 + i * 5, 1000 + i * 10));
  }
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("IndicatorEngine", () => {
  beforeEach(() => {
    _resetForTesting();
  });

  // ── Engine lifecycle ─────────────────────────────────────────────────────

  describe("engine lifecycle", () => {
    it("should return null snapshot for untracked symbol", () => {
      expect(getSnapshot("AAPL")).toBeNull();
    });

    it("should create engine on first feedBar", () => {
      feedBar("AAPL", makeBar(150));
      expect(getSnapshot("AAPL")).not.toBeNull();
    });

    it("should normalize symbol to uppercase", () => {
      feedBar("aapl", makeBar(150));
      expect(getSnapshot("AAPL")).not.toBeNull();
      expect(getTrackedSymbols()).toEqual(["AAPL"]);
    });

    it("should track multiple symbols independently", () => {
      feedBar("AAPL", makeBar(150));
      feedBar("MSFT", makeBar(300));
      expect(getTrackedSymbols()).toHaveLength(2);
      expect(getTrackedSymbols()).toContain("AAPL");
      expect(getTrackedSymbols()).toContain("MSFT");
    });

    it("should remove engine", () => {
      feedBar("AAPL", makeBar(150));
      expect(removeEngine("AAPL")).toBe(true);
      expect(getSnapshot("AAPL")).toBeNull();
      expect(removeEngine("AAPL")).toBe(false);
    });

    it("should return all snapshots", () => {
      feedBar("AAPL", makeBar(150));
      feedBar("MSFT", makeBar(300));
      const all = getAllSnapshots();
      expect(all).toHaveLength(2);
      expect(all.map((s) => s.symbol).sort()).toEqual(["AAPL", "MSFT"]);
    });

    it("should return immutable snapshot copy", () => {
      feedBar("AAPL", makeBar(150));
      const s1 = getSnapshot("AAPL")!;
      const s2 = getSnapshot("AAPL")!;
      expect(s1).not.toBe(s2);
      expect(s1.flags).not.toBe(s2.flags);
    });
  });

  // ── Price tracking ───────────────────────────────────────────────────────

  describe("price tracking", () => {
    it("should update price_last from bar close", () => {
      feedBar("AAPL", makeBar(150.25));
      const snap = getSnapshot("AAPL")!;
      expect(snap.price_last).toBe(150.25);
    });

    it("should track high/low of day", () => {
      feedBar("AAPL", makeBar(150, 1708000000));
      feedBar("AAPL", makeBar(155, 1708000005)); // higher
      feedBar("AAPL", makeBar(148, 1708000010)); // lower
      const snap = getSnapshot("AAPL")!;
      expect(snap.high_of_day).toBe(156); // 155 + 1 (bar high)
      expect(snap.low_of_day).toBe(147);  // 148 - 1 (bar low)
    });

    it("should compute range_pct", () => {
      feedBar("AAPL", makeBar(100, 1708000000));
      feedBar("AAPL", makeBar(110, 1708000005));
      const snap = getSnapshot("AAPL")!;
      expect(snap.range_pct).toBeGreaterThan(0);
    });

    it("should compute range_position (0=LOD, 1=HOD)", () => {
      feedBar("AAPL", makeBar(100, 1708000000));
      feedBar("AAPL", makeBar(110, 1708000005));
      const snap = getSnapshot("AAPL")!;
      // Close is 110, range is ~99 to ~111
      expect(snap.range_position).toBeGreaterThan(0.5);
    });
  });

  // ── Quote data ───────────────────────────────────────────────────────────

  describe("quote data", () => {
    it("should set bid/ask/last via setQuote", () => {
      const engine = getEngine("AAPL");
      engine.setQuote(149.90, 150.10, 150.00);
      const snap = engine.getSnapshot();
      expect(snap.price_bid).toBe(149.90);
      expect(snap.price_ask).toBe(150.10);
      expect(snap.price_last).toBe(150.00);
    });

    it("should compute spread_pct", () => {
      const engine = getEngine("AAPL");
      engine.setQuote(149.00, 151.00, 150.00);
      const snap = engine.getSnapshot();
      // (151 - 149) / 150 * 100 = 1.33%
      expect(snap.spread_pct).toBeCloseTo(1.333, 2);
    });

    it("should handle null bid/ask gracefully", () => {
      const engine = getEngine("AAPL");
      engine.setQuote(null, null, 150.00);
      const snap = engine.getSnapshot();
      expect(snap.spread_pct).toBeNull();
    });
  });

  // ── Gap calculation ──────────────────────────────────────────────────────

  describe("gap calculation", () => {
    it("should compute gap_pct from prior close", () => {
      const engine = getEngine("AAPL");
      engine.setPriorClose(148.00);
      feedBar("AAPL", makeBar(150.00));
      const snap = getSnapshot("AAPL")!;
      // (150 - 148) / 148 * 100 = 1.35%
      expect(snap.gap_pct).toBeCloseTo(1.351, 1);
    });

    it("should handle 0 prior close", () => {
      const engine = getEngine("AAPL");
      engine.setPriorClose(0);
      feedBar("AAPL", makeBar(150.00));
      const snap = getSnapshot("AAPL")!;
      // Should not divide by zero
      expect(snap.gap_pct).toBeNull();
    });
  });

  // ── Volume tracking ──────────────────────────────────────────────────────

  describe("volume tracking", () => {
    it("should accumulate cumulative volume", () => {
      feedBar("AAPL", makeBar(150, 1708000000, 5000));
      feedBar("AAPL", makeBar(151, 1708000005, 3000));
      const snap = getSnapshot("AAPL")!;
      expect(snap.volume_cumulative).toBe(8000);
    });

    it("should compute rvol_20d from avg volume", () => {
      // Feed bars first (setAvgVolume computes rvol at call time)
      feedBar("AAPL", makeBar(150, 1708000000, 5000));
      feedBar("AAPL", makeBar(151, 1708000005, 5000));
      const engine = getEngine("AAPL");
      engine.setAvgVolume(10000);
      const snap = engine.getSnapshot();
      // cumulative 10000 / avg 10000 = 1.0
      expect(snap.rvol_20d).toBe(1.0);
    });

    it("should handle 0 avg volume", () => {
      const engine = getEngine("AAPL");
      engine.setAvgVolume(0);
      feedBar("AAPL", makeBar(150, 1708000000, 5000));
      const snap = getSnapshot("AAPL")!;
      expect(snap.rvol_20d).toBeNull();
    });
  });

  // ── 1-minute bar aggregation ─────────────────────────────────────────────

  describe("1-minute bar aggregation", () => {
    it("should aggregate 5s bars into 1m bar", () => {
      const baseTime = 1708000020; // aligned to a minute boundary
      // 12 bars at 5s interval = 1 minute
      feedBar("AAPL", makeBar(100, baseTime, 500));       // first bar: sets open
      feedBar("AAPL", makeBar(102, baseTime + 5, 600));   // higher
      feedBar("AAPL", makeBar(98, baseTime + 10, 400));   // lower
      feedBar("AAPL", makeBar(101, baseTime + 15, 700));  // last close

      const snap = getSnapshot("AAPL")!;
      expect(snap.bar_1m_open).toBe(99.5);   // first bar open
      expect(snap.bar_1m_high).toBe(103);     // max high across bars
      expect(snap.bar_1m_low).toBe(97);       // min low across bars
      expect(snap.bar_1m_close).toBe(101);    // last bar close
      expect(snap.bar_1m_volume).toBe(2200);  // sum of volumes
    });

    it("should start new 1m bar on minute boundary", () => {
      feedBar("AAPL", makeBar(100, 1708000000, 500)); // minute 0
      feedBar("AAPL", makeBar(105, 1708000060, 600)); // minute 1 (new bar)
      const snap = getSnapshot("AAPL")!;
      expect(snap.bar_1m_open).toBe(104.5);  // new bar's open
      expect(snap.bar_1m_close).toBe(105);
      expect(snap.bar_1m_volume).toBe(600);  // only minute 1 volume
    });
  });

  // ── VWAP ─────────────────────────────────────────────────────────────────

  describe("VWAP", () => {
    it("should compute VWAP from bar data", () => {
      feedBar("AAPL", makeBar(100, 1708000000, 1000));
      const snap = getSnapshot("AAPL")!;
      // TP = (101 + 99 + 100) / 3 = 100
      // VWAP = 100 * 1000 / 1000 = 100
      expect(snap.vwap).toBeCloseTo(100, 0);
    });

    it("should compute vwap_dev_pct", () => {
      feedBar("AAPL", makeBar(100, 1708000000, 1000));
      const snap = getSnapshot("AAPL")!;
      if (snap.vwap !== null) {
        expect(snap.vwap_dev_pct).toBeDefined();
      }
    });

    it("should return null VWAP when no volume", () => {
      feedBar("AAPL", makeBar(100, 1708000000, 0));
      const snap = getSnapshot("AAPL")!;
      expect(snap.vwap).toBeNull();
    });
  });

  // ── Streaming indicators (warm-up) ───────────────────────────────────────

  describe("streaming indicators", () => {
    it("should return null indicators before warm-up", () => {
      feedBar("AAPL", makeBar(100));
      const snap = getSnapshot("AAPL")!;
      // EMA(9) needs 9 bars, RSI(14) needs 14+1, etc.
      expect(snap.ema_9).toBeNull();
      expect(snap.rsi_14).toBeNull();
      expect(snap.macd_line).toBeNull();
    });

    it("should compute EMA after sufficient bars", () => {
      warmUp("AAPL", 30);
      const snap = getSnapshot("AAPL")!;
      expect(snap.ema_9).not.toBeNull();
      expect(snap.ema_21).not.toBeNull();
      expect(typeof snap.ema_9).toBe("number");
      expect(typeof snap.ema_21).toBe("number");
    });

    it("should compute RSI after sufficient bars", () => {
      warmUp("AAPL", 30);
      const snap = getSnapshot("AAPL")!;
      expect(snap.rsi_14).not.toBeNull();
      expect(snap.rsi_14!).toBeGreaterThanOrEqual(0);
      expect(snap.rsi_14!).toBeLessThanOrEqual(100);
    });

    it("should compute MACD after sufficient bars", () => {
      warmUp("AAPL", 40); // MACD needs 26 + 9 bars
      const snap = getSnapshot("AAPL")!;
      expect(snap.macd_line).not.toBeNull();
      expect(snap.macd_signal).not.toBeNull();
      expect(snap.macd_histogram).not.toBeNull();
    });

    it("should compute Bollinger Bands after sufficient bars", () => {
      warmUp("AAPL", 25); // BB needs 20 bars
      const snap = getSnapshot("AAPL")!;
      expect(snap.bollinger_upper).not.toBeNull();
      expect(snap.bollinger_lower).not.toBeNull();
      expect(snap.bb_width_pct).not.toBeNull();
      expect(snap.bollinger_upper!).toBeGreaterThan(snap.bollinger_lower!);
    });

    it("should compute ATR as percentage of price", () => {
      warmUp("AAPL", 20); // ATR needs 14 bars
      const snap = getSnapshot("AAPL")!;
      expect(snap.atr_14_pct).not.toBeNull();
      expect(snap.atr_14_pct!).toBeGreaterThan(0);
    });
  });

  // ── Flags ────────────────────────────────────────────────────────────────

  describe("flags", () => {
    it("should flag spread_wide when spread > 0.50%", () => {
      const engine = getEngine("AAPL");
      // Spread = (151 - 149) / 150 * 100 = 1.33% > 0.50
      engine.setQuote(149, 151, 150);
      const snap = engine.getSnapshot();
      expect(snap.flags).toContain("spread_wide");
    });

    it("should not flag spread_wide when spread <= 0.50%", () => {
      const engine = getEngine("AAPL");
      // Spread = (150.10 - 149.90) / 150 * 100 = 0.133%
      engine.setQuote(149.90, 150.10, 150);
      const snap = engine.getSnapshot();
      expect(snap.flags).not.toContain("spread_wide");
    });

    it("should flag rvol_low when rvol < 1.0", () => {
      const engine = getEngine("AAPL");
      engine.setAvgVolume(10000);
      feedBar("AAPL", makeBar(150, 1708000000, 3000)); // cumVol 3000, avg 10000 → 0.3x
      const snap = getSnapshot("AAPL")!;
      expect(snap.flags).toContain("rvol_low");
    });

    it("should flag illiquid when both spread_wide and rvol_low", () => {
      const engine = getEngine("AAPL");
      engine.setAvgVolume(10000);
      engine.setQuote(149, 151, 150); // wide spread
      feedBar("AAPL", makeBar(150, 1708000000, 3000)); // low rvol
      const snap = getSnapshot("AAPL")!;
      expect(snap.flags).toContain("spread_wide");
      expect(snap.flags).toContain("rvol_low");
      expect(snap.flags).toContain("illiquid");
    });
  });

  // ── Day boundary reset ───────────────────────────────────────────────────

  describe("day boundary", () => {
    it("should reset intraday state on new day", () => {
      // Day 1
      feedBar("AAPL", makeBar(150, 1708000000, 5000));
      feedBar("AAPL", makeBar(160, 1708000005, 3000));
      const snap1 = getSnapshot("AAPL")!;
      expect(snap1.volume_cumulative).toBe(8000);
      expect(snap1.high_of_day).toBe(161); // 160 + 1

      // Day 2 (86400 seconds later)
      feedBar("AAPL", makeBar(155, 1708000000 + 86400, 1000));
      const snap2 = getSnapshot("AAPL")!;
      expect(snap2.volume_cumulative).toBe(1000); // reset
      expect(snap2.high_of_day).toBe(156); // only new bar
    });
  });

  // ── Schema contract ──────────────────────────────────────────────────────

  describe("schema contract", () => {
    it("should have all required fields in snapshot", () => {
      feedBar("AAPL", makeBar(150));
      const snap = getSnapshot("AAPL")!;

      // Verify all FeatureSnapshot fields exist
      expect(snap).toHaveProperty("symbol");
      expect(snap).toHaveProperty("ts_et");
      expect(snap).toHaveProperty("source");
      expect(snap).toHaveProperty("price_last");
      expect(snap).toHaveProperty("price_bid");
      expect(snap).toHaveProperty("price_ask");
      expect(snap).toHaveProperty("spread_pct");
      expect(snap).toHaveProperty("bar_1m_open");
      expect(snap).toHaveProperty("bar_1m_high");
      expect(snap).toHaveProperty("bar_1m_low");
      expect(snap).toHaveProperty("bar_1m_close");
      expect(snap).toHaveProperty("bar_1m_volume");
      expect(snap).toHaveProperty("volume_cumulative");
      expect(snap).toHaveProperty("rvol_20d");
      expect(snap).toHaveProperty("ema_9");
      expect(snap).toHaveProperty("ema_21");
      expect(snap).toHaveProperty("vwap");
      expect(snap).toHaveProperty("vwap_dev_pct");
      expect(snap).toHaveProperty("rsi_14");
      expect(snap).toHaveProperty("macd_line");
      expect(snap).toHaveProperty("macd_signal");
      expect(snap).toHaveProperty("macd_histogram");
      expect(snap).toHaveProperty("atr_14_pct");
      expect(snap).toHaveProperty("bollinger_upper");
      expect(snap).toHaveProperty("bollinger_lower");
      expect(snap).toHaveProperty("bb_width_pct");
      expect(snap).toHaveProperty("high_of_day");
      expect(snap).toHaveProperty("low_of_day");
      expect(snap).toHaveProperty("range_pct");
      expect(snap).toHaveProperty("range_position");
      expect(snap).toHaveProperty("prior_close");
      expect(snap).toHaveProperty("gap_pct");
      expect(snap).toHaveProperty("flags");
    });

    it("should default source to ibkr", () => {
      feedBar("AAPL", makeBar(150));
      const snap = getSnapshot("AAPL")!;
      expect(snap.source).toBe("ibkr");
    });

    it("should have valid timestamp", () => {
      feedBar("AAPL", makeBar(150));
      const snap = getSnapshot("AAPL")!;
      expect(new Date(snap.ts_et).getTime()).not.toBeNaN();
    });
  });
});
