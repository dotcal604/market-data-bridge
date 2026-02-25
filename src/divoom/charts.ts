/**
 * Divoom Chart Renderer
 *
 * Server-side chart generation for the TimesFrame display.
 * Two rendering engines:
 *   1. @napi-rs/canvas — custom HUD-style graphics (sparklines, gauges, heatmaps)
 *   2. chartjs-node-canvas — standard chart types (line, bar, candlestick)
 *
 * All charts render to PNG Buffer, served via REST endpoints
 * and referenced by Image elements in the TimesFrame layout.
 */

import { createCanvas, type Canvas } from "@napi-rs/canvas";
import { ChartJSNodeCanvas } from "chartjs-node-canvas";
import { logger } from "../logging.js";

const log = logger.child({ module: "divoom-charts" });

// ─── Shared Constants ───────────────────────────────────────

const COLORS = {
  green: "#00FF00",
  red: "#FF0000",
  cyan: "#00FFFF",
  yellow: "#FFFF00",
  orange: "#FF8800",
  magenta: "#FF00FF",
  white: "#FFFFFF",
  gray: "#808080",
  dimGray: "#404040",
  bg: "#0A0A0A",
  bgCard: "#141414",
  gridLine: "#1E1E1E",
  glow: "rgba(0, 255, 255, 0.15)",
} as const;

// ─── Chart.js Renderer (singleton) ──────────────────────────

let chartRenderer: ChartJSNodeCanvas | null = null;

function getChartRenderer(width: number, height: number): ChartJSNodeCanvas {
  // Create new renderer for requested dimensions
  // ChartJSNodeCanvas caches internally
  // IMPORTANT: Divoom device does NOT composite alpha — must use opaque background
  return new ChartJSNodeCanvas({
    width,
    height,
    backgroundColour: COLORS.bg,
  });
}

/** Fill canvas with opaque dark background — Divoom device ignores alpha channel */
function fillBackground(ctx: ReturnType<Canvas["getContext"]>, w: number, h: number): void {
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, w, h);
}

// ─── Types ──────────────────────────────────────────────────

export interface SparklineOptions {
  width?: number;
  height?: number;
  lineColor?: string;
  fillColor?: string;
  lineWidth?: number;
  showDots?: boolean;
  glowEffect?: boolean;
}

export interface GaugeOptions {
  width?: number;
  height?: number;
  min?: number;
  max?: number;
  zones?: Array<{ from: number; to: number; color: string }>;
  label?: string;
}

export interface MiniCandleOptions {
  width?: number;
  height?: number;
  upColor?: string;
  downColor?: string;
  wickColor?: string;
}

export interface HeatmapCell {
  label: string;
  value: number; // change percent
}

export interface BarChartOptions {
  width?: number;
  height?: number;
  barColor?: string | ((value: number) => string);
  showLabels?: boolean;
}

export interface OHLC {
  open: number;
  high: number;
  low: number;
  close: number;
}

// ─── 1. Sparkline (@napi-rs/canvas) ─────────────────────────

