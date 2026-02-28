/**
 * Widget: Indicators — RSI + VIX gauge pair
 *
 * Pure Image widget — two side-by-side gauge images.
 * Each gauge is self-labeled ("RSI", "VIX") via the chart renderer,
 * so no Text header is needed. This keeps the Text budget untouched.
 *
 * Cost: 0 Text + 2 Image + 0 NetData
 *
 * Self-disables (height → 0) when chartBaseUrl is not configured.
 * Gauges are 200×120px each, centered in the 768px content area
 * with a visual gap between them for breathing room.
 */

import type { Widget, WidgetContext, WidgetOutput, SlotCost } from "./types.js";
import { imageEl, GAUGE_W, GAUGE_H, SECTION_GAP, CANVAS_W } from "./helpers.js";
import { registerWidget } from "./registry.js";

// Layout: two 200px gauges centered in 800px canvas with a gap between them
//   |--- pad ---|  [RSI 200px]  |-- gap --|  [VIX 200px]  |--- pad ---|
const GAUGE_GAP = 40;
const PAIR_W = GAUGE_W * 2 + GAUGE_GAP; // 200 + 200 + 40 = 440
const LEFT_X = Math.floor((CANVAS_W - PAIR_W) / 2); // (800 - 440) / 2 = 180
const RIGHT_X = LEFT_X + GAUGE_W + GAUGE_GAP;        // 180 + 200 + 40 = 420

export const indicatorsWidget: Widget = {
  id: "indicators",
  name: "Technical Indicators",
  renderMode: "image",

  slotCost(_ctx: WidgetContext): SlotCost {
    // Pure image — no text budget impact
    return { text: 0, image: 2, netdata: 0 };
  },

  getHeight(ctx: WidgetContext): number {
    if (ctx.chartBaseUrl === undefined) return 0; // self-disable without charts
    return GAUGE_H + SECTION_GAP; // 120 + 12 = 132px (fixed)
  },

  async render(
    ctx: WidgetContext,
    origin: { y: number; firstId: number; height: number },
  ): Promise<WidgetOutput> {
    if (ctx.chartBaseUrl === undefined) {
      return { elements: [] };
    }

    const url = ctx.chartBaseUrl;

    return {
      elements: [
        // RSI gauge — left
        imageEl(origin.firstId, origin.y, `${url}/api/divoom/charts/rsi-gauge`, {
          width: GAUGE_W,
          height: GAUGE_H,
          startX: LEFT_X,
          align: 0,
        }),
        // VIX gauge — right
        imageEl(origin.firstId + 1, origin.y, `${url}/api/divoom/charts/vix-gauge`, {
          width: GAUGE_W,
          height: GAUGE_H,
          startX: RIGHT_X,
          align: 0,
        }),
      ],
    };
  },
};

registerWidget(indicatorsWidget);
