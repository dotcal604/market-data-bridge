/**
 * Divoom Market Data Screens
 *
 * Rotating screens for the Divoom TimeFrame display.
 * Each screen fetches its own data and returns TextLine[] for rendering.
 */

import type { TextLine } from "./display.js";
import { getQuote, runScreener, getTrendingSymbols } from "../providers/yahoo.js";
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

function arrow(change: number): string {
  return change >= 0 ? "+" : "";
}

function changeColor(change: number): string {
  if (change > 0) return C.green;
  if (change < 0) return C.red;
  return C.gray;
}

function fmtPrice(price: number): string {
  return price >= 1000 ? price.toFixed(1) : price.toFixed(2);
}

function fmtPct(pct: number): string {
  return `${arrow(pct)}${pct.toFixed(2)}%`;
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

  // Fetch indices in parallel
  const [spy, qqq, dia, iwm, vix] = await Promise.all([
    getQuote("SPY").catch(() => null),
    getQuote("QQQ").catch(() => null),
    getQuote("DIA").catch(() => null),
    getQuote("IWM").catch(() => null),
    getQuote("^VIX").catch(() => null),
  ]);

  const lines: TextLine[] = [];
  let y = 0;

  // Header
  lines.push({ text: `${sessionLabel(session)}  ${time}`, y, color: C.cyan, id: 0 });
  y += 16;

  // SPY
  if (spy) {
    const pct = spy.changePercent ?? 0;
    lines.push({
      text: `SPY  ${fmtPrice(spy.last ?? 0)}  ${fmtPct(pct)}`,
      y, color: changeColor(pct), id: 1,
    });
  }
  y += 16;

  // QQQ
  if (qqq) {
    const pct = qqq.changePercent ?? 0;
    lines.push({
      text: `QQQ  ${fmtPrice(qqq.last ?? 0)}  ${fmtPct(pct)}`,
      y, color: changeColor(pct), id: 2,
    });
  }
  y += 16;

  // DIA
  if (dia) {
    const pct = dia.changePercent ?? 0;
    lines.push({
      text: `DIA  ${fmtPrice(dia.last ?? 0)}  ${fmtPct(pct)}`,
      y, color: changeColor(pct), id: 3,
    });
  }
  y += 16;

  // IWM
  if (iwm) {
    const pct = iwm.changePercent ?? 0;
    lines.push({
      text: `IWM  ${fmtPrice(iwm.last ?? 0)}  ${fmtPct(pct)}`,
      y, color: changeColor(pct), id: 4,
    });
  }
  y += 16;

  // VIX
  if (vix) {
    const vixLevel = vix.last ?? 0;
    const vixColor = vixLevel > 25 ? C.red : vixLevel > 18 ? C.orange : C.green;
    lines.push({
      text: `VIX  ${fmtPrice(vixLevel)}`,
      y, color: vixColor, id: 5,
    });
  }

  return lines;
}

// ─── Screen: Top Gainers ────────────────────────────────────

async function fetchTopGainers(): Promise<TextLine[]> {
  const results = await runScreener("day_gainers", 6).catch(() => []);

  const lines: TextLine[] = [];
  lines.push({ text: "TOP GAINERS", y: 0, color: C.green, id: 0 });

  for (let i = 0; i < Math.min(results.length, 5); i++) {
    const r = results[i];
    const pct = r.changePercent ?? 0;
    const sym = r.symbol.padEnd(6, " ");
    lines.push({
      text: `${sym}${fmtPct(pct)}  ${fmtPrice(r.last ?? 0)}`,
      y: 16 + i * 16,
      color: C.green,
      id: i + 1,
    });
  }

  return lines;
}

// ─── Screen: Top Losers ─────────────────────────────────────

async function fetchTopLosers(): Promise<TextLine[]> {
  const results = await runScreener("day_losers", 6).catch(() => []);

  const lines: TextLine[] = [];
  lines.push({ text: "TOP LOSERS", y: 0, color: C.red, id: 0 });

  for (let i = 0; i < Math.min(results.length, 5); i++) {
    const r = results[i];
    const pct = r.changePercent ?? 0;
    const sym = r.symbol.padEnd(6, " ");
    lines.push({
      text: `${sym}${fmtPct(pct)}  ${fmtPrice(r.last ?? 0)}`,
      y: 16 + i * 16,
      color: C.red,
      id: i + 1,
    });
  }

  return lines;
}

// ─── Screen: Most Active ────────────────────────────────────

async function fetchMostActive(): Promise<TextLine[]> {
  const results = await runScreener("most_actives", 6).catch(() => []);

  const lines: TextLine[] = [];
  lines.push({ text: "MOST ACTIVE", y: 0, color: C.yellow, id: 0 });

  for (let i = 0; i < Math.min(results.length, 5); i++) {
    const r = results[i];
    const pct = r.changePercent ?? 0;
    const sym = r.symbol.padEnd(6, " ");
    const v = r.volume ?? 0;
    const vol = v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : `${(v / 1e3).toFixed(0)}K`;
    lines.push({
      text: `${sym}${fmtPct(pct)}  ${vol}`,
      y: 16 + i * 16,
      color: changeColor(pct),
      id: i + 1,
    });
  }

  return lines;
}

// ─── Screen: Sector Performance ─────────────────────────────

