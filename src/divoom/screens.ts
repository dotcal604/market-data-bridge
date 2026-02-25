/**
 * Divoom Market Data Screens
 *
 * Fetches market data and produces a DashboardData object for the
 * TimesFrame layout engine. All data sections are fetched in parallel.
 *
 * IBKR-first: uses real-time IBKR quotes/indicators when TWS is connected,
 * falls back to Yahoo Finance (15-20 min delayed) when it's not.
 */

import type { DashboardData, DashboardSection, TextRow } from "./layout.js";
import type { ChartInputData, HeatmapCell, OHLC } from "./charts.js";
import { getQuote, getNews, runScreener, getHistoricalBars, getTrendingSymbols } from "../providers/yahoo.js";
import { getStatus } from "../providers/status.js";
import { isConnected } from "../ibkr/connection.js";
import { logger } from "../logging.js";

const log = logger.child({ module: "divoom-screens" });

// ─── Colors ─────────────────────────────────────────────────

export const C = {
  green: "#00FF00",
  red: "#FF0000",
  yellow: "#FFFF00",
  cyan: "#00FFFF",
  magenta: "#FF00FF",
  white: "#FFFFFF",
  gray: "#808080",
  orange: "#FF8800",
  blue: "#4488FF",
} as const;

// ─── Helpers ────────────────────────────────────────────────

export function changeColor(change: number): string {
  if (change > 0) return C.green;
  if (change < 0) return C.red;
  return C.gray;
}

export function fmtPrice(price: number): string {
  return price >= 1000 ? price.toFixed(1) : price.toFixed(2);
}

export function fmtPct(pct: number): string {
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
}

export function fmtDollar(amount: number): string {
  const abs = Math.abs(amount);
  if (abs >= 1e6) return `${(amount / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(amount / 1e3).toFixed(1)}K`;
  return amount.toFixed(0);
}

export function sessionLabel(session: string): string {
  switch (session) {
    case "pre-market": return "PRE";
    case "regular": return "OPEN";
    case "after-hours": return "AH";
    case "closed": return "CLOSED";
    default: return session.toUpperCase();
  }
}

export function trim(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + "~" : text;
}

export function currentSession(): string {
  return getStatus().marketSession;
}

// ─── Smart Quote: IBKR real-time -> Yahoo fallback ──────────

export interface SmartQuoteResult {
  symbol: string;
  last: number;
  changePercent: number;
  bid: number | null;
  ask: number | null;
  volume: number | null;
  source: "LIVE" | "DLY";
}

export async function smartQuote(symbol: string): Promise<SmartQuoteResult | null> {
  if (isConnected()) {
    try {
      const { getIBKRQuote } = await import("../ibkr/marketdata.js");
      const q = await getIBKRQuote({ symbol });
      if (q.last !== null) {
        const close = q.close ?? q.last;
        const changePct = close !== 0 ? ((q.last - close) / close) * 100 : 0;
        return {
          symbol: q.symbol,
          last: q.last,
          changePercent: changePct,
          bid: q.bid,
          ask: q.ask,
          volume: q.volume,
          source: q.delayed ? "DLY" : "LIVE",
        };
      }
    } catch {
      // fall through to Yahoo
    }
  }

  try {
    const q = await getQuote(symbol);
    if (q.last !== null) {
      return {
        symbol: q.symbol,
        last: q.last,
        changePercent: q.changePercent ?? 0,
        bid: q.bid,
        ask: q.ask,
        volume: q.volume,
        source: "DLY",
      };
    }
  } catch {
    // no data
  }

  return null;
}

// ─── Section Builders ───────────────────────────────────────

async function fetchHeader(): Promise<{ header: TextRow; source: "LIVE" | "DLY" }> {
  const status = getStatus();
  const session = status.marketSession;
  const time = status.easternTime;

  // Peek at one index quote to determine source
  const spy = await smartQuote("SPY").catch(() => null);
  const source = spy?.source ?? "DLY";

  return {
    header: {
      text: `${sessionLabel(session)} \u00b7 ${source} \u00b7 ${time}`,
      color: C.cyan,
    },
    source,
  };
}

