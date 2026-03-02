/**
 * Canvas Widget System — Built-in Widgets
 *
 * Each widget is a pure drawing function: receives (ctx, rect, params, palette)
 * and draws into its allocated region. Widgets use DrawContext for rect-relative
 * coordinates — (0, 0) = top-left of the widget's slot.
 *
 * Same widget type can appear multiple times with different params:
 *   { widget: "sparkline", params: { label: "SPY", color: "cyan" } }
 *   { widget: "sparkline", params: { label: "QQQ", color: "green" } }
 */

import { loadImage } from "@napi-rs/canvas";
import type { Rect, Palette, CanvasWidget } from "./types.js";
import { Ph, SECTOR_ICONS } from "./types.js";
import { DrawContext } from "./draw.js";

import type { TextSegment } from "./draw.js";

// ─── Helper: create a DrawContext from render args ──────────

function dc(ctx: CanvasRenderingContext2D, rect: Rect, palette: Palette): DrawContext {
  return new DrawContext(ctx, rect, palette);
}

// ═══════════════════════════════════════════════════════════════
//  HEADER — Session badge, connection dots, clock
// ═══════════════════════════════════════════════════════════════

export const headerWidget: CanvasWidget = {
  id: "header",
  name: "Header Bar",
  gridSize: { w: 4, h: 1 },

  render(ctx, rect, params, palette) {
    const d = dc(ctx, rect, palette);
    const session = (params.session as string) ?? "CLOSED";
    const time = (params.time as string) ?? "00:00 ET";
    const connections = (params.connections as Array<{ label: string; ok: boolean }>) ?? [
      { label: "IBKR", ok: true },
      { label: "Yahoo", ok: true },
    ];

    // Status dots
    const dots: TextSegment[] = connections.map((c) => [
      "\u25CF ", c.ok ? palette.green : palette.gray,
    ]);

    // Session badge + live indicator + clock
    const segments: TextSegment[] = [
      ...dots,
      ["  ", palette.bg],
      [session, palette.orange, "JBMono Bold"],
      ["  ", palette.bg],
      [Ph.broadcast, palette.green, "Ph Light"],
      [" LIVE", palette.green],
      ["   ", palette.bg],
      [Ph.clock, palette.gray, "Ph Light"],
      [` ${time}`, palette.gray],
    ];

    d.richText(segments, 0, 28, 26);
  },
};

// ═══════════════════════════════════════════════════════════════
//  INDICES — SPY/QQQ (large) + DIA/IWM/VIX (small)
// ═══════════════════════════════════════════════════════════════

interface IndexData {
  sym: string;
  val: string;
  chg: string;
  dir: number; // 1 = up, -1 = down
}

export const indicesWidget: CanvasWidget = {
  id: "indices",
  name: "Market Indices",
  gridSize: { w: 4, h: 2 },

  render(ctx, rect, params, palette) {
    const d = dc(ctx, rect, palette);
    const primary = (params.primary as IndexData[]) ?? [
      { sym: "SPY", val: "580.25", chg: "-0.48%", dir: -1 },
      { sym: "QQQ", val: "495.12", chg: "-0.32%", dir: -1 },
    ];
    const secondary = (params.secondary as IndexData[]) ?? [
      { sym: "DIA", val: "425.88", chg: "-1.05%", dir: -1 },
      { sym: "IWM", val: "198.45", chg: "-1.72%", dir: -1 },
      { sym: "VIX", val: "20.1", chg: "+6.6%", dir: 1 },
    ];

    // Row 1: Primary indices (large)
    for (let i = 0; i < primary.length; i++) {
      const idx = primary[i];
      const col = idx.dir >= 0 ? palette.green : palette.red;
      const arrow = idx.dir >= 0 ? Ph.trendUp : Ph.trendDown;
      const xOff = i * 380;
      d.richText([
        [idx.sym, palette.cyan],
        [` ${idx.val} `, palette.white],
        [arrow, col, "Ph Light"],
        [` ${idx.chg}`, col],
      ], xOff, 24, 24);
    }

    // Row 2: Secondary indices (smaller)
    const spacing = Math.floor(rect.w / Math.max(secondary.length, 1));
    for (let i = 0; i < secondary.length; i++) {
      const idx = secondary[i];
      const col = idx.dir >= 0 ? palette.green : palette.red;
      const arrow = idx.dir >= 0 ? Ph.trendUp : Ph.trendDown;
      d.richText([
        [idx.sym, palette.cyan],
        [` ${idx.val} `, palette.softWhite],
        [arrow, col, "Ph Light"],
        [` ${idx.chg}`, col],
      ], i * spacing, 56, 18);
    }
  },
};

