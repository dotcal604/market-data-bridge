import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchDashboardData, currentSession } from "../screens.js";

// ─── Mocks ──────────────────────────────────────────────────

vi.mock("../../providers/yahoo.js", () => ({
  getQuote: vi.fn(),
  getNews: vi.fn(),
  getHistoricalBars: vi.fn(),
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

vi.mock("../../ibkr/marketdata.js", () => ({
  getIBKRQuote: vi.fn(),
}));

vi.mock("../../ibkr/account.js", () => ({
  getAccountSummary: vi.fn(),
  getPnL: vi.fn(),
  getPositions: vi.fn(),
}));

vi.mock("../../ibkr/portfolio.js", () => ({
  computePortfolioExposure: vi.fn(),
}));

vi.mock("../../indicators/engine.js", () => ({
  getSnapshot: vi.fn(),
  getTrackedSymbols: vi.fn(),
}));

vi.mock("../../db/database.js", () => ({
  queryHollyAlerts: vi.fn(),
}));

import { getQuote, getNews, runScreener } from "../../providers/yahoo.js";
import { getStatus } from "../../providers/status.js";
import { isConnected } from "../../ibkr/connection.js";
import { getIBKRQuote } from "../../ibkr/marketdata.js";
import { getPnL, getPositions } from "../../ibkr/account.js";
import { getSnapshot, getTrackedSymbols } from "../../indicators/engine.js";

const mockGetQuote = vi.mocked(getQuote);
const mockGetNews = vi.mocked(getNews);
const mockRunScreener = vi.mocked(runScreener);
const mockGetStatus = vi.mocked(getStatus);
const mockIsConnected = vi.mocked(isConnected);
const mockGetIBKRQuote = vi.mocked(getIBKRQuote);
const mockGetPnL = vi.mocked(getPnL);
const mockGetPositions = vi.mocked(getPositions);
const mockGetSnapshot = vi.mocked(getSnapshot);
const mockGetTrackedSymbols = vi.mocked(getTrackedSymbols);

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
    staleness_warning: null,
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

function setSession(session: string, time = "10:30 AM") {
  mockGetStatus.mockReturnValue({
    status: "ready",
    easternTime: time,
    marketSession: session,
    marketData: "yahoo-finance (always available)",
    screener: "yahoo-finance (always available)",
    ibkr: { connected: false, mode: "paper", host: "", port: 7497, clientId: 0, twsVersion: "", note: "" },
    timestamp: new Date().toISOString(),
  } as any);
}

function setupDefaults() {
  mockGetQuote.mockResolvedValue(makeQuote());
  mockGetNews.mockResolvedValue([]);
  mockRunScreener.mockResolvedValue([]);
  mockGetTrackedSymbols.mockReturnValue([]);
}

// ─── Tests ──────────────────────────────────────────────────

describe("screens", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSession("regular");
    mockIsConnected.mockReturnValue(false);
    setupDefaults();
  });

  describe("currentSession", () => {
    it("returns the session from getStatus", () => {
      setSession("after-hours");
      expect(currentSession()).toBe("after-hours");
    });
  });

  // ─── DashboardData Structure ─────────────────────────────

  describe("fetchDashboardData — structure", () => {
    it("returns all required sections", async () => {
      const data = await fetchDashboardData();

      expect(data.header).toBeDefined();
      expect(data.header.text).toBeTruthy();
      expect(data.header.color).toBeTruthy();

      expect(data.indices).toBeInstanceOf(Array);
      expect(data.indices).toHaveLength(4);

      expect(data.sectors).toBeDefined();
      expect(data.sectors.header).toBeDefined();
      expect(data.sectors.rows).toBeInstanceOf(Array);

      expect(data.movers).toBeDefined();
      expect(data.portfolio).toBeDefined();
      expect(data.news).toBeDefined();
      expect(data.indicators).toBeDefined();
    });

    it("returns consistent TextRow format across all sections", async () => {
      const data = await fetchDashboardData();

      // Verify TextRow structure {text, color}
      expect(typeof data.header.text).toBe("string");
      expect(typeof data.header.color).toBe("string");

      for (const idx of data.indices) {
        expect(typeof idx.text).toBe("string");
        expect(typeof idx.color).toBe("string");
      }
    });
  });

  // ─── Header ──────────────────────────────────────────────

  describe("header", () => {
    it("includes session label and time", async () => {
      const data = await fetchDashboardData();

      expect(data.header.text).toContain("OPEN");
      expect(data.header.text).toContain("10:30 AM");
      expect(data.header.color).toBe("#00FFFF");
    });

    it("shows PRE during pre-market", async () => {
      setSession("pre-market", "7:30 AM");
      const data = await fetchDashboardData();
      expect(data.header.text).toContain("PRE");
    });

    it("shows CLOSED during closed session", async () => {
      setSession("closed", "8:00 PM");
      const data = await fetchDashboardData();
      expect(data.header.text).toContain("CLOSED");
    });

    it("shows AH during after-hours", async () => {
      setSession("after-hours", "5:30 PM");
      const data = await fetchDashboardData();
      expect(data.header.text).toContain("AH");
    });

    it("shows DLY when IBKR disconnected", async () => {
      const data = await fetchDashboardData();
      expect(data.header.text).toContain("DLY");
    });

    it("shows LIVE when IBKR connected", async () => {
      mockIsConnected.mockReturnValue(true);
      mockGetIBKRQuote.mockResolvedValue({
        symbol: "SPY",
        bid: 580.0, ask: 580.10, last: 580.05,
        open: 578.0, high: 582.0, low: 577.0, close: 578.0,
        volume: 50000000, timestamp: new Date().toISOString(),
        delayed: false, staleness_warning: null,
      });

      const data = await fetchDashboardData();
      expect(data.header.text).toContain("LIVE");
    });
  });

  // ─── Indices ─────────────────────────────────────────────

  describe("indices", () => {
    it("returns 4 index rows (SPY, QQQ, DIA, IWM)", async () => {
      const data = await fetchDashboardData();
      expect(data.indices).toHaveLength(4);
      expect(data.indices[0].text).toContain("SPY");
      expect(data.indices[1].text).toContain("QQQ");
      expect(data.indices[2].text).toContain("DIA");
      expect(data.indices[3].text).toContain("IWM");
    });

    it("colors green for positive change", async () => {
      mockGetQuote.mockResolvedValue(makeQuote({ changePercent: 0.45 }));
      const data = await fetchDashboardData();
      expect(data.indices[0].color).toBe("#2D8B2D");
      expect(data.indices[0].text).toContain("+0.45%");
    });

    it("colors red for negative change", async () => {
      mockGetQuote.mockResolvedValue(makeQuote({ changePercent: -0.52 }));
      const data = await fetchDashboardData();
      expect(data.indices[0].color).toBe("#CC0000");
    });

    it("formats price correctly", async () => {
      mockGetQuote.mockResolvedValue(makeQuote({ last: 582.14 }));
      const data = await fetchDashboardData();
      expect(data.indices[0].text).toContain("582.14");
    });

    it("formats high prices with 1 decimal", async () => {
      mockGetQuote.mockResolvedValue(makeQuote({ last: 1234.56 }));
      const data = await fetchDashboardData();
      expect(data.indices[0].text).toContain("1234.6");
    });

    it("shows '--' when a quote fails", async () => {
      mockGetQuote.mockRejectedValue(new Error("Network error"));
      const data = await fetchDashboardData();
      expect(data.indices[0].text).toContain("--");
      expect(data.indices[0].color).toBe("#808080");
    });
  });

  // ─── VIX ─────────────────────────────────────────────────

  describe("vix", () => {
    it("returns VIX data when available", async () => {
      mockGetQuote.mockImplementation(async (symbol: string) => {
        if (symbol === "^VIX") return makeQuote({ symbol: "^VIX", last: 16.5 });
        return makeQuote();
      });

      const data = await fetchDashboardData();
      expect(data.vix).not.toBeNull();
      expect(data.vix!.text).toContain("VIX");
      expect(data.vix!.text).toContain("16.50");
    });

    it("colors VIX red when > 25", async () => {
      mockGetQuote.mockImplementation(async (symbol: string) => {
        if (symbol === "^VIX") return makeQuote({ symbol: "^VIX", last: 28.5, changePercent: 5.0 });
        return makeQuote();
      });

      const data = await fetchDashboardData();
      expect(data.vix!.color).toBe("#FF0000");
    });

    it("colors VIX orange when 18-25", async () => {
      mockGetQuote.mockImplementation(async (symbol: string) => {
        if (symbol === "^VIX") return makeQuote({ symbol: "^VIX", last: 22.0 });
        return makeQuote();
      });

      const data = await fetchDashboardData();
      expect(data.vix!.color).toBe("#FF8800");
    });

    it("colors VIX green when < 18", async () => {
      mockGetQuote.mockImplementation(async (symbol: string) => {
        if (symbol === "^VIX") return makeQuote({ symbol: "^VIX", last: 15.0 });
        return makeQuote();
      });

      const data = await fetchDashboardData();
      expect(data.vix!.color).toBe("#00FF00");
    });
  });

  // ─── Sectors ─────────────────────────────────────────────

  describe("sectors", () => {
    it("fetches 5 sector ETF quotes", async () => {
      const data = await fetchDashboardData();
      expect(mockGetQuote).toHaveBeenCalledWith("XLK");
      expect(mockGetQuote).toHaveBeenCalledWith("XLF");
      expect(mockGetQuote).toHaveBeenCalledWith("XLE");
      expect(mockGetQuote).toHaveBeenCalledWith("XLV");
      expect(mockGetQuote).toHaveBeenCalledWith("XLY");
      expect(data.sectors.rows).toHaveLength(5);
    });

    it("renders header in blue with source badge", async () => {
      const data = await fetchDashboardData();
      expect(data.sectors.header.text).toContain("SECTORS");
      expect(data.sectors.header.color).toBe("#4488FF");
    });

    it("includes sector labels and ETF symbols", async () => {
      const data = await fetchDashboardData();
      expect(data.sectors.rows[0].text).toContain("Tech");
      expect(data.sectors.rows[0].text).toContain("XLK");
    });

    it("colors rows by change direction", async () => {
      mockGetQuote.mockResolvedValue(makeQuote({ changePercent: 0.8 }));
      const data = await fetchDashboardData();
      expect(data.sectors.rows[0].color).toBe("#00CC00");
    });
  });

  // ─── Movers (regular session) ────────────────────────────

  describe("movers — regular session", () => {
    it("shows MOVERS header during regular session", async () => {
      mockRunScreener.mockResolvedValue([makeScreenerResult()]);
      const data = await fetchDashboardData();
      expect(data.movers.header.text).toBe("MOVERS");
      expect(data.movers.header.color).toBe("#FFFF00");
    });

    it("shows gainers and losers with arrows", async () => {
      mockRunScreener.mockImplementation(async (screener: string) => {
        if (screener === "day_gainers") {
          return [makeScreenerResult({ symbol: "NVDA", changePercent: 5.2 })];
        }
        return [makeScreenerResult({ symbol: "BA", changePercent: -3.5 })];
      });

      const data = await fetchDashboardData();
      const gainer = data.movers.rows.find((r) => r.text.includes("NVDA"));
      const loser = data.movers.rows.find((r) => r.text.includes("BA"));

      expect(gainer).toBeDefined();
      expect(gainer!.color).toBe("#00FF00");
      expect(loser).toBeDefined();
      expect(loser!.color).toBe("#FF0000");
    });

    it("handles screener failure gracefully", async () => {
      mockRunScreener.mockRejectedValue(new Error("API error"));
      const data = await fetchDashboardData();
      expect(data.movers.rows[0].text).toBe("No mover data");
      expect(data.movers.rows[0].color).toBe("#808080");
    });
  });

  // ─── Futures (off-hours) ─────────────────────────────────

  describe("movers — off-hours shows futures", () => {
    it("shows FUTURES header during pre-market", async () => {
      setSession("pre-market");
      const data = await fetchDashboardData();
      expect(data.movers.header.text).toContain("FUTURES");
    });

    it("shows FUTURES during closed session", async () => {
      setSession("closed");
      const data = await fetchDashboardData();
      expect(data.movers.header.text).toContain("FUTURES");
    });

    it("shows FUTURES during after-hours", async () => {
      setSession("after-hours");
      const data = await fetchDashboardData();
      expect(data.movers.header.text).toContain("FUTURES");
    });

    it("fetches ES, NQ, YM, RTY futures", async () => {
      setSession("closed");
      const data = await fetchDashboardData();
      expect(mockGetQuote).toHaveBeenCalledWith("ES=F");
      expect(mockGetQuote).toHaveBeenCalledWith("NQ=F");
      expect(mockGetQuote).toHaveBeenCalledWith("YM=F");
      expect(mockGetQuote).toHaveBeenCalledWith("RTY=F");
    });

    it("renders futures with price and change%", async () => {
      setSession("closed");
      mockGetQuote.mockResolvedValue(makeQuote({ last: 5950.25, changePercent: 0.3 }));
      const data = await fetchDashboardData();
      expect(data.movers.rows.length).toBeGreaterThan(0);
      expect(data.movers.rows[0].text).toContain("+0.30%");
    });

    it("shows fallback when no futures data", async () => {
      setSession("closed");
      mockGetQuote.mockRejectedValue(new Error("fail"));
      const data = await fetchDashboardData();
      expect(data.movers.rows[0].text).toBe("No futures data");
    });
  });

  // ─── Portfolio ───────────────────────────────────────────

  describe("portfolio", () => {
    it("shows IBKR Disconnected when not connected", async () => {
      mockIsConnected.mockReturnValue(false);
      const data = await fetchDashboardData();
      expect(data.portfolio.header.text).toBe("PORTFOLIO");
      expect(data.portfolio.rows[0].text).toBe("IBKR Disconnected");
      expect(data.portfolio.rows[0].color).toBe("#808080");
    });

    it("renders PnL and positions when IBKR connected", async () => {
      mockIsConnected.mockReturnValue(true);
      mockGetIBKRQuote.mockResolvedValue({
        symbol: "SPY", bid: 580.0, ask: 580.10, last: 580.05,
        open: 578.0, high: 582.0, low: 577.0, close: 578.0,
        volume: 50000000, timestamp: new Date().toISOString(),
        delayed: false, staleness_warning: null,
      });
      mockGetPnL.mockResolvedValue({
        account: "DU12345", dailyPnL: 523.45,
        unrealizedPnL: 200, realizedPnL: 323.45,
        timestamp: new Date().toISOString(),
      });
      mockGetPositions.mockResolvedValue([
        { account: "DU12345", symbol: "AAPL", secType: "STK", exchange: "SMART", currency: "USD", position: 100, avgCost: 178.50 },
        { account: "DU12345", symbol: "MSFT", secType: "STK", exchange: "SMART", currency: "USD", position: 50, avgCost: 420.00 },
      ]);

      const data = await fetchDashboardData();
      expect(data.portfolio.header.text).toBe("PORTFOLIO");
      expect(data.portfolio.rows[0].text).toContain("+$523.45");
      expect(data.portfolio.rows[0].color).toBe("#00FF00");
      expect(data.portfolio.rows[1].text).toContain("Positions: 2");
      expect(data.portfolio.rows[2].text).toContain("AAPL");
    });

    it("renders negative PnL in red", async () => {
      mockIsConnected.mockReturnValue(true);
      mockGetIBKRQuote.mockResolvedValue({
        symbol: "SPY", bid: 580.0, ask: 580.10, last: 580.05,
        open: 578.0, high: 582.0, low: 577.0, close: 578.0,
        volume: 50000000, timestamp: new Date().toISOString(),
        delayed: false, staleness_warning: null,
      });
      mockGetPnL.mockResolvedValue({
        account: "DU12345", dailyPnL: -150.00,
        unrealizedPnL: -150, realizedPnL: 0,
        timestamp: new Date().toISOString(),
      });
      mockGetPositions.mockResolvedValue([]);

      const data = await fetchDashboardData();
      expect(data.portfolio.rows[0].text).toContain("-$150.00");
      expect(data.portfolio.rows[0].color).toBe("#FF0000");
    });
  });

  // ─── News ────────────────────────────────────────────────

  describe("news", () => {
    it("fetches stock market news", async () => {
      mockGetNews.mockResolvedValue([
        { title: "Markets rally on Fed signal", publisher: "Reuters", link: "", publishedAt: "", relatedTickers: [] },
        { title: "Tech earnings beat estimates", publisher: "Bloomberg", link: "", publishedAt: "", relatedTickers: [] },
      ]);

      const data = await fetchDashboardData();
      expect(mockGetNews).toHaveBeenCalledWith("stock market");
      expect(data.news.header.text).toBe("NEWS");
      expect(data.news.header.color).toBe("#FFFFFF");
      expect(data.news.rows[0].text).toContain("Markets rally");
      expect(data.news.rows[0].color).toBe("#FFFF00");
    });

    it("truncates long headlines", async () => {
      mockGetNews.mockResolvedValue([
        { title: "This is a really long headline that exceeds the character limit for the display", publisher: "", link: "", publishedAt: "", relatedTickers: [] },
      ]);

      const data = await fetchDashboardData();
      expect(data.news.rows[0].text.length).toBeLessThanOrEqual(40);
      expect(data.news.rows[0].text).toMatch(/~$/);
    });

    it("shows fallback when no news", async () => {
      mockGetNews.mockResolvedValue([]);
      const data = await fetchDashboardData();
      expect(data.news.rows[0].text).toBe("No headlines");
      expect(data.news.rows[0].color).toBe("#808080");
    });

    it("limits to 3 headlines", async () => {
      const news = Array.from({ length: 10 }, (_, i) => ({
        title: `Headline ${i}`, publisher: "", link: "", publishedAt: "", relatedTickers: [],
      }));
      mockGetNews.mockResolvedValue(news);

      const data = await fetchDashboardData();
      expect(data.news.rows).toHaveLength(3);
    });

    it("handles news API failure", async () => {
      mockGetNews.mockRejectedValue(new Error("fail"));
      const data = await fetchDashboardData();
      expect(data.news.rows[0].text).toBe("No headlines");
    });
  });

  // ─── Indicators ──────────────────────────────────────────

  describe("indicators", () => {
    it("shows no subscriptions when nothing tracked", async () => {
      mockGetTrackedSymbols.mockReturnValue([]);
      const data = await fetchDashboardData();
      expect(data.indicators.header.text).toBe("INDICATORS");
      expect(data.indicators.rows[0].text).toBe("No subscriptions");
    });

    it("shows warming up when no price data", async () => {
      mockGetTrackedSymbols.mockReturnValue(["SPY"]);
      mockGetSnapshot.mockReturnValue({ symbol: "SPY", price_last: null } as any);

      const data = await fetchDashboardData();
      expect(data.indicators.header.text).toContain("IND SPY");
      expect(data.indicators.rows[0].text).toBe("Warming up...");
    });

    it("renders RSI, MACD, VWAP, EMA, ATR when available", async () => {
      mockGetTrackedSymbols.mockReturnValue(["SPY"]);
      mockGetSnapshot.mockReturnValue({
        symbol: "SPY",
        price_last: 580.50,
        rsi_14: 65.2,
        macd_histogram: 0.125,
        vwap: 579.00,
        vwap_dev_pct: 0.26,
        ema_9: 581.00,
        ema_21: 578.00,
        atr_14_pct: 1.15,
      } as any);

      const data = await fetchDashboardData();
      expect(data.indicators.header.text).toContain("IND SPY");
      expect(data.indicators.header.text).toContain("580.50");

      const texts = data.indicators.rows.map((r) => r.text);
      expect(texts).toContainEqual(expect.stringContaining("RSI(14)"));
      expect(texts).toContainEqual(expect.stringContaining("MACD H"));
      expect(texts).toContainEqual(expect.stringContaining("VWAP"));
      expect(texts).toContainEqual(expect.stringContaining("EMA 9/21"));
      expect(texts).toContainEqual(expect.stringContaining("ATR(14)"));
    });

    it("colors RSI red when overbought (> 70)", async () => {
      mockGetTrackedSymbols.mockReturnValue(["SPY"]);
      mockGetSnapshot.mockReturnValue({
        symbol: "SPY", price_last: 585.00, rsi_14: 75.3,
        macd_histogram: null, vwap: null, vwap_dev_pct: null,
        ema_9: null, ema_21: null, atr_14_pct: null,
      } as any);

      const data = await fetchDashboardData();
      const rsi = data.indicators.rows.find((r) => r.text.includes("RSI"));
      expect(rsi!.color).toBe("#FF0000");
    });

    it("shows BULL when EMA 9 > EMA 21", async () => {
      mockGetTrackedSymbols.mockReturnValue(["SPY"]);
      mockGetSnapshot.mockReturnValue({
        symbol: "SPY", price_last: 580.00, rsi_14: null,
        macd_histogram: null, vwap: null, vwap_dev_pct: null,
        ema_9: 581.00, ema_21: 578.00, atr_14_pct: null,
      } as any);

      const data = await fetchDashboardData();
      const ema = data.indicators.rows.find((r) => r.text.includes("EMA"));
      expect(ema!.text).toContain("BULL");
      expect(ema!.color).toBe("#00FF00");
    });

    it("shows BEAR when EMA 9 < EMA 21", async () => {
      mockGetTrackedSymbols.mockReturnValue(["SPY"]);
      mockGetSnapshot.mockReturnValue({
        symbol: "SPY", price_last: 575.00, rsi_14: null,
        macd_histogram: null, vwap: null, vwap_dev_pct: null,
        ema_9: 574.00, ema_21: 578.00, atr_14_pct: null,
      } as any);

      const data = await fetchDashboardData();
      const ema = data.indicators.rows.find((r) => r.text.includes("EMA"));
      expect(ema!.text).toContain("BEAR");
      expect(ema!.color).toBe("#FF0000");
    });

    it("handles indicator engine failure", async () => {
      mockGetTrackedSymbols.mockImplementation(() => { throw new Error("Engine error"); });
      const data = await fetchDashboardData();
      expect(data.indicators.header.text).toBe("INDICATORS");
      expect(data.indicators.rows[0].text).toBe("Unavailable");
    });
  });

  // ─── SmartQuote IBKR-First Routing ───────────────────────

  describe("smartQuote routing", () => {
    it("uses IBKR quote when connected (shows LIVE)", async () => {
      mockIsConnected.mockReturnValue(true);
      mockGetIBKRQuote.mockResolvedValue({
        symbol: "SPY", bid: 580.0, ask: 580.10, last: 580.05,
        open: 578.0, high: 582.0, low: 577.0, close: 578.0,
        volume: 50000000, timestamp: new Date().toISOString(),
        delayed: false, staleness_warning: null,
      });

      const data = await fetchDashboardData();
      expect(data.header.text).toContain("LIVE");
      expect(mockGetIBKRQuote).toHaveBeenCalled();
    });

    it("falls back to Yahoo when IBKR fails", async () => {
      mockIsConnected.mockReturnValue(true);
      mockGetIBKRQuote.mockRejectedValue(new Error("IBKR timeout"));
      mockGetQuote.mockResolvedValue(makeQuote());

      const data = await fetchDashboardData();
      expect(data.header.text).toContain("DLY");
      expect(mockGetQuote).toHaveBeenCalled();
    });

    it("uses Yahoo directly when IBKR disconnected", async () => {
      mockIsConnected.mockReturnValue(false);
      const data = await fetchDashboardData();
      expect(data.header.text).toContain("DLY");
      expect(mockGetIBKRQuote).not.toHaveBeenCalled();
      expect(mockGetQuote).toHaveBeenCalled();
    });
  });

  // ─── Parallel Fetching ───────────────────────────────────

  describe("fetchDashboardData — parallel fetching", () => {
    it("fetches all sections even when some fail", async () => {
      mockGetQuote.mockResolvedValue(makeQuote());
      mockGetNews.mockRejectedValue(new Error("news fail"));
      mockRunScreener.mockRejectedValue(new Error("screener fail"));
      mockGetTrackedSymbols.mockReturnValue([]);

      const data = await fetchDashboardData();

      // Indices should still work
      expect(data.indices[0].text).toContain("SPY");
      // News falls back gracefully
      expect(data.news.rows[0].text).toBe("No headlines");
      // Movers falls back gracefully
      expect(data.movers.rows[0].text).toBe("No mover data");
    });
  });
});
