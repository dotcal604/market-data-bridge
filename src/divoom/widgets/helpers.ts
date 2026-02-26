/**
 * Widget System — Element Factories & Layout Constants
 *
 * Provides textEl() and imageEl() factories that mirror the
 * original layout.ts helpers but work with widget origins.
 */

import type { DisplayElement } from "../display.js";

// ─── Canvas Constants (from layout.ts) ──────────────────────

export const CANVAS_W = 800;
export const PAD_X = 16;
export const CONTENT_W = CANVAS_W - PAD_X * 2; // 768

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

// Multi-line panel heights (newline-based sections filling the 1280px canvas)
// Each widget occupies a tall panel rendered as one Text element with \n separators.
// Layout math: 8 top-pad + 80 header + 280 indices + 200 portfolio + 280 movers + 280 news + 120 footer = 1248px
export const PANEL_HEADER_H = 80;    // session badge, 1 line
export const PANEL_INDICES_H = 280;  // 3 lines: SPY/QQQ, DIA/IWM/VIX, sparkline label
export const PANEL_PORTFOLIO_H = 200; // 2 lines: P&L, account details
export const PANEL_MOVERS_H = 280;   // 3 lines: header + 2 movers
export const PANEL_NEWS_H = 280;     // 3 headlines
export const PANEL_FOOTER_H = 120;   // 1-2 lines: source/status

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
  } = {},
): DisplayElement {
  const align = opts.align ?? 0;
  return {
    ID: id,
    Type: "Text",
    StartX: opts.startX ?? (align === 1 ? 0 : PAD_X),
    StartY: y,
    Width: opts.width ?? (align === 1 ? CANVAS_W : CONTENT_W),
    Height: opts.height ?? DATA_H,
    Align: align,
    FontSize: opts.fontSize ?? DATA_SIZE,
    FontID: FONT_ID,
    FontColor: color,
    BgColor: opts.bgColor ?? BG_TRANSPARENT,
    TextMessage: text,
  };
}

// ─── Section Background Colors ─────────────────────────────
// Dark accent tints for section backgrounds.
// Device renders these as solid fills behind text if BgColor is supported.
// If device ignores BgColor, these are harmless (transparent fallback).

export const SectionBg = {
  header:    "#001818",  // dark cyan
  indices:   "#080818",  // dark blue
  movers:    "#180818",  // dark magenta
  portfolio: "#081808",  // dark green
  news:      "#181008",  // dark amber
  footer:    "#00000000", // transparent — metadata stays clean
} as const;

// ─── Block Sparkline ────────────────────────────────────────

/**
 * Render a numeric series as a sparkline using Unicode lower-block characters.
 *
 * Uses U+2581–U+2588 (▁▂▃▄▅▆▇█) — the same Unicode block as the full-block
 * character (█ U+2588) already confirmed to render on FontID 52.
 * Braille U+2800–28FF is NOT supported by this font.
 *
 * @param values  - Array of numbers (e.g. closing prices)
 * @param width   - Number of characters to output (default: 20)
 * @returns A string of block characters representing the sparkline
 *
 * @example
 * blockSparkline([100, 102, 98, 105, 103, 101, 107, 110])
 * // → "▃▄▂▆▅▃▇█"
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

  // U+2581–U+2588: ▁▂▃▄▅▆▇█ (8 levels, bottom-to-top fill)
  const BLOCKS = "▁▂▃▄▅▆▇█";

  let result = "";
  for (const val of resampled) {
    const normalized = (val - min) / range; // 0..1
    const level = Math.min(7, Math.round(normalized * 7)); // 0..7
    result += BLOCKS[level];
  }

  return result;
}

/** @deprecated Use blockSparkline — braille U+2800–28FF not in FontID 52 */
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