async function fetchIndices(): Promise<{ indices: TextRow[]; vix: TextRow | null; source: "LIVE" | "DLY" }> {
  const [spy, qqq, dia, iwm, vix] = await Promise.all([
    smartQuote("SPY"),
    smartQuote("QQQ"),
    smartQuote("DIA"),
    smartQuote("IWM"),
    smartQuote("^VIX"),
  ]);

  const source = spy?.source ?? qqq?.source ?? "DLY";

  const pairs = [
    { label: "SPY", q: spy },
    { label: "QQQ", q: qqq },
    { label: "DIA", q: dia },
    { label: "IWM", q: iwm },
  ];

  const indices: TextRow[] = pairs.map(({ label, q }) => {
    if (!q) return { text: `${label}  --`, color: C.gray };
    return {
      text: `${label}  ${fmtPrice(q.last)}  ${fmtPct(q.changePercent)}`,
      color: changeColor(q.changePercent),
    };
  });

  let vixRow: TextRow | null = null;
  if (vix) {
    const vixColor = vix.last > 25 ? C.red : vix.last > 18 ? C.orange : C.green;
    vixRow = { text: `VIX  ${fmtPrice(vix.last)}`, color: vixColor };
  }

  return { indices, vix: vixRow, source };
}

async function fetchSectors(): Promise<DashboardSection> {
  const SECTOR_ETFS = [
    { symbol: "XLK", label: "Tech " },
    { symbol: "XLF", label: "Fin  " },
    { symbol: "XLE", label: "Engy " },
    { symbol: "XLV", label: "Hlth " },
    { symbol: "XLY", label: "Cons " },
  ] as const;

  const quotes = await Promise.all(
    SECTOR_ETFS.map((s) => smartQuote(s.symbol)),
  );

  const src = quotes.find((q) => q)?.source ?? "DLY";

  const rows: TextRow[] = SECTOR_ETFS.map((sector, i) => {
    const q = quotes[i];
    if (!q) return { text: `${sector.label}${sector.symbol}  --`, color: C.gray };
    return {
      text: `${sector.label}${sector.symbol}  ${fmtPct(q.changePercent)}`,
      color: changeColor(q.changePercent),
    };
  });

  return {
    header: { text: `SECTORS ${src}`, color: C.blue },
    rows,
  };
}

async function fetchMovers(session: string): Promise<DashboardSection> {
  // During off-hours, show futures instead of movers
  if (session !== "regular") {
    return fetchFutures();
  }

  const [gainers, losers] = await Promise.all([
    runScreener("day_gainers", 3).catch(() => []),
    runScreener("day_losers", 3).catch(() => []),
  ]);

  const rows: TextRow[] = [];

  for (let i = 0; i < 2; i++) {
    const g = gainers[i];
    if (g) {
      rows.push({
        text: `\u25b2 ${g.symbol.padEnd(6)}${fmtPct(g.changePercent ?? 0)}`,
        color: C.green,
      });
    }
  }

  for (let i = 0; i < 2; i++) {
    const l = losers[i];
    if (l) {
      rows.push({
        text: `\u25bc ${l.symbol.padEnd(6)}${fmtPct(l.changePercent ?? 0)}`,
        color: C.red,
      });
    }
  }

  if (rows.length === 0) {
    rows.push({ text: "No mover data", color: C.gray });
  }

  return {
    header: { text: "MOVERS", color: C.yellow },
    rows,
  };
}

async function fetchFutures(): Promise<DashboardSection> {
  const [es, nq, ym, rty] = await Promise.all([
    smartQuote("ES=F"),
    smartQuote("NQ=F"),
    smartQuote("YM=F"),
    smartQuote("RTY=F"),
  ]);

  const src = es?.source ?? nq?.source ?? "DLY";

  const items = [
    { label: "ES   ", q: es },
    { label: "NQ   ", q: nq },
    { label: "YM   ", q: ym },
    { label: "RTY  ", q: rty },
  ];

  const rows: TextRow[] = items
    .filter((item) => item.q)
    .map((item) => ({
      text: `${item.label}${fmtPrice(item.q!.last)}  ${fmtPct(item.q!.changePercent)}`,
      color: changeColor(item.q!.changePercent),
    }));

  if (rows.length === 0) {
    rows.push({ text: "No futures data", color: C.gray });
  }

  return {
    header: { text: `FUTURES ${src}`, color: C.cyan },
    rows,
  };
}

