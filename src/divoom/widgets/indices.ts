/**
 * Widget: Indices — Major index quotes + VIX + SPY sparkline
 *
 * Renders as ONE multi-line Text element (panel-style):
 *
 *   "████ SPY ▲+1.24%   QQQ ▲+1.73%"
 *   "     DIA ▲+0.57%   IWM ▲+0.45%"
 *   "     VIX 18.4⚡  ⡀⡄⡀⣄⡄⡀⣤⣴⣤⣠"
 *
 * Uses \n to separate rows within a single Text element.
 * Height = PANEL_INDICES_H (280px) to accommodate 3 lines at large font.
 *
 * Budget: 1 Text slot (was 2 — freeing a slot for footer widget).
 */

import type { Widget, WidgetContext, WidgetOutput, SlotCost } from "./types.js";
import { textEl, brailleSparkline, PANEL_INDICES_H } from "./helpers.js";
import { C, changeColor, fmtPct, smartQuote } from "../screens.js";
import { getHistoricalBars } from "../../providers/yahoo.js";
import { registerWidget } from "./registry.js";

const INDEX_SYMBOLS = ["SPY", "QQQ", "DIA", "IWM"] as const;
const VIX_SYMBOL = "^VIX";

const FONT_SIZE = 36;
const SPARKLINE_WIDTH = 12; // braille chars after VIX label

function vixLabel(level: number): string {
  if (level > 25) return `VIX ${Math.round(level)}⚡⚡`;
  if (level > 20) return `VIX ${Math.round(level)}⚡`;
  return `VIX ${Math.round(level)}`;
}

function vixColor(level: number): string {
  if (level > 25) return C.red;
  if (level > 20) return C.orange;
  if (level > 15) return C.yellow;
  return C.green;
}

function arrow(pct: number | null): string {
  if (pct === null) return "·";
  return pct >= 0 ? "▲" : "▼";
}

export const indicesWidget: Widget = {
  id: "indices",
  name: "Major Indices",
  renderMode: "text",

  slotCost(_ctx: WidgetContext): SlotCost {
    // Now 1 Text slot (was 2) — collapsed into a multi-line panel
    return { text: 1, image: 0, netdata: 0 };
  },

  getHeight(_ctx: WidgetContext): number {
    return PANEL_INDICES_H;
  },

  async render(
    ctx: WidgetContext,
    origin: { y: number; firstId: number; height: number },
  ): Promise<WidgetOutput> {
    const [spyQ, qqqQ, diaQ, iwmQ, vixQ, spyBars] = await Promise.all([
      smartQuote(INDEX_SYMBOLS[0]).catch(() => null),
      smartQuote(INDEX_SYMBOLS[1]).catch(() => null),
      smartQuote(INDEX_SYMBOLS[2]).catch(() => null),
      smartQuote(INDEX_SYMBOLS[3]).catch(() => null),
      smartQuote(VIX_SYMBOL).catch(() => null),
      getHistoricalBars("SPY", "1mo", "1d").catch(() => []),
    ]);

    // ── Line 1: SPY + QQQ ─────────────────────────────────────────────
    const spyArrow = arrow(spyQ?.changePercent ?? null);
    const qqqArrow = arrow(qqqQ?.changePercent ?? null);
    const line1 = spyQ && qqqQ
      ? `████ SPY ${spyArrow}${fmtPct(spyQ.changePercent)}  QQQ ${qqqArrow}${fmtPct(qqqQ.changePercent)}`
      : `████ SPY --  QQQ --`;

    // ── Line 2: DIA + IWM ─────────────────────────────────────────────
    const diaArrow = arrow(diaQ?.changePercent ?? null);
    const iwmArrow = arrow(iwmQ?.changePercent ?? null);
    const line2 = diaQ && iwmQ
      ? `     DIA ${diaArrow}${fmtPct(diaQ.changePercent)}  IWM ${iwmArrow}${fmtPct(iwmQ.changePercent)}`
      : `     DIA --  IWM --`;

    // ── Line 3: VIX + braille sparkline ───────────────────────────────
    const vixPart = vixQ ? vixLabel(vixQ.last) : "VIX --";
    const sparkline = spyBars.length > 2
      ? "  " + brailleSparkline(spyBars.map((b) => b.close), SPARKLINE_WIDTH)
      : "";
    const line3 = `     ${vixPart}${sparkline}`;

    // Color driven by SPY direction; VIX level overrides for danger
    const mainColor = vixQ && vixQ.last > 25
      ? vixColor(vixQ.last)
      : spyQ ? changeColor(spyQ.changePercent) : C.gray;

    const text = `${line1}\n${line2}\n${line3}`;

    return {
      elements: [
        textEl(origin.firstId, origin.y, text, mainColor, {
          height: origin.height,
          fontSize: FONT_SIZE,
        }),
      ],
    };
  },
};

registerWidget(indicesWidget);
