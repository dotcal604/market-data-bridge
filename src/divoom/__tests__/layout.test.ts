import { describe, it, expect } from "vitest";
import { buildElements, SLOTS, getLayoutHeight } from "../layout.js";
import type { DashboardData, DashboardSection, TextRow, ChartUrls } from "../layout.js";

// ─── Fixtures ───────────────────────────────────────────────

function makeSection(header = "TEST", rowCount = 2): DashboardSection {
  return {
    header: { text: header, color: "#FFFFFF" },
    rows: Array.from({ length: rowCount }, (_, i) => ({
      text: `Row ${i}`,
      color: i % 2 === 0 ? "#00FF00" : "#FF0000",
    })),
  };
}

function makeDashboardData(overrides: Partial<DashboardData> = {}): DashboardData {
  return {
    header: { text: "OPEN \u00b7 LIVE \u00b7 10:30 AM", color: "#00FFFF" },
    indices: [
      { text: "SPY  580.25  +0.35%", color: "#00FF00" },
      { text: "QQQ  495.50  +0.42%", color: "#00FF00" },
      { text: "DIA  432.10  -0.12%", color: "#FF0000" },
      { text: "IWM  218.75  +0.28%", color: "#00FF00" },
    ],
    vix: { text: "VIX  16.50", color: "#00FF00" },
    sectors: makeSection("SECTORS DLY", 5),
    movers: makeSection("MOVERS", 4),
    portfolio: makeSection("PORTFOLIO", 4),
    news: makeSection("NEWS", 3),
    indicators: makeSection("INDICATORS", 5),
    ...overrides,
  };
}

const CHART_URLS: ChartUrls = {
  spySparkline: "http://localhost:3000/api/divoom/charts/spy-sparkline",
  sectorHeatmap: "http://localhost:3000/api/divoom/charts/sector-heatmap",
  pnlCurve: "http://localhost:3000/api/divoom/charts/pnl-curve",
  rsiGauge: "http://localhost:3000/api/divoom/charts/rsi-gauge",
  vixGauge: "http://localhost:3000/api/divoom/charts/vix-gauge",
  volumeBars: "http://localhost:3000/api/divoom/charts/volume-bars",
};

// ─── Tests ──────────────────────────────────────────────────

