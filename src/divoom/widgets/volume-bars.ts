/**
 * Widget: Volume Bars — Intraday volume chart
 *
 * Renders a server-generated volume bar chart image.
 * Opts out (height 0) when chartBaseUrl is not configured.
 *
 * Uses 1 Image slot — no Text budget impact.
 */

import type { Widget, WidgetContext, WidgetOutput, SlotCost } from "./types.js";
import { imageEl, VOLUME_H, SECTION_GAP } from "./helpers.js";
import { registerWidget } from "./registry.js";

export const volumeBarsWidget: Widget = {
  id: "volume-bars",
  name: "Volume Bars",
  renderMode: "image",

  slotCost(_ctx: WidgetContext): SlotCost {
    return { text: 0, image: 1, netdata: 0 };
  },

  getHeight(ctx: WidgetContext): number {
    if (ctx.chartBaseUrl === undefined) return 0;
    return VOLUME_H + SECTION_GAP;
  },

  async render(
    ctx: WidgetContext,
    origin: { y: number; firstId: number; height: number },
  ): Promise<WidgetOutput> {
    if (ctx.chartBaseUrl === undefined) {
      return { elements: [] };
    }

    const url = `${ctx.chartBaseUrl}/api/divoom/charts/volume-bars`;

    return {
      elements: [
        imageEl(origin.firstId, origin.y, url, { height: VOLUME_H }),
      ],
    };
  },
};

registerWidget(volumeBarsWidget);
