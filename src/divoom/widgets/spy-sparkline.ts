/**
 * Widget: SPY Sparkline — Intraday price chart
 *
 * Renders a server-generated sparkline PNG for SPY.
 * Opts out (height 0) when chartBaseUrl is not configured.
 *
 * Uses 1 Image slot — no Text budget impact.
 */

import type { Widget, WidgetContext, WidgetOutput, SlotCost } from "./types.js";
import { imageEl, SPARKLINE_H, SECTION_GAP } from "./helpers.js";
import { registerWidget } from "./registry.js";

export const spySparklineWidget: Widget = {
  id: "spy-sparkline",
  name: "SPY Sparkline",
  renderMode: "image",

  slotCost(_ctx: WidgetContext): SlotCost {
    return { text: 0, image: 1, netdata: 0 };
  },

  getHeight(ctx: WidgetContext): number {
    if (ctx.chartBaseUrl === undefined) return 0;
    return SPARKLINE_H + SECTION_GAP;
  },

  async render(
    ctx: WidgetContext,
    origin: { y: number; firstId: number; height: number },
  ): Promise<WidgetOutput> {
    if (ctx.chartBaseUrl === undefined) {
      return { elements: [] };
    }

    const url = `${ctx.chartBaseUrl}/api/divoom/charts/spy-sparkline`;

    return {
      elements: [
        imageEl(origin.firstId, origin.y, url, { height: SPARKLINE_H }),
      ],
    };
  },
};

registerWidget(spySparklineWidget);
