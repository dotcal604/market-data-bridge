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

// ─── State ───────────────────────────────────────────────────

let registered = false;
let cachedJpeg: Buffer | null = null;
let lastRenderMs = 0;

function ensureRegistered(): void {
  if (registered) return;
  registerWidgets(allWidgets);
  registered = true;
}

// ─── Demo Layout ─────────────────────────────────────────────
// Static data for now — will be replaced with live market data feed

function buildDemoLayout(): Slot[] {
  return [
    {
      widget: "header",
      params: {
        session: "REGULAR",
        time: "10:42 ET",
        connections: [
          { label: "IBKR", ok: true },
          { label: "Yahoo", ok: true },
        ],
      },
    },
    {
      widget: "indices",
      params: {
        primary: [
          { sym: "SPY", val: "580.25", chg: "+0.48%", dir: 1 },
          { sym: "QQQ", val: "495.12", chg: "+0.72%", dir: 1 },
        ],
        secondary: [
          { sym: "DIA", val: "425.88", chg: "-0.15%", dir: -1 },
          { sym: "IWM", val: "198.45", chg: "+1.22%", dir: 1 },
          { sym: "VIX", val: "16.8", chg: "-4.2%", dir: -1 },
        ],
      },
    },
    {
      widget: "sparkline",
      params: {
        label: "SPY 1mo",
        data: [565, 568, 570, 567, 572, 575, 573, 578, 580, 576, 582, 585, 583, 579, 581, 580, 578, 580, 583, 580, 577, 580],
        color: "#00CCEE",
      },
    },
    {
      widget: "sparkline",
      params: {
        label: "QQQ 1mo",
        data: [480, 483, 486, 482, 488, 491, 489, 494, 496, 493, 498, 495, 497, 500, 502, 499, 501, 498, 496, 495, 493, 495],
        color: "#00DD55",
      },
    },
    { widget: "separator" },
    {
      widget: "sectors",
      params: {
        sectors: [
          { name: "TECH", chg: 1.8, leader: "NVDA" },
          { name: "HLTH", chg: 0.9, leader: "UNH" },
          { name: "FINL", chg: 0.3, leader: "JPM" },
          { name: "INDU", chg: 0.5, leader: "CAT" },
          { name: "CONS", chg: -0.2, leader: "AMZN" },
          { name: "ENER", chg: -1.1, leader: "XOM" },
          { name: "UTIL", chg: 0.1, leader: "NEE" },
          { name: "REAL", chg: -0.6, leader: "PLD" },
          { name: "MATL", chg: 0.4, leader: "LIN" },
          { name: "COMM", chg: 1.2, leader: "GOOGL" },
          { name: "STPL", chg: -0.3, leader: "PG" },
        ],
      },
    },
    { widget: "pnl" },
    { widget: "separator" },
    {
      widget: "movers",
      params: {
        title: "TOP MOVERS",
        movers: [
          { sym: "AAOI", chg: "+56.88%", price: "$84.23", dir: 1, vol: 8.2 },
          { sym: "BWIN", chg: "+25.64%", price: "$23.23", dir: 1, vol: 4.5 },
          { sym: "RUN",  chg: "-35.11%", price: "$13.25", dir: -1, vol: 6.1 },
          { sym: "FIGR", chg: "-25.73%", price: "$25.28", dir: -1, vol: 2.3 },
        ],
      },
    },
    {
      widget: "gauge",
      params: { label: "RSI (14)", value: 58, max: 100, color: "#00CCEE", icon: Ph.gauge },
    },
    {
      widget: "gauge",
      params: { label: "VIX", value: 17, max: 50, color: "#EEDD00", icon: Ph.warning },
    },
  ];
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
  const layout = buildDemoLayout();
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
