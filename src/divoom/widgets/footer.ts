/**
 * Widget: Footer — Data source attribution + market close time
 *
 * Fills the bottom of the canvas with a 1-line status footer:
 *
 *   Regular:    "Yahoo Finance · Market Bridge"
 *   After-hours: "AH ends 20:00 ET · Bridge v1"
 *   Closed:     "Opens Thu 09:30 ET · Yahoo Fin."  (day computed dynamically)
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
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Next trading day abbreviation based on current ET day/time. */
function nextOpenDay(): string {
  const et = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day = et.getDay(); // 0=Sun .. 6=Sat
  const hour = et.getHours();

  // Weekend or Friday evening → Monday
  if (day === 0 || day === 6 || (day === 5 && hour >= 20))
    return "Mon";

  // Weekday evening (Mon–Thu after 20:00) → tomorrow
  if (hour >= 20) return DAY_NAMES[day + 1];

  // Weekday early AM (before pre-market at 04:00) → today
  return DAY_NAMES[day];
}

function footerText(session: string, ibkrConnected: boolean): string {
  const src = ibkrConnected ? "IBKR + Yahoo" : "Yahoo Finance";
  switch (session) {
    case "pre-market":   return `Pre-mkt ends 09:30 ET · ${src}`;
    case "regular":      return `${src} · Market Bridge`;
    case "after-hours":  return `AH ends 20:00 ET · ${src}`;
    case "closed":       return `Opens ${nextOpenDay()} 09:30 ET · ${src}`;
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
          align: 0, // left (Align:1 = right on device firmware)
          fontSize: FONT_SIZE,
          height: origin.height,
        }),
      ],
    };
  },
};

registerWidget(footerWidget);
