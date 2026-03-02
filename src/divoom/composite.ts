/**
 * Composite Background Renderer — Top/Bottom Layout
 *
 * Renders a single 800×1280 JPEG served as BackgroudImageAddr.
 *
 * Layout:
 *   TOP  (0–splitY):     Pure black (transparent glass behind text elements)
 *   BOTTOM (splitY–1280): Live chart graphics (SPY sparkline, sector heatmap, volume bars, gauges)
 *
 * On the transparent IPS panel:
 *   - Black pixels = see-through glass
 *   - Dim colored pixels = semi-transparent (translucent glass)
 *   - Bright pixels = opaque glow (charts)
 *
 * Data is fetched live from screens.ts (Yahoo/IBKR) and cached for 20s.
 */

import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import sharp from "sharp";
import { logger } from "../logging.js";
import { getCompositeSettings } from "./config-store.js";
import {
  fetchSpyChartData,
  fetchSectorHeatmapData,
  fetchIndicatorValues,
} from "./screens.js";

const log = logger.child({ module: "divoom-composite" });

const W = 800;
const H = 1280;
const PAD = 12;
const CHART_W = W - PAD * 2; // 776px usable

/** Get current palette — reads from config store each render */
function getPalette() {
  const cfg = getCompositeSettings();
  return { bg: "#000000" as const, ...cfg.palette };
}

// ─── Drawing Helpers ─────────────────────────────────────────

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Draw a sparkline with fill and glow */
function drawSparkline(
  ctx: SKRSContext2D,
  data: number[],
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  opts: { fill?: boolean; glow?: boolean } = {},
) {
  if (data.length < 2) return;

  const { fill = true, glow = true } = opts;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const padY = h * 0.1;

  const points = data.map((v, i) => ({
    px: x + (i / (data.length - 1)) * w,
    py: y + padY + (1 - (v - min) / range) * (h - padY * 2),
  }));

  // Fill under curve
  if (fill) {
    ctx.beginPath();
    ctx.moveTo(points[0].px, y + h);
    for (const p of points) ctx.lineTo(p.px, p.py);
    ctx.lineTo(points[points.length - 1].px, y + h);
    ctx.closePath();
    ctx.fillStyle = hexToRgba(color, 0.25);
    ctx.fill();
  }

  // Glow
  if (glow) {
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(points[0].px, points[0].py);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].px, points[i].py);
    ctx.stroke();
    ctx.restore();
  }

  // Main line
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(points[0].px, points[0].py);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].px, points[i].py);
  ctx.stroke();
}

/** Draw a bar chart */
function drawBars(
  ctx: SKRSContext2D,
  data: Array<{ value: number; color: string; label?: string }>,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  if (data.length === 0) return;

  const maxVal = Math.max(...data.map((d) => Math.abs(d.value)), 1);
  const barW = Math.max(8, (w / data.length) - 4);
  const gap = 4;

  for (let i = 0; i < data.length; i++) {
    const d = data[i];
    const barH = (Math.abs(d.value) / maxVal) * h * 0.85;
    const bx = x + i * (barW + gap);
    const by = y + h - barH;

    ctx.fillStyle = hexToRgba(d.color, 0.7);
    ctx.fillRect(bx, by, barW, barH);

    // Bright top edge
    ctx.fillStyle = hexToRgba(d.color, 0.9);
    ctx.fillRect(bx, by, barW, 2);

    // Label below bar
    if (d.label) {
      ctx.font = "bold 14px sans-serif";
      ctx.fillStyle = hexToRgba(getPalette().white, 0.6);
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(d.label, bx + barW / 2, y + h + 2);
      ctx.textAlign = "left";
    }
  }
}

/** Draw a horizontal gauge bar */
function drawGaugeBar(
  ctx: SKRSContext2D,
  value: number,
  min: number,
  max: number,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  color: string,
) {
  // Track background
  const p = getPalette();
  ctx.fillStyle = hexToRgba(p.white, 0.1);
  ctx.fillRect(x, y, w, h);

  // Fill bar
  const pct = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const barW = pct * w;
  ctx.fillStyle = hexToRgba(color, 0.5);
  ctx.fillRect(x, y, barW, h);

  // Bright edge
  ctx.fillStyle = hexToRgba(color, 0.8);
  ctx.fillRect(x + barW - 2, y, 2, h);

  // Label
  ctx.font = "bold 14px monospace";
  ctx.fillStyle = hexToRgba(p.white, 0.5);
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + 6, y + h / 2);

  // Value
  ctx.textAlign = "right";
  ctx.fillStyle = color;
  ctx.fillText(value.toFixed(1), x + w - 6, y + h / 2);
  ctx.textAlign = "left";
}