// ═══════════════════════════════════════════════════════════════
//  SPARKLINE — Line chart with label + price range
// ═══════════════════════════════════════════════════════════════

export const sparklineWidget: CanvasWidget = {
  id: "sparkline",
  name: "Sparkline Chart",
  gridSize: { w: 2, h: 2 },

  render(ctx, rect, params, palette) {
    const d = dc(ctx, rect, palette);
    const label = (params.label as string) ?? "SPY 1mo";
    const data = (params.data as number[]) ?? [82, 84, 81, 85, 88, 86, 90, 92, 89, 87, 91, 94, 96, 93, 95, 98, 97, 99, 101, 100, 103, 105];
    const color = (params.color as string) ?? palette.cyan;

    // Label
    d.richText([
      [Ph.chartLineUp, color, "Ph Light"],
      [` ${label}`, palette.gray],
    ], 0, 14, 14);

    // Chart area
    const chartY = 24;
    const chartH = rect.h - chartY - 12;
    d.sparkline(data, 0, chartY, rect.w, chartH, color, {
      lineWidth: 2.5,
      glow: true,
    });

    // Price labels floating on chart
    const maxP = Math.max(...data);
    const minP = Math.min(...data);
    d.textRight(`$${maxP.toFixed(2)}`, chartY + 14, palette.green, 13);
    d.textRight(`$${minP.toFixed(2)}`, chartY + chartH - 4, palette.red, 13);
  },
};

// ═══════════════════════════════════════════════════════════════
//  SECTORS — Horizontal bar chart with sector names + % change
// ═══════════════════════════════════════════════════════════════

interface SectorData {
  name: string;
  chg: number;
  /** Leading ticker driving the sector — used for logo background */
  leader?: string;
}

// ── Treemap helpers ──────────────────────────────────────────

/** Map % change → [bgColor, textColor] with intensity scaling */
function treemapColor(chg: number, maxChg: number): [string, string] {
  const t = Math.min(Math.abs(chg) / Math.max(maxChg, 0.1), 1);
  const intensity = 0.25 + t * 0.75;
  const ch = Math.round(intensity * 180);
  const lo = Math.round(intensity * 40);
  const bg = chg >= 0
    ? `rgb(${lo}, ${ch}, ${lo})`
    : `rgb(${ch}, ${lo}, ${lo})`;
  return [bg, "#FFFFFF"];
}

interface TreemapCell { x: number; y: number; w: number; h: number; idx: number }

/**
 * Squarified treemap layout (Bruls-Huizing-van Wijk).
 * Subdivides a rectangle into cells proportional to weights,
 * choosing horizontal/vertical splits to keep cells close to square.
 */