export async function renderSparkline(
  data: number[],
  options: SparklineOptions = {},
): Promise<Buffer> {
  const {
    width = 380,
    height = 100,
    lineColor = COLORS.cyan,
    fillColor = "rgba(0, 255, 255, 0.08)",
    lineWidth = 2.5,
    showDots = false,
    glowEffect = true,
  } = options;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  fillBackground(ctx, width, height);

  if (data.length < 2) {
    return canvas.toBuffer("image/png");
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const padY = height * 0.08;

  const points = data.map((v, i) => ({
    x: (i / (data.length - 1)) * width,
    y: padY + (1 - (v - min) / range) * (height - padY * 2),
  }));

  // Fill gradient under the line
  ctx.beginPath();
  ctx.moveTo(points[0].x, height);
  for (const p of points) ctx.lineTo(p.x, p.y);
  ctx.lineTo(points[points.length - 1].x, height);
  ctx.closePath();
  ctx.fillStyle = fillColor;
  ctx.fill();

  // Glow effect
  if (glowEffect) {
    ctx.save();
    ctx.shadowColor = lineColor;
    ctx.shadowBlur = 8;
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = lineWidth + 1;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    ctx.stroke();
    ctx.restore();
  }

  // Main line
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.stroke();

  // End dot
  if (showDots && points.length > 0) {
    const last = points[points.length - 1];
    ctx.beginPath();
    ctx.arc(last.x, last.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = lineColor;
    ctx.fill();
  }

  return canvas.toBuffer("image/png");
}

// ─── 2. Arc Gauge (@napi-rs/canvas) ─────────────────────────

export async function renderGauge(
  value: number,
  options: GaugeOptions = {},
): Promise<Buffer> {
  const {
    width = 200,
    height = 120,
    min = 0,
    max = 100,
    zones = [
      { from: 0, to: 30, color: COLORS.green },
      { from: 30, to: 70, color: COLORS.yellow },
      { from: 70, to: 100, color: COLORS.red },
    ],
    label,
  } = options;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  fillBackground(ctx, width, height);

  const cx = width / 2;
  const cy = height * 0.85;
  const radius = Math.min(width / 2, height) * 0.75;
  const startAngle = Math.PI;
  const endAngle = 2 * Math.PI;
  const arcWidth = 12;

  // Draw zone arcs
  for (const zone of zones) {
    const zoneStart = startAngle + ((zone.from - min) / (max - min)) * Math.PI;
    const zoneEnd = startAngle + ((zone.to - min) / (max - min)) * Math.PI;

    ctx.beginPath();
    ctx.arc(cx, cy, radius, zoneStart, zoneEnd);
    ctx.strokeStyle = zone.color;
    ctx.lineWidth = arcWidth;
    ctx.lineCap = "butt";
    ctx.globalAlpha = 0.3;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // Draw active arc up to value
  const clampedValue = Math.max(min, Math.min(max, value));
  const valueAngle = startAngle + ((clampedValue - min) / (max - min)) * Math.PI;
  const activeColor = zones.find((z) => clampedValue >= z.from && clampedValue <= z.to)?.color ?? COLORS.white;

  ctx.beginPath();
  ctx.arc(cx, cy, radius, startAngle, valueAngle);
  ctx.strokeStyle = activeColor;
  ctx.lineWidth = arcWidth;
  ctx.lineCap = "round";

  // Glow
  ctx.save();
  ctx.shadowColor = activeColor;
  ctx.shadowBlur = 10;
  ctx.stroke();
  ctx.restore();
  ctx.stroke();

  // Needle
  const needleLength = radius - arcWidth;
  const nx = cx + Math.cos(valueAngle) * needleLength;
  const ny = cy + Math.sin(valueAngle) * needleLength;

  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(nx, ny);
  ctx.strokeStyle = COLORS.white;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Center dot
  ctx.beginPath();
  ctx.arc(cx, cy, 4, 0, Math.PI * 2);
  ctx.fillStyle = COLORS.white;
  ctx.fill();

  // Value text
  ctx.font = "bold 22px sans-serif";
  ctx.fillStyle = activeColor;
  ctx.textAlign = "center";
  ctx.fillText(clampedValue.toFixed(1), cx, cy - 10);

  // Label
  if (label) {
    ctx.font = "14px sans-serif";
    ctx.fillStyle = COLORS.gray;
    ctx.fillText(label, cx, cy + 8);
  }

  return canvas.toBuffer("image/png");
}

// ─── 3. Mini Candlestick Chart (@napi-rs/canvas) ────────────

export async function renderCandlestick(
  candles: OHLC[],
  options: MiniCandleOptions = {},
): Promise<Buffer> {
  const {
    width = 380,
    height = 140,
    upColor = COLORS.green,
    downColor = COLORS.red,
    wickColor = COLORS.gray,
  } = options;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  fillBackground(ctx, width, height);

  if (candles.length === 0) return canvas.toBuffer("image/png");

  const allPrices = candles.flatMap((c) => [c.high, c.low]);
  const min = Math.min(...allPrices);
  const max = Math.max(...allPrices);
  const range = max - min || 1;
  const padY = height * 0.05;
  const padX = 8;
  const candleW = Math.max(4, (width - padX * 2) / candles.length * 0.7);
  const gap = (width - padX * 2) / candles.length;

  function yPos(price: number): number {
    return padY + (1 - (price - min) / range) * (height - padY * 2);
  }

  // Grid lines
  ctx.strokeStyle = COLORS.gridLine;
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= 4; i++) {
    const y = padY + (i / 4) * (height - padY * 2);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const x = padX + i * gap + gap / 2;
    const isUp = c.close >= c.open;
    const color = isUp ? upColor : downColor;

    // Wick
    ctx.beginPath();
    ctx.moveTo(x, yPos(c.high));
    ctx.lineTo(x, yPos(c.low));
    ctx.strokeStyle = wickColor;
    ctx.lineWidth = 1;
    ctx.stroke();

    // Body
    const bodyTop = yPos(Math.max(c.open, c.close));
    const bodyBot = yPos(Math.min(c.open, c.close));
    const bodyH = Math.max(1, bodyBot - bodyTop);

    ctx.fillStyle = color;
    ctx.fillRect(x - candleW / 2, bodyTop, candleW, bodyH);

    // Glow on last candle
    if (i === candles.length - 1) {
      ctx.save();
      ctx.shadowColor = color;
      ctx.shadowBlur = 6;
      ctx.fillRect(x - candleW / 2, bodyTop, candleW, bodyH);
      ctx.restore();
    }
  }

  return canvas.toBuffer("image/png");
}

// ─── 4. Sector Heatmap (@napi-rs/canvas) ────────────────────

export async function renderHeatmap(
  cells: HeatmapCell[],
  options: { width?: number; height?: number } = {},
): Promise<Buffer> {
  const { width = 380, height = 130 } = options;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  fillBackground(ctx, width, height);

  if (cells.length === 0) return canvas.toBuffer("image/png");

  const cols = Math.min(cells.length, 5);
  const rows = Math.ceil(cells.length / cols);
  const cellW = (width - 4) / cols;
  const cellH = (height - 4) / rows;
  const gap = 3;

  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = 2 + col * cellW;
    const y = 2 + row * cellH;

    // Color by magnitude
    const absVal = Math.abs(cell.value);
    const intensity = Math.min(absVal / 5, 1); // 5% = max intensity
    let r: number, g: number, b: number;
    if (cell.value >= 0) {
      r = 0; g = Math.floor(100 + 155 * intensity); b = 0;
    } else {
      r = Math.floor(100 + 155 * intensity); g = 0; b = 0;
    }

    // Cell background
    ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
    ctx.fillRect(x + gap / 2, y + gap / 2, cellW - gap, cellH - gap);

    // Label
    ctx.font = "bold 16px sans-serif";
    ctx.fillStyle = COLORS.white;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(cell.label, x + cellW / 2, y + cellH / 2 - 8);

    // Value
    ctx.font = "13px sans-serif";
    const sign = cell.value >= 0 ? "+" : "";
    ctx.fillText(`${sign}${cell.value.toFixed(1)}%`, x + cellW / 2, y + cellH / 2 + 10);
  }

  return canvas.toBuffer("image/png");
}

// ─── 5. Volume Bars (@napi-rs/canvas) ───────────────────────

export async function renderVolumeBars(
  data: Array<{ label: string; volume: number; change: number }>,
  options: BarChartOptions = {},
): Promise<Buffer> {
  const { width = 380, height = 100 } = options;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  fillBackground(ctx, width, height);

  if (data.length === 0) return canvas.toBuffer("image/png");

  const maxVol = Math.max(...data.map((d) => d.volume));
  const barW = Math.max(20, (width - 20) / data.length * 0.7);
  const gap = (width - 20) / data.length;
  const labelH = 18;
  const barArea = height - labelH - 6;

  for (let i = 0; i < data.length; i++) {
    const d = data[i];
    const x = 10 + i * gap + gap / 2 - barW / 2;
    const barH = (d.volume / maxVol) * barArea;
    const y = barArea - barH + 3;
    const color = d.change >= 0 ? COLORS.green : COLORS.red;

    // Bar with glow
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = 4;
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.8;
    ctx.fillRect(x, y, barW, barH);
    ctx.restore();

    // Label
    ctx.font = "11px sans-serif";
    ctx.fillStyle = COLORS.gray;
    ctx.textAlign = "center";
    ctx.globalAlpha = 1;
    ctx.fillText(d.label, x + barW / 2, height - 3);
  }

  return canvas.toBuffer("image/png");
}

// ─── 6. PnL Equity Curve (Chart.js) ─────────────────────────

export async function renderPnLCurve(
  values: number[],
  labels: string[],
  options: { width?: number; height?: number } = {},
): Promise<Buffer> {
  const { width = 380, height = 120 } = options;

  const renderer = getChartRenderer(width, height);

  const lastVal = values[values.length - 1] ?? 0;
  const borderColor = lastVal >= 0 ? COLORS.green : COLORS.red;
  const bgColor = lastVal >= 0 ? "rgba(0, 255, 0, 0.08)" : "rgba(255, 0, 0, 0.08)";

  const buf = await renderer.renderToBuffer({
    type: "line",
    data: {
      labels,
      datasets: [{
        data: values,
        borderColor,
        backgroundColor: bgColor,
        borderWidth: 2,
        fill: true,
        tension: 0.3,
        pointRadius: 0,
        pointHitRadius: 0,
      }],
    },
    options: {
      responsive: false,
      animation: false,
      plugins: {
        legend: { display: false },
      },
      scales: {
        x: {
          display: false,
        },
        y: {
          display: true,
          ticks: { color: COLORS.dimGray, font: { size: 10 } },
          grid: { color: COLORS.gridLine },
          border: { display: false },
        },
      },
    },
  } as any);

  return Buffer.from(buf);
}

// ─── 7. Portfolio Allocation Doughnut (Chart.js) ─────────────

export async function renderAllocation(
  holdings: Array<{ label: string; value: number }>,
  options: { width?: number; height?: number } = {},
): Promise<Buffer> {
  const { width = 200, height = 200 } = options;

  const renderer = getChartRenderer(width, height);

  const palette = [COLORS.cyan, COLORS.green, COLORS.magenta, COLORS.yellow, COLORS.orange, "#6644FF", "#FF4488"];

  const buf = await renderer.renderToBuffer({
    type: "doughnut",
    data: {
      labels: holdings.map((h) => h.label),
      datasets: [{
        data: holdings.map((h) => h.value),
        backgroundColor: holdings.map((_, i) => palette[i % palette.length]),
        borderColor: COLORS.bg,
        borderWidth: 2,
      }],
    },
    options: {
      responsive: false,
      animation: false,
      cutout: "60%",
      plugins: {
        legend: {
          display: true,
          position: "bottom",
          labels: {
            color: COLORS.gray,
            font: { size: 11 },
            padding: 6,
            boxWidth: 10,
          },
        },
      },
    },
  } as any);

  return Buffer.from(buf);
}

// ─── 8. Data Table Image (@napi-rs/canvas) ──────────────────

export interface DataTableRow {
  text: string;    // full row string (pre-formatted, e.g. "SPY   $595.23  +1.23%")
  color: string;   // hex color for this row
}

/**
 * Render a compact HUD-style data table as a PNG image.
 * Used by Image-mode widgets (indices, movers, portfolio) to stay
 * within the device's 6-Text budget.
 */
export async function renderDataTable(
  title: string | null,
  rows: DataTableRow[],
  options: {
    width?: number;
    rowHeight?: number;
    titleHeight?: number;
  } = {},
): Promise<Buffer> {
  const { width = 768, rowHeight = 34, titleHeight = 30 } = options;
  const height = (title ? titleHeight : 0) + rows.length * rowHeight;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  fillBackground(ctx, width, height);

  let y = 0;

  if (title) {
    ctx.font = "bold 20px sans-serif";
    ctx.fillStyle = COLORS.cyan;
    ctx.textBaseline = "middle";
    ctx.fillText(title, 16, titleHeight / 2);
    y += titleHeight;
  }

  ctx.font = "20px monospace";
  ctx.textBaseline = "middle";
  for (const row of rows) {
    ctx.fillStyle = row.color;
    ctx.fillText(row.text, 16, y + rowHeight / 2);
    y += rowHeight;
  }

  return canvas.toBuffer("image/png");
}

// ─── 9. News Panel Image (@napi-rs/canvas) ──────────────────

/**
 * Render up to 3 news headlines as a PNG image.
 * Text wraps at width; long headlines are truncated.
 */
export async function renderNewsPanel(
  title: string,
  headlines: string[],
  options: {
    width?: number;
    rowHeight?: number;
    titleHeight?: number;
  } = {},
): Promise<Buffer> {
  const { width = 768, rowHeight = 30, titleHeight = 30 } = options;
  const height = titleHeight + headlines.length * rowHeight;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  fillBackground(ctx, width, height);

  ctx.font = "bold 20px sans-serif";
  ctx.fillStyle = COLORS.cyan;
  ctx.textBaseline = "middle";
  ctx.fillText(title, 16, titleHeight / 2);

  ctx.font = "16px sans-serif";
  let y = titleHeight;
  for (const headline of headlines) {
    ctx.fillStyle = headline.includes("No news") ? COLORS.gray : COLORS.white;
    ctx.fillText(headline, 16, y + rowHeight / 2);
    y += rowHeight;
  }

  return canvas.toBuffer("image/png");
}

// ─── Chart Cache ────────────────────────────────────────────

interface CacheEntry {
  buffer: Buffer;
  timestamp: number;
}

const chartCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 20_000; // 2× the refresh interval — prevents expiry gap when data fetch is slow

export function getCachedChart(key: string): Buffer | null {
  const entry = chartCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    chartCache.delete(key);
    return null;
  }
  return entry.buffer;
}

