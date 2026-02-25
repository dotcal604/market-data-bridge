/**
 * Widget: Indicators — RSI / EMA / ATR gauges & text
 *
 * When chartBaseUrl is available:
 *   Renders a section header + 2 gauge images (RSI + VIX).
 *   Cost: 1 Text + 2 Image slots.
 *
 * When chartBaseUrl is unavailable:
 *   Renders a section header + 3 indicator text rows.
 *   Cost: 4 Text + 0 Image slots.
 *
 * Indicator values are placeholders until real indicator fetchers are wired in.
 */

import type { Widget, WidgetContext, WidgetOutput, SlotCost } from "./types.js";
import {
  textEl,
  imageEl,
  SECTION_HEADER_SIZE,
  SECTION_HEADER_H,
  DATA_SIZE,
  DATA_H,
  SECTION_GAP,
  GAUGE_W,
  GAUGE_H,
  CANVAS_W,
  PAD_X,
} from "./helpers.js";
import { C } from "../screens.js";
import { registerWidget } from "./registry.js";

// Placeholder indicator values (will be replaced by real fetchers)
const PLACEHOLDER_RSI = 55.2;
const PLACEHOLDER_EMA_BULL = true;
const PLACEHOLDER_ATR = 3.42;

const INDICATOR_ROW_H = DATA_H - 2; // 32

function rsiColor(rsi: number): string {
  if (rsi > 70) return C.red;
  if (rsi < 30) return C.green;
  return C.yellow;
}

export const indicatorsWidget: Widget = {
  id: "indicators",
  name: "Technical Indicators",
  renderMode: "text",

  slotCost(ctx: WidgetContext): SlotCost {
    if (ctx.chartBaseUrl) {
      return { text: 1, image: 2, netdata: 0 };
    }
    return { text: 4, image: 0, netdata: 0 };
  },

  getHeight(ctx: WidgetContext): number {
    if (ctx.chartBaseUrl) {
      // header + gauges + gap
      return SECTION_HEADER_H + GAUGE_H + SECTION_GAP;
    }
    // header + 3 indicator rows + gap
    return SECTION_HEADER_H + 3 * INDICATOR_ROW_H + SECTION_GAP;
  },

  async render(
    ctx: WidgetContext,
    origin: { y: number; firstId: number; height: number },
  ): Promise<WidgetOutput> {
    const elements = [];
    let id = origin.firstId;
    let y = origin.y;

    // Section header
    elements.push(
      textEl(id++, y, "\u25b8 INDICATORS", C.cyan, {
        fontSize: SECTION_HEADER_SIZE,
        height: SECTION_HEADER_H,
      }),
    );
    y += SECTION_HEADER_H;

    if (ctx.chartBaseUrl) {
      // Chart mode: 2 gauge images side-by-side
      const url = ctx.chartBaseUrl;

      elements.push(
        imageEl(id++, y, `${url}/api/divoom/charts/rsi-gauge`, {
          width: GAUGE_W,
          height: GAUGE_H,
          startX: PAD_X,
          align: 0,
        }),
      );

      elements.push(
        imageEl(id++, y, `${url}/api/divoom/charts/vix-gauge`, {
          width: GAUGE_W,
          height: GAUGE_H,
          startX: CANVAS_W - PAD_X - GAUGE_W,
          align: 0,
        }),
      );
    } else {
      // Text-only mode: 3 indicator rows
      const rsi = PLACEHOLDER_RSI;
      const emaBull = PLACEHOLDER_EMA_BULL;
      const atr = PLACEHOLDER_ATR;

      elements.push(
        textEl(id++, y, `RSI(14): ${rsi.toFixed(1)}`, rsiColor(rsi), {
          fontSize: DATA_SIZE,
          height: INDICATOR_ROW_H,
        }),
      );
      y += INDICATOR_ROW_H;

      elements.push(
        textEl(
          id++,
          y,
          `EMA 9/21: ${emaBull ? "Bull" : "Bear"}`,
          emaBull ? C.green : C.red,
          { fontSize: DATA_SIZE, height: INDICATOR_ROW_H },
        ),
      );
      y += INDICATOR_ROW_H;

      elements.push(
        textEl(id++, y, `ATR(14): $${atr.toFixed(2)}`, C.white, {
          fontSize: DATA_SIZE,
          height: INDICATOR_ROW_H,
        }),
      );
    }

    return { elements };
  },
};

registerWidget(indicatorsWidget);
