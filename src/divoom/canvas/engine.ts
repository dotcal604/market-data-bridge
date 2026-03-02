/**
 * Canvas Widget System — Grid Layout Engine
 *
 * Takes a list of Slots placed on a grid + a registry of CanvasWidgets:
 *   1. Resolves slot widget IDs → CanvasWidget instances
 *   2. Converts grid (col, row, w, h) to pixel Rects
 *   3. Renders each widget into its Rect
 *   4. Encodes the final canvas to JPEG via sharp
 *
 * Grid model:
 *   - Canvas divided into columns × rows cells
 *   - Each slot placed at (col, row) with size (w, h) in grid units
 *   - Slots without explicit position auto-flow (top-to-bottom, left-to-right)
 *   - Cell size = (usable dimension - gaps) / grid count
 *   - Overlapping slots render in array order (later on top)
 */

import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import sharp from "sharp";
import { resolve } from "path";
import type { Rect, Palette, Slot, CanvasConfig, CanvasWidget } from "./types.js";
import { DEFAULT_CONFIG, DEFAULT_PALETTE } from "./types.js";
import { DrawContext } from "./draw.js";

// ─── Widget Registry ────────────────────────────────────────

const registry = new Map<string, CanvasWidget>();

/** Register a widget type so the engine can resolve it by ID */
export function registerWidget(widget: CanvasWidget): void {
  registry.set(widget.id, widget);
}

/** Register multiple widget types */
export function registerWidgets(widgets: CanvasWidget[]): void {
  for (const w of widgets) registerWidget(w);
}

/** Get all registered widget types (for admin UI listing) */
export function getRegisteredWidgets(): CanvasWidget[] {
  return [...registry.values()];
}

// ─── Font Registration ──────────────────────────────────────

let fontsRegistered = false;

function ensureFonts(): void {
  if (fontsRegistered) return;

  const fontDir = resolve(
    import.meta.dirname ?? ".",
    "../../../data/fonts",
  );

  const textFonts = [
    ["JetBrainsMono-Regular.ttf", "JBMono"],
    ["JetBrainsMono-Bold.ttf", "JBMono Bold"],
    ["JetBrainsMono-Medium.ttf", "JBMono Medium"],
    ["Garamond.ttf", "Garamond"],
    ["Garamond-Bold.ttf", "Garamond Bold"],
    ["Lato.ttf", "Lato"],
    ["Lato-Bold.ttf", "Lato Bold"],
    ["Lato-Semibold.ttf", "Lato Semibold"],
  ];

  const iconFonts = [
    ["Phosphor-Light.ttf", "Ph Light"],
    ["Phosphor.ttf", "Ph"],
    ["Phosphor-Bold.ttf", "Ph Bold"],
  ];

  for (const [file, family] of [...textFonts, ...iconFonts]) {
    try {
      GlobalFonts.registerFromPath(resolve(fontDir, file), family);
    } catch {
      // Font file might not exist — non-fatal
    }
  }

  fontsRegistered = true;
}

// ─── Layout Engine ──────────────────────────────────────────

export interface EngineResult {
  /** Raw JPEG buffer, ready to push via BackgroudImageAddr */
  jpeg: Buffer;
  /** Which widget IDs were rendered */
  rendered: string[];
  /** Which slot indices had unresolved widget IDs */
  skipped: number[];
  /** Total canvas height used (max bottom edge of any widget) */
  usedHeight: number;
}

/**
 * Convert a grid-positioned slot to a pixel Rect.
 *
 * Grid math:
 *   cellW = (usableWidth - (columns-1)*gap) / columns
 *   cellH = (usableHeight - (rows-1)*gap) / rows
 *   x = padding + col * (cellW + gap)
 *   y = topPad + row * (cellH + gap)
 *   w = span_w * cellW + (span_w - 1) * gap
 *   h = span_h * cellH + (span_h - 1) * gap
 */
function gridToRect(
  col: number,
  row: number,
  spanW: number,
  spanH: number,
  cellW: number,
  cellH: number,
  gap: number,
  padding: number,
  topPad: number,
): Rect {
  return {
    x: padding + col * (cellW + gap),
    y: topPad + row * (cellH + gap),
    w: spanW * cellW + (spanW - 1) * gap,
    h: spanH * cellH + (spanH - 1) * gap,
  };
}

/**
 * Render a complete layout to JPEG.
 *
 * @param slots  - Widget placements on the grid
 * @param config - Canvas dimensions, grid size, palette, JPEG quality
 * @returns EngineResult with JPEG buffer and render metadata
 */
