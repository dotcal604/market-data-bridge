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
  currentSession, sessionLabel, smartQuote,
  fetchSectorHeatmapData, fetchIndicatorValues, fmtPrice, fmtPct, fmtDollar,
} from "../screens.js";
import { getStatus } from "../../providers/status.js";
import { isConnected } from "../../ibkr/connection.js";
import { runScreener, getHistoricalBars } from "../../providers/yahoo.js";
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

  // Parallel fetch: indices, sparklines (SPY+QQQ), sectors, movers, indicators, portfolio
  const [
    spyQ, qqqQ, diaQ, iwmQ, vixQ,
    spyBars, qqqBars,
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
    getHistoricalBars("SPY", "1mo", "1d").catch(() => []),
    getHistoricalBars("QQQ", "1mo", "1d").catch(() => []),
    fetchSectorHeatmapData().catch(() => []),
    fetchIndicatorValues().catch(() => ({ rsi: null, vix: null, volumeBars: [] })),
    runScreener("day_gainers", 3).catch(() => []),
    runScreener("day_losers", 3).catch(() => []),
    ibkr ? fetchPortfolioData().catch(() => null) : Promise.resolve(null),
  ]);

  // Extract close prices for sparklines
  const spyPrices = spyBars.map((b: any) => b.close).filter((v: any): v is number => v != null);
  const qqqPrices = qqqBars.map((b: any) => b.close).filter((v: any): v is number => v != null);

  const source = spyQ?.source ?? "DLY";

  // Short time: "3:05 PM ET" instead of full locale string
  const shortTime = new Date().toLocaleString("en-US", {
    hour: "numeric", minute: "2-digit", hour12: true,
    timeZone: "America/New_York",
  }) + " ET";

  // ── Build Slots ──
  // Grid: 10 rows × 4 cols. Slot h overrides pack content tightly.
  // Layout: header(1) + indices(1) + sparkline+sectors(3) + pnl(1) + movers(3) + gauges(1) = 10

  const slots: Slot[] = [];

  // Header — 1 row
  slots.push({
    widget: "header",
    params: {
      session: sessionLabel(session),
      time: shortTime,
      connections: [
        { label: "IBKR", ok: ibkr },
        { label: source, ok: true },
      ],
    },
  });

  // Indices — 1 row (override from default h:2)
  const mkIdx = (sym: string, q: typeof spyQ) =>
    q ? { sym, val: fmtPrice(q.last), chg: fmtPct(q.changePercent), dir: q.changePercent >= 0 ? 1 : -1 }
      : { sym, val: "--", chg: "--", dir: 0 };

  slots.push({
    widget: "indices",
    h: 1,
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

  // Sparklines — SPY + QQQ side by side (w:2 h:2 each — compact charts)
  if (spyPrices.length >= 5) {
    slots.push({
      widget: "sparkline",
      h: 2,
      params: { label: "SPY 1mo", data: spyPrices, color: "#00CCEE" },
    });
  }
  if (qqqPrices.length >= 5) {
    slots.push({
      widget: "sparkline",
      h: 2,
      params: { label: "QQQ 1mo", data: qqqPrices, color: "#BB66FF" },
    });
  }

  // Sectors (w:2 h:2) + PnL (w:2 h:2) — side by side
  if (sectorData.length > 0) {
    slots.push({
      widget: "sectors",
      h: 2,
      params: {
        sectors: sectorData
          .map(s => ({ name: s.label.toUpperCase(), chg: s.value }))
          .sort((a, b) => Math.abs(b.chg) - Math.abs(a.chg))
          .slice(0, 5),
      },
    });
  }
  if (portfolioData) {
    slots.push({
      widget: "pnl",
      params: portfolioData,
    });
  } else {
    // Placeholder PnL when IBKR disconnected — keeps layout full
    slots.push({
      widget: "pnl",
      params: {
        dayPnl: "—", dayDir: 0,
        netValue: "—",
        deployedPct: 0, riskLevel: "—", riskPct: 0,
      },
    });
  }

  // Movers — 2 rows (tight pack; 4 items ≈ 220px fits in 2 cells)
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
      h: 2,
      params: {
        title: session === "regular" ? "TOP MOVERS"
          : session === "after-hours" ? "AFTER HOURS"
          : session === "pre-market" ? "PRE-MARKET"
          : "PRIOR SESSION",
        movers,
      },
    });
  }

  // Gauges — RSI + VIX, side by side (1 row)
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
      getPnL().catch(() => null),
      getPositions().catch(() => []),
      getAccountSummary().catch(() => null),
    ]);

    const dailyPnl = pnl?.dailyPnL ?? 0;
    const netLiq = acct?.netLiquidation ?? 0;
    const grossPos = (positions as any[]).reduce((s, p) => s + Math.abs(p.position * p.avgCost), 0);
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

  // Adaptive grid: compute rows from actual slot content
  const cols = config.columns;
  let rowCursor = 0;
  let colCursor = 0;
  for (const slot of layout) {
    const def = allWidgets.find(w => w.id === slot.widget);
    const sw = Math.min(slot.w ?? def?.gridSize.w ?? cols, cols);
    const sh = slot.h ?? def?.gridSize.h ?? 1;
    if (colCursor + sw > cols) { colCursor = 0; rowCursor += 1; }
    // Side-by-side widgets share the same row band
    colCursor += sw;
    if (colCursor >= cols) {
      rowCursor += sh;
      colCursor = 0;
    } else {
      // Still in same row — height contributes when row completes
      // (handled implicitly: next full-width widget advances past it)
      rowCursor += 0; // peer will fill adjacent cols
    }
  }
  // If last row wasn't closed, add its height
  if (colCursor > 0) {
    const lastSlot = layout[layout.length - 1];
    const lastDef = allWidgets.find(w => w.id === lastSlot?.widget);
    rowCursor += lastSlot?.h ?? lastDef?.gridSize.h ?? 1;
  }
  const adaptiveRows = Math.max(rowCursor, 6); // floor at 6 to avoid huge cells
  log.info({ adaptiveRows, rowCursor, slotCount: layout.length, slots: layout.map(s => `${s.widget}(w:${s.w ?? '?'},h:${s.h ?? '?'})`) }, "canvas adaptive grid");
  const effectiveConfig = { ...config, rows: adaptiveRows };

  const result = await renderLayout(layout, effectiveConfig);
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
