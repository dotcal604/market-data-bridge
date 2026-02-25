/**
 * Widget: Footer — Data source attribution + market close time
 *
 * Fills the bottom of the canvas with a 1-line status footer:
 *
 *   Regular:    "Yahoo Finance · Market Bridge"
 *   After-hours: "AH ends 20:00 ET · Bridge v1"
 *   Closed:     "Opens 09:30 Mon · Yahoo Fin."
 *
 * Small font, gray color — purely informational context.
 * Uses the 6th text slot freed when indices collapsed from 2T to 1T.
 *
 * Budget: 1 Text slot.
 */

import type { Widget, WidgetContext, WidgetOutput, SlotCost } from "./types.js";
import { textEl, PANEL_FOOTER_H } from "./helpers.js";
import { C } from "../screens.js";
import { registerWidget } from "./registry.js";

const FONT_SIZE = 30;

function footerText(session: string, ibkrConnected: boolean): string {
  const src = ibkrConnected ? "IBKR + Yahoo" : "Yahoo Finance";
  switch (session) {
    case "pre-market":   return `Pre-mkt ends 09:30 ET · ${src}`;
    case "regular":      return `${src} · Market Bridge`;
    case "after-hours":  return `AH ends 20:00 ET · ${src}`;
    case "closed":       return `Opens Mon 09:30 ET · ${src}`;
    default:             return `${src} · Market Bridge`;
  }
}

export const footerWidget: Widget = {
  id: "footer",
  name: "Footer",
  renderMode: "text",

  slotCost(_ctx: WidgetContext): SlotCost {
    return { text: 1, image: 0, netdata: 0 };
  },

  getHeight(_ctx: WidgetContext): number {
    return PANEL_FOOTER_H;
  },

  async render(
    ctx: WidgetContext,
    origin: { y: number; firstId: number; height: number },
  ): Promise<WidgetOutput> {
    const text = footerText(ctx.session, ctx.ibkrConnected);

    return {
      elements: [
        textEl(origin.firstId, origin.y, text, C.gray, {
          align: 1, // centered
          fontSize: FONT_SIZE,
          height: origin.height,
        }),
      ],
    };
  },
};

registerWidget(footerWidget);
