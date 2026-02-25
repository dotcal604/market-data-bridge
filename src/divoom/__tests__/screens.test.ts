import { describe, it, expect, vi, beforeEach } from "vitest";
import { getScreens, buildScrollingTicker, currentSession } from "../screens.js";

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

import { getQuote, getNews, getHistoricalBars, runScreener, getTrendingSymbols } from "../../providers/yahoo.js";
import { getStatus } from "../../providers/status.js";
import { isConnected } from "../../ibkr/connection.js";
import { getIBKRQuote } from "../../ibkr/marketdata.js";
import { getAccountSummary, getPnL, getPositions } from "../../ibkr/account.js";
import { computePortfolioExposure } from "../../ibkr/portfolio.js";
import { getSnapshot, getTrackedSymbols } from "../../indicators/engine.js";
import { queryHollyAlerts } from "../../db/database.js";

const mockGetQuote = vi.mocked(getQuote);
const mockGetNews = vi.mocked(getNews);
const mockGetHistoricalBars = vi.mocked(getHistoricalBars);
const mockRunScreener = vi.mocked(runScreener);
const mockGetTrending = vi.mocked(getTrendingSymbols);
const mockGetStatus = vi.mocked(getStatus);
const mockIsConnected = vi.mocked(isConnected);
const mockGetIBKRQuote = vi.mocked(getIBKRQuote);
const mockGetAccountSummary = vi.mocked(getAccountSummary);
const mockGetPnL = vi.mocked(getPnL);
const mockGetPositions = vi.mocked(getPositions);
const mockComputeExposure = vi.mocked(computePortfolioExposure);
const mockGetSnapshot = vi.mocked(getSnapshot);
const mockGetTrackedSymbols = vi.mocked(getTrackedSymbols);
const mockQueryHollyAlerts = vi.mocked(queryHollyAlerts);

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

// ─── Tests ──────────────────────────────────────────────────

