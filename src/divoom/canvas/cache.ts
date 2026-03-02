/**
 * Canvas Rendering Cache
 *
 * Pre-renders the full canvas dashboard to JPEG each updater cycle.
 * The REST route `/api/divoom/charts/canvas` serves the cached buffer.
 * The device fetches this JPEG via BackgroudImageAddr.
 *
 * On the transparent IPS panel: black pixels = LCD blocking = opaque,
 * colored/white pixels = LCD open = glowing. LIGHT_CONFIG uses white bg
 * for the bright glass aesthetic validated on device.
 */

import { registerWidgets, renderLayout } from "./engine.js";
import { allWidgets } from "./widgets.js";
import { LIGHT_CONFIG, Ph } from "./types.js";
import type { Slot, CanvasConfig } from "./types.js";
import {
  currentSession, sessionLabel, smartQuote, fetchSpyChartData,
  fetchSectorHeatmapData, fetchIndicatorValues, fmtPrice, fmtPct, fmtDollar,
} from "../screens.js";
import { getStatus } from "../../providers/status.js";
import { isConnected } from "../../ibkr/connection.js";
import { runScreener } from "../../providers/yahoo.js";
import { logger } from "../../logging.js";

const log = logger.child({ module: "canvas-cache" });

// ─── State ───────────────────────────────────────────────────

let registered = false;
let cachedJpeg: Buffer | null = null;
let lastRenderMs = 0;

function ensureRegistered(): void {
  if (registered) return;
  registerWidgets(allWidgets);
  registered = true;
}

// ─── Live Layout ─────────────────────────────────────────────
// Fetches real market data from IBKR (live) / Yahoo (delayed)

async function buildLiveLayout(): Promise<Slot[]> {
  const session = currentSession();
  const status = getStatus();
  const ibkr = isConnected();

  // Parallel fetch: indices, sparkline, sectors, movers, indicators, portfolio
  const [
    spyQ, qqqQ, diaQ, iwmQ, vixQ,
    spyChart,
    sectorData,
    indicators,
    gainers, losers,
    portfolioData,
  ] = await Promise.all([
    smartQuote("SPY").catch(() => null),
    smartQuote("QQQ").catch(() => null),
    smartQuote("DIA").catch(() => null),
    smartQuote("IWM").catch(() => null),
    smartQuote("^VIX").catch(() => null),
    fetchSpyChartData().catch(() => ({ prices: [] as number[], ticker: "SPY", timeframe: "1mo" })),
    fetchSectorHeatmapData().catch(() => []),
    fetchIndicatorValues().catch(() => ({ rsi: null, vix: null, volumeBars: [] })),
    session === "regular" ? runScreener("day_gainers", 3).catch(() => []) : Promise.resolve([]),
    session === "regular" ? runScreener("day_losers", 3).catch(() => []) : Promise.resolve([]),
    ibkr ? fetchPortfolioData().catch(() => null) : Promise.resolve(null),
  ]);

  const source = spyQ?.source ?? "DLY";

  // ── Build Slots ──

  const slots: Slot[] = [];

  // Header
  slots.push({
    widget: "header",
    params: {
      session: sessionLabel(session),
      time: status.easternTime,
      connections: [
        { label: "IBKR", ok: ibkr },
        { label: source, ok: true },
      ],
    },
  });

  // Indices
  const mkIdx = (sym: string, q: typeof spyQ) =>
    q ? { sym, val: fmtPrice(q.last), chg: fmtPct(q.changePercent), dir: q.changePercent >= 0 ? 1 : -1 }
      : { sym, val: "--", chg: "--", dir: 0 };

  slots.push({
    widget: "indices",
    params: {
      primary: [mkIdx("SPY", spyQ), mkIdx("QQQ", qqqQ)],
      secondary: [
        mkIdx("DIA", diaQ),
        mkIdx("IWM", iwmQ),
        vixQ
          ? { sym: "VIX", val: fmtPrice(vixQ.last), chg: fmtPct(vixQ.changePercent), dir: vixQ.changePercent <= 0 ? 1 : -1 }
          : { sym: "VIX", val: "--", chg: "--", dir: 0 },
      ],
    },
  });

  // Sparkline (SPY history)
  if (spyChart.prices.length >= 5) {
    slots.push({
      widget: "sparkline",
      params: { label: `${spyChart.ticker} ${spyChart.timeframe}`, data: spyChart.prices, color: "#00CCEE" },
    });
  }

  slots.push({ widget: "separator" });

  // Sectors (treemap)
  if (sectorData.length > 0) {
    slots.push({
      widget: "sectors",
      params: {
        sectors: sectorData.map(s => ({ name: s.label.toUpperCase(), chg: s.value })),
      },
    });
  }

  // PnL
  if (portfolioData) {
    slots.push({
      widget: "pnl",
      params: portfolioData,
    });
  }

  slots.push({ widget: "separator" });

  // Movers
  const movers: Array<{ sym: string; chg: string; price: string; dir: number; vol: number }> = [];
  for (const g of gainers.slice(0, 2)) {
    movers.push({
      sym: g.symbol,
      chg: fmtPct(g.changePercent ?? 0),
      price: `$${fmtPrice(g.last ?? 0)}`,
      dir: 1,
      vol: (g.volume ?? 0) / 1e6,
    });
  }
  for (const l of losers.slice(0, 2)) {
    movers.push({
      sym: l.symbol,
      chg: fmtPct(l.changePercent ?? 0),
      price: `$${fmtPrice(l.last ?? 0)}`,
      dir: -1,
      vol: (l.volume ?? 0) / 1e6,
    });
  }
  if (movers.length > 0) {
    slots.push({
      widget: "movers",
      params: { title: session === "regular" ? "TOP MOVERS" : "PRIOR MOVERS", movers },
    });
  }

  // Gauges — RSI + VIX
  if (indicators.rsi != null) {
    slots.push({
      widget: "gauge",
      params: { label: "RSI (14)", value: Math.round(indicators.rsi), max: 100, color: "#00CCEE", icon: Ph.gauge },
    });
  }
  if (indicators.vix != null) {
    slots.push({
      widget: "gauge",
      params: { label: "VIX", value: Math.round(indicators.vix), max: 50, color: "#EEDD00", icon: Ph.warning },
    });
  } else if (vixQ) {
    slots.push({
      widget: "gauge",
      params: { label: "VIX", value: Math.round(vixQ.last), max: 50, color: "#EEDD00", icon: Ph.warning },
    });
  }

  return slots;
}