export function setCachedChart(key: string, buffer: Buffer): void {
  chartCache.set(key, { buffer, timestamp: Date.now() });
}

export function clearChartCache(): void {
  chartCache.clear();
}

/** Opaque dark 1x1 placeholder PNG for cache misses (device ignores alpha) */
let _placeholderPng: Buffer | null = null;
export function getPlaceholderPng(): Buffer {
  if (!_placeholderPng) {
    const canvas = createCanvas(1, 1);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, 1, 1);
    _placeholderPng = canvas.toBuffer("image/png");
  }
  return _placeholderPng;
}

// ─── Render All Dashboard Charts ────────────────────────────

export interface ChartInputData {
  spyPrices: number[];         // intraday price series
  spyCandles: OHLC[];          // daily OHLC bars
  sectorHeatmap: HeatmapCell[]; // sector changes
  pnlCurve: { values: number[]; labels: string[] } | null;
  rsiValue: number | null;
  vixValue: number | null;
  volumeBars: Array<{ label: string; volume: number; change: number }>;
  allocation: Array<{ label: string; value: number }> | null;
}

export interface RenderedCharts {
  spySparkline: Buffer | null;
  spyCandles: Buffer | null;
  sectorHeatmap: Buffer | null;
  pnlCurve: Buffer | null;
  rsiGauge: Buffer | null;
  vixGauge: Buffer | null;
  volumeBars: Buffer | null;
  allocation: Buffer | null;
}