function squarify(
  items: number[],          // weights (must be > 0)
  x: number, y: number,    // top-left of available area
  w: number, h: number,    // available area
  gap: number,
): TreemapCell[] {
  if (items.length === 0) return [];
  if (items.length === 1) return [{ x, y, w, h, idx: 0 }];

  // Sort indices by weight descending — squarify needs this
  const indices = items.map((_, i) => i).sort((a, b) => items[b] - items[a]);
  const sorted = indices.map(i => items[i]);
  const totalArea = w * h;
  const totalWeight = sorted.reduce((a, b) => a + b, 0);

  const cells: TreemapCell[] = [];

  // Recursive squarify: lay out items row by row
  let rx = x, ry = y, rw = w, rh = h;
  let si = 0; // index into sorted[]

  while (si < sorted.length) {
    // Lay along shorter axis
    const vertical = rw >= rh;
    const side = vertical ? rh : rw;

    // Greedily add items to current row while aspect ratio improves
    const row: number[] = [];
    let rowWeight = 0;
    const remainingWeight = sorted.slice(si).reduce((a, b) => a + b, 0);
    const remainingArea = rw * rh;

    function worstAspect(rowW: number, items: number[]): number {
      const rowLen = (rowW / remainingWeight) * (vertical ? rw : rh);
      let worst = 0;
      for (const it of items) {
        const cellSide = (it / rowW) * side;
        const ratio = Math.max(rowLen / cellSide, cellSide / rowLen);
        worst = Math.max(worst, ratio);
      }
      return worst;
    }

    row.push(sorted[si]);
    rowWeight = sorted[si];
    si++;

    while (si < sorted.length) {
      const withNext = [...row, sorted[si]];
      const withoutRatio = worstAspect(rowWeight, row);
      const withRatio = worstAspect(rowWeight + sorted[si], withNext);
      if (withRatio <= withoutRatio) {
        row.push(sorted[si]);
        rowWeight += sorted[si];
        si++;
      } else {
        break;
      }
    }

    // Lay out the row
    const rowFraction = rowWeight / remainingWeight;
    const rowThickness = vertical
      ? Math.round(rw * rowFraction)
      : Math.round(rh * rowFraction);

    let cx = rx, cy = ry;
    for (let r = 0; r < row.length; r++) {
      const cellFrac = row[r] / rowWeight;
      const cellLen = Math.round(cellFrac * side);
      // Original index: indices array maps sorted position → original
      const origIdx = indices[si - row.length + r];

      if (vertical) {
        cells.push({
          x: cx, y: cy,
          w: rowThickness - gap, h: cellLen - gap,
          idx: origIdx,
        });
        cy += cellLen;
      } else {
        cells.push({
          x: cx, y: cy,
          w: cellLen - gap, h: rowThickness - gap,
          idx: origIdx,
        });
        cx += cellLen;
      }
    }

    // Shrink remaining area
    if (vertical) {
      rx += rowThickness;
      rw -= rowThickness;
    } else {
      ry += rowThickness;
      rh -= rowThickness;
    }
  }

  return cells;
}

export const sectorsWidget: CanvasWidget = {
  id: "sectors",
  name: "Sector Strength",
  gridSize: { w: 2, h: 2 },

  async render(ctx, rect, params, palette) {
    const d = dc(ctx, rect, palette);
    const sectors = (params.sectors as SectorData[]) ?? [
      { name: "TECH", chg: 1.8 },
      { name: "HLTH", chg: 0.9 },
      { name: "FINL", chg: 0.3 },
      { name: "INDU", chg: 0.5 },
      { name: "CONS", chg: -0.2 },
      { name: "ENER", chg: -1.1 },
      { name: "UTIL", chg: 0.1 },
      { name: "REAL", chg: -0.6 },
      { name: "MATL", chg: 0.4 },
      { name: "COMM", chg: 1.2 },
      { name: "STPL", chg: -0.3 },
    ];

    // Section label
    d.richText([
      [Ph.chartLine, palette.gray, "Ph Light"],
      [" SECTORS", palette.gray],
    ], 0, 16, 14);

    // ── Squarified treemap ────────────────────────────────────
    const mapTop = 24;
    const mapH = rect.h - mapTop - 4;
    const mapW = rect.w;
    const cellGap = 3;

    const maxChg = Math.max(...sectors.map(s => Math.abs(s.chg)), 0.1);
    const weights = sectors.map(s => Math.max(Math.abs(s.chg), 0.15));

    const cells = squarify(weights, 0, mapTop, mapW, mapH, cellGap);

    for (const cell of cells) {
      const s = sectors[cell.idx];
      const [bg, textCol] = treemapColor(s.chg, maxChg);

      // Cell background
      d.fillRect(cell.x, cell.y, cell.w, cell.h, bg);

      // ── Icon label ────────────────────────────────────────────
      const minDim = Math.min(cell.w, cell.h);
      const icon = SECTOR_ICONS[s.name];
      if (icon) {
        const iconSize = Math.max(12, Math.round(minDim * 0.55));
        const iconW = d.measureText(icon, iconSize, "Ph Light");
        const iconX = cell.x + Math.round((cell.w - iconW) / 2);
        const iconY = cell.y + Math.round(cell.h / 2) + Math.round(iconSize * 0.35);
        d.text(icon, iconX, iconY, textCol, iconSize, "Ph Light");
      }
    }
  },
};

// ═══════════════════════════════════════════════════════════════
//  POSITIONS — Open positions with P&L + stop info
// ═══════════════════════════════════════════════════════════════

interface PositionData {
  sym: string;
  qty: string;
  pnl: string;
  pnlDir: number;
  stop: string;
}

