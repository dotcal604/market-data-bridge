import { describe, it, expect, vi, beforeEach } from "vitest";
import { getScreens, buildScrollingTicker } from "../screens.js";

// ─── Mocks ──────────────────────────────────────────────────

vi.mock("../../providers/yahoo.js", () => ({
  getQuote: vi.fn(),
  runScreener: vi.fn(),
  getTrendingSymbols: vi.fn(),
}));

vi.mock("../../providers/status.js", () => ({
  getStatus: vi.fn(),
}));

vi.mock("../../ibkr/connection.js", () => ({
  isConnected: vi.fn(),
}));

vi.mock("../../logging.js", () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

import { getQuote, runScreener, getTrendingSymbols } from "../../providers/yahoo.js";
import { getStatus } from "../../providers/status.js";
import { isConnected } from "../../ibkr/connection.js";

const mockGetQuote = vi.mocked(getQuote);
const mockRunScreener = vi.mocked(runScreener);
const mockGetTrending = vi.mocked(getTrendingSymbols);
const mockGetStatus = vi.mocked(getStatus);
const mockIsConnected = vi.mocked(isConnected);

// ─── Fixtures ───────────────────────────────────────────────

function makeQuote(overrides: Partial<{ symbol: string; last: number; changePercent: number }> = {}) {
  return {
    symbol: overrides.symbol ?? "SPY",
    bid: 0,
    ask: 0,
    last: overrides.last ?? 580.0,
    open: 578.0,
    high: 582.0,
    low: 577.0,
    close: 578.0,
    volume: 50000000,
    change: 2.0,
    changePercent: overrides.changePercent ?? 0.35,
    marketCap: 0,
    timestamp: "2026-02-25T10:30:00Z",
    marketTime: "",
    delayed: true,
  };
}

function makeScreenerResult(overrides: Partial<{ symbol: string; last: number; changePercent: number; volume: number }> = {}) {
  return {
    rank: 1,
    symbol: overrides.symbol ?? "NVDA",
    longName: "NVIDIA Corp",
    last: overrides.last ?? 892.0,
    change: 30.0,
    changePercent: overrides.changePercent ?? 3.5,
    volume: overrides.volume ?? 45000000,
    marketCap: 2200000000000,
    exchange: "NMS",
  };
}

// ─── Tests ──────────────────────────────────────────────────

describe("screens", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetStatus.mockReturnValue({
      status: "ready",
      easternTime: "10:30 AM",
      marketSession: "regular",
      ibkr: { connected: false, mode: "paper", host: "", port: 7497, clientId: 0, twsVersion: "", note: "" },
      timestamp: new Date().toISOString(),
    } as any);
    mockIsConnected.mockReturnValue(false);
  });

  describe("getScreens", () => {
    it("returns 7 screens", () => {
      const screens = getScreens();
      expect(screens).toHaveLength(7);
    });

    it("returns named screens in correct order", () => {
      const screens = getScreens();
      const names = screens.map((s) => s.name);
      expect(names).toEqual([
        "market-pulse",
        "top-gainers",
        "top-losers",
        "most-active",
        "sectors",
        "portfolio",
        "trending",
      ]);
    });

    it("each screen has a fetch function", () => {
      const screens = getScreens();
      for (const screen of screens) {
        expect(typeof screen.fetch).toBe("function");
      }
    });
  });

  describe("market-pulse screen", () => {
    it("fetches SPY, QQQ, DIA, IWM, VIX quotes", async () => {
      mockGetQuote.mockResolvedValue(makeQuote());

      const screens = getScreens();
      const lines = await screens[0].fetch();

      // Should call getQuote for 5 indices
      expect(mockGetQuote).toHaveBeenCalledWith("SPY");
      expect(mockGetQuote).toHaveBeenCalledWith("QQQ");
      expect(mockGetQuote).toHaveBeenCalledWith("DIA");
      expect(mockGetQuote).toHaveBeenCalledWith("IWM");
      expect(mockGetQuote).toHaveBeenCalledWith("^VIX");
    });

    it("renders header with session and time", async () => {
      mockGetQuote.mockResolvedValue(makeQuote());

      const screens = getScreens();
      const lines = await screens[0].fetch();

      expect(lines[0].text).toContain("OPEN");
      expect(lines[0].text).toContain("10:30 AM");
      expect(lines[0].color).toBe("#00FFFF"); // cyan header
    });

    it("renders index lines with green for positive change", async () => {
      mockGetQuote.mockResolvedValue(makeQuote({ symbol: "SPY", last: 582.14, changePercent: 0.45 }));

      const screens = getScreens();
      const lines = await screens[0].fetch();

      // SPY line should be green
      const spyLine = lines.find((l) => l.text.includes("SPY"));
      expect(spyLine).toBeDefined();
      expect(spyLine!.color).toBe("#00FF00");
      expect(spyLine!.text).toContain("+0.45%");
    });

    it("renders red for negative change", async () => {
      mockGetQuote.mockResolvedValue(makeQuote({ symbol: "SPY", last: 575.0, changePercent: -0.52 }));

      const screens = getScreens();
      const lines = await screens[0].fetch();

      const spyLine = lines.find((l) => l.text.includes("SPY"));
      expect(spyLine).toBeDefined();
      expect(spyLine!.color).toBe("#FF0000");
    });

    it("renders VIX with color coding based on level", async () => {
      // VIX > 25 should be red
      mockGetQuote.mockImplementation(async (symbol: string) => {
        if (symbol === "^VIX") return makeQuote({ symbol: "^VIX", last: 28.5, changePercent: 5.0 });
        return makeQuote();
      });

      const screens = getScreens();
      const lines = await screens[0].fetch();

      const vixLine = lines.find((l) => l.text.includes("VIX"));
      expect(vixLine).toBeDefined();
      expect(vixLine!.color).toBe("#FF0000"); // red for high VIX
    });

    it("handles quote failures gracefully", async () => {
      mockGetQuote.mockRejectedValue(new Error("Network error"));

      const screens = getScreens();
      const lines = await screens[0].fetch();

      // Should still return header line at minimum
      expect(lines.length).toBeGreaterThanOrEqual(1);
      expect(lines[0].text).toContain("OPEN");
    });

    it("shows pre-market session label", async () => {
      mockGetStatus.mockReturnValue({
        status: "ready",
        easternTime: "7:30 AM",
        marketSession: "pre-market",
        ibkr: { connected: false },
        timestamp: new Date().toISOString(),
      } as any);
      mockGetQuote.mockResolvedValue(makeQuote());

      const screens = getScreens();
      const lines = await screens[0].fetch();

      expect(lines[0].text).toContain("PRE");
    });

    it("shows closed session label", async () => {
      mockGetStatus.mockReturnValue({
        status: "ready",
        easternTime: "8:00 PM",
        marketSession: "closed",
        ibkr: { connected: false },
        timestamp: new Date().toISOString(),
      } as any);
      mockGetQuote.mockResolvedValue(makeQuote());

      const screens = getScreens();
      const lines = await screens[0].fetch();

      expect(lines[0].text).toContain("CLOSED");
    });
  });

  describe("top-gainers screen", () => {
    it("fetches day_gainers screener", async () => {
      mockRunScreener.mockResolvedValue([
        makeScreenerResult({ symbol: "NVDA", changePercent: 4.2 }),
        makeScreenerResult({ symbol: "TSLA", changePercent: 3.1 }),
      ]);

      const screens = getScreens();
      await screens[1].fetch();

      expect(mockRunScreener).toHaveBeenCalledWith("day_gainers", 6);
    });

    it("renders header and up to 5 gainers", async () => {
      const results = Array.from({ length: 6 }, (_, i) =>
        makeScreenerResult({ symbol: `SYM${i}`, changePercent: 5 - i }),
      );
      mockRunScreener.mockResolvedValue(results);

      const screens = getScreens();
      const lines = await screens[1].fetch();

      expect(lines[0].text).toBe("TOP GAINERS");
      expect(lines[0].color).toBe("#00FF00");
      // 1 header + 5 results
      expect(lines).toHaveLength(6);
    });

    it("renders all lines green", async () => {
      mockRunScreener.mockResolvedValue([
        makeScreenerResult({ symbol: "NVDA", changePercent: 4.2 }),
      ]);

      const screens = getScreens();
      const lines = await screens[1].fetch();

      for (const line of lines) {
        expect(line.color).toBe("#00FF00");
      }
    });

    it("handles screener failure gracefully", async () => {
      mockRunScreener.mockRejectedValue(new Error("API error"));

      const screens = getScreens();
      const lines = await screens[1].fetch();

      // Should at least have the header
      expect(lines).toHaveLength(1);
      expect(lines[0].text).toBe("TOP GAINERS");
    });
  });

  describe("top-losers screen", () => {
    it("fetches day_losers screener", async () => {
      mockRunScreener.mockResolvedValue([]);

      const screens = getScreens();
      await screens[2].fetch();

      expect(mockRunScreener).toHaveBeenCalledWith("day_losers", 6);
    });

    it("renders header in red", async () => {
      mockRunScreener.mockResolvedValue([
        makeScreenerResult({ symbol: "AAPL", changePercent: -2.5 }),
      ]);

      const screens = getScreens();
      const lines = await screens[2].fetch();

      expect(lines[0].text).toBe("TOP LOSERS");
      expect(lines[0].color).toBe("#FF0000");
    });
  });

  describe("most-active screen", () => {
    it("fetches most_actives screener", async () => {
      mockRunScreener.mockResolvedValue([]);

      const screens = getScreens();
      await screens[3].fetch();

      expect(mockRunScreener).toHaveBeenCalledWith("most_actives", 6);
    });

    it("renders volume in M/K format", async () => {
      mockRunScreener.mockResolvedValue([
        makeScreenerResult({ symbol: "AAPL", volume: 85000000, changePercent: 1.2 }),
        makeScreenerResult({ symbol: "MSFT", volume: 500000, changePercent: -0.5 }),
      ]);

      const screens = getScreens();
      const lines = await screens[3].fetch();

      expect(lines[0].text).toBe("MOST ACTIVE");
      expect(lines[0].color).toBe("#FFFF00");
      expect(lines[1].text).toContain("85.0M");
      expect(lines[2].text).toContain("500K");
    });

    it("colors lines based on change direction", async () => {
      mockRunScreener.mockResolvedValue([
        makeScreenerResult({ symbol: "AAPL", changePercent: 1.2, volume: 1000000 }),
        makeScreenerResult({ symbol: "MSFT", changePercent: -0.5, volume: 1000000 }),
      ]);

      const screens = getScreens();
      const lines = await screens[3].fetch();

      expect(lines[1].color).toBe("#00FF00"); // positive
      expect(lines[2].color).toBe("#FF0000"); // negative
    });
  });

  describe("sectors screen", () => {
    it("fetches quotes for 5 sector ETFs", async () => {
      mockGetQuote.mockResolvedValue(makeQuote());

      const screens = getScreens();
      await screens[4].fetch();

      expect(mockGetQuote).toHaveBeenCalledWith("XLK");
      expect(mockGetQuote).toHaveBeenCalledWith("XLF");
      expect(mockGetQuote).toHaveBeenCalledWith("XLE");
      expect(mockGetQuote).toHaveBeenCalledWith("XLV");
      expect(mockGetQuote).toHaveBeenCalledWith("XLY");
    });

    it("renders header and sector lines", async () => {
      mockGetQuote.mockResolvedValue(makeQuote({ changePercent: 0.8 }));

      const screens = getScreens();
      const lines = await screens[4].fetch();

      expect(lines[0].text).toBe("SECTORS");
      expect(lines[0].color).toBe("#4488FF"); // blue
      // 1 header + 5 sectors
      expect(lines).toHaveLength(6);
    });

    it("includes sector labels", async () => {
      mockGetQuote.mockResolvedValue(makeQuote({ changePercent: 0.5 }));

      const screens = getScreens();
      const lines = await screens[4].fetch();

      expect(lines[1].text).toContain("Tech");
      expect(lines[1].text).toContain("XLK");
      expect(lines[2].text).toContain("Fin");
      expect(lines[2].text).toContain("XLF");
    });
  });

  describe("portfolio screen", () => {
    it("shows disconnected message when IBKR not connected", async () => {
      mockIsConnected.mockReturnValue(false);

      const screens = getScreens();
      const lines = await screens[5].fetch();

      expect(lines[0].text).toBe("PORTFOLIO");
      expect(lines[1].text).toBe("IBKR Disconnected");
      expect(lines[1].color).toBe("#808080"); // gray
    });
  });

  describe("trending screen", () => {
    it("fetches trending symbols and their quotes", async () => {
      mockGetTrending.mockResolvedValue([
        { symbol: "NVDA" },
        { symbol: "TSLA" },
        { symbol: "AAPL" },
      ]);
      mockGetQuote.mockResolvedValue(makeQuote({ last: 892.0, changePercent: 4.2 }));

      const screens = getScreens();
      const lines = await screens[6].fetch();

      expect(mockGetTrending).toHaveBeenCalled();
      expect(lines[0].text).toBe("TRENDING");
      expect(lines[0].color).toBe("#FF8800"); // orange
    });

    it("limits to 5 trending results", async () => {
      const trending = Array.from({ length: 10 }, (_, i) => ({ symbol: `SYM${i}` }));
      mockGetTrending.mockResolvedValue(trending);
      mockGetQuote.mockResolvedValue(makeQuote());

      const screens = getScreens();
      const lines = await screens[6].fetch();

      // 1 header + max 5 results
      expect(lines.length).toBeLessThanOrEqual(6);
    });

    it("handles trending failure gracefully", async () => {
      mockGetTrending.mockRejectedValue(new Error("API error"));

      const screens = getScreens();
      const lines = await screens[6].fetch();

      expect(lines[0].text).toBe("TRENDING");
      // Should just have header when no data
      expect(lines).toHaveLength(1);
    });
  });

  describe("buildScrollingTicker", () => {
    it("builds ticker string from major symbols", async () => {
      mockGetQuote.mockResolvedValue(makeQuote({ symbol: "SPY", last: 582.14, changePercent: 0.45 }));

      const ticker = await buildScrollingTicker();

      expect(ticker.text).toContain("SPY");
      expect(ticker.text).toContain("582.14");
      expect(ticker.text).toContain("+0.45%");
      expect(ticker.text).toContain("|");
      expect(ticker.color).toBe("#FFFFFF");
    });

    it("handles partial quote failures", async () => {
      let callCount = 0;
      mockGetQuote.mockImplementation(async () => {
        callCount++;
        if (callCount % 2 === 0) throw new Error("fail");
        return makeQuote({ symbol: "SPY", last: 580.0, changePercent: 0.3 });
      });

      const ticker = await buildScrollingTicker();

      // Should still have some symbols even if some failed
      expect(ticker.text.length).toBeGreaterThan(0);
    });
  });

  describe("line formatting", () => {
    it("assigns unique TextId to each line", async () => {
      mockGetQuote.mockResolvedValue(makeQuote());

      const screens = getScreens();
      const lines = await screens[0].fetch();

      const ids = lines.map((l) => l.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it("spaces lines at 16px intervals", async () => {
      mockGetQuote.mockResolvedValue(makeQuote());

      const screens = getScreens();
      const lines = await screens[0].fetch();

      for (let i = 1; i < lines.length; i++) {
        expect(lines[i].y).toBe(i * 16);
      }
    });

    it("formats prices >= 1000 with 1 decimal", async () => {
      mockGetQuote.mockResolvedValue(makeQuote({ last: 1234.56, changePercent: 0.1 }));

      const screens = getScreens();
      const lines = await screens[0].fetch();

      const spyLine = lines.find((l) => l.text.includes("SPY"));
      expect(spyLine!.text).toContain("1234.6");
    });

    it("formats prices < 1000 with 2 decimals", async () => {
      mockGetQuote.mockResolvedValue(makeQuote({ last: 582.14, changePercent: 0.1 }));

      const screens = getScreens();
      const lines = await screens[0].fetch();

      const spyLine = lines.find((l) => l.text.includes("SPY"));
      expect(spyLine!.text).toContain("582.14");
    });
  });
});
