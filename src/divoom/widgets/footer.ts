/**
 * Widget: Footer — Session countdown + data source
 *
 * 1-line status footer with live countdown to next session milestone:
 *
 *   Regular:     "Closes 16:00 · 2h 38m · Yahoo"
 *   After-hours: "AH ends 20:00 · 1h 12m · Yahoo"
 *   Pre-market:  "Opens 09:30 · 45m · IBKR+Yahoo"
 *   Closed:      "Opens Mon 09:30 · 12h 08m · Yahoo"
 *
 * Countdown recalculated every 10s cycle — always accurate.
 * Handles weekend transitions (Fri→Mon = 3 days).
 * Small font, gray color — purely informational context.
 *
 * Budget: 1 Text slot.
 */

import type { Widget, WidgetContext, WidgetOutput, SlotCost } from "./types.js";
import { textEl, PANEL_FOOTER_H } from "./helpers.js";
import { C } from "../screens.js";
import { registerWidget } from "./registry.js";

const FONT_SIZE = 30;
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Get current ET Date. */
function etNow(): Date {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
}

/** Next trading day abbreviation based on current ET day/time. */
function nextOpenDay(): string {
  const et = etNow();
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

/**
 * Countdown string from now (ET) to a target hour:minute today or next trading day.
 * Returns "2h 38m" or "45m" or "< 1m".
 */
function countdown(targetHour: number, targetMin: number, nextDay = false): string {
  const et = etNow();
  const now = et.getHours() * 60 + et.getMinutes();
  let target = targetHour * 60 + targetMin;

  if (nextDay) {
    // Calculate to next trading day
    const day = et.getDay();
    let daysUntil = 1;
    if (day === 5) daysUntil = 3;       // Friday → Monday
    else if (day === 6) daysUntil = 2;   // Saturday → Monday
    else if (day === 0) daysUntil = 1;   // Sunday → Monday
    target += daysUntil * 24 * 60 - now; // remaining minutes today + days
    const hours = Math.floor(target / 60);
    const mins = target % 60;
    if (hours > 0) return `${hours}h ${mins}m`;
    return mins > 0 ? `${mins}m` : "< 1m";
  }

  const diff = target - now;
  if (diff <= 0) return "< 1m";
  const hours = Math.floor(diff / 60);
  const mins = diff % 60;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function footerText(session: string, ibkrConnected: boolean): string {
  const src = ibkrConnected ? "IBKR+Yahoo" : "Yahoo";
  switch (session) {
    case "pre-market":
      return `| Opens 09:30 · ${countdown(9, 30)} · ${src}`;
    case "regular":
      return `| Closes 16:00 · ${countdown(16, 0)} · ${src}`;
    case "after-hours":
      return `| AH ends 20:00 · ${countdown(20, 0)} · ${src}`;
    case "closed":
      return `| Opens ${nextOpenDay()} 09:30 · ${countdown(9, 30, true)} · ${src}`;
    default:
      return `| ${src} · Market Bridge`;
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
