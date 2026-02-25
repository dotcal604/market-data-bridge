/**
 * Divoom Market Data Screens
 *
 * Session-aware rotating screens for the Divoom TimeFrame display.
 * IBKR-first: uses real-time IBKR quotes/indicators when TWS is connected,
 * falls back to Yahoo Finance (15-20 min delayed) when it's not.
 */

import type { TextLine } from "./display.js";
import { getQuote, getNews, runScreener, getHistoricalBars, getTrendingSymbols } from "../providers/yahoo.js";
import { getStatus } from "../providers/status.js";
import { isConnected } from "../ibkr/connection.js";
import { logger } from "../logging.js";

const log = logger.child({ module: "divoom-screens" });

// ─── Colors ─────────────────────────────────────────────────
const C = {
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

function changeColor(change: number): string {
  if (change > 0) return C.green;
  if (change < 0) return C.red;
  return C.gray;
}

function fmtPrice(price: number): string {
  return price >= 1000 ? price.toFixed(1) : price.toFixed(2);
}

function fmtPct(pct: number): string {
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
}

function fmtDollar(amount: number): string {
  const abs = Math.abs(amount);
  if (abs >= 1e6) return `${(amount / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(amount / 1e3).toFixed(1)}K`;
  return amount.toFixed(0);
}

function sessionLabel(session: string): string {
  switch (session) {
    case "pre-market": return "PRE";
    case "regular": return "OPEN";
    case "after-hours": return "AH";
    case "closed": return "CLOSED";
    default: return session.toUpperCase();
  }
}

function trim(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + "~" : text;
}

export function currentSession(): string {
  return getStatus().marketSession;
}

// ─── Smart Quote: IBKR real-time → Yahoo fallback ───────────

interface SmartQuoteResult {
  symbol: string;
  last: number;
  changePercent: number;
  bid: number | null;
  ask: number | null;
  volume: number | null;
  source: "LIVE" | "DLY";
}

async function smartQuote(symbol: string): Promise<SmartQuoteResult | null> {
  // Try IBKR first when connected
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

  // Yahoo fallback
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

// ─── Screen Interface ───────────────────────────────────────

export interface Screen {
  name: string;
  fetch: () => Promise<TextLine[]>;
}

// ─── Screen: Market Pulse ───────────────────────────────────

async function fetchMarketPulse(): Promise<TextLine[]> {
  const status = getStatus();
  const session = status.marketSession;
  const time = status.easternTime;

  const [spy, qqq, dia, iwm, vix] = await Promise.all([
    smartQuote("SPY"),
    smartQuote("QQQ"),
    smartQuote("DIA"),
    smartQuote("IWM"),
    smartQuote("^VIX"),
  ]);

  // Determine source badge from first successful quote
  const src = spy?.source ?? qqq?.source ?? "DLY";

  const lines: TextLine[] = [];
  let y = 0;

  lines.push({ text: `${sessionLabel(session)} ${src} ${time}`, y, color: C.cyan, id: 0 });
  y += 16;

  const indices = [
    { label: "SPY", q: spy },
    { label: "QQQ", q: qqq },
    { label: "DIA", q: dia },
    { label: "IWM", q: iwm },
  ];

  for (let i = 0; i < indices.length; i++) {
    const { label, q } = indices[i];
    if (q) {
      lines.push({
        text: `${label}  ${fmtPrice(q.last)}  ${fmtPct(q.changePercent)}`,
        y, color: changeColor(q.changePercent), id: i + 1,
      });
    }
    y += 16;
  }

  if (vix) {
    const vixColor = vix.last > 25 ? C.red : vix.last > 18 ? C.orange : C.green;
    lines.push({ text: `VIX  ${fmtPrice(vix.last)}`, y, color: vixColor, id: 5 });
  }

  return lines;
}

// ─── Screen: Top Gainers ────────────────────────────────────

async function fetchTopGainers(): Promise<TextLine[]> {
  const session = currentSession();
  const results = await runScreener("day_gainers", 6).catch(() => []);

  const lines: TextLine[] = [];
  lines.push({ text: session === "regular" ? "TOP GAINERS" : "PRIOR GAINERS", y: 0, color: C.green, id: 0 });

  for (let i = 0; i < Math.min(results.length, 5); i++) {
    const r = results[i];
    const pct = r.changePercent ?? 0;
    lines.push({
      text: `${r.symbol.padEnd(6)}${fmtPct(pct)}  ${fmtPrice(r.last ?? 0)}`,
      y: 16 + i * 16, color: C.green, id: i + 1,
    });
  }

  return lines;
}

// ─── Screen: Top Losers ─────────────────────────────────────

async function fetchTopLosers(): Promise<TextLine[]> {
  const session = currentSession();
  const results = await runScreener("day_losers", 6).catch(() => []);

  const lines: TextLine[] = [];
  lines.push({ text: session === "regular" ? "TOP LOSERS" : "PRIOR LOSERS", y: 0, color: C.red, id: 0 });

  for (let i = 0; i < Math.min(results.length, 5); i++) {
    const r = results[i];
    const pct = r.changePercent ?? 0;
    lines.push({
      text: `${r.symbol.padEnd(6)}${fmtPct(pct)}  ${fmtPrice(r.last ?? 0)}`,
      y: 16 + i * 16, color: C.red, id: i + 1,
    });
  }

  return lines;
}

// ─── Screen: Most Active ────────────────────────────────────

async function fetchMostActive(): Promise<TextLine[]> {
  const session = currentSession();
  const results = await runScreener("most_actives", 6).catch(() => []);

  const lines: TextLine[] = [];
  lines.push({ text: session === "regular" ? "MOST ACTIVE" : "PRIOR ACTIVE", y: 0, color: C.yellow, id: 0 });

  for (let i = 0; i < Math.min(results.length, 5); i++) {
    const r = results[i];
    const pct = r.changePercent ?? 0;
    const v = r.volume ?? 0;
    const vol = v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : `${(v / 1e3).toFixed(0)}K`;
    lines.push({
      text: `${r.symbol.padEnd(6)}${fmtPct(pct)}  ${vol}`,
      y: 16 + i * 16, color: changeColor(pct), id: i + 1,
    });
  }

  return lines;
}

// ─── Screen: Sectors (smartQuote) ───────────────────────────

const SECTOR_ETFS = [
  { symbol: "XLK", label: "Tech " },
  { symbol: "XLF", label: "Fin  " },
  { symbol: "XLE", label: "Engy " },
  { symbol: "XLV", label: "Hlth " },
  { symbol: "XLY", label: "Cons " },
] as const;

async function fetchSectors(): Promise<TextLine[]> {
  const quotes = await Promise.all(
    SECTOR_ETFS.map((s) => smartQuote(s.symbol)),
  );

  const src = quotes.find((q) => q)?.source ?? "DLY";

  const lines: TextLine[] = [];
  lines.push({ text: `SECTORS ${src}`, y: 0, color: C.blue, id: 0 });

  for (let i = 0; i < SECTOR_ETFS.length; i++) {
    const q = quotes[i];
    const sector = SECTOR_ETFS[i];
    if (q) {
      lines.push({
        text: `${sector.label}${sector.symbol}  ${fmtPct(q.changePercent)}`,
        y: 16 + i * 16, color: changeColor(q.changePercent), id: i + 1,
      });
    }
  }

  return lines;
}

// ─── Screen: Portfolio (IBKR) ───────────────────────────────

async function fetchPortfolio(): Promise<TextLine[]> {
  if (!isConnected()) {
    return [
      { text: "PORTFOLIO", y: 0, color: C.magenta, id: 0 },
      { text: "IBKR Disconnected", y: 16, color: C.gray, id: 1 },
      { text: "Start TWS to view", y: 32, color: C.gray, id: 2 },
    ];
  }

  try {
    const { getPnL, getPositions } = await import("../ibkr/account.js");
    const { queryHollyAlerts } = await import("../db/database.js");

    const [pnl, positions, alerts] = await Promise.all([
      getPnL(),
      getPositions(),
      Promise.resolve(queryHollyAlerts({ limit: 1 })),
    ]);

    const lines: TextLine[] = [];
    const dailyPnl = pnl.dailyPnL ?? 0;
    const pnlColor = dailyPnl >= 0 ? C.green : C.red;
    const pnlText = dailyPnl >= 0
      ? `+$${dailyPnl.toFixed(2)}`
      : `-$${Math.abs(dailyPnl).toFixed(2)}`;

    lines.push({ text: "PORTFOLIO", y: 0, color: C.magenta, id: 0 });
    lines.push({ text: `PnL: ${pnlText}`, y: 16, color: pnlColor, id: 1 });
    lines.push({ text: `Positions: ${positions.length}`, y: 32, color: C.cyan, id: 2 });

    for (let i = 0; i < Math.min(positions.length, 2); i++) {
      const p = positions[i];
      lines.push({
        text: `${p.symbol} ${p.position}@${p.avgCost.toFixed(2)}`,
        y: 48 + i * 16, color: C.white, id: 3 + i,
      });
    }

    if (alerts.length > 0) {
      const alert = alerts[0];
      lines.push({
        text: `Holly: ${alert.symbol} @${Number(alert.entry_price).toFixed(2)}`,
        y: positions.length >= 2 ? 80 : 48 + Math.min(positions.length, 2) * 16,
        color: C.magenta, id: 7,
      });
    }

    return lines;
  } catch (err) {
    log.error({ err }, "Failed to fetch portfolio for display");
    return [
      { text: "PORTFOLIO", y: 0, color: C.magenta, id: 0 },
      { text: "Data unavailable", y: 16, color: C.gray, id: 1 },
    ];
  }
}

// ─── Screen: Account Summary (IBKR) ────────────────────────

async function fetchAccount(): Promise<TextLine[]> {
  if (!isConnected()) {
    return [
      { text: "ACCOUNT", y: 0, color: C.cyan, id: 0 },
      { text: "IBKR Disconnected", y: 16, color: C.gray, id: 1 },
    ];
  }

  try {
    const { getAccountSummary } = await import("../ibkr/account.js");
    const acct = await getAccountSummary();

    const lines: TextLine[] = [];
    lines.push({ text: "ACCOUNT", y: 0, color: C.cyan, id: 0 });
    lines.push({ text: `Net Liq: $${fmtDollar(acct.netLiquidation ?? 0)}`, y: 16, color: C.white, id: 1 });
    lines.push({ text: `Cash: $${fmtDollar(acct.totalCashValue ?? 0)}`, y: 32, color: C.white, id: 2 });
    lines.push({ text: `BP: $${fmtDollar(acct.buyingPower ?? 0)}`, y: 48, color: C.green, id: 3 });

    const margin = acct.maintMarginReq ?? 0;
    const netLiq = acct.netLiquidation ?? 1;
    const marginPct = netLiq > 0 ? (margin / netLiq) * 100 : 0;
    const marginColor = marginPct > 80 ? C.red : marginPct > 50 ? C.orange : C.green;
    lines.push({ text: `Margin: ${marginPct.toFixed(1)}% used`, y: 64, color: marginColor, id: 4 });

    const excess = acct.excessLiquidity ?? 0;
    lines.push({ text: `Excess: $${fmtDollar(excess)}`, y: 80, color: excess > 0 ? C.green : C.red, id: 5 });

    return lines;
  } catch (err) {
    log.error({ err }, "Failed to fetch account for display");
    return [
      { text: "ACCOUNT", y: 0, color: C.cyan, id: 0 },
      { text: "Data unavailable", y: 16, color: C.gray, id: 1 },
    ];
  }
}

// ─── Screen: Streaming Indicators (IBKR real-time bars) ─────

async function fetchIndicators(): Promise<TextLine[]> {
  try {
    const { getSnapshot, getTrackedSymbols } = await import("../indicators/engine.js");
    const tracked = getTrackedSymbols();

    if (tracked.length === 0) {
      return [
        { text: "INDICATORS", y: 0, color: C.orange, id: 0 },
        { text: "No subscriptions", y: 16, color: C.gray, id: 1 },
        { text: "Subscribe via MCP", y: 32, color: C.gray, id: 2 },
      ];
    }

    // Show indicators for first tracked symbol (typically SPY)
    const symbol = tracked[0];
    const snap = getSnapshot(symbol);

    if (!snap || snap.price_last === null) {
      return [
        { text: `IND ${symbol}`, y: 0, color: C.orange, id: 0 },
        { text: "Warming up...", y: 16, color: C.gray, id: 1 },
      ];
    }

    const lines: TextLine[] = [];
    lines.push({ text: `IND ${symbol} ${fmtPrice(snap.price_last)}`, y: 0, color: C.orange, id: 0 });

    // RSI
    if (snap.rsi_14 !== null) {
      const rsiVal = snap.rsi_14;
      const rsiColor = rsiVal > 70 ? C.red : rsiVal < 30 ? C.green : C.white;
      lines.push({ text: `RSI(14)  ${rsiVal.toFixed(1)}`, y: 16, color: rsiColor, id: 1 });
    }

    // MACD
    if (snap.macd_histogram !== null) {
      const hist = snap.macd_histogram;
      lines.push({ text: `MACD H   ${hist >= 0 ? "+" : ""}${hist.toFixed(3)}`, y: 32, color: changeColor(hist), id: 2 });
    }

    // VWAP vs price
    if (snap.vwap !== null) {
      const dev = snap.vwap_dev_pct ?? 0;
      const label = dev >= 0 ? "above" : "below";
      lines.push({ text: `VWAP ${Math.abs(dev).toFixed(2)}% ${label}`, y: 48, color: changeColor(dev), id: 3 });
    }

    // EMA trend
    if (snap.ema_9 !== null && snap.ema_21 !== null) {
      const trend = snap.ema_9 > snap.ema_21 ? "BULL" : "BEAR";
      const tColor = trend === "BULL" ? C.green : C.red;
      lines.push({ text: `EMA 9/21 ${trend}`, y: 64, color: tColor, id: 4 });
    }

    // ATR / Bollinger
    if (snap.atr_14_pct !== null) {
      lines.push({ text: `ATR(14)  ${snap.atr_14_pct.toFixed(2)}%`, y: 80, color: C.white, id: 5 });
    }

    return lines;
  } catch (err) {
    log.error({ err }, "Failed to fetch indicators for display");
    return [
      { text: "INDICATORS", y: 0, color: C.orange, id: 0 },
      { text: "Unavailable", y: 16, color: C.gray, id: 1 },
    ];
  }
}

// ─── Screen: Portfolio Exposure (IBKR) ──────────────────────

async function fetchExposure(): Promise<TextLine[]> {
  if (!isConnected()) {
    return [
      { text: "EXPOSURE", y: 0, color: C.yellow, id: 0 },
      { text: "IBKR Disconnected", y: 16, color: C.gray, id: 1 },
    ];
  }

  try {
    const { computePortfolioExposure } = await import("../ibkr/portfolio.js");
    const exp = await computePortfolioExposure();

    if (exp.positionCount === 0) {
      return [
        { text: "EXPOSURE", y: 0, color: C.yellow, id: 0 },
        { text: "Flat - no positions", y: 16, color: C.gray, id: 1 },
      ];
    }

    const lines: TextLine[] = [];
    lines.push({ text: "EXPOSURE", y: 0, color: C.yellow, id: 0 });

    const deployedColor = exp.percentDeployed > 80 ? C.red : exp.percentDeployed > 50 ? C.orange : C.green;
    lines.push({ text: `Deployed: ${exp.percentDeployed.toFixed(1)}%`, y: 16, color: deployedColor, id: 1 });

    lines.push({ text: `Gross: $${fmtDollar(exp.grossExposure)}`, y: 32, color: C.white, id: 2 });
    lines.push({ text: `Net:   $${fmtDollar(exp.netExposure)}`, y: 48, color: changeColor(exp.netExposure), id: 3 });

    const heatColor = exp.portfolioHeat > 5 ? C.red : exp.portfolioHeat > 2 ? C.orange : C.green;
    lines.push({ text: `Heat: ${exp.portfolioHeat.toFixed(2)}%`, y: 64, color: heatColor, id: 4 });

    if (exp.largestPosition) {
      lines.push({
        text: `Top: ${exp.largestPosition} ${exp.largestPositionPercent.toFixed(1)}%`,
        y: 80, color: C.white, id: 5,
      });
    }

    return lines;
  } catch (err) {
    log.error({ err }, "Failed to fetch exposure for display");
    return [
      { text: "EXPOSURE", y: 0, color: C.yellow, id: 0 },
      { text: "Data unavailable", y: 16, color: C.gray, id: 1 },
    ];
  }
}

// ─── Screen: Trending ───────────────────────────────────────

async function fetchTrending(): Promise<TextLine[]> {
  const trending = await getTrendingSymbols().catch(() => []);
  const top = trending.slice(0, 8);

  const quotes = await Promise.all(
    top.map((t) => smartQuote(t.symbol)),
  );

  const lines: TextLine[] = [];
  lines.push({ text: "TRENDING", y: 0, color: C.orange, id: 0 });

  for (let i = 0; i < Math.min(quotes.length, 5); i++) {
    const q = quotes[i];
    if (q) {
      lines.push({
        text: `${q.symbol.padEnd(6)}${fmtPrice(q.last)}  ${fmtPct(q.changePercent)}`,
        y: 16 + i * 16, color: changeColor(q.changePercent), id: i + 1,
      });
    }
  }

  return lines;
}

// ─── Screen: News Headlines ─────────────────────────────────

async function fetchNews(): Promise<TextLine[]> {
  const news = await getNews("stock market").catch(() => []);

  const lines: TextLine[] = [];
  lines.push({ text: "NEWS", y: 0, color: C.white, id: 0 });

  for (let i = 0; i < Math.min(news.length, 5); i++) {
    lines.push({
      text: trim(news[i].title, 24),
      y: 16 + i * 16, color: C.yellow, id: i + 1, scrollSpeed: 30,
    });
  }

  if (news.length === 0) {
    lines.push({ text: "No headlines", y: 16, color: C.gray, id: 1 });
  }

  return lines;
}

// ─── Screen: Futures (smartQuote) ───────────────────────────

async function fetchFutures(): Promise<TextLine[]> {
  const [es, nq, ym, rty] = await Promise.all([
    smartQuote("ES=F"),
    smartQuote("NQ=F"),
    smartQuote("YM=F"),
    smartQuote("RTY=F"),
  ]);

  const src = es?.source ?? nq?.source ?? "DLY";

  const lines: TextLine[] = [];
  lines.push({ text: `FUTURES ${src}`, y: 0, color: C.cyan, id: 0 });

  const items = [
    { label: "ES   ", q: es },
    { label: "NQ   ", q: nq },
    { label: "YM   ", q: ym },
    { label: "RTY  ", q: rty },
  ];

  let row = 0;
  for (const item of items) {
    if (item.q) {
      lines.push({
        text: `${item.label}${fmtPrice(item.q.last)}  ${fmtPct(item.q.changePercent)}`,
        y: 16 + row * 16, color: changeColor(item.q.changePercent), id: row + 1,
      });
      row++;
    }
  }

  if (row === 0) {
    lines.push({ text: "No futures data", y: 16, color: C.gray, id: 1 });
  }

  return lines;
}

// ─── Screen: SPY Daily Chart (5-day bars) ────────────────────

async function fetchDailyChart(): Promise<TextLine[]> {
  const bars = await getHistoricalBars("SPY", "5d", "1d").catch(() => []);

  const lines: TextLine[] = [];
  lines.push({ text: "SPY 5-DAY", y: 0, color: C.white, id: 0 });

  const recent = bars.slice(-5);
  for (let i = 0; i < recent.length; i++) {
    const bar = recent[i];
    const dayChange = ((bar.close - bar.open) / bar.open) * 100;
    const date = new Date(bar.time).toLocaleDateString("en-US", { month: "numeric", day: "numeric" });
    lines.push({
      text: `${date}  ${fmtPrice(bar.close)}  ${fmtPct(dayChange)}`,
      y: 16 + i * 16, color: changeColor(dayChange), id: i + 1,
    });
  }

  return lines;
}

// ─── Session-Aware Screen Registry ──────────────────────────

export function getScreens(session?: string): Screen[] {
  const s = session ?? currentSession();
  const ibkr = isConnected();

  // Core screens — always available (smartQuote handles IBKR/Yahoo routing)
  const core: Screen[] = [
    { name: "market-pulse", fetch: fetchMarketPulse },
    { name: "sectors", fetch: fetchSectors },
    { name: "trending", fetch: fetchTrending },
    { name: "news", fetch: fetchNews },
  ];

  // IBKR-only screens — added when TWS is connected
  const ibkrScreens: Screen[] = ibkr ? [
    { name: "account", fetch: fetchAccount },
    { name: "portfolio", fetch: fetchPortfolio },
    { name: "exposure", fetch: fetchExposure },
    { name: "indicators", fetch: fetchIndicators },
  ] : [
    { name: "portfolio", fetch: fetchPortfolio },
  ];

  const always = [...core, ...ibkrScreens];

  switch (s) {
    case "regular":
      return [
        ...always,
        { name: "top-gainers", fetch: fetchTopGainers },
        { name: "top-losers", fetch: fetchTopLosers },
        { name: "most-active", fetch: fetchMostActive },
      ];

    case "pre-market":
      return [
        ...always,
        { name: "futures", fetch: fetchFutures },
        { name: "prior-gainers", fetch: fetchTopGainers },
        { name: "prior-losers", fetch: fetchTopLosers },
      ];

    case "after-hours":
      return [
        ...always,
        { name: "futures", fetch: fetchFutures },
        { name: "prior-gainers", fetch: fetchTopGainers },
        { name: "most-active", fetch: fetchMostActive },
      ];

    case "closed":
    default:
      return [
        ...always,
        { name: "futures", fetch: fetchFutures },
        { name: "daily-chart", fetch: fetchDailyChart },
        { name: "prior-gainers", fetch: fetchTopGainers },
        { name: "prior-losers", fetch: fetchTopLosers },
      ];
  }
}

// ─── Scrolling Ticker (smartQuote) ──────────────────────────

export async function buildScrollingTicker(): Promise<{ text: string; color: string }> {
  const symbols = ["SPY", "QQQ", "DIA", "IWM", "AAPL", "MSFT", "NVDA", "TSLA"];
  const quotes = await Promise.all(symbols.map((s) => smartQuote(s)));

  const parts: string[] = [];
  for (const q of quotes) {
    if (q) parts.push(`${q.symbol} ${fmtPrice(q.last)} ${fmtPct(q.changePercent)}`);
  }

  return { text: parts.join("  |  "), color: C.white };
}
