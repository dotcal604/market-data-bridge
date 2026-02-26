/**
 * Widget: Movers — Top gainer & loser as multi-line panel
 *
 * Renders as ONE multi-line Text element:
 *
 *   "── MOVERS ──────────────────"
 *   "▲ AVGO  +8.2%  $247"
 *   "▼ NVDA  -3.1%  $612"
 *
 * Session-aware: "MOVERS" during regular hours, "AFTER HOURS" label otherwise.
 * Color: white (symbols carry directional meaning via ▲▼ arrows).
 *
 * Budget: 1 Text slot.
 */

import type { Widget, WidgetContext, WidgetOutput, SlotCost } from "./types.js";
import { textEl, PANEL_MOVERS_H } from "./helpers.js";
import { C, fmtPrice, fmtPct, trim } from "../screens.js";
import { runScreener } from "../../providers/yahoo.js";
import { registerWidget } from "./registry.js";

const FONT_SIZE = 36;

function sessionLabel(session: string): string {
  switch (session) {
    case "pre-market": return "── PRE-MARKET ──────────────";
    case "after-hours": return "── AFTER HOURS ─────────────";
    case "closed": return "── PRIOR SESSION ────────────";
    default: return "── TOP MOVERS ───────────────";
  }
}

function moverLine(
  dir: "▲" | "▼",
  sym: string,
  price: number | null,
  pct: number | null,
): string {
  const s = trim(sym, 6).padEnd(6);
  const p = pct !== null ? fmtPct(pct).padStart(7) : "     --";
  const px = price !== null ? `  $${fmtPrice(price)}` : "";
  return `${dir} ${s}${p}${px}`;
}

export const moversWidget: Widget = {
  id: "movers",
  name: "Top Movers",
  renderMode: "text",

  slotCost(_ctx: WidgetContext): SlotCost {
    return { text: 1, image: 0, netdata: 0 };
  },

  getHeight(_ctx: WidgetContext): number {
    return PANEL_MOVERS_H;
  },

  async render(
    ctx: WidgetContext,
    origin: { y: number; firstId: number; height: number },
  ): Promise<WidgetOutput> {
    let gainers: Array<{ symbol: string; last: number | null; changePercent: number | null }> = [];
    let losers: Array<{ symbol: string; last: number | null; changePercent: number | null }> = [];

    try {
      const [g, l] = await Promise.all([
        runScreener("day_gainers", 2).catch(() => []),
        runScreener("day_losers", 2).catch(() => []),
      ]);
      gainers = g;
      losers = l;
    } catch {
      // screeners failed — fallback text below
    }

    const g = gainers[0];
    const l = losers[0];

    const header = sessionLabel(ctx.session);
    const gLine = g?.last != null
      ? moverLine("▲", g.symbol, g.last, g.changePercent ?? null)
      : "▲ --";
    const lLine = l?.last != null
      ? moverLine("▼", l.symbol, l.last, l.changePercent ?? null)
      : "▼ --";

    const text = `${header}\n${gLine}\n${lLine}`;

    return {
      elements: [
        textEl(origin.firstId, origin.y, text, C.white, {
          height: origin.height,
          fontSize: FONT_SIZE,
        }),
      ],
    };
  },
};

registerWidget(moversWidget);