const SECTOR_ETFS = [
  { symbol: "XLK", label: "Tech " },
  { symbol: "XLF", label: "Fin  " },
  { symbol: "XLE", label: "Engy " },
  { symbol: "XLV", label: "Hlth " },
  { symbol: "XLY", label: "Cons " },
] as const;

async function fetchSectors(): Promise<TextLine[]> {
  const quotes = await Promise.all(
    SECTOR_ETFS.map((s) => getQuote(s.symbol).catch(() => null)),
  );

  const lines: TextLine[] = [];
  lines.push({ text: "SECTORS", y: 0, color: C.blue, id: 0 });

  for (let i = 0; i < SECTOR_ETFS.length; i++) {
    const q = quotes[i];
    const sector = SECTOR_ETFS[i];
    if (q) {
      const pct = q.changePercent ?? 0;
      lines.push({
        text: `${sector.label}${sector.symbol}  ${fmtPct(pct)}`,
        y: 16 + i * 16,
        color: changeColor(pct),
        id: i + 1,
      });
    }
  }

  return lines;
}

// ─── Screen: Portfolio (IBKR only) ─────────────────────────

async function fetchPortfolio(): Promise<TextLine[]> {
  if (!isConnected()) {
    return [
      { text: "PORTFOLIO", y: 0, color: C.magenta, id: 0 },
      { text: "IBKR Disconnected", y: 16, color: C.gray, id: 1 },
      { text: "Start TWS to view", y: 32, color: C.gray, id: 2 },
    ];
  }

  try {
    const { getPnL } = await import("../ibkr/account.js");
    const { getPositions } = await import("../ibkr/account.js");
    const { queryHollyAlerts } = await import("../db/database.js");

    const [pnl, positions, alerts] = await Promise.all([
      getPnL(),
      getPositions(),
      Promise.resolve(queryHollyAlerts({ limit: 1 })),
    ]);

    const lines: TextLine[] = [];
    const dailyPnl = pnl.dailyPnL ?? 0;
    const pnlColor = dailyPnl >= 0 ? C.green : C.red;
    const pnlSign = dailyPnl >= 0 ? "+" : "";
    const pnlText = dailyPnl >= 0
      ? `${pnlSign}$${dailyPnl.toFixed(2)}`
      : `-$${Math.abs(dailyPnl).toFixed(2)}`;

    lines.push({ text: "PORTFOLIO", y: 0, color: C.magenta, id: 0 });
    lines.push({ text: `PnL: ${pnlText}`, y: 16, color: pnlColor, id: 1 });
    lines.push({ text: `Positions: ${positions.length}`, y: 32, color: C.cyan, id: 2 });

    // Show top positions
    for (let i = 0; i < Math.min(positions.length, 2); i++) {
      const p = positions[i];
      lines.push({
        text: `${p.symbol} ${p.position}@${p.avgCost.toFixed(2)}`,
        y: 48 + i * 16,
        color: C.white,
        id: 3 + i,
      });
    }

    // Holly alert
    if (alerts.length > 0) {
      const alert = alerts[0];
      lines.push({
        text: `Holly: ${alert.symbol} @${Number(alert.entry_price).toFixed(2)}`,
        y: positions.length >= 2 ? 80 : 48 + Math.min(positions.length, 2) * 16,
        color: C.magenta,
        id: 7,
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

// ─── Screen: Trending / Scrolling Ticker ────────────────────

async function fetchTrending(): Promise<TextLine[]> {
  const trending = await getTrendingSymbols().catch(() => []);
  const top = trending.slice(0, 8);

  // Fetch quotes for trending symbols in parallel
  const quotes = await Promise.all(
    top.map((t) => getQuote(t.symbol).catch(() => null)),
  );

  const lines: TextLine[] = [];
  lines.push({ text: "TRENDING", y: 0, color: C.orange, id: 0 });

  for (let i = 0; i < Math.min(quotes.length, 5); i++) {
    const q = quotes[i];
    if (q) {
      const pct = q.changePercent ?? 0;
      const sym = q.symbol.padEnd(6, " ");
      lines.push({
        text: `${sym}${fmtPrice(q.last ?? 0)}  ${fmtPct(pct)}`,
        y: 16 + i * 16,
        color: changeColor(pct),
        id: i + 1,
      });
    }
  }

  return lines;
}

// ─── Screen Registry ────────────────────────────────────────

export function getScreens(): Screen[] {
  return [
    { name: "market-pulse", fetch: fetchMarketPulse },
    { name: "top-gainers", fetch: fetchTopGainers },
    { name: "top-losers", fetch: fetchTopLosers },
    { name: "most-active", fetch: fetchMostActive },
    { name: "sectors", fetch: fetchSectors },
    { name: "portfolio", fetch: fetchPortfolio },
    { name: "trending", fetch: fetchTrending },
  ];
}

// ─── Scrolling Ticker Builder ───────────────────────────────

export async function buildScrollingTicker(): Promise<{ text: string; color: string }> {
  const symbols = ["SPY", "QQQ", "DIA", "IWM", "AAPL", "MSFT", "NVDA", "TSLA"];
  const quotes = await Promise.all(
    symbols.map((s) => getQuote(s).catch(() => null)),
  );

  const parts: string[] = [];
  for (const q of quotes) {
    if (q) {
      const pct = q.changePercent ?? 0;
      parts.push(`${q.symbol} ${fmtPrice(q.last ?? 0)} ${fmtPct(pct)}`);
    }
  }

  return { text: parts.join("  |  "), color: C.white };
}