async function fetchPortfolio(): Promise<DashboardSection> {
  if (!isConnected()) {
    return {
      header: { text: "PORTFOLIO", color: C.magenta },
      rows: [
        { text: "IBKR Disconnected", color: C.gray },
        { text: "Start TWS to view", color: C.gray },
      ],
    };
  }

  try {
    const { getPnL, getPositions } = await import("../ibkr/account.js");
    const [pnl, positions] = await Promise.all([getPnL(), getPositions()]);

    const dailyPnl = pnl.dailyPnL ?? 0;
    const pnlColor = dailyPnl >= 0 ? C.green : C.red;
    const pnlText = dailyPnl >= 0
      ? `+$${dailyPnl.toFixed(2)}`
      : `-$${Math.abs(dailyPnl).toFixed(2)}`;

    const rows: TextRow[] = [
      { text: `PnL: ${pnlText}`, color: pnlColor },
      { text: `Positions: ${positions.length}`, color: C.cyan },
    ];

    // Show top 2 positions
    for (let i = 0; i < Math.min(positions.length, 2); i++) {
      const p = positions[i];
      rows.push({
        text: `${p.symbol} ${p.position}@${p.avgCost.toFixed(2)}`,
        color: C.white,
      });
    }

    return {
      header: { text: "PORTFOLIO", color: C.magenta },
      rows,
    };
  } catch (err) {
    log.error({ err }, "Failed to fetch portfolio for display");
    return {
      header: { text: "PORTFOLIO", color: C.magenta },
      rows: [{ text: "Data unavailable", color: C.gray }],
    };
  }
}

async function fetchNews(): Promise<DashboardSection> {
  const news = await getNews("stock market").catch(() => []);

  const rows: TextRow[] = news.slice(0, 3).map((n) => ({
    text: trim(n.title, 40),
    color: C.yellow,
  }));

  if (rows.length === 0) {
    rows.push({ text: "No headlines", color: C.gray });
  }

  return {
    header: { text: "NEWS", color: C.white },
    rows,
  };
}

async function fetchIndicators(): Promise<DashboardSection> {
  try {
    const { getSnapshot, getTrackedSymbols } = await import("../indicators/engine.js");
    const tracked = getTrackedSymbols();

    if (tracked.length === 0) {
      return {
        header: { text: "INDICATORS", color: C.orange },
        rows: [
          { text: "No subscriptions", color: C.gray },
          { text: "Subscribe via MCP", color: C.gray },
        ],
      };
    }

    const symbol = tracked[0];
    const snap = getSnapshot(symbol);

    if (!snap || snap.price_last === null) {
      return {
        header: { text: `IND ${symbol}`, color: C.orange },
        rows: [{ text: "Warming up...", color: C.gray }],
      };
    }

    const rows: TextRow[] = [];

    // Header includes symbol + price
    const headerText = `IND ${symbol} ${fmtPrice(snap.price_last)}`;

    if (snap.rsi_14 !== null) {
      const rsiColor = snap.rsi_14 > 70 ? C.red : snap.rsi_14 < 30 ? C.green : C.white;
      rows.push({ text: `RSI(14)  ${snap.rsi_14.toFixed(1)}`, color: rsiColor });
    }

    if (snap.macd_histogram !== null) {
      const hist = snap.macd_histogram;
      rows.push({ text: `MACD H   ${hist >= 0 ? "+" : ""}${hist.toFixed(3)}`, color: changeColor(hist) });
    }

    if (snap.vwap !== null) {
      const dev = snap.vwap_dev_pct ?? 0;
      const label = dev >= 0 ? "above" : "below";
      rows.push({ text: `VWAP ${Math.abs(dev).toFixed(2)}% ${label}`, color: changeColor(dev) });
    }

    if (snap.ema_9 !== null && snap.ema_21 !== null) {
      const trend = snap.ema_9 > snap.ema_21 ? "BULL" : "BEAR";
      rows.push({ text: `EMA 9/21 ${trend}`, color: trend === "BULL" ? C.green : C.red });
    }

    if (snap.atr_14_pct !== null) {
      rows.push({ text: `ATR(14)  ${snap.atr_14_pct.toFixed(2)}%`, color: C.white });
    }

    return {
      header: { text: headerText, color: C.orange },
      rows,
    };
  } catch (err) {
    log.error({ err }, "Failed to fetch indicators for display");
    return {
      header: { text: "INDICATORS", color: C.orange },
      rows: [{ text: "Unavailable", color: C.gray }],
    };
  }
}

// ─── Chart Data Collectors ───────────────────────────────────

async function fetchSpyChartData(): Promise<{ prices: number[]; candles: OHLC[] }> {
  try {
    const bars = await getHistoricalBars("SPY", "1mo", "1d");
    const prices = bars.map((b: any) => b.close).filter((v: any): v is number => v != null);
    const candles: OHLC[] = bars
      .filter((b: any) => b.open != null && b.high != null && b.low != null && b.close != null)
      .map((b: any) => ({
        open: b.open as number,
        high: b.high as number,
        low: b.low as number,
        close: b.close as number,
      }));
    return { prices, candles };
  } catch (err) {
    log.warn({ err }, "Failed to fetch SPY chart data");
    return { prices: [], candles: [] };
  }
}

