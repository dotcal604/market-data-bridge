/**
 * Widget: Header — Session status badge
 *
 * Shows current market session, connection mode, and Eastern Time.
 * Format: "OPEN · LIVE · 14:22 ET"
 *
 * Color: session-aware (cyan/yellow/orange/gray).
 * BgColor: dark session-tinted background.
 * Budget: 1 Text slot.
 */

import type { Widget, WidgetContext, WidgetOutput, SlotCost } from "./types.js";
import { textEl, HEADER_SIZE, PANEL_HEADER_H, SectionBg } from "./helpers.js";
import { C, sessionLabel } from "../screens.js";
import { registerWidget } from "./registry.js";

function sessionColor(session: string): string {
  switch (session) {
    case "regular":      return C.cyan;
    case "pre-market":   return C.yellow;
    case "after-hours":  return C.orange;
    case "closed":       return C.gray;
    default:             return C.white;
  }
}

export const headerWidget: Widget = {
  id: "header",
  name: "Session Header",
  renderMode: "text",

  slotCost(_ctx: WidgetContext): SlotCost {
    return { text: 1, image: 0, netdata: 0 };
  },

  getHeight(_ctx: WidgetContext): number {
    return PANEL_HEADER_H;
  },

  async render(
    ctx: WidgetContext,
    origin: { y: number; firstId: number; height: number },
  ): Promise<WidgetOutput> {
    const label = sessionLabel(ctx.session);
    const mode = ctx.ibkrConnected ? "LIVE" : "DEMO";
    const etTime =
      new Date().toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: "America/New_York",
      }) + " ET";

    const text = `| ${label} \u00b7 ${mode} \u00b7 ${etTime}`;
    const color = sessionColor(ctx.session);

    return {
      elements: [
        textEl(origin.firstId, origin.y, text, color, {
          align: 0, // left (Align:1 = right on device firmware)
          fontSize: HEADER_SIZE,
          height: origin.height,
          bgColor: SectionBg.header,
        }),
      ],
    };
  },
};

registerWidget(headerWidget);