/** Fetch portfolio P&L data from IBKR (returns canvas pnl widget params). */
async function fetchPortfolioData(): Promise<Record<string, unknown> | null> {
  try {
    const { getPnL, getPositions, getAccountSummary } = await import("../../ibkr/account.js");
    const [pnl, positions, acct] = await Promise.all([
      getPnL(), getPositions(), getAccountSummary().catch(() => null),
    ]);

    const dailyPnl = pnl.dailyPnL ?? 0;
    const netLiq = acct?.netLiquidation ?? 0;
    const grossPos = positions.reduce((s, p) => s + Math.abs(p.position * p.avgCost), 0);
    const deployedPct = netLiq > 0 ? Math.round((grossPos / netLiq) * 100) : 0;

    return {
      dayPnl: `${dailyPnl >= 0 ? "+" : ""}$${fmtDollar(Math.abs(dailyPnl))}`,
      dayDir: dailyPnl >= 0 ? 1 : -1,
      netValue: `$${fmtDollar(netLiq)}`,
      deployedPct: Math.min(deployedPct, 100),
      riskLevel: deployedPct > 80 ? "HIGH" : deployedPct > 50 ? "MED" : "LOW",
      riskPct: Math.min(deployedPct, 100),
    };
  } catch (err) {
    log.warn({ err }, "Failed to fetch portfolio for canvas");
    return null;
  }
}

// ─── Render & Cache ──────────────────────────────────────────

/**
 * Render the canvas dashboard and cache the JPEG.
 * Called once per updater cycle (~10s).
 */
export async function renderCanvasDashboard(
  config: CanvasConfig = LIGHT_CONFIG,
): Promise<Buffer> {
  ensureRegistered();

  const t0 = performance.now();
  const layout = await buildLiveLayout();
  const result = await renderLayout(layout, config);
  lastRenderMs = performance.now() - t0;

  cachedJpeg = result.jpeg;
  return cachedJpeg;
}

/**
 * Get the cached canvas JPEG. Returns null if not yet rendered.
 */
export function getCachedCanvasJpeg(): Buffer | null {
  return cachedJpeg;
}

/** Last render time in ms (for diagnostics) */
export function getLastRenderMs(): number {
  return lastRenderMs;
}