/**
 * Render all dashboard charts in parallel.
 * Uses cache to avoid re-rendering unchanged data.
 */
export async function renderAllCharts(input: ChartInputData): Promise<RenderedCharts> {
  const results: RenderedCharts = {
    spySparkline: null,
    spyCandles: null,
    sectorHeatmap: null,
    pnlCurve: null,
    rsiGauge: null,
    vixGauge: null,
    volumeBars: null,
    allocation: null,
  };

  const tasks: Array<Promise<void>> = [];

  // SPY Sparkline
  if (input.spyPrices.length >= 2) {
    tasks.push(
      renderSparkline(input.spyPrices, {
        width: 760, height: 100,
        lineColor: COLORS.cyan, glowEffect: true, showDots: true,
      }).then((buf) => {
        results.spySparkline = buf;
        setCachedChart("spy-sparkline", buf);
      }).catch((err) => log.error({ err }, "Failed to render SPY sparkline")),
    );
  }

  // SPY Candles
  if (input.spyCandles.length > 0) {
    tasks.push(
      renderCandlestick(input.spyCandles, { width: 760, height: 140 })
        .then((buf) => {
          results.spyCandles = buf;
          setCachedChart("spy-candles", buf);
        }).catch((err) => log.error({ err }, "Failed to render SPY candles")),
    );
  }

  // Sector Heatmap
  if (input.sectorHeatmap.length > 0) {
    tasks.push(
      renderHeatmap(input.sectorHeatmap, { width: 760, height: 130 })
        .then((buf) => {
          results.sectorHeatmap = buf;
          setCachedChart("sector-heatmap", buf);
        }).catch((err) => log.error({ err }, "Failed to render sector heatmap")),
    );
  }

  // PnL Curve
  if (input.pnlCurve && input.pnlCurve.values.length >= 2) {
    tasks.push(
      renderPnLCurve(input.pnlCurve.values, input.pnlCurve.labels, { width: 760, height: 120 })
        .then((buf) => {
          results.pnlCurve = buf;
          setCachedChart("pnl-curve", buf);
        }).catch((err) => log.error({ err }, "Failed to render PnL curve")),
    );
  }

  // RSI Gauge
  if (input.rsiValue !== null) {
    tasks.push(
      renderGauge(input.rsiValue, {
        width: 200, height: 120,
        min: 0, max: 100,
        zones: [
          { from: 0, to: 30, color: COLORS.green },
          { from: 30, to: 70, color: COLORS.yellow },
          { from: 70, to: 100, color: COLORS.red },
        ],
        label: "RSI",
      }).then((buf) => {
        results.rsiGauge = buf;
        setCachedChart("rsi-gauge", buf);
      }).catch((err) => log.error({ err }, "Failed to render RSI gauge")),
    );
  }

  // VIX Gauge
  if (input.vixValue !== null) {
    tasks.push(
      renderGauge(input.vixValue, {
        width: 200, height: 120,
        min: 10, max: 45,
        zones: [
          { from: 10, to: 18, color: COLORS.green },
          { from: 18, to: 25, color: COLORS.orange },
          { from: 25, to: 45, color: COLORS.red },
        ],
        label: "VIX",
      }).then((buf) => {
        results.vixGauge = buf;
        setCachedChart("vix-gauge", buf);
      }).catch((err) => log.error({ err }, "Failed to render VIX gauge")),
    );
  }

  // Volume Bars
  if (input.volumeBars.length > 0) {
    tasks.push(
      renderVolumeBars(input.volumeBars, { width: 760, height: 100 })
        .then((buf) => {
          results.volumeBars = buf;
          setCachedChart("volume-bars", buf);
        }).catch((err) => log.error({ err }, "Failed to render volume bars")),
    );
  }

  // Allocation Doughnut
  if (input.allocation && input.allocation.length > 0) {
    tasks.push(
      renderAllocation(input.allocation, { width: 200, height: 200 })
        .then((buf) => {
          results.allocation = buf;
          setCachedChart("allocation", buf);
        }).catch((err) => log.error({ err }, "Failed to render allocation")),
    );
  }

  await Promise.all(tasks);

  return results;
}
