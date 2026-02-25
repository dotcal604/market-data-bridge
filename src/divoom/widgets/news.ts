/**
 * Widget: News — Top headlines ticker
 *
 * Fetches top 3 market headlines via Yahoo Finance and displays them
 * as compact text rows beneath a section header.
 *
 * Uses 4 Text slots (1 header + 3 headlines).
 * Has renderAsImage fallback hook for future image-rendered ticker.
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
import { C, trim } from "../screens.js";
import { getNews } from "../../providers/yahoo.js";
import { registerWidget } from "./registry.js";

const HEADLINE_FONT_SIZE = DATA_SIZE - 4;  // 26
const HEADLINE_ROW_H = DATA_H - 4;         // 30
const HEADLINE_COUNT = 3;

export const newsWidget: Widget = {
  id: "news",
  name: "News Headlines",
  renderMode: "text",

  slotCost(_ctx: WidgetContext): SlotCost {
    return { text: 4, image: 0, netdata: 0 };
  },

  getHeight(_ctx: WidgetContext): number {
    // header + 3 headline rows + gap
    return SECTION_HEADER_H + HEADLINE_COUNT * HEADLINE_ROW_H + SECTION_GAP;
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
      textEl(id++, y, "\u25b8 NEWS", C.cyan, {
        fontSize: SECTION_HEADER_SIZE,
        height: SECTION_HEADER_H,
      }),
    );
    y += SECTION_HEADER_H;

    // Fetch headlines
    let headlines: string[];
    try {
      const news = await getNews("SPY");
      headlines = news
        .slice(0, HEADLINE_COUNT)
        .map((item) => trim(item.title, 40));
    } catch {
      headlines = [];
    }

    // Pad to exactly 3 rows
    while (headlines.length < HEADLINE_COUNT) {
      headlines.push("  No news available");
    }

    for (const headline of headlines) {
      const color = headline.startsWith("  No news") ? C.gray : C.white;
      elements.push(
        textEl(id++, y, headline, color, {
          fontSize: HEADLINE_FONT_SIZE,
          height: HEADLINE_ROW_H,
        }),
      );
      y += HEADLINE_ROW_H;
    }

    return { elements };
  },

  /** Passthrough to render() — hook for future image-rendered news ticker. */
  async renderAsImage(
    ctx: WidgetContext,
    origin: { y: number; firstId: number },
  ): Promise<WidgetOutput> {
    return this.render(ctx, origin);
  },
};

registerWidget(newsWidget);