describe("screens", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSession("regular");
    mockIsConnected.mockReturnValue(false);
  });

  // ─── Session-Aware Screen Selection ───────────────────────

  describe("getScreens — session-aware", () => {
    it("returns 8 screens during regular session", () => {
      const screens = getScreens("regular");
      expect(screens).toHaveLength(8);
    });

    it("returns 8 screens during pre-market", () => {
      const screens = getScreens("pre-market");
      expect(screens).toHaveLength(8);
    });

    it("returns 8 screens during after-hours", () => {
      const screens = getScreens("after-hours");
      expect(screens).toHaveLength(8);
    });

    it("returns 9 screens during closed session", () => {
      const screens = getScreens("closed");
      expect(screens).toHaveLength(9);
    });

    it("includes futures screen outside RTH", () => {
      for (const session of ["pre-market", "after-hours", "closed"]) {
        const screens = getScreens(session);
        const names = screens.map((s) => s.name);
        expect(names).toContain("futures");
      }
    });

    it("does NOT include futures during regular session", () => {
      const screens = getScreens("regular");
      const names = screens.map((s) => s.name);
      expect(names).not.toContain("futures");
    });

    it("includes daily-chart only during closed session", () => {
      expect(getScreens("closed").map((s) => s.name)).toContain("daily-chart");
      expect(getScreens("regular").map((s) => s.name)).not.toContain("daily-chart");
      expect(getScreens("pre-market").map((s) => s.name)).not.toContain("daily-chart");
    });

    it("includes news in every session", () => {
      for (const session of ["regular", "pre-market", "after-hours", "closed"]) {
        const names = getScreens(session).map((s) => s.name);
        expect(names).toContain("news");
      }
    });

    it("always includes core screens (market-pulse, sectors, portfolio, trending)", () => {
      for (const session of ["regular", "pre-market", "after-hours", "closed"]) {
        const names = getScreens(session).map((s) => s.name);
        expect(names).toContain("market-pulse");
        expect(names).toContain("sectors");
        expect(names).toContain("portfolio");
        expect(names).toContain("trending");
      }
    });

    it("regular session includes top-gainers, top-losers, most-active", () => {
      const names = getScreens("regular").map((s) => s.name);
      expect(names).toContain("top-gainers");
      expect(names).toContain("top-losers");
      expect(names).toContain("most-active");
    });

    it("each screen has a fetch function", () => {
      for (const session of ["regular", "pre-market", "after-hours", "closed"]) {
        const screens = getScreens(session);
        for (const screen of screens) {
          expect(typeof screen.fetch).toBe("function");
        }
      }
    });
  });

  describe("currentSession", () => {
    it("returns the session from getStatus", () => {
      setSession("after-hours");
      expect(currentSession()).toBe("after-hours");
    });
  });

  // ─── Market Pulse ─────────────────────────────────────────

  describe("market-pulse screen", () => {
    it("fetches SPY, QQQ, DIA, IWM, VIX quotes", async () => {
      mockGetQuote.mockResolvedValue(makeQuote());

      const screens = getScreens("regular");
      const pulse = screens.find((s) => s.name === "market-pulse")!;
      await pulse.fetch();

      expect(mockGetQuote).toHaveBeenCalledWith("SPY");
      expect(mockGetQuote).toHaveBeenCalledWith("QQQ");
      expect(mockGetQuote).toHaveBeenCalledWith("DIA");
      expect(mockGetQuote).toHaveBeenCalledWith("IWM");
      expect(mockGetQuote).toHaveBeenCalledWith("^VIX");
    });

    it("renders header with session and time", async () => {
      mockGetQuote.mockResolvedValue(makeQuote());

      const screens = getScreens("regular");
      const lines = await screens.find((s) => s.name === "market-pulse")!.fetch();

      expect(lines[0].text).toContain("OPEN");
      expect(lines[0].text).toContain("10:30 AM");
      expect(lines[0].color).toBe("#00FFFF");
    });

    it("renders green for positive change", async () => {
      mockGetQuote.mockResolvedValue(makeQuote({ changePercent: 0.45 }));

      const lines = await getScreens("regular").find((s) => s.name === "market-pulse")!.fetch();

      const spyLine = lines.find((l) => l.text.includes("SPY"));
      expect(spyLine!.color).toBe("#00FF00");
      expect(spyLine!.text).toContain("+0.45%");
    });

    it("renders red for negative change", async () => {
      mockGetQuote.mockResolvedValue(makeQuote({ changePercent: -0.52 }));

      const lines = await getScreens("regular").find((s) => s.name === "market-pulse")!.fetch();

      const spyLine = lines.find((l) => l.text.includes("SPY"));
      expect(spyLine!.color).toBe("#FF0000");
    });

    it("renders VIX red when > 25", async () => {
      mockGetQuote.mockImplementation(async (symbol: string) => {
        if (symbol === "^VIX") return makeQuote({ symbol: "^VIX", last: 28.5, changePercent: 5.0 });
        return makeQuote();
      });

      const lines = await getScreens("regular").find((s) => s.name === "market-pulse")!.fetch();

      const vixLine = lines.find((l) => l.text.includes("VIX"));
      expect(vixLine!.color).toBe("#FF0000");
    });

    it("handles quote failures gracefully", async () => {
      mockGetQuote.mockRejectedValue(new Error("Network error"));

      const lines = await getScreens("regular").find((s) => s.name === "market-pulse")!.fetch();

      expect(lines.length).toBeGreaterThanOrEqual(1);
      expect(lines[0].text).toContain("OPEN");
    });

    it("shows PRE label during pre-market", async () => {
      setSession("pre-market", "7:30 AM");
      mockGetQuote.mockResolvedValue(makeQuote());

      const lines = await getScreens("pre-market").find((s) => s.name === "market-pulse")!.fetch();
      expect(lines[0].text).toContain("PRE");
    });

    it("shows CLOSED label during closed session", async () => {
      setSession("closed", "8:00 PM");
      mockGetQuote.mockResolvedValue(makeQuote());

      const lines = await getScreens("closed").find((s) => s.name === "market-pulse")!.fetch();
      expect(lines[0].text).toContain("CLOSED");
    });

    it("shows AH label during after-hours", async () => {
      setSession("after-hours", "5:30 PM");
      mockGetQuote.mockResolvedValue(makeQuote());

      const lines = await getScreens("after-hours").find((s) => s.name === "market-pulse")!.fetch();
      expect(lines[0].text).toContain("AH");
    });
  });

  // ─── Top Gainers/Losers ───────────────────────────────────

  describe("top-gainers screen", () => {
    it("shows 'TOP GAINERS' during regular session", async () => {
      setSession("regular");
      mockRunScreener.mockResolvedValue([makeScreenerResult()]);

      const lines = await getScreens("regular").find((s) => s.name === "top-gainers")!.fetch();
      expect(lines[0].text).toBe("TOP GAINERS");
    });

    it("shows 'PRIOR GAINERS' outside regular session", async () => {
      setSession("closed");
      mockRunScreener.mockResolvedValue([makeScreenerResult()]);

      const lines = await getScreens("closed").find((s) => s.name === "prior-gainers")!.fetch();
      expect(lines[0].text).toBe("PRIOR GAINERS");
    });

    it("fetches day_gainers screener", async () => {
      mockRunScreener.mockResolvedValue([]);

      await getScreens("regular").find((s) => s.name === "top-gainers")!.fetch();
      expect(mockRunScreener).toHaveBeenCalledWith("day_gainers", 6);
    });

    it("renders up to 5 results", async () => {
      const results = Array.from({ length: 6 }, (_, i) =>
        makeScreenerResult({ symbol: `SYM${i}`, changePercent: 5 - i }),
      );
      mockRunScreener.mockResolvedValue(results);

      const lines = await getScreens("regular").find((s) => s.name === "top-gainers")!.fetch();
      expect(lines).toHaveLength(6); // 1 header + 5 results
    });

    it("handles screener failure gracefully", async () => {
      mockRunScreener.mockRejectedValue(new Error("API error"));

      const lines = await getScreens("regular").find((s) => s.name === "top-gainers")!.fetch();
      expect(lines).toHaveLength(1);
      expect(lines[0].text).toBe("TOP GAINERS");
    });
  });

  describe("top-losers screen", () => {
    it("shows 'PRIOR LOSERS' outside regular session", async () => {
      setSession("pre-market");
      mockRunScreener.mockResolvedValue([makeScreenerResult({ changePercent: -2.5 })]);

      const lines = await getScreens("pre-market").find((s) => s.name === "prior-losers")!.fetch();
      expect(lines[0].text).toBe("PRIOR LOSERS");
      expect(lines[0].color).toBe("#FF0000");
    });
  });

  // ─── Most Active ──────────────────────────────────────────

  describe("most-active screen", () => {
    it("shows 'PRIOR ACTIVE' outside regular session", async () => {
      setSession("after-hours");
      mockRunScreener.mockResolvedValue([]);

      const lines = await getScreens("after-hours").find((s) => s.name === "most-active")!.fetch();
      expect(lines[0].text).toBe("PRIOR ACTIVE");
    });

    it("renders volume in M/K format", async () => {
      setSession("regular");
      mockRunScreener.mockResolvedValue([
        makeScreenerResult({ symbol: "AAPL", volume: 85000000, changePercent: 1.2 }),
        makeScreenerResult({ symbol: "MSFT", volume: 500000, changePercent: -0.5 }),
      ]);

      const lines = await getScreens("regular").find((s) => s.name === "most-active")!.fetch();
      expect(lines[1].text).toContain("85.0M");
      expect(lines[2].text).toContain("500K");
    });

    it("colors lines based on change direction", async () => {
      setSession("regular");
      mockRunScreener.mockResolvedValue([
        makeScreenerResult({ changePercent: 1.2, volume: 1000000 }),
        makeScreenerResult({ changePercent: -0.5, volume: 1000000 }),
      ]);

      const lines = await getScreens("regular").find((s) => s.name === "most-active")!.fetch();
      expect(lines[1].color).toBe("#00FF00");
      expect(lines[2].color).toBe("#FF0000");
    });
  });

  // ─── Sectors ──────────────────────────────────────────────

  describe("sectors screen", () => {
    it("fetches quotes for 5 sector ETFs", async () => {
      mockGetQuote.mockResolvedValue(makeQuote());

      await getScreens("regular").find((s) => s.name === "sectors")!.fetch();

      expect(mockGetQuote).toHaveBeenCalledWith("XLK");
      expect(mockGetQuote).toHaveBeenCalledWith("XLF");
      expect(mockGetQuote).toHaveBeenCalledWith("XLE");
      expect(mockGetQuote).toHaveBeenCalledWith("XLV");
      expect(mockGetQuote).toHaveBeenCalledWith("XLY");
    });

    it("renders header in blue and 5 sectors", async () => {
      mockGetQuote.mockResolvedValue(makeQuote({ changePercent: 0.8 }));

      const lines = await getScreens("regular").find((s) => s.name === "sectors")!.fetch();

      expect(lines[0].text).toContain("SECTORS");
      expect(lines[0].color).toBe("#4488FF");
      expect(lines).toHaveLength(6); // 1 header + 5 sectors
    });

    it("includes sector labels and ETF symbols", async () => {
      mockGetQuote.mockResolvedValue(makeQuote({ changePercent: 0.5 }));

      const lines = await getScreens("regular").find((s) => s.name === "sectors")!.fetch();

      expect(lines[1].text).toContain("Tech");
      expect(lines[1].text).toContain("XLK");
    });
  });

  // ─── Portfolio ────────────────────────────────────────────

  describe("portfolio screen", () => {
    it("shows disconnected message when IBKR not connected", async () => {
      mockIsConnected.mockReturnValue(false);

      const lines = await getScreens("regular").find((s) => s.name === "portfolio")!.fetch();

      expect(lines[0].text).toBe("PORTFOLIO");
      expect(lines[1].text).toBe("IBKR Disconnected");
      expect(lines[1].color).toBe("#808080");
    });

    it("renders PnL and positions when IBKR connected", async () => {
      mockIsConnected.mockReturnValue(true);
      mockGetPnL.mockResolvedValue({
        account: "DU12345",
        dailyPnL: 523.45,
        unrealizedPnL: 200,
        realizedPnL: 323.45,
        timestamp: new Date().toISOString(),
      });
      mockGetPositions.mockResolvedValue([
        { account: "DU12345", symbol: "AAPL", secType: "STK", exchange: "SMART", currency: "USD", position: 100, avgCost: 178.50 },
        { account: "DU12345", symbol: "MSFT", secType: "STK", exchange: "SMART", currency: "USD", position: 50, avgCost: 420.00 },
      ]);
      mockQueryHollyAlerts.mockReturnValue([]);

      const screen = getScreens("regular").find((s) => s.name === "portfolio")!;
      const lines = await screen.fetch();

      expect(lines[0].text).toBe("PORTFOLIO");
      expect(lines[1].text).toContain("+$523.45");
      expect(lines[1].color).toBe("#00FF00");
      expect(lines[2].text).toContain("Positions: 2");
      expect(lines[3].text).toContain("AAPL");
    });

    it("renders negative PnL in red", async () => {
      mockIsConnected.mockReturnValue(true);
      mockGetPnL.mockResolvedValue({
        account: "DU12345",
        dailyPnL: -150.00,
        unrealizedPnL: -150,
        realizedPnL: 0,
        timestamp: new Date().toISOString(),
      });
      mockGetPositions.mockResolvedValue([]);
      mockQueryHollyAlerts.mockReturnValue([]);

      const screen = getScreens("regular").find((s) => s.name === "portfolio")!;
      const lines = await screen.fetch();

      expect(lines[1].text).toContain("-$150.00");
      expect(lines[1].color).toBe("#FF0000");
    });
  });

  // ─── IBKR-Connected Screen Counts ───────────────────────────

  describe("getScreens — IBKR connected", () => {
    beforeEach(() => {
      mockIsConnected.mockReturnValue(true);
    });

    it("adds account, exposure, indicators screens when IBKR connected (regular)", () => {
      const screens = getScreens("regular");
      const names = screens.map((s) => s.name);
      expect(names).toContain("account");
      expect(names).toContain("exposure");
      expect(names).toContain("indicators");
      expect(screens).toHaveLength(11); // 4 core + 4 ibkr + 3 session
    });

    it("adds IBKR screens during pre-market when connected", () => {
      const screens = getScreens("pre-market");
      const names = screens.map((s) => s.name);
      expect(names).toContain("account");
      expect(names).toContain("indicators");
      expect(screens).toHaveLength(11); // 4 core + 4 ibkr + 3 session
    });

    it("adds IBKR screens during closed when connected", () => {
      const screens = getScreens("closed");
      const names = screens.map((s) => s.name);
      expect(names).toContain("account");
      expect(names).toContain("exposure");
      expect(screens).toHaveLength(12); // 4 core + 4 ibkr + 4 session
    });

    it("does NOT include account/exposure/indicators when IBKR disconnected", () => {
      mockIsConnected.mockReturnValue(false);
      const names = getScreens("regular").map((s) => s.name);
      expect(names).not.toContain("account");
      expect(names).not.toContain("exposure");
      expect(names).not.toContain("indicators");
    });
  });

  // ─── Account Screen (IBKR) ──────────────────────────────────

  describe("account screen", () => {
    it("shows disconnected message when IBKR not connected", async () => {
      mockIsConnected.mockReturnValue(false);

      // Get screens with IBKR disconnected — account not in registry,
      // so we test via IBKR-connected registry
      mockIsConnected.mockReturnValue(true);
      const screen = getScreens("regular").find((s) => s.name === "account")!;

      // Now disconnect for the fetch
      mockIsConnected.mockReturnValue(false);
      const lines = await screen.fetch();

      expect(lines[0].text).toBe("ACCOUNT");
      expect(lines[1].text).toBe("IBKR Disconnected");
      expect(lines[1].color).toBe("#808080");
    });

    it("renders account summary when IBKR connected", async () => {
      mockIsConnected.mockReturnValue(true);
      mockGetAccountSummary.mockResolvedValue({
        account: "DU12345",
        netLiquidation: 125000,
        totalCashValue: 45000,
        settledCash: 45000,
        buyingPower: 250000,
        grossPositionValue: 80000,
        maintMarginReq: 25000,
        excessLiquidity: 100000,
        availableFunds: 100000,
        currency: "USD",
        timestamp: new Date().toISOString(),
      });

      const screen = getScreens("regular").find((s) => s.name === "account")!;
      const lines = await screen.fetch();

      expect(lines[0].text).toBe("ACCOUNT");
      expect(lines[1].text).toContain("Net Liq");
      expect(lines[1].text).toContain("125.0K");
      expect(lines[2].text).toContain("Cash");
      expect(lines[3].text).toContain("BP");
      expect(lines[4].text).toContain("Margin");
      expect(lines[4].text).toContain("20.0%"); // 25000/125000 = 20%
      expect(lines[5].text).toContain("Excess");
    });

    it("colors margin red when > 80%", async () => {
      mockIsConnected.mockReturnValue(true);
      mockGetAccountSummary.mockResolvedValue({
        account: "DU12345",
        netLiquidation: 50000,
        totalCashValue: 5000,
        settledCash: 5000,
        buyingPower: 10000,
        grossPositionValue: 45000,
        maintMarginReq: 42000, // 84% of net liq
        excessLiquidity: 8000,
        availableFunds: 8000,
        currency: "USD",
        timestamp: new Date().toISOString(),
      });

      const screen = getScreens("regular").find((s) => s.name === "account")!;
      const lines = await screen.fetch();

      const marginLine = lines.find((l) => l.text.includes("Margin"));
      expect(marginLine!.color).toBe("#FF0000"); // red for > 80%
    });

    it("handles account fetch failure", async () => {
      mockIsConnected.mockReturnValue(true);
      mockGetAccountSummary.mockRejectedValue(new Error("IBKR error"));

      const screen = getScreens("regular").find((s) => s.name === "account")!;
      const lines = await screen.fetch();

      expect(lines[0].text).toBe("ACCOUNT");
      expect(lines[1].text).toBe("Data unavailable");
    });
  });

  // ─── Indicators Screen (IBKR) ────────────────────────────────

  describe("indicators screen", () => {
    it("shows no subscriptions when nothing tracked", async () => {
      mockIsConnected.mockReturnValue(true);
      mockGetTrackedSymbols.mockReturnValue([]);

      const screen = getScreens("regular").find((s) => s.name === "indicators")!;
      const lines = await screen.fetch();

      expect(lines[0].text).toBe("INDICATORS");
      expect(lines[1].text).toBe("No subscriptions");
    });

    it("shows warming up when snapshot has no price", async () => {
      mockIsConnected.mockReturnValue(true);
      mockGetTrackedSymbols.mockReturnValue(["SPY"]);
      mockGetSnapshot.mockReturnValue({ symbol: "SPY", price_last: null } as any);

      const screen = getScreens("regular").find((s) => s.name === "indicators")!;
      const lines = await screen.fetch();

      expect(lines[0].text).toContain("IND SPY");
      expect(lines[1].text).toBe("Warming up...");
    });

    it("renders RSI, MACD, VWAP, EMA, ATR when available", async () => {
      mockIsConnected.mockReturnValue(true);
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

      const screen = getScreens("regular").find((s) => s.name === "indicators")!;
      const lines = await screen.fetch();

      expect(lines[0].text).toContain("IND SPY");
      expect(lines[0].text).toContain("580.50");
      expect(lines[1].text).toContain("RSI(14)");
      expect(lines[1].text).toContain("65.2");
      expect(lines[2].text).toContain("MACD H");
      expect(lines[3].text).toContain("VWAP");
      expect(lines[3].text).toContain("above");
      expect(lines[4].text).toContain("EMA 9/21");
      expect(lines[4].text).toContain("BULL");
      expect(lines[4].color).toBe("#00FF00");
      expect(lines[5].text).toContain("ATR(14)");
    });

    it("colors RSI red when overbought (> 70)", async () => {
      mockIsConnected.mockReturnValue(true);
      mockGetTrackedSymbols.mockReturnValue(["SPY"]);
      mockGetSnapshot.mockReturnValue({
        symbol: "SPY",
        price_last: 585.00,
        rsi_14: 75.3,
        macd_histogram: null,
        vwap: null,
        vwap_dev_pct: null,
        ema_9: null,
        ema_21: null,
        atr_14_pct: null,
      } as any);

      const screen = getScreens("regular").find((s) => s.name === "indicators")!;
      const lines = await screen.fetch();

      const rsiLine = lines.find((l) => l.text.includes("RSI"));
      expect(rsiLine!.color).toBe("#FF0000");
    });

    it("shows BEAR when EMA 9 < EMA 21", async () => {
      mockIsConnected.mockReturnValue(true);
      mockGetTrackedSymbols.mockReturnValue(["SPY"]);
      mockGetSnapshot.mockReturnValue({
        symbol: "SPY",
        price_last: 575.00,
        rsi_14: null,
        macd_histogram: null,
        vwap: null,
        vwap_dev_pct: null,
        ema_9: 574.00,
        ema_21: 578.00,
        atr_14_pct: null,
      } as any);

      const screen = getScreens("regular").find((s) => s.name === "indicators")!;
      const lines = await screen.fetch();

      const emaLine = lines.find((l) => l.text.includes("EMA"));
      expect(emaLine!.text).toContain("BEAR");
      expect(emaLine!.color).toBe("#FF0000");
    });

    it("handles indicator engine failure", async () => {
      mockIsConnected.mockReturnValue(true);
      mockGetTrackedSymbols.mockImplementation(() => { throw new Error("Engine error"); });

      const screen = getScreens("regular").find((s) => s.name === "indicators")!;
      const lines = await screen.fetch();

      expect(lines[0].text).toBe("INDICATORS");
      expect(lines[1].text).toBe("Unavailable");
    });
  });

  // ─── Exposure Screen (IBKR) ──────────────────────────────────

  describe("exposure screen", () => {
    it("shows disconnected message when IBKR not connected", async () => {
      mockIsConnected.mockReturnValue(true);
      const screen = getScreens("regular").find((s) => s.name === "exposure")!;

      mockIsConnected.mockReturnValue(false);
      const lines = await screen.fetch();

      expect(lines[0].text).toBe("EXPOSURE");
      expect(lines[1].text).toBe("IBKR Disconnected");
    });

    it("shows flat message when no positions", async () => {
      mockIsConnected.mockReturnValue(true);
      mockComputeExposure.mockResolvedValue({
        positionCount: 0,
        percentDeployed: 0,
        grossExposure: 0,
        netExposure: 0,
        portfolioHeat: 0,
        largestPosition: null,
        largestPositionPercent: 0,
        sectorBreakdown: {},
        betaWeightedExposure: 0,
        netLiquidation: 100000,
      } as any);

      const screen = getScreens("regular").find((s) => s.name === "exposure")!;
      const lines = await screen.fetch();

      expect(lines[0].text).toBe("EXPOSURE");
      expect(lines[1].text).toBe("Flat - no positions");
    });

    it("renders exposure data with positions", async () => {
      mockIsConnected.mockReturnValue(true);
      mockComputeExposure.mockResolvedValue({
        positionCount: 5,
        percentDeployed: 65.2,
        grossExposure: 81500,
        netExposure: 45000,
        portfolioHeat: 3.2,
        largestPosition: "AAPL",
        largestPositionPercent: 22.5,
        sectorBreakdown: { Technology: 40 },
        betaWeightedExposure: 50000,
        netLiquidation: 125000,
      } as any);

      const screen = getScreens("regular").find((s) => s.name === "exposure")!;
      const lines = await screen.fetch();

      expect(lines[0].text).toBe("EXPOSURE");
      expect(lines[1].text).toContain("Deployed");
      expect(lines[1].text).toContain("65.2%");
      expect(lines[2].text).toContain("Gross");
      expect(lines[3].text).toContain("Net");
      expect(lines[4].text).toContain("Heat");
      expect(lines[4].text).toContain("3.20%");
      expect(lines[5].text).toContain("AAPL");
      expect(lines[5].text).toContain("22.5%");
    });

    it("colors deployed red when > 80%", async () => {
      mockIsConnected.mockReturnValue(true);
      mockComputeExposure.mockResolvedValue({
        positionCount: 3,
        percentDeployed: 92.0,
        grossExposure: 115000,
        netExposure: 100000,
        portfolioHeat: 6.5,
        largestPosition: "NVDA",
        largestPositionPercent: 45.0,
        sectorBreakdown: {},
        betaWeightedExposure: 90000,
        netLiquidation: 125000,
      } as any);

      const screen = getScreens("regular").find((s) => s.name === "exposure")!;
      const lines = await screen.fetch();

      expect(lines[1].color).toBe("#FF0000"); // deployed > 80%
      expect(lines[4].color).toBe("#FF0000"); // heat > 5
    });

    it("handles exposure fetch failure", async () => {
      mockIsConnected.mockReturnValue(true);
      mockComputeExposure.mockRejectedValue(new Error("Portfolio error"));

      const screen = getScreens("regular").find((s) => s.name === "exposure")!;
      const lines = await screen.fetch();

      expect(lines[0].text).toBe("EXPOSURE");
      expect(lines[1].text).toBe("Data unavailable");
    });
  });

  // ─── SmartQuote IBKR-First Routing ────────────────────────────

  describe("smartQuote routing (via market-pulse)", () => {
    it("uses IBKR quote when connected (shows LIVE badge)", async () => {
      mockIsConnected.mockReturnValue(true);
      mockGetIBKRQuote.mockResolvedValue({
        symbol: "SPY",
        bid: 580.0,
        ask: 580.10,
        last: 580.05,
        open: 578.0,
        high: 582.0,
        low: 577.0,
        close: 578.0,
        volume: 50000000,
        timestamp: new Date().toISOString(),
        delayed: false,
        staleness_warning: null,
      });

      const screen = getScreens("regular").find((s) => s.name === "market-pulse")!;
      const lines = await screen.fetch();

      expect(lines[0].text).toContain("LIVE");
      expect(mockGetIBKRQuote).toHaveBeenCalledWith({ symbol: "SPY" });
    });

    it("falls back to Yahoo when IBKR fails", async () => {
      mockIsConnected.mockReturnValue(true);
      mockGetIBKRQuote.mockRejectedValue(new Error("IBKR timeout"));
      mockGetQuote.mockResolvedValue(makeQuote());

      const screen = getScreens("regular").find((s) => s.name === "market-pulse")!;
      const lines = await screen.fetch();

      expect(lines[0].text).toContain("DLY");
      expect(mockGetQuote).toHaveBeenCalled();
    });

    it("uses Yahoo directly when IBKR disconnected", async () => {
      mockIsConnected.mockReturnValue(false);
      mockGetQuote.mockResolvedValue(makeQuote());

      const screen = getScreens("regular").find((s) => s.name === "market-pulse")!;
      const lines = await screen.fetch();

      expect(lines[0].text).toContain("DLY");
      expect(mockGetIBKRQuote).not.toHaveBeenCalled();
      expect(mockGetQuote).toHaveBeenCalled();
    });
  });

  // ─── Trending ─────────────────────────────────────────────

  describe("trending screen", () => {
    it("fetches trending symbols and their quotes", async () => {
      mockGetTrending.mockResolvedValue([
        { symbol: "NVDA" },
        { symbol: "TSLA" },
      ]);
      mockGetQuote.mockResolvedValue(makeQuote({ last: 892.0, changePercent: 4.2 }));

      const lines = await getScreens("regular").find((s) => s.name === "trending")!.fetch();

      expect(mockGetTrending).toHaveBeenCalled();
      expect(lines[0].text).toBe("TRENDING");
      expect(lines[0].color).toBe("#FF8800");
    });

    it("limits to 5 trending results", async () => {
      const trending = Array.from({ length: 10 }, (_, i) => ({ symbol: `SYM${i}` }));
      mockGetTrending.mockResolvedValue(trending);
      mockGetQuote.mockResolvedValue(makeQuote());

      const lines = await getScreens("regular").find((s) => s.name === "trending")!.fetch();
      expect(lines.length).toBeLessThanOrEqual(6);
    });

    it("handles trending failure gracefully", async () => {
      mockGetTrending.mockRejectedValue(new Error("API error"));

      const lines = await getScreens("regular").find((s) => s.name === "trending")!.fetch();

      expect(lines[0].text).toBe("TRENDING");
      expect(lines).toHaveLength(1);
    });
  });

  // ─── News ─────────────────────────────────────────────────

  describe("news screen", () => {
    it("fetches stock market news", async () => {
      mockGetNews.mockResolvedValue([
        { title: "Markets rally on Fed signal", publisher: "Reuters", link: "", publishedAt: "", relatedTickers: [] },
        { title: "Tech earnings beat estimates", publisher: "Bloomberg", link: "", publishedAt: "", relatedTickers: [] },
      ]);

      const lines = await getScreens("regular").find((s) => s.name === "news")!.fetch();

      expect(mockGetNews).toHaveBeenCalledWith("stock market");
      expect(lines[0].text).toBe("NEWS");
      expect(lines[0].color).toBe("#FFFFFF");
      expect(lines[1].text).toContain("Markets rally");
      expect(lines[1].color).toBe("#FFFF00");
    });

    it("truncates long headlines", async () => {
      mockGetNews.mockResolvedValue([
        { title: "This is a really long headline that exceeds the character limit", publisher: "", link: "", publishedAt: "", relatedTickers: [] },
      ]);

      const lines = await getScreens("regular").find((s) => s.name === "news")!.fetch();

      expect(lines[1].text.length).toBeLessThanOrEqual(24);
      expect(lines[1].text).toMatch(/~$/);
    });

    it("shows fallback when no news", async () => {
      mockGetNews.mockResolvedValue([]);

      const lines = await getScreens("regular").find((s) => s.name === "news")!.fetch();

      expect(lines[1].text).toBe("No headlines");
      expect(lines[1].color).toBe("#808080");
    });

    it("handles news API failure", async () => {
      mockGetNews.mockRejectedValue(new Error("fail"));

      const lines = await getScreens("regular").find((s) => s.name === "news")!.fetch();

      expect(lines[0].text).toBe("NEWS");
      expect(lines[1].text).toBe("No headlines");
    });

    it("limits to 5 headlines", async () => {
      const news = Array.from({ length: 10 }, (_, i) => ({
        title: `Headline ${i}`, publisher: "", link: "", publishedAt: "", relatedTickers: [],
      }));
      mockGetNews.mockResolvedValue(news);

      const lines = await getScreens("regular").find((s) => s.name === "news")!.fetch();
      expect(lines).toHaveLength(6); // 1 header + 5 headlines
    });
  });

  // ─── Futures ──────────────────────────────────────────────

  describe("futures screen", () => {
    it("fetches ES, NQ, YM, RTY futures", async () => {
      mockGetQuote.mockResolvedValue(makeQuote());

      const lines = await getScreens("closed").find((s) => s.name === "futures")!.fetch();

      expect(mockGetQuote).toHaveBeenCalledWith("ES=F");
      expect(mockGetQuote).toHaveBeenCalledWith("NQ=F");
      expect(mockGetQuote).toHaveBeenCalledWith("YM=F");
      expect(mockGetQuote).toHaveBeenCalledWith("RTY=F");
    });

    it("renders header in cyan with source badge", async () => {
      mockGetQuote.mockResolvedValue(makeQuote());

      const lines = await getScreens("closed").find((s) => s.name === "futures")!.fetch();

      expect(lines[0].text).toContain("FUTURES");
      expect(lines[0].text).toContain("DLY");
      expect(lines[0].color).toBe("#00FFFF");
    });

    it("renders futures with price and change%", async () => {
      mockGetQuote.mockResolvedValue(makeQuote({ last: 5950.25, changePercent: 0.3 }));

      const lines = await getScreens("pre-market").find((s) => s.name === "futures")!.fetch();

      expect(lines.length).toBeGreaterThan(1);
      // Skip header (index 0), check first data line
      expect(lines[1].text).toContain("ES");
      expect(lines[1].text).toContain("+0.30%");
    });

    it("shows fallback when no futures data", async () => {
      mockGetQuote.mockRejectedValue(new Error("fail"));

      const lines = await getScreens("closed").find((s) => s.name === "futures")!.fetch();

      expect(lines[1].text).toBe("No futures data");
      expect(lines[1].color).toBe("#808080");
    });
  });

  // ─── Daily Chart ──────────────────────────────────────────

  describe("daily-chart screen", () => {
    it("fetches 5d historical bars for SPY", async () => {
      mockGetHistoricalBars.mockResolvedValue([
        { time: "2026-02-20T00:00:00Z", open: 575, high: 580, low: 573, close: 578, volume: 50000000 },
        { time: "2026-02-21T00:00:00Z", open: 578, high: 582, low: 576, close: 580, volume: 45000000 },
      ]);

      const lines = await getScreens("closed").find((s) => s.name === "daily-chart")!.fetch();

      expect(mockGetHistoricalBars).toHaveBeenCalledWith("SPY", "5d", "1d");
      expect(lines[0].text).toBe("SPY 5-DAY");
    });

    it("renders bars with date, close, and change%", async () => {
      mockGetHistoricalBars.mockResolvedValue([
        { time: "2026-02-24T00:00:00Z", open: 575, high: 580, low: 573, close: 580, volume: 50000000 },
      ]);

      const lines = await getScreens("closed").find((s) => s.name === "daily-chart")!.fetch();

      expect(lines[1].text).toContain("580.00");
      expect(lines[1].text).toContain("+0.87%");
      expect(lines[1].color).toBe("#00FF00");
    });

    it("colors red for negative day", async () => {
      mockGetHistoricalBars.mockResolvedValue([
        { time: "2026-02-24T00:00:00Z", open: 580, high: 581, low: 573, close: 575, volume: 50000000 },
      ]);

      const lines = await getScreens("closed").find((s) => s.name === "daily-chart")!.fetch();

      expect(lines[1].color).toBe("#FF0000");
    });

    it("handles bar failure gracefully", async () => {
      mockGetHistoricalBars.mockRejectedValue(new Error("fail"));

      const lines = await getScreens("closed").find((s) => s.name === "daily-chart")!.fetch();

      expect(lines).toHaveLength(1);
      expect(lines[0].text).toBe("SPY 5-DAY");
    });
  });

  // ─── Scrolling Ticker ─────────────────────────────────────

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
      expect(ticker.text.length).toBeGreaterThan(0);
    });
  });

  // ─── Line Formatting ─────────────────────────────────────

  describe("line formatting", () => {
    it("assigns unique TextId to each line", async () => {
      mockGetQuote.mockResolvedValue(makeQuote());

      const lines = await getScreens("regular").find((s) => s.name === "market-pulse")!.fetch();

      const ids = lines.map((l) => l.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it("spaces lines at 16px intervals", async () => {
      mockGetQuote.mockResolvedValue(makeQuote());

      const lines = await getScreens("regular").find((s) => s.name === "market-pulse")!.fetch();

      for (let i = 1; i < lines.length; i++) {
        expect(lines[i].y).toBe(i * 16);
      }
    });

    it("formats prices >= 1000 with 1 decimal", async () => {
      mockGetQuote.mockResolvedValue(makeQuote({ last: 1234.56, changePercent: 0.1 }));

      const lines = await getScreens("regular").find((s) => s.name === "market-pulse")!.fetch();

      const spyLine = lines.find((l) => l.text.includes("SPY"));
      expect(spyLine!.text).toContain("1234.6");
    });

    it("formats prices < 1000 with 2 decimals", async () => {
      mockGetQuote.mockResolvedValue(makeQuote({ last: 582.14, changePercent: 0.1 }));

      const lines = await getScreens("regular").find((s) => s.name === "market-pulse")!.fetch();

      const spyLine = lines.find((l) => l.text.includes("SPY"));
      expect(spyLine!.text).toContain("582.14");
    });
  });
});