export const positionsWidget: CanvasWidget = {
  id: "positions",
  name: "Open Positions",
  gridSize: { w: 2, h: 2 },

  render(ctx, rect, params, palette) {
    const d = dc(ctx, rect, palette);
    const positions = (params.positions as PositionData[]) ?? [
      { sym: "PLTR", qty: "45sh", pnl: "+$142", pnlDir: 1, stop: "stp $82.5" },
      { sym: "NVDA", qty: "20sh", pnl: "-$38", pnlDir: -1, stop: "stp $410" },
      { sym: "AAPL", qty: "15sh", pnl: "+$21", pnlDir: 1, stop: "none" },
    ];

    // Section label
    d.richText([
      [Ph.shield, palette.gray, "Ph Light"],
      [" POSITIONS", palette.gray],
    ], 0, 16, 14);

    // Position rows
    let y = 28;
    for (const pos of positions) {
      const pnlColor = pos.pnlDir >= 0 ? palette.green : palette.red;
      const stopColor = pos.stop === "none" ? palette.orange : palette.gray;
      const arrow = pos.pnlDir >= 0 ? Ph.trendUp : Ph.trendDown;
      d.richText([
        [pos.sym, palette.white],
        [` ${pos.qty} `, palette.gray],
        [arrow, pnlColor, "Ph Light"],
        [` ${pos.pnl}`, pnlColor],
        [`  ${pos.stop}`, stopColor],
      ], 8, y + 22, 22);
      y += 30;
    }
  },
};

// ═══════════════════════════════════════════════════════════════
//  PNL SUMMARY — Day P&L, net value, deployed %, risk level
// ═══════════════════════════════════════════════════════════════

export const pnlWidget: CanvasWidget = {
  id: "pnl",
  name: "P&L Summary",
  gridSize: { w: 2, h: 2 },

  render(ctx, rect, params, palette) {
    const d = dc(ctx, rect, palette);
    const dayPnl = (params.dayPnl as string) ?? "+$342";
    const dayDir = (params.dayDir as number) ?? 1;
    const netValue = (params.netValue as string) ?? "$24.1K";
    const deployedPct = (params.deployedPct as number) ?? 73;
    const riskLevel = (params.riskLevel as string) ?? "MED";
    const riskPct = (params.riskPct as number) ?? 35;

    const dayColor = dayDir >= 0 ? palette.green : palette.red;

    // Day P&L + Net
    d.richText([
      [Ph.currencyDollar, dayColor, "Ph Light"],
      [" Day ", palette.gray],
      [dayPnl, dayColor, "JBMono Bold"],
      ["    Net ", palette.gray],
      [netValue, palette.white, "JBMono Bold"],
    ], 0, 28, 24);

    // Deployed gauge — pixel bar with track
    const gaugeX = 140;
    const gaugeW = rect.w - gaugeX - 70;
    d.richText([
      [Ph.gauge, palette.cyan, "Ph Light"],
      [" Deployed", palette.gray],
    ], 8, 54, 16);
    d.bar(gaugeX, 42, gaugeW, 14, deployedPct, 100, palette.cyan, palette.dimGray);
    d.text(`${deployedPct}%`, gaugeX + gaugeW + 8, 54, palette.white, 16, "JBMono Bold");

    // Risk heat bar — pixel bar with track
    const riskColor = riskPct > 60 ? palette.red : riskPct > 30 ? palette.orange : palette.green;
    d.richText([
      [Ph.warning, riskColor, "Ph Light"],
      [" Risk", palette.gray],
    ], 8, 74, 16);
    d.bar(gaugeX, 62, gaugeW, 14, riskPct, 100, riskColor, palette.dimGray);
    d.text(riskLevel, gaugeX + gaugeW + 8, 74, riskColor, 16, "JBMono Bold");
  },
};

// ═══════════════════════════════════════════════════════════════
//  MOVERS — Top gainers/losers with relative volume bars
// ═══════════════════════════════════════════════════════════════

interface MoverData {
  sym: string;
  chg: string;
  price: string;
  dir: number;
  vol: number;
}