describe("layout", () => {
  describe("SLOTS", () => {
    it("has element IDs for all dashboard sections", () => {
      const ids = SLOTS.map((s) => s.id);
      // Header
      expect(ids).toContain(1);
      // Indices
      expect(ids).toContain(10);
      expect(ids).toContain(13);
      // VIX
      expect(ids).toContain(14);
      // SPY sparkline image
      expect(ids).toContain(15);
      // Sectors header + heatmap image
      expect(ids).toContain(20);
      expect(ids).toContain(21);
      // Movers
      expect(ids).toContain(30);
      expect(ids).toContain(34);
      // Portfolio
      expect(ids).toContain(40);
      expect(ids).toContain(44);
      // PnL curve image
      expect(ids).toContain(45);
      // News
      expect(ids).toContain(50);
      expect(ids).toContain(53);
      // Indicators header + gauge images + text rows
      expect(ids).toContain(60);
      expect(ids).toContain(61);
      expect(ids).toContain(62);
      expect(ids).toContain(63);
      expect(ids).toContain(65);
      // Volume bars image
      expect(ids).toContain(70);
    });

    it("has all unique IDs", () => {
      const ids = SLOTS.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("has no overlapping Y positions for adjacent elements", () => {
      const sorted = [...SLOTS].sort((a, b) => a.y - b.y);
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1];
        expect(sorted[i].y).toBeGreaterThanOrEqual(prev.y);
      }
    });

    it("marks image slots with type=image", () => {
      const imageSlots = SLOTS.filter((s) => s.type === "image");
      const imageIds = imageSlots.map((s) => s.id);
      // SPY sparkline, sector heatmap, PnL curve, RSI gauge, VIX gauge, volume bars
      expect(imageIds).toContain(15);
      expect(imageIds).toContain(21);
      expect(imageIds).toContain(45);
      expect(imageIds).toContain(61);
      expect(imageIds).toContain(62);
      expect(imageIds).toContain(70);
      expect(imageSlots.length).toBe(6);
    });
  });

  describe("buildElements (text only)", () => {
    it("creates text-only elements when no chartUrls provided", () => {
      const data = makeDashboardData();
      const elements = buildElements(data);

      // All should be Text type
      for (const el of elements) {
        expect(el.Type).toBe("Text");
      }
    });

    it("maps header to element ID 1 center-aligned", () => {
      const data = makeDashboardData();
      const elements = buildElements(data);
      const header = elements.find((e) => e.ID === 1)!;

      expect(header.TextMessage).toContain("OPEN");
      expect(header.TextMessage).toContain("LIVE");
      expect(header.FontColor).toBe("#00FFFF");
      expect(header.Align).toBe(1);
      expect(header.Type).toBe("Text");
    });

    it("maps indices to elements 10-13", () => {
      const data = makeDashboardData();
      const elements = buildElements(data);

      const spy = elements.find((e) => e.ID === 10)!;
      expect(spy.TextMessage).toContain("SPY");
      expect(spy.FontColor).toBe("#00FF00");

      const dia = elements.find((e) => e.ID === 12)!;
      expect(dia.TextMessage).toContain("DIA");
      expect(dia.FontColor).toBe("#FF0000");
    });

    it("maps VIX to element ID 14", () => {
      const data = makeDashboardData();
      const elements = buildElements(data);
      const vix = elements.find((e) => e.ID === 14)!;

      expect(vix.TextMessage).toContain("VIX");
      expect(vix.FontColor).toBe("#00FF00");
    });

    it("maps null VIX to empty text", () => {
      const data = makeDashboardData({ vix: null });
      const elements = buildElements(data);
      const vix = elements.find((e) => e.ID === 14)!;

      expect(vix.TextMessage).toBe("");
    });

    it("maps section headers to correct IDs", () => {
      const data = makeDashboardData();
      const elements = buildElements(data);

      // Sectors header
      expect(elements.find((e) => e.ID === 20)!.TextMessage).toBe("SECTORS DLY");
      // Movers header
      expect(elements.find((e) => e.ID === 30)!.TextMessage).toBe("MOVERS");
      // Portfolio header
      expect(elements.find((e) => e.ID === 40)!.TextMessage).toBe("PORTFOLIO");
      // News header
      expect(elements.find((e) => e.ID === 50)!.TextMessage).toBe("NEWS");
      // Indicators header
      expect(elements.find((e) => e.ID === 60)!.TextMessage).toBe("INDICATORS");
    });

    it("fills empty section rows with blank text", () => {
      const data = makeDashboardData({
        portfolio: {
          header: { text: "PORTFOLIO", color: "#FF00FF" },
          rows: [{ text: "IBKR Disconnected", color: "#808080" }],
        },
      });
      const elements = buildElements(data);

      // ID 41 should have the disconnect message
      expect(elements.find((e) => e.ID === 41)!.TextMessage).toBe("IBKR Disconnected");
      // IDs 42-44 should be empty
      expect(elements.find((e) => e.ID === 42)!.TextMessage).toBe("");
      expect(elements.find((e) => e.ID === 43)!.TextMessage).toBe("");
      expect(elements.find((e) => e.ID === 44)!.TextMessage).toBe("");
    });

    it("fills fewer indices with empty text", () => {
      const data = makeDashboardData({
        indices: [
          { text: "SPY  580.25  +0.35%", color: "#00FF00" },
        ],
      });
      const elements = buildElements(data);

      expect(elements.find((e) => e.ID === 10)!.TextMessage).toContain("SPY");
      expect(elements.find((e) => e.ID === 11)!.TextMessage).toBe("");
      expect(elements.find((e) => e.ID === 12)!.TextMessage).toBe("");
      expect(elements.find((e) => e.ID === 13)!.TextMessage).toBe("");
    });

    it("uses transparent background on all elements", () => {
      const data = makeDashboardData();
      const elements = buildElements(data);

      for (const el of elements) {
        expect(el.BgColor).toBe("#00000000");
      }
    });
  });

  describe("buildElements (with charts)", () => {
    it("includes Image elements when chartUrls provided", () => {
      const data = makeDashboardData();
      const elements = buildElements(data, CHART_URLS);

      const imageElements = elements.filter((e) => e.Type === "Image");
      expect(imageElements.length).toBe(6);
    });

    it("sets correct URLs on Image elements", () => {
      const data = makeDashboardData();
      const elements = buildElements(data, CHART_URLS);

      const sparkline = elements.find((e) => e.ID === 15)!;
      expect(sparkline.Type).toBe("Image");
      expect(sparkline.Url).toBe(CHART_URLS.spySparkline);
      expect(sparkline.ImgLocalFlag).toBe(0);

      const heatmap = elements.find((e) => e.ID === 21)!;
      expect(heatmap.Type).toBe("Image");
      expect(heatmap.Url).toBe(CHART_URLS.sectorHeatmap);
    });

    it("omits Image elements for missing chart URLs", () => {
      const data = makeDashboardData();
      const partialUrls: ChartUrls = {
        spySparkline: "http://localhost:3000/api/divoom/charts/spy-sparkline",
      };
      const elements = buildElements(data, partialUrls);

      const imageElements = elements.filter((e) => e.Type === "Image");
      expect(imageElements.length).toBe(1);
      expect(imageElements[0].ID).toBe(15);
    });

    it("positions RSI and VIX gauges side by side", () => {
      const data = makeDashboardData();
      const elements = buildElements(data, CHART_URLS);

      const rsi = elements.find((e) => e.ID === 61)!;
      const vix = elements.find((e) => e.ID === 62)!;

      expect(rsi.Type).toBe("Image");
      expect(vix.Type).toBe("Image");
      expect(rsi.StartY).toBe(vix.StartY); // Same Y
      expect(rsi.StartX).toBeLessThan(vix.StartX); // RSI on left
    });

    it("includes more elements than text-only mode", () => {
      const data = makeDashboardData();
      const textOnly = buildElements(data);
      const withCharts = buildElements(data, CHART_URLS);

      expect(withCharts.length).toBeGreaterThan(textOnly.length);
    });
  });

  describe("getLayoutHeight", () => {
    it("returns a reasonable height for the expanded chart layout", () => {
      const height = getLayoutHeight();
      // With chart images, layout extends beyond the base 1280 canvas
      // TimesFrame supports scrollable content on the 1080P display
      expect(height).toBeGreaterThan(1000);
      expect(height).toBeLessThanOrEqual(2000);
    });
  });
});
