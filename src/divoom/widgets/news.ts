/**
 * Widget: News — 3-headline panel
 *
 * Dual-mode rendering:
 *
 *   Image mode (chartBaseUrl available):
 *     Server-rendered news panel with title + 3 headlines.
 *     Image mode uses a smaller font (18px) so headlines can be LONGER
 *     (~55 chars vs 32 in Text mode) — much more informative.
 *
 *       ┌─────────────────────────────────────┐
 *       │  ▸ NEWS                             │  ← orange title
 *       │  Fed signals gradual rate cut path   │  ← white headline
 *       │  NVDA beats estimates on AI demand   │  ← white headline
 *       │  Dollar rises against yen on data    │  ← white headline
 *       └─────────────────────────────────────┘
 *
 *     Cost: 0 Text + 1 Image + 0 NetData
 *
 *   Text fallback (no chartBaseUrl):
 *     Compact 3-line multi-line Text panel (original format).
 *     Cost: 1 Text + 0 Image + 0 NetData
 *
 * The Image path saves 1 Text slot and allows longer headlines.
 */

import type { Widget, WidgetContext, WidgetOutput, SlotCost } from "./types.js";
import { textEl, imageEl, PANEL_NEWS_H, SectionBg } from "./helpers.js";
import { C, trim } from "../screens.js";
import { renderNewsPanel, setCachedChart } from "../charts.js";
import { getNews } from "../../providers/yahoo.js";
import { registerWidget } from "./registry.js";

// ─── Image-mode constants ─────────────────────────────────────
const IMAGE_FONT = 18;
const IMAGE_ROW_H = 32;
const IMAGE_TITLE_H = 28;
const IMAGE_H = IMAGE_TITLE_H + 3 * IMAGE_ROW_H; // 28 + 3×32 = 124px
const IMAGE_MAX_CHARS = 55; // ~55 chars at 18px fits 768px comfortably

// ─── Text-mode constants (fallback) ───────────────────────────
const TEXT_FONT_SIZE = 36;
const TEXT_MAX_CHARS = 32; // per headline at fontSize=36 (~21.6px/char, 768px width)

// ─── Widget ───────────────────────────────────────────────────

export const newsWidget: Widget = {
  id: "news",
  name: "News Headlines",

  // Dual-mode: Image when charts available, Text fallback otherwise
  renderMode: "text", // base mode for flex engine (text widgets get flex height)

  slotCost(ctx: WidgetContext): SlotCost {
    if (ctx.chartBaseUrl) {
      return { text: 0, image: 1, netdata: 0 }; // Image mode — saves 1 Text slot
    }
    return { text: 1, image: 0, netdata: 0 }; // Text fallback
  },

  getHeight(ctx: WidgetContext): number {
    if (ctx.chartBaseUrl) {
      return IMAGE_H; // Fixed: 28 + 3×32 = 124px
    }
    return PANEL_NEWS_H; // Flex minimum: 160px (engine stretches)
  },

  async render(
    ctx: WidgetContext,
    origin: { y: number; firstId: number; height: number },
  ): Promise<WidgetOutput> {
    // Fetch news (same data either way)
    let headlines: string[] = [];

    try {
      const news = await getNews("SPY");
      if (news.length > 0) {
        headlines = news.slice(0, 3).map((n) => n.title);
      }
    } catch {
      // empty headlines triggers fallback styling
    }

    // ── Image mode: server-rendered news panel ────────────────
    if (ctx.chartBaseUrl) {
      const displayLines = headlines.length > 0
        ? headlines.map((h) => trim(h, IMAGE_MAX_CHARS))
        : ["No news available", "", ""];

      // Pad to 3 lines for consistent height
      while (displayLines.length < 3) displayLines.push("");

      const buffer = await renderNewsPanel("▸ NEWS", displayLines, {
        rowHeight: IMAGE_ROW_H,
        titleHeight: IMAGE_TITLE_H,
        fontSize: IMAGE_FONT,
        titleColor: C.orange,
        bgColor: "#181008", // dark amber tint (matches SectionBg.news)
      });
      setCachedChart("news-panel", buffer);

      return {
        elements: [
          imageEl(
            origin.firstId,
            origin.y,
            `${ctx.chartBaseUrl}/api/divoom/charts/news-panel`,
            { height: origin.height },
          ),
        ],
      };
    }

    // ── Text fallback: compact 3-line panel ───────────────────
    let lines: string[] = ["| No news available", "", ""];
    if (headlines.length > 0) {
      lines = headlines.map((h) => `| ${trim(h, TEXT_MAX_CHARS)}`);
      while (lines.length < 3) lines.push("");
    }

    const text = lines.join("\n");

    return {
      elements: [
        textEl(origin.firstId, origin.y, text, C.orange, {
          height: origin.height,
          fontSize: TEXT_FONT_SIZE,
          bgColor: SectionBg.news,
        }),
      ],
    };
  },
};

registerWidget(newsWidget);
