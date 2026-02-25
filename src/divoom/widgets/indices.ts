/**
 * Widget: Indices — Major index quotes + VIX
 *
 * Shows SPY, QQQ, DIA, IWM with price and change %, plus VIX
 * with fear-level coloring. Fetches all quotes in parallel.
 *
 * Uses 5 Text slots (4 indices + 1 VIX) for real-time feel.
 */

import type { Widget, WidgetContext, WidgetOutput, SlotCost } from "./types.js";
import { textEl, DATA_SIZE, DATA_H, SECTION_GAP } from "./helpers.js";
import { C, changeColor, fmtPrice, fmtPct, smartQuote } from "../screens.js";
import { registerWidget } from "./registry.js";

const INDEX_SYMBOLS = ["SPY", "QQQ", "DIA", "IWM"] as const;
const VIX_SYMBOL = "^VIX";

function vixColor(level: number): string {
  if (level > 25) return C.red;
  if (level > 20) return C.orange;
  if (level > 15) return C.yellow;
  return C.green;
}

export const indicesWidget: Widget = {
  id: "indices",
  name: "Major Indices",
  renderMode: "text",

  slotCost(_ctx: WidgetContext): SlotCost {
    return { text: 5, image: 0, netdata: 0 };
  },

  getHeight(_ctx: WidgetContext): number {
    return 5 * DATA_H + SECTION_GAP;
  },

  async render(
    ctx: WidgetContext,
    origin: { y: number; firstId: number },
  ): Promise<WidgetOutput> {
    // Fetch all 5 quotes in parallel
    const [spyQ, qqqQ, diaQ, iwmQ, vixQ] = await Promise.all([
      smartQuote(INDEX_SYMBOLS[0]).catch(() => null),
      smartQuote(INDEX_SYMBOLS[1]).catch(() => null),
      smartQuote(INDEX_SYMBOLS[2]).catch(() => null),
      smartQuote(INDEX_SYMBOLS[3]).catch(() => null),
      smartQuote(VIX_SYMBOL).catch(() => null),
    ]);

    const quotes = [
      { symbol: "SPY", q: spyQ },
      { symbol: "QQQ", q: qqqQ },
      { symbol: "DIA", q: diaQ },
      { symbol: "IWM", q: iwmQ },
    ];

    const elements = [];
    let id = origin.firstId;
    let y = origin.y;

    // Index rows
    for (const { symbol, q } of quotes) {
      if (q) {
        const text = `${symbol.padEnd(5)} $${fmtPrice(q.last)}  ${fmtPct(q.changePercent)}`;
        const color = changeColor(q.changePercent);
        elements.push(textEl(id, y, text, color, { fontSize: DATA_SIZE }));
      } else {
        elements.push(textEl(id, y, `${symbol.padEnd(5)} --  --`, C.gray, { fontSize: DATA_SIZE }));
      }
      id++;
      y += DATA_H;
    }

    // VIX row
    if (vixQ) {
      const text = `VIX   $${fmtPrice(vixQ.last)}  ${fmtPct(vixQ.changePercent)}`;
      elements.push(textEl(id, y, text, vixColor(vixQ.last), { fontSize: DATA_SIZE }));
    } else {
      elements.push(textEl(id, y, "VIX   --  --", C.gray, { fontSize: DATA_SIZE }));
    }

    return { elements };
  },
};

registerWidget(indicesWidget);
