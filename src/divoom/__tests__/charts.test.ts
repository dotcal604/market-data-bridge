import { describe, it, expect, beforeEach } from "vitest";
import {
  renderSparkline,
  renderGauge,
  renderCandlestick,
  renderHeatmap,
  renderVolumeBars,
  renderPnLCurve,
  renderAllocation,
  renderAllCharts,
  getCachedChart,
  setCachedChart,
  clearChartCache,
  type ChartInputData,
  type OHLC,
  type HeatmapCell,
} from "../charts.js";

// ─── Helpers ──────────────────────────────────────────────────

/** Verify buffer is a valid PNG (magic bytes) */
function isPng(buf: Buffer): boolean {
  return buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
}

const SAMPLE_PRICES = [100, 102, 101, 105, 103, 107, 106, 110];

const SAMPLE_CANDLES: OHLC[] = [
  { open: 100, high: 105, low: 98, close: 103 },
  { open: 103, high: 108, low: 101, close: 106 },
  { open: 106, high: 110, low: 104, close: 108 },
  { open: 108, high: 112, low: 106, close: 109 },
  { open: 109, high: 113, low: 107, close: 111 },
];

const SAMPLE_HEATMAP: HeatmapCell[] = [
  { label: "Tech", value: 1.5 },
  { label: "Fin", value: -0.8 },
  { label: "Engy", value: 2.3 },
  { label: "Hlth", value: -1.2 },
  { label: "Cons", value: 0.5 },
];

// ─── Tests ────────────────────────────────────────────────────

