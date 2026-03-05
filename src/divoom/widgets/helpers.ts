/**
 * Widget System — Element Factories & Layout Constants
 *
 * Provides textEl() and imageEl() factories that mirror the
 * original layout.ts helpers but work with widget origins.
 */

import type { DisplayElement } from "../display.js";
import { getContentSettings } from "../config-store.js";

// ─── Canvas Constants (from layout.ts) ──────────────────────

export const CANVAS_W = 800;
export const PAD_X = 16;
export const CONTENT_W = CANVAS_W - PAD_X * 2; // 768

// Split-canvas: text elements confined to left half
export const TEXT_ZONE_W = 400;        // left half for text elements
export const TEXT_PAD_X = 10;          // tighter padding in narrow zone
export const TEXT_CONTENT_W = TEXT_ZONE_W - TEXT_PAD_X * 2; // 380

export const FONT_ID = 52;
export const BG_TRANSPARENT = "#00000000";

// Font sizes
export const HEADER_SIZE = 36;
export const SECTION_HEADER_SIZE = 24;
export const DATA_SIZE = 30;

// Row heights (single-line)
export const HEADER_H = 44;
export const SECTION_HEADER_H = 30;
export const DATA_H = 34;
export const SECTION_GAP = 12;

// Multi-line panel MINIMUM heights (flex engine distributes remaining canvas space)
// These are minimums — the flex engine stretches non-fixed widgets proportionally
// to fill the 1280px canvas. Reduced from original values to accommodate Image widgets.
// 3 lines at FontSize 36 ≈ 108px of text; minimums include ~50px pad for breathing room.
export const PANEL_HEADER_H = 64;    // session badge, 1 line (fixed, no flex)
export const PANEL_INDICES_H = 160;  // 3 lines: SPY/QQQ, DIA/IWM/VIX, sparkline label
export const PANEL_PORTFOLIO_H = 130; // 2 lines: P&L, account details
export const PANEL_MOVERS_H = 190;   // 5 lines: header + 4 movers @ fontSize 28
export const PANEL_NEWS_H = 90;      // 3 headlines @ fontSize 22
export const PANEL_FOOTER_H = 36;    // 1 line: source/status (fixed, small font)

// Chart image dimensions
export const CHART_W = CONTENT_W;
export const SPARKLINE_H = 100;
export const HEATMAP_H = 130;
export const PNL_CURVE_H = 120;
export const GAUGE_W = 200;
export const GAUGE_H = 120;
export const VOLUME_H = 100;

// ─── Element Factories ──────────────────────────────────────

/**
 * Create a Text DisplayElement.
 *
 * @param id       - Element ID (unique across the layout)
 * @param y        - Y position on canvas
 * @param text     - Text content
 * @param color    - Font color hex (e.g. "#00FF00")
 * @param opts     - Optional overrides for font size, height, alignment, width
 */
export function textEl(
  id: number,
  y: number,
  text: string,
  color: string,
  opts: {
    fontSize?: number;
    height?: number;
    align?: 0 | 1 | 2;
    width?: number;
    startX?: number;
    bgColor?: string;
    /** Override FontID (default: reads from config store, fallback FONT_ID=52) */
    fontId?: number;
  } = {},
): DisplayElement {
  const align = opts.align ?? 0;
  // Read FontID: explicit opt → config store → hardcoded default
  const resolvedFontId = opts.fontId ?? getContentSettings().fontId ?? FONT_ID;
  return {
    ID: id,
    Type: "Text",
    StartX: opts.startX ?? (align === 1 ? 0 : PAD_X),
    StartY: y,
    Width: opts.width ?? (align === 1 ? CANVAS_W : CONTENT_W),
    Height: opts.height ?? DATA_H,
    Align: align,
    FontSize: opts.fontSize ?? DATA_SIZE,
    FontID: resolvedFontId,
    FontColor: color,
    BgColor: opts.bgColor ?? BG_TRANSPARENT,
    TextMessage: text,
  };
}

// ─── Section Background Colors ─────────────────────────────
// All transparent — opaque BgColor blocks the IPS glass and compositing layer.
// BackgroudImageAddr (composite JPEG) handles visual depth behind text.

export const SectionBg = {
  header:    "#00000000",
  indices:   "#00000000",
  movers:    "#00000000",
  portfolio: "#00000000",
  news:      "#00000000",
  footer:    "#00000000",
} as const;

// ─── Block Sparkline ────────────────────────────────────────

/**
 * Render a numeric series as a sparkline using Unicode block elements.
 *
 * Uses 8 Unicode block characters with ascending height: ▁▂▃▄▅▆▇█
 * (U+2581–U+2588). Confirmed rendering on device FontID 52.
 *
 * Braille characters (U+2800–28FF) are NOT supported — garbled output.
 *
 * @param values  - Array of numbers (e.g. closing prices)
 * @param width   - Number of characters to output (default: 20)
 * @returns A string of block characters representing the sparkline
 *
 * @example
 * blockSparkline([100, 102, 98, 105, 103, 101, 107, 110])
 * // → "▂▃▁▅▄▃▆█"
 */
export function blockSparkline(values: number[], width = 20): string {
  if (values.length === 0) return "";

  // Resample to target width using nearest-neighbor
  const resampled: number[] = [];
  for (let i = 0; i < width; i++) {
    const srcIdx = Math.round((i / (width - 1)) * (values.length - 1));
    resampled.push(values[Math.min(srcIdx, values.length - 1)]);
  }

  const min = Math.min(...resampled);
  const max = Math.max(...resampled);
  const range = max - min || 1;

  // 8 Unicode block levels from low to high: ▁▂▃▄▅▆▇█
  const BLOCKS = "▁▂▃▄▅▆▇█";

  let result = "";
  for (const val of resampled) {
    const normalized = (val - min) / range; // 0..1
    const level = Math.min(7, Math.round(normalized * 7)); // 0..7
    result += BLOCKS[level];
  }

  return result;
}

/** @deprecated Use blockSparkline — braille U+2800–28FF not supported */
export const brailleSparkline = blockSparkline;

/**
 * Create an Image DisplayElement.
 *
 * @param id     - Element ID
 * @param y      - Y position on canvas
 * @param url    - Image URL (the device fetches this)
 * @param opts   - Optional overrides for dimensions and positioning
 */
export function imageEl(
  id: number,
  y: number,
  url: string,
  opts: {
    width?: number;
    height?: number;
    startX?: number;
    align?: 0 | 1 | 2;
    localFlag?: 0 | 1;
  } = {},
): DisplayElement {
  const width = opts.width ?? CHART_W;
  const align = opts.align ?? 1;
  return {
    ID: id,
    Type: "Image",
    StartX: opts.startX ?? (align === 1 ? (CANVAS_W - width) / 2 : PAD_X),
    StartY: y,
    Width: width,
    Height: opts.height ?? SPARKLINE_H,
    Align: 0,
    FontSize: 0,
    FontID: 0,
    FontColor: "#FFFFFF",
    BgColor: BG_TRANSPARENT,
    Url: url,
    ImgLocalFlag: opts.localFlag ?? 0,
  };
}