export const moversWidget: CanvasWidget = {
  id: "movers",
  name: "Top Movers",
  gridSize: { w: 4, h: 2 },

  render(ctx, rect, params, palette) {
    const d = dc(ctx, rect, palette);
    const title = (params.title as string) ?? "TOP MOVERS";
    const movers = (params.movers as MoverData[]) ?? [
      { sym: "AAOI", chg: "+56.88%", price: "$84.23", dir: 1, vol: 8.2 },
      { sym: "BWIN", chg: "+25.64%", price: "$23.23", dir: 1, vol: 4.5 },
      { sym: "RUN",  chg: "-35.11%", price: "$13.25", dir: -1, vol: 6.1 },
      { sym: "FIGR", chg: "-25.73%", price: "$25.28", dir: -1, vol: 2.3 },
    ];

    // Section label
    d.richText([
      [Ph.fire, palette.magenta, "Ph Light"],
      [` ${title}`, palette.magenta],
    ], 0, 16, 14);

    // Mover rows — block char volume bars for relative comparison
    const maxVol = Math.max(...movers.map((m) => m.vol), 1);
    const volBarX = 460;
    const volBarChars = 20;
    let y = 28;
    for (const m of movers) {
      const col = m.dir >= 0 ? palette.green : palette.red;
      const arrow = m.dir >= 0 ? Ph.trendUp : Ph.trendDown;
      d.richText([
        [arrow, col, "Ph Light"],
        [` ${m.sym.padEnd(5)}`, palette.white],
        [`${m.chg.padStart(9)}`, col],
        [`  ${m.price}`, palette.gray],
      ], 8, y + 20, 20);
      d.blockBar(volBarX, y + 20, m.vol, maxVol, volBarChars, 16, col);
      y += 28;
    }
  },
};

// ═══════════════════════════════════════════════════════════════
//  NEWS — Headlines with newspaper icon
// ═══════════════════════════════════════════════════════════════

export const newsWidget: CanvasWidget = {
  id: "news",
  name: "News Headlines",
  gridSize: { w: 4, h: 2 },

  render(ctx, rect, params, palette) {
    const d = dc(ctx, rect, palette);
    const headlines = (params.headlines as string[]) ?? [
      "Trump Administration Shuns Anthropic...",
      "NVDA earnings beat expectations, guide...",
      "Fed signals patience on rate cuts amid...",
    ];

    // Section label
    d.richText([
      [Ph.newspaper, palette.orange, "Ph Light"],
      [" NEWS", palette.orange],
    ], 0, 16, 14);

    // Headlines
    let y = 28;
    for (const hl of headlines) {
      d.text(hl, 8, y + 16, palette.orange, 16);
      y += 24;
    }
  },
};

// ═══════════════════════════════════════════════════════════════
//  SEPARATOR — Thin line divider (height-adaptive)
// ═══════════════════════════════════════════════════════════════

export const separatorWidget: CanvasWidget = {
  id: "separator",
  name: "Separator",
  gridSize: { w: 4, h: 1 },

  render(ctx, rect, params, palette) {
    const d = dc(ctx, rect, palette);
    const color = (params.color as string) ?? palette.dimGray;
    d.separator(Math.floor(rect.h / 2), color);
  },
};

// ═══════════════════════════════════════════════════════════════
//  FOOTER — Sources, countdown, connection status
// ═══════════════════════════════════════════════════════════════

export const footerWidget: CanvasWidget = {
  id: "footer",
  name: "Footer Bar",
  gridSize: { w: 4, h: 1 },

  render(ctx, rect, params, palette) {
    const d = dc(ctx, rect, palette);
    const nextOpen = (params.nextOpen as string) ?? "Opens Mon 09:30";
    const countdown = (params.countdown as string) ?? "54h 50m";
    const sources = (params.sources as Array<{ name: string; color: string }>) ?? [
      { name: "IBKR", color: palette.green },
      { name: "Yahoo", color: palette.gray },
    ];

    const segments: TextSegment[] = [
      [Ph.timer, palette.gray, "Ph Light"],
      [` ${nextOpen}`, palette.gray],
      ["  ", palette.bg],
      [countdown, palette.white],
    ];

    for (const src of sources) {
      segments.push(["  ", palette.bg]);
      segments.push([src.name, src.color]);
    }

    d.richText(segments, 0, rect.h - 8, 16);
  },
};

// ═══════════════════════════════════════════════════════════════
//  GAUGE — Horizontal gauge bar with label + value
// ═══════════════════════════════════════════════════════════════

