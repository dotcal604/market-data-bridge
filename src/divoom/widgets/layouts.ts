/**
 * Widget System — Per-Session Layout Configs
 *
 * Mixed Text + Image layouts. Image widgets self-disable (getHeight → 0)
 * when chartBaseUrl is not configured.
 *
 *   header         → 1 Text (session badge)            64px min (fixed)
 *   indices        → 1 Text (3-line panel)            160px min (flex)
 *   spy-sparkline  → 1 Image (chart, self-disables)   112px    (fixed)
 *   sectors        → 1 Image (heatmap, self-disables)  142px   (fixed)
 *   movers         → 1 Text (3-line panel)            160px min (flex)
 *   portfolio      → 1 Text (connected) or 0          130px min (flex)
 *   news           → 1 Text (3 headlines)             160px min (flex)
 *   indicators     → 2 Image (RSI+VIX gauges, self-d) 132px   (fixed)
 *   volume-bars    → 1 Image (chart, self-disables)   112px    (fixed)
 *   footer         → 1 Text (source attribution)       64px min (fixed)
 *
 * Budget with charts + IBKR: 6T + 5I  (well within 6/10/6)
 * Budget with charts, no IBKR: 5T + 5I (portfolio opts out)
 * Budget without charts:       6T + 0I  (all Image widgets opt out)
 *
 * Minimum total: 1236px (IBKR + charts) → 36px flex slack across 4 flex widgets
 * Without portfolio: 1106px → 166px flex slack (comfortable)
 * Without charts:     868px → image widgets height=0, generous flex
 *
 * Flex engine distributes remaining canvas (1280px) among non-fixed widgets.
 * Image widgets are fixed-size (charts have natural pixel dimensions).
 */

import type { LayoutConfig } from "./types.js";

export const REGULAR_LAYOUT: LayoutConfig = {
  name: "regular",
  widgets: [
    "header",
    "indices",
    "spy-sparkline", // Image — self-disables when chartBaseUrl undefined
    "sectors",       // Image — heatmap, self-disables without chartBaseUrl
    "movers",
    "portfolio",
    "news",
    "indicators",    // 2× Image — RSI + VIX gauges, self-disables without chartBaseUrl
    "volume-bars",   // Image — volume chart, self-disables without chartBaseUrl
    "footer",
  ],
};

export const PRE_MARKET_LAYOUT: LayoutConfig = {
  name: "pre-market",
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
    "footer",
  ],
};

export const AFTER_HOURS_LAYOUT: LayoutConfig = {
  name: "after-hours",
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
    "footer",
  ],
};

export const CLOSED_LAYOUT: LayoutConfig = {
  name: "closed",
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
