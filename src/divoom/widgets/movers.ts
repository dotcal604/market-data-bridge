/**
 * Widget: Movers — Top gainers & losers
 *
 * Shows the top 2 day gainers and top 2 day losers from Yahoo screeners.
 * Uses 5 Text slots: 1 header + 4 data rows.
 *
 * Has renderAsImage() hook for budget degradation — currently falls
 * through to text rendering. Will be backed by a movers-table chart
 * endpoint in a future iteration.
 */

import type { Widget, WidgetContext, WidgetOutput, SlotCost } from "./types.js";
import {
  textEl,
  SECTION_HEADER_SIZE,
  SECTION_HEADER_H,
  DATA_SIZE,
  DATA_H,
  SECTION_GAP,
} from "./helpers.js";
import { C, changeColor, fmtPrice, fmtPct, trim } from "../screens.js";
import { runScreener } from "../../providers/yahoo.js";
import { registerWidget } from "./registry.js";

const MOVER_ROWS = 4;
const ROW_H = DATA_H - 2;
const ROW_FONT = DATA_SIZE - 2;

export const moversWidget: Widget = {
  id: "movers",
  name: "Top Movers",
  renderMode: "text",

  slotCost(_ctx: WidgetContext): SlotCost {
    // 1 header + 4 data rows
    return { text: 1 + MOVER_ROWS, image: 0, netdata: 0 };
  },

  getHeight(_ctx: WidgetContext): number {
    return SECTION_HEADER_H + MOVER_ROWS * ROW_H + SECTION_GAP;
  },

  async render(
    _ctx: WidgetContext,
    origin: { y: number; firstId: number },
  ): Promise<WidgetOutput> {
    const elements = [];
    let id = origin.firstId;
    let y = origin.y;

    // Section header
    elements.push(
      textEl(id++, y, "\u25b8 MOVERS", C.cyan, {
        fontSize: SECTION_HEADER_SIZE,
        height: SECTION_HEADER_H,
      }),
    );
    y += SECTION_HEADER_H;

    // Fetch top gainers and losers in parallel
    let gainers: Array<{ symbol: string; last: number | null; changePercent: number | null }> = [];
    let losers: Array<{ symbol: string; last: number | null; changePercent: number | null }> = [];

    try {
      const [g, l] = await Promise.all([
        runScreener("day_gainers", 3).catch(() => []),
        runScreener("day_losers", 3).catch(() => []),
      ]);
      gainers = g;
      losers = l;
    } catch {
      // Both screeners failed — will show fallback below
    }

    const rows: Array<{ text: string; color: string }> = [];

    // Top 2 gainers
    for (let i = 0; i < 2; i++) {
      const g = gainers[i];
      if (g && g.last != null) {
        const sym = trim(g.symbol, 6).padEnd(6);
        const price = fmtPrice(g.last);
        const pct = fmtPct(g.changePercent ?? 0);
        rows.push({ text: `${sym}$${price}  ${pct}`, color: C.green });
      }
    }

    // Top 2 losers
    for (let i = 0; i < 2; i++) {
      const l = losers[i];
      if (l && l.last != null) {
        const sym = trim(l.symbol, 6).padEnd(6);
        const price = fmtPrice(l.last);
        const pct = fmtPct(l.changePercent ?? 0);
        rows.push({ text: `${sym}$${price}  ${pct}`, color: C.red });
      }
    }

    // Fallback if no data
    if (rows.length === 0) {
      rows.push({ text: "  No mover data", color: C.gray });
    }

    // Pad to exactly MOVER_ROWS for consistent height
    while (rows.length < MOVER_ROWS) {
      rows.push({ text: "", color: C.gray });
    }

    // Emit data rows
    for (let i = 0; i < MOVER_ROWS; i++) {
      const row = rows[i];
      elements.push(
        textEl(id++, y, row.text, row.color, {
          fontSize: ROW_FONT,
          height: ROW_H,
        }),
      );
      y += ROW_H;
    }

    return { elements };
  },

  /**
   * Image fallback for budget degradation.
   * Currently passes through to text render. When the movers-table
   * chart endpoint is implemented, this will emit a single Image
   * element instead, saving 5 Text slots for 1 Image slot.
   */
  async renderAsImage(
    ctx: WidgetContext,
    origin: { y: number; firstId: number },
  ): Promise<WidgetOutput> {
    // TODO: when chart endpoint is ready, render as:
    // imageEl(origin.firstId, origin.y,
    //   `${ctx.chartBaseUrl}/api/divoom/charts/movers-table`,
    //   { height: this.getHeight(ctx) - SECTION_GAP })
    return this.render(ctx, origin);
  },
};

registerWidget(moversWidget);