async function fetchSectorHeatmapData(): Promise<HeatmapCell[]> {
  const SECTORS = [
    { symbol: "XLK", label: "Tech" },
    { symbol: "XLF", label: "Fin" },
    { symbol: "XLE", label: "Engy" },
    { symbol: "XLV", label: "Hlth" },
    { symbol: "XLY", label: "Cons" },
    { symbol: "XLI", label: "Ind" },
    { symbol: "XLU", label: "Util" },
    { symbol: "XLP", label: "Stpl" },
    { symbol: "XLRE", label: "RE" },
    { symbol: "XLB", label: "Mtrl" },
  ];

  const quotes = await Promise.all(SECTORS.map((s) => smartQuote(s.symbol).catch(() => null)));

  return SECTORS
    .map((s, i) => ({
      label: s.label,
      value: quotes[i]?.changePercent ?? 0,
    }))
    .filter((c) => c.value !== 0 || quotes[SECTORS.findIndex((s) => s.label === c.label)] !== null);
}

async function fetchPnlChartData(): Promise<{ values: number[]; labels: string[] } | null> {
  if (!isConnected()) return null;

  try {
    const { getPnL } = await import("../ibkr/account.js");
    const pnl = await getPnL();
    // Return just the daily PnL as a single-point (fuller data requires historical tracking)
    if (pnl.dailyPnL != null) {
      return { values: [0, pnl.dailyPnL], labels: ["Open", "Now"] };
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchIndicatorValues(): Promise<{
  rsi: number | null;
  vix: number | null;
  volumeBars: Array<{ label: string; volume: number; change: number }>;
}> {
  let rsi: number | null = null;
  let vix: number | null = null;
  const volumeBars: Array<{ label: string; volume: number; change: number }> = [];

  // RSI from indicator engine
  try {
    const { getSnapshot, getTrackedSymbols } = await import("../indicators/engine.js");
    const tracked = getTrackedSymbols();
    if (tracked.length > 0) {
      const snap = getSnapshot(tracked[0]);
      if (snap?.rsi_14 != null) rsi = snap.rsi_14;
    }
  } catch { /* no indicator data */ }

  // VIX
  try {
    const vixQuote = await smartQuote("^VIX");
    if (vixQuote) vix = vixQuote.last;
  } catch { /* no VIX data */ }

  // Volume bars for major indices
  const volSymbols = ["SPY", "QQQ", "DIA", "IWM"];
  const volQuotes = await Promise.all(volSymbols.map((s) => smartQuote(s).catch(() => null)));
  for (let i = 0; i < volSymbols.length; i++) {
    const q = volQuotes[i];
    if (q?.volume) {
      volumeBars.push({
        label: volSymbols[i],
        volume: q.volume,
        change: q.changePercent,
      });
    }
  }

  return { rsi, vix, volumeBars };
}

// ─── Main Dashboard Fetch ───────────────────────────────────

export interface DashboardResult {
  dashboard: DashboardData;
  chartInput: ChartInputData;
}

/**
 * Fetch all market data in parallel and return a unified DashboardData object.
 */
export async function fetchDashboardData(): Promise<DashboardData> {
  const result = await fetchDashboardWithCharts();
  return result.dashboard;
}

/**
 * Fetch all market data and chart input data in parallel.
 */
export async function fetchDashboardWithCharts(): Promise<DashboardResult> {
  const session = currentSession();

  const [
    headerResult, indicesResult, sectors, movers, portfolio, news, indicators,
    spyChart, sectorHeatmap, pnlData, indicatorValues,
  ] = await Promise.all([
    fetchHeader(),
    fetchIndices(),
    fetchSectors(),
    fetchMovers(session),
    fetchPortfolio(),
    fetchNews(),
    fetchIndicators(),
    fetchSpyChartData(),
    fetchSectorHeatmapData(),
    fetchPnlChartData(),
    fetchIndicatorValues(),
  ]);

  const dashboard: DashboardData = {
    header: headerResult.header,
    indices: indicesResult.indices,
    vix: indicesResult.vix,
    sectors,
    movers,
    portfolio,
    news,
    indicators,
  };

  const chartInput: ChartInputData = {
    spyPrices: spyChart.prices,
    spyCandles: spyChart.candles,
    sectorHeatmap,
    pnlCurve: pnlData,
    rsiValue: indicatorValues.rsi,
    vixValue: indicatorValues.vix,
    volumeBars: indicatorValues.volumeBars,
    allocation: null, // TODO: derive from portfolio positions
  };

  return { dashboard, chartInput };
}