describe("charts", () => {
  beforeEach(() => {
    clearChartCache();
  });

  describe("renderSparkline", () => {
    it("returns a valid PNG buffer", async () => {
      const buf = await renderSparkline(SAMPLE_PRICES);
      expect(Buffer.isBuffer(buf)).toBe(true);
      expect(isPng(buf)).toBe(true);
      expect(buf.length).toBeGreaterThan(100);
    });

    it("handles minimal data (2 points)", async () => {
      const buf = await renderSparkline([10, 20]);
      expect(isPng(buf)).toBe(true);
    });

    it("returns empty canvas for single data point", async () => {
      const buf = await renderSparkline([42]);
      expect(isPng(buf)).toBe(true);
    });

    it("respects custom dimensions", async () => {
      const buf = await renderSparkline(SAMPLE_PRICES, { width: 100, height: 50 });
      expect(isPng(buf)).toBe(true);
    });
  });

  describe("renderGauge", () => {
    it("returns a valid PNG buffer", async () => {
      const buf = await renderGauge(55);
      expect(isPng(buf)).toBe(true);
      expect(buf.length).toBeGreaterThan(100);
    });

    it("clamps value to min/max range", async () => {
      const bufLow = await renderGauge(-10, { min: 0, max: 100 });
      const bufHigh = await renderGauge(150, { min: 0, max: 100 });
      expect(isPng(bufLow)).toBe(true);
      expect(isPng(bufHigh)).toBe(true);
    });

    it("renders with label", async () => {
      const buf = await renderGauge(42, { label: "RSI" });
      expect(isPng(buf)).toBe(true);
    });
  });

  describe("renderCandlestick", () => {
    it("returns a valid PNG buffer", async () => {
      const buf = await renderCandlestick(SAMPLE_CANDLES);
      expect(isPng(buf)).toBe(true);
      expect(buf.length).toBeGreaterThan(100);
    });

    it("handles empty candle array", async () => {
      const buf = await renderCandlestick([]);
      expect(isPng(buf)).toBe(true);
    });

    it("handles single candle", async () => {
      const buf = await renderCandlestick([{ open: 100, high: 105, low: 98, close: 103 }]);
      expect(isPng(buf)).toBe(true);
    });
  });

  describe("renderHeatmap", () => {
    it("returns a valid PNG buffer", async () => {
      const buf = await renderHeatmap(SAMPLE_HEATMAP);
      expect(isPng(buf)).toBe(true);
      expect(buf.length).toBeGreaterThan(100);
    });

    it("handles empty cell array", async () => {
      const buf = await renderHeatmap([]);
      expect(isPng(buf)).toBe(true);
    });

    it("handles single cell", async () => {
      const buf = await renderHeatmap([{ label: "X", value: 3.0 }]);
      expect(isPng(buf)).toBe(true);
    });
  });

  describe("renderVolumeBars", () => {
    it("returns a valid PNG buffer", async () => {
      const data = [
        { label: "SPY", volume: 50000000, change: 0.5 },
        { label: "QQQ", volume: 30000000, change: -0.3 },
        { label: "DIA", volume: 20000000, change: 0.1 },
      ];
      const buf = await renderVolumeBars(data);
      expect(isPng(buf)).toBe(true);
      expect(buf.length).toBeGreaterThan(100);
    });

    it("handles empty data array", async () => {
      const buf = await renderVolumeBars([]);
      expect(isPng(buf)).toBe(true);
    });
  });

  describe("renderPnLCurve", () => {
    it("returns a valid PNG buffer", async () => {
      const values = [0, 100, -50, 200, 150, 300];
      const labels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const buf = await renderPnLCurve(values, labels);
      expect(isPng(buf)).toBe(true);
      expect(buf.length).toBeGreaterThan(100);
    });
  });

  describe("renderAllocation", () => {
    it("returns a valid PNG buffer", async () => {
      const holdings = [
        { label: "AAPL", value: 30 },
        { label: "MSFT", value: 25 },
        { label: "GOOG", value: 20 },
        { label: "Cash", value: 25 },
      ];
      const buf = await renderAllocation(holdings);
      expect(isPng(buf)).toBe(true);
      expect(buf.length).toBeGreaterThan(100);
    });
  });

  describe("chart cache", () => {
    it("stores and retrieves cached chart", () => {
      const buf = Buffer.from("fake-png-data");
      setCachedChart("test-chart", buf);
      expect(getCachedChart("test-chart")).toBe(buf);
    });

    it("returns null for uncached key", () => {
      expect(getCachedChart("nonexistent")).toBeNull();
    });

    it("clears all cached charts", () => {
      setCachedChart("a", Buffer.from("a"));
      setCachedChart("b", Buffer.from("b"));
      clearChartCache();
      expect(getCachedChart("a")).toBeNull();
      expect(getCachedChart("b")).toBeNull();
    });
  });

  describe("renderAllCharts", () => {
    it("renders all available chart types in parallel", async () => {
      const input: ChartInputData = {
        spyPrices: SAMPLE_PRICES,
        spyCandles: SAMPLE_CANDLES,
        sectorHeatmap: SAMPLE_HEATMAP,
        pnlCurve: { values: [0, 100, 200], labels: ["A", "B", "C"] },
        rsiValue: 55,
        vixValue: 18,
        volumeBars: [
          { label: "SPY", volume: 50000000, change: 0.5 },
          { label: "QQQ", volume: 30000000, change: -0.3 },
        ],
        allocation: [
          { label: "AAPL", value: 50 },
          { label: "Cash", value: 50 },
        ],
      };

      const results = await renderAllCharts(input);

      expect(results.spySparkline).not.toBeNull();
      expect(isPng(results.spySparkline!)).toBe(true);

      expect(results.spyCandles).not.toBeNull();
      expect(isPng(results.spyCandles!)).toBe(true);

      expect(results.sectorHeatmap).not.toBeNull();
      expect(isPng(results.sectorHeatmap!)).toBe(true);

      expect(results.pnlCurve).not.toBeNull();
      expect(isPng(results.pnlCurve!)).toBe(true);

      expect(results.rsiGauge).not.toBeNull();
      expect(isPng(results.rsiGauge!)).toBe(true);

      expect(results.vixGauge).not.toBeNull();
      expect(isPng(results.vixGauge!)).toBe(true);

      expect(results.volumeBars).not.toBeNull();
      expect(isPng(results.volumeBars!)).toBe(true);

      expect(results.allocation).not.toBeNull();
      expect(isPng(results.allocation!)).toBe(true);
    });

    it("populates chart cache after rendering", async () => {
      clearChartCache();

      const input: ChartInputData = {
        spyPrices: SAMPLE_PRICES,
        spyCandles: [],
        sectorHeatmap: SAMPLE_HEATMAP,
        pnlCurve: null,
        rsiValue: 42,
        vixValue: null,
        volumeBars: [],
        allocation: null,
      };

      await renderAllCharts(input);

      expect(getCachedChart("spy-sparkline")).not.toBeNull();
      expect(getCachedChart("sector-heatmap")).not.toBeNull();
      expect(getCachedChart("rsi-gauge")).not.toBeNull();
      // These should not be cached (null/empty input)
      expect(getCachedChart("spy-candles")).toBeNull();
      expect(getCachedChart("pnl-curve")).toBeNull();
      expect(getCachedChart("vix-gauge")).toBeNull();
    });

    it("handles all-null input gracefully", async () => {
      const input: ChartInputData = {
        spyPrices: [],
        spyCandles: [],
        sectorHeatmap: [],
        pnlCurve: null,
        rsiValue: null,
        vixValue: null,
        volumeBars: [],
        allocation: null,
      };

      const results = await renderAllCharts(input);

      expect(results.spySparkline).toBeNull();
      expect(results.spyCandles).toBeNull();
      expect(results.sectorHeatmap).toBeNull();
      expect(results.pnlCurve).toBeNull();
      expect(results.rsiGauge).toBeNull();
      expect(results.vixGauge).toBeNull();
      expect(results.volumeBars).toBeNull();
      expect(results.allocation).toBeNull();
    });
  });
});
