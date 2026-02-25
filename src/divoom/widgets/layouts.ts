/**
 * Widget System — Per-Session Layout Configs
 *
 * TimesFrame (DeviceType "Frame") only renders Text elements — Image elements
 * are silently ignored. All layouts use only text-capable widgets:
 *
 *   header    → 1 Text (session badge)           80px
 *   indices   → 1 Text (3-line panel)           280px  ← was 2T, now 1T
 *   movers    → 1 Text (3-line panel)           280px
 *   portfolio → 1 Text (connected) or 0         200px  ← opts out when disconnected
 *   news      → 1 Text (3 headlines)            280px
 *   footer    → 1 Text (source attribution)     120px  ← freed slot from indices 2T→1T
 *
 * Canvas math: 8 top-pad + 80 + 280 + 200 + 280 + 280 + 120 = 1248px (97% coverage)
 *
 * Budget: 6 Text (connected) · 5 Text (disconnected) · 0 Image · 0 NetData ✓
 */

import type { LayoutConfig } from "./types.js";

export const REGULAR_LAYOUT: LayoutConfig = {
  name: "regular",
  widgets: [
    "header",
    "indices",
    "movers",
    "portfolio",
    "news",
    "footer",
  ],
};

export const PRE_MARKET_LAYOUT: LayoutConfig = {
  name: "pre-market",
  widgets: [
    "header",
    "indices",
    "portfolio",
    "news",
    "footer",
  ],
};

export const AFTER_HOURS_LAYOUT: LayoutConfig = {
  name: "after-hours",
  widgets: [
    "header",
    "indices",
    "portfolio",
    "news",
    "footer",
  ],
};

export const CLOSED_LAYOUT: LayoutConfig = {
  name: "closed",
  widgets: [
    "header",
    "indices",
    "news",
    "footer",
  ],
};

/** Get the layout config for a given market session. */
export function getLayoutForSession(session: string): LayoutConfig {
  switch (session) {
    case "pre-market":
      return PRE_MARKET_LAYOUT;
    case "regular":
      return REGULAR_LAYOUT;
    case "after-hours":
      return AFTER_HOURS_LAYOUT;
    case "closed":
      return CLOSED_LAYOUT;
    default:
      return REGULAR_LAYOUT;
  }
}