export async function renderLayout(
  slots: Slot[],
  config: CanvasConfig = DEFAULT_CONFIG,
): Promise<EngineResult> {
  ensureFonts();

  const { width, height, padding, palette, jpegQuality, columns, rows, gap } = config;

  // Grid geometry
  const topPad = padding / 2;
  const bottomPad = padding / 2;
  const usableWidth = width - padding * 2;
  const usableHeight = height - topPad - bottomPad;
  const cellW = (usableWidth - (columns - 1) * gap) / columns;
  const cellH = (usableHeight - (rows - 1) * gap) / rows;

  // Step 1: Resolve slots and compute Rects
  //   Auto-flow: slots without explicit (col, row) are placed sequentially.
  //   We track a "cursor" that advances through the grid for auto-placement.
  const placements: Array<{ widget: CanvasWidget; params: Record<string, unknown>; rect: Rect }> = [];
  const skipped: number[] = [];
  let autoRow = 0;
  let autoCol = 0;

  // Occupancy grid for auto-flow (tracks which cells are taken)
  const occupied = new Set<string>();
  const cellKey = (c: number, r: number) => `${c},${r}`;

  // Mark cells as occupied
  const markOccupied = (c: number, r: number, w: number, h: number) => {
    for (let dr = 0; dr < h; dr++) {
      for (let dc = 0; dc < w; dc++) {
        occupied.add(cellKey(c + dc, r + dr));
      }
    }
  };

  // Find next free position for auto-flow
  const advanceCursor = (spanW: number, spanH: number): { col: number; row: number } | null => {
    while (autoRow + spanH <= rows) {
      if (autoCol + spanW <= columns) {
        // Check if all cells in this span are free
        let fits = true;
        outer: for (let dr = 0; dr < spanH; dr++) {
          for (let dc = 0; dc < spanW; dc++) {
            if (occupied.has(cellKey(autoCol + dc, autoRow + dr))) {
              fits = false;
              break outer;
            }
          }
        }
        if (fits) {
          const result = { col: autoCol, row: autoRow };
          autoCol += spanW;
          if (autoCol >= columns) {
            autoCol = 0;
            autoRow++;
          }
          return result;
        }
      }
      // Move cursor forward
      autoCol++;
      if (autoCol >= columns) {
        autoCol = 0;
        autoRow++;
      }
    }
    return null; // grid full
  };

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    const widget = registry.get(slot.widget);
    if (!widget) {
      skipped.push(i);
      continue;
    }

    // Size: slot override → widget's declared gridSize → full-width × 1
    const spanW = Math.min(slot.w ?? widget.gridSize.w, columns);
    const spanH = slot.h ?? widget.gridSize.h;

    let col: number;
    let row: number;

    if (slot.col != null && slot.row != null) {
      // Explicit placement
      col = slot.col;
      row = slot.row;
    } else {
      // Auto-flow: find next free spot
      const pos = advanceCursor(spanW, spanH);
      if (!pos) {
        skipped.push(i);
        continue; // grid full
      }
      col = pos.col;
      row = pos.row;
    }

    // Clamp to grid bounds
    if (col + spanW > columns || row + spanH > rows) {
      skipped.push(i);
      continue;
    }

    markOccupied(col, row, spanW, spanH);

    const rect = gridToRect(col, row, spanW, spanH, cellW, cellH, gap, padding, topPad);
    placements.push({ widget, params: slot.params ?? {}, rect });
  }

  // Step 2: Create canvas and render
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d") as unknown as CanvasRenderingContext2D;

  // Background fill (black = transparent glass, white = opaque)
  ctx.fillStyle = palette.bg;
  ctx.fillRect(0, 0, width, height);
  ctx.textBaseline = "alphabetic";

  // Draw left rail accents before widgets (grouping indicator)
  ctx.fillStyle = palette.dimGray;
  for (const { rect } of placements) {
    ctx.fillRect(rect.x, rect.y, 6, rect.h);
  }

  // Render widgets sequentially (Canvas2D context is not thread-safe)
  const rendered: string[] = [];
  let maxBottom = 0;

  for (const { widget, params, rect } of placements) {
    try {
      await widget.render(ctx, rect, params, palette);
      rendered.push(widget.id);
      maxBottom = Math.max(maxBottom, rect.y + rect.h);
    } catch (err) {
      console.error(`Widget "${widget.id}" render error:`, err);
    }
  }

  // Step 3: Encode to JPEG
  const pngBuf = canvas.toBuffer("image/png");
  const jpeg = await sharp(pngBuf).jpeg({ quality: jpegQuality }).toBuffer();

  return {
    jpeg,
    rendered,
    skipped,
    usedHeight: maxBottom,
  };
}