/** Draw a sector heatmap grid */
function drawHeatmapGrid(
  ctx: SKRSContext2D,
  cells: Array<{ label: string; value: number }>,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const p = getPalette();
  const cols = Math.min(cells.length, 5);
  const rows = Math.ceil(cells.length / cols);
  const cellW = (w - 4) / cols;
  const cellH = (h - 4) / rows;
  const gap = 3;

  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    const col = i % cols;
    const row = Math.floor(i / cols);
    const cx = x + 2 + col * cellW;
    const cy = y + 2 + row * cellH;

    const intensity = Math.min(Math.abs(cell.value) / 3, 1);
    const color = cell.value >= 0 ? p.green : p.red;

    ctx.fillStyle = hexToRgba(color, 0.2 + intensity * 0.5);
    ctx.fillRect(cx + gap / 2, cy + gap / 2, cellW - gap, cellH - gap);

    // Label
    ctx.font = "bold 16px sans-serif";
    ctx.fillStyle = hexToRgba(p.white, 0.8);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(cell.label, cx + cellW / 2, cy + cellH / 2 - 10);

    // Value
    ctx.font = "14px sans-serif";
    ctx.fillStyle = hexToRgba(color, 0.9);
    const sign = cell.value >= 0 ? "+" : "";
    ctx.fillText(`${sign}${cell.value.toFixed(1)}%`, cx + cellW / 2, cy + cellH / 2 + 10);
  }
  ctx.textAlign = "left";
}

/** Draw a section header label */
function drawSectionLabel(
  ctx: SKRSContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
) {
  ctx.font = "bold 16px sans-serif";
  ctx.fillStyle = hexToRgba(color, 0.7);
  ctx.textBaseline = "top";
  ctx.fillText(text, x, y);

  // Accent underline
  const metrics = ctx.measureText(text);
  ctx.fillStyle = hexToRgba(color, 0.3);
  ctx.fillRect(x, y + 20, metrics.width, 1);
}

// ─── Live Data Types ─────────────────────────────────────────

interface ChartData {
  spyPrices: number[];
  /** Label for sparkline section, e.g. "PLTR 1mo" */
  sparklineLabel: string;
  sectorHeatmap: Array<{ label: string; value: number }>;
  rsi: number | null;
  vix: number | null;
  volumeBars: Array<{ label: string; volume: number; change: number }>;
}

/** Fetch all chart data in parallel from live market sources */
async function fetchChartData(): Promise<ChartData> {
  const [spyChart, sectorHeatmap, indicators] = await Promise.all([
    fetchSpyChartData(),
    fetchSectorHeatmapData(),
    fetchIndicatorValues(),
  ]);

  return {
    spyPrices: spyChart.prices,
    sparklineLabel: `${spyChart.ticker} ${spyChart.timeframe}`,
    sectorHeatmap,
    rsi: indicators.rsi,
    vix: indicators.vix,
    volumeBars: indicators.volumeBars,
  };
}

// ─── Main Composite Renderer ─────────────────────────────────

export interface CompositeOpts {
  quality?: number;
  /** Top-zone tint brightness 0–100 (default 0 = pure black/transparent). */
  tintBrightness?: number;
  /** Top-zone tint hex color override (default: neutral gray from brightness). */
  tintColor?: string;
  /** Y position where text zone ends and chart zone begins (default 740). */
  splitY?: number;
}

/**
 * Render the top/bottom 800×1280 composite background image.
 *
 * Top zone (0 to splitY): solid tint fill → translucent glass behind text.
 * Bottom zone (splitY to 1280): live chart graphics.
 *
 * Returns a JPEG Buffer ready for BackgroudImageAddr.
 */
