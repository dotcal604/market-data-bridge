/**
 * Widget System — Per-Session Layout Configs
 *
 * Each market session gets a tuned widget list.
 * Widgets that don't apply (e.g. portfolio when IBKR disconnected)
 * self-opt-out via getHeight() === 0, but session-specific layouts
 * keep things intentional.
 */

import type { LayoutConfig } from "./types.js";

export const REGULAR_LAYOUT: LayoutConfig = {
  name: "regular",
  widgets: [
    "header",
    "indices",
    "spy-sparkline",
    "sectors",
    "movers",
    "portfolio",
    "news",
    "indicators",
    "volume-bars",
  ],
};

export const PRE_MARKET_LAYOUT: LayoutConfig = {
  name: "pre-market",
  widgets: [
    "header",
    "indices",
    "spy-sparkline",
    "sectors",
    "portfolio",
    "news",
    "indicators",
  ],
};

export const AFTER_HOURS_LAYOUT: LayoutConfig = {
  name: "after-hours",
  widgets: [
    "header",
    "indices",
    "spy-sparkline",
    "sectors",
    "portfolio",
    "news",
    "indicators",
  ],
};

export const CLOSED_LAYOUT: LayoutConfig = {
  name: "closed",
  widgets: [
    "header",
    "indices",
    "spy-sparkline",
    "news",
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
