/**
 * Widget: Movers — Top 2 gainers & 2 losers
 *
 * Renders as ONE multi-line Text element (up to 5 lines):
 *
 *   "▌── TOP MOVERS ──────────────"
 *   "▌ ▲ AVGO    +8.2%  $247"
 *   "▌ ▲ MSFT    +3.1%  $421"
 *   "▌ ▼ NVDA    -3.1%  $612"
 *   "▌ ▼ TSLA    -2.4%  $189"
 *
 * Graceful degradation: if screener returns <2 results, empty
 * lines are filtered out (5 → 4 → 3 lines).
 *
 * Session-aware header: "TOP MOVERS" (regular), "AFTER HOURS",
 * "PRE-MARKET", "PRIOR SESSION" (closed).
 *
 * Color: magenta · BgColor: dark magenta tint.
 * Budget: 1 Text slot.
 */

import type { Widget, WidgetContext, WidgetOutput, SlotCost } from "./types.js";
import { textEl, PANEL_MOVERS_H, SectionBg } from "./helpers.js";
import { C, fmtPrice, fmtPct, trim } from "../screens.js";
import { runScreener } from "../../providers/yahoo.js";
import { registerWidget } from "./registry.js";

const FONT_SIZE = 36;

function sessionLabel(session: string): string {
  switch (session) {
    case "pre-market": return "▌── PRE-MARKET ─────────────";
    case "after-hours": return "▌── AFTER HOURS ────────────";
    case "closed": return "▌── PRIOR SESSION ───────────";
    default: return "▌── TOP MOVERS ──────────────";
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
  return `▌ ${dir} ${s}${p}${px}`;
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

    const [g1, g2] = gainers;
    const [l1, l2] = losers;

    const header = sessionLabel(ctx.session);
    const gLine1 = g1?.last != null
      ? moverLine("▲", g1.symbol, g1.last, g1.changePercent ?? null)
      : "▌ ▲ --";
    const gLine2 = g2?.last != null
      ? moverLine("▲", g2.symbol, g2.last, g2.changePercent ?? null)
      : "";
    const lLine1 = l1?.last != null
      ? moverLine("▼", l1.symbol, l1.last, l1.changePercent ?? null)
      : "▌ ▼ --";
    const lLine2 = l2?.last != null
      ? moverLine("▼", l2.symbol, l2.last, l2.changePercent ?? null)
      : "";

    const text = [header, gLine1, gLine2, lLine1, lLine2]
      .filter(Boolean)
      .join("\n");

    return {
      elements: [
        textEl(origin.firstId, origin.y, text, C.magenta, {
          height: origin.height,
          fontSize: FONT_SIZE,
          bgColor: SectionBg.movers,
        }),
      ],
    };
  },
};

registerWidget(moversWidget);