export const gaugeWidget: CanvasWidget = {
  id: "gauge",
  name: "Gauge Bar",
  gridSize: { w: 2, h: 1 },

  render(ctx, rect, params, palette) {
    const d = dc(ctx, rect, palette);
    const label = (params.label as string) ?? "RSI";
    const value = (params.value as number) ?? 55;
    const max = (params.max as number) ?? 100;
    const color = (params.color as string) ?? palette.cyan;
    const icon = (params.icon as string) ?? Ph.gauge;

    // Icon + Label
    d.richText([
      [icon, color, "Ph Light"],
      [` ${label} `, palette.gray],
    ], 0, 24, 16);

    // Bar
    const barX = 100;
    const barW = rect.w - barX - 60;
    d.bar(barX, 12, barW, 14, value, max, color, palette.dimGray);

    // Value text
    d.text(`${value}`, rect.w - 50, 24, palette.white, 16, "JBMono Bold");
  },
};

// ═══════════════════════════════════════════════════════════════
//  IMAGE CARD — Fetch + render arbitrary image with text overlay
// ═══════════════════════════════════════════════════════════════

// Module-level image cache — survives across render cycles
const imageCache = new Map<string, { img: ReturnType<typeof loadImage> extends Promise<infer T> ? T : never; ts: number }>();
const IMG_CACHE_TTL = 300_000; // 5 min → new cat every 5 min

async function getCachedImage(url: string): Promise<any> {
  const cached = imageCache.get(url);
  if (cached && Date.now() - cached.ts < IMG_CACHE_TTL) {
    return cached.img;
  }
  const resp = await fetch(url);
  const buf = Buffer.from(await resp.arrayBuffer());
  const img = await loadImage(buf);
  imageCache.set(url, { img: img as any, ts: Date.now() });
  return img;
}

export const imageCardWidget: CanvasWidget = {
  id: "image-card",
  name: "Image Card",
  gridSize: { w: 4, h: 2 },

  async render(ctx, rect, params, palette) {
    const d = dc(ctx, rect, palette);
    const url = (params.url as string) ?? "https://cataas.com/cat?width=800&height=800";
    const title = (params.title as string) ?? "";
    const subtitle = (params.subtitle as string) ?? "";

    try {
      const img = await getCachedImage(url);

      // Scale to fill width, center vertically within rect
      const scale = rect.w / img.width;
      const drawH = img.height * scale;
      const offsetY = (rect.h - drawH) / 2;

      // Clip to widget bounds so image doesn't bleed into neighbors
      ctx.save();
      ctx.beginPath();
      ctx.rect(rect.x, rect.y, rect.w, rect.h);
      ctx.clip();

      ctx.drawImage(img as any, rect.x, rect.y + offsetY, rect.w, drawH);

      ctx.restore();

      // Bottom gradient for text readability
      if (title || subtitle) {
        const gradH = 80;
        const grad = ctx.createLinearGradient(
          rect.x, rect.y + rect.h - gradH,
          rect.x, rect.y + rect.h,
        );
        grad.addColorStop(0, "rgba(0,0,0,0)");
        grad.addColorStop(1, "rgba(0,0,0,0.85)");
        ctx.fillStyle = grad;
        ctx.fillRect(rect.x, rect.y + rect.h - gradH, rect.w, gradH);
      }

      // Title + subtitle over gradient
      if (title) {
        d.text(title, 12, rect.h - 36, palette.white, 22, "JBMono Bold");
      }
      if (subtitle) {
        d.text(subtitle, 12, rect.h - 12, palette.cyan, 14);
      }
    } catch (err) {
      // Fallback — show placeholder if fetch fails
      d.fillRect(0, 0, rect.w, rect.h, palette.dimGray);
      d.text("Image unavailable", 12, rect.h / 2, palette.red, 18);
    }
  },
};

// ═══════════════════════════════════════════════════════════════
//  ALL WIDGETS — Export collection for easy registration
// ═══════════════════════════════════════════════════════════════

export const allWidgets: CanvasWidget[] = [
  headerWidget,
  indicesWidget,
  sparklineWidget,
  sectorsWidget,
  positionsWidget,
  pnlWidget,
  moversWidget,
  newsWidget,
  separatorWidget,
  footerWidget,
  gaugeWidget,
  imageCardWidget,
];
