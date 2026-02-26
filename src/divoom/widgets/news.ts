/**
 * Widget: News — 3-headline panel
 *
 * Renders as ONE multi-line Text element:
 *
 *   "▌ Fed signals rate cut timeline"
 *   "▌ NVDA beats on strong AI demand"
 *   "▌ Dollar rises vs yen on data"
 *
 * Each headline trimmed to ~32 chars to fit at fontSize=36 across 800px.
 * ▌ prefix adds a colored left rail at zero slot cost.
 *
 * Color: orange · BgColor: dark orange tint.
 * Budget: 1 Text slot.
 */

import type { Widget, WidgetContext, WidgetOutput, SlotCost } from "./types.js";
import { textEl, PANEL_NEWS_H, SectionBg } from "./helpers.js";
import { C, trim } from "../screens.js";
import { getNews } from "../../providers/yahoo.js";
import { registerWidget } from "./registry.js";

const FONT_SIZE = 36;
const MAX_CHARS = 32; // per headline at fontSize=36 (~21.6px/char, 768px / 21.6 ≈ 35 total, minus "> " prefix = 33, -1 margin)

export const newsWidget: Widget = {
  id: "news",
  name: "News Headlines",
  renderMode: "text",

  slotCost(_ctx: WidgetContext): SlotCost {
    return { text: 1, image: 0, netdata: 0 };
  },

  getHeight(_ctx: WidgetContext): number {
    return PANEL_NEWS_H;
  },

  async render(
    ctx: WidgetContext,
    origin: { y: number; firstId: number; height: number },
  ): Promise<WidgetOutput> {
    let lines: string[] = ["▌ No news available", "", ""];

    try {
      const news = await getNews("SPY");
      if (news.length > 0) {
        lines = news.slice(0, 3).map((n) => `▌ ${trim(n.title, MAX_CHARS)}`);
        // Pad to 3 lines so panel height is consistent
        while (lines.length < 3) lines.push("");
      }
    } catch {
      // fallback stays as-is
    }

    const text = lines.join("\n");

    return {
      elements: [
        textEl(origin.firstId, origin.y, text, C.orange, {
          height: origin.height,
          fontSize: FONT_SIZE,
          bgColor: SectionBg.news,
        }),
      ],
    };
  },
};

registerWidget(newsWidget);
