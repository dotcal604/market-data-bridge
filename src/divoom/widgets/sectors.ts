/**
 * Widget: Sectors — Sector performance heatmap
 *
 * When chartBaseUrl is available: renders a single Image element
 * pointing at the sector-heatmap chart endpoint.
 * When no chart server: renders a text-only section header.
 *
 * Uses 1 Image slot (chart mode) or 1 Text slot (fallback).
 */

import type { Widget, WidgetContext, WidgetOutput, SlotCost } from "./types.js";
import {
  textEl,
  imageEl,
  SECTION_HEADER_SIZE,
  SECTION_HEADER_H,
  SECTION_GAP,
  HEATMAP_H,
} from "./helpers.js";
import { C } from "../screens.js";
import { registerWidget } from "./registry.js";

export const sectorsWidget: Widget = {
  id: "sectors",
  name: "Sector Heatmap",
  renderMode: "image",

  slotCost(ctx: WidgetContext): SlotCost {
    return ctx.chartBaseUrl
      ? { text: 0, image: 1, netdata: 0 }
      : { text: 1, image: 0, netdata: 0 };
  },

  getHeight(ctx: WidgetContext): number {
    // Chart mode: header baked into image, so just image + gap
    // Text mode: section header + gap
    return ctx.chartBaseUrl
      ? SECTION_HEADER_H + HEATMAP_H + SECTION_GAP
      : SECTION_HEADER_H + SECTION_GAP;
  },

  async render(
    ctx: WidgetContext,
    origin: { y: number; firstId: number },
  ): Promise<WidgetOutput> {
    if (ctx.chartBaseUrl) {
      // Single image element — the heatmap chart has its own title
      return {
        elements: [
          imageEl(
            origin.firstId,
            origin.y,
            `${ctx.chartBaseUrl}/api/divoom/charts/sector-heatmap`,
            { height: HEATMAP_H },
          ),
        ],
      };
    }

    // Text fallback — just a section header
    return {
      elements: [
        textEl(origin.firstId, origin.y, "\u25b8 SECTORS", C.cyan, {
          fontSize: SECTION_HEADER_SIZE,
          height: SECTION_HEADER_H,
        }),
      ],
    };
  },
};

registerWidget(sectorsWidget);