export async function renderComposite(
  opts: CompositeOpts = {},
): Promise<Buffer> {
  const t0 = Date.now();

  // ── Read config store for defaults; opts override ──
  const cfg = getCompositeSettings();
  const palette = { bg: "#000000" as const, ...cfg.palette };

  const quality = opts.quality ?? cfg.jpegQuality;
  const tintBrightness = opts.tintBrightness ?? 0;
  const splitY = opts.splitY ?? cfg.splitY;

  // ── Fetch live market data ──
  let data: ChartData;
  try {
    data = await fetchChartData();
  } catch (err) {
    log.warn({ err }, "Live data fetch failed — rendering with empty charts");
    data = { spyPrices: [], sparklineLabel: "", sectorHeatmap: [], rsi: null, vix: null, volumeBars: [] };
  }

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  // ── Base: solid black (transparent on IPS) ──
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, W, H);

  // ── Top zone: translucent glass tint ──
  const tint = opts.tintColor ?? neutralTint(tintBrightness);
  ctx.fillStyle = tint;
  ctx.fillRect(0, 0, W, splitY);

  // ── Bottom zone: live chart graphics ──
  // Clip to prevent glow/shadow bleed into the text zone above splitY
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, splitY, W, H - splitY);
  ctx.clip();

  const chartY = splitY + 8; // small gap below text
  let cursor = chartY;

  // Section 1: SPY Sparkline
  if (cfg.sections.sparkline.enabled) {
    const sparkH = cfg.sections.sparkline.height;
    drawSectionLabel(ctx, data.sparklineLabel, PAD, cursor, palette.cyan);
    cursor += 24;
    if (data.spyPrices.length >= 2) {
      // Determine color from overall direction
      const first = data.spyPrices[0];
      const last = data.spyPrices[data.spyPrices.length - 1];
      const sparkColor = last >= first ? palette.green : palette.red;
      drawSparkline(ctx, data.spyPrices, PAD, cursor, CHART_W, sparkH - 24, sparkColor);

      // Horizontal reference lines
      ctx.setLineDash([3, 6]);
      ctx.strokeStyle = hexToRgba(palette.cyan, 0.2);
      ctx.lineWidth = 0.5;
      for (let i = 1; i <= 3; i++) {
        const ly = cursor + ((sparkH - 24) / 4) * i;
        ctx.beginPath();
        ctx.moveTo(PAD, ly);
        ctx.lineTo(PAD + CHART_W, ly);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    cursor += sparkH - 24 + 16;
  }

  // Section 2: Sector Heatmap
  if (cfg.sections.heatmap.enabled) {
    const hmH = cfg.sections.heatmap.height;
    if (data.sectorHeatmap.length > 0) {
      drawSectionLabel(ctx, "SECTORS", PAD, cursor, palette.orange);
      cursor += 24;
      drawHeatmapGrid(ctx, data.sectorHeatmap, PAD, cursor, CHART_W, hmH - 24);
      cursor += hmH - 24 + 16;
    }
  }

  // Section 3: Volume Bars
  if (cfg.sections.volume.enabled) {
    if (data.volumeBars.length > 0) {
      drawSectionLabel(ctx, "VOLUME", PAD, cursor, palette.magenta);
      cursor += 24;
      const volBarData = data.volumeBars.map((b) => ({
        value: b.volume,
        color: b.change >= 0 ? palette.green : palette.red,
        label: b.label,
      }));
      drawBars(ctx, volBarData, PAD, cursor, CHART_W, 80);
      cursor += 80 + 24; // extra for labels below bars
    }
  }

  // Section 4: RSI & VIX gauges (side by side)
  if (cfg.sections.gauges.enabled) {
    if (data.rsi !== null || data.vix !== null) {
      const gaugeW = (CHART_W - 12) / 2;
      if (data.rsi !== null) {
        const rsiColor = data.rsi > 70 ? palette.red : data.rsi < 30 ? palette.green : palette.cyan;
        drawGaugeBar(ctx, data.rsi, 0, 100, PAD, cursor, gaugeW, 24, "RSI", rsiColor);
      }
      if (data.vix !== null) {
        const vixColor = data.vix > 25 ? palette.red : data.vix > 18 ? palette.yellow : palette.green;
        drawGaugeBar(ctx, data.vix, 0, 50, PAD + gaugeW + 12, cursor, gaugeW, 24, "VIX", vixColor);
      }
      cursor += 32;
    }
  }

  // Restore full canvas (remove chart zone clip)
  ctx.restore();

  // ── Encode to JPEG via sharp ──
  const pngBuf = canvas.toBuffer("image/png");
  const jpegBuf = await sharp(pngBuf)
    .jpeg({ quality, mozjpeg: true })
    .toBuffer();

  log.info({
    size: jpegBuf.length,
    ms: Date.now() - t0,
    splitY,
    spy: data.spyPrices.length,
    sectors: data.sectorHeatmap.length,
    volume: data.volumeBars.length,
    rsi: data.rsi,
    vix: data.vix,
  }, "Top/bottom composite rendered");

  return jpegBuf;
}

/** Convert brightness (0–100) to a neutral gray hex string */
function neutralTint(brightness: number): string {
  const v = Math.round((Math.max(0, Math.min(100, brightness)) / 100) * 255);
  const hex = v.toString(16).padStart(2, "0");
  return `#${hex}${hex}${hex}`;
}

// ─── Cache ───────────────────────────────────────────────────

let cachedComposite: { buffer: Buffer; at: number } | null = null;

export async function getCachedComposite(
  opts?: CompositeOpts,
): Promise<Buffer> {
  const now = Date.now();
  const cfg = getCompositeSettings();
  if (cachedComposite && now - cachedComposite.at < cfg.cacheTtlMs) {
    return cachedComposite.buffer;
  }

  const buffer = await renderComposite(opts);
  cachedComposite = { buffer, at: now };
  return buffer;
}

export function clearCompositeCache(): void {
  cachedComposite = null;
}
