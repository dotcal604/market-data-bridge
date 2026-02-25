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

// Row heights
export const HEADER_H = 44;
export const SECTION_HEADER_H = 30;
export const DATA_H = 34;
export const SECTION_GAP = 12;

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
    BgColor: BG_TRANSPARENT,
    TextMessage: text,
  };
}

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
