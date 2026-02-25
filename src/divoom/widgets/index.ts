/**
 * Widget System — Barrel Export
 *
 * Re-exports engine, types, registry, and helpers.
 * Individual widgets register themselves when imported.
 */

// Core
export { renderLayout } from "./engine.js";
export type { EngineResult } from "./engine.js";
export {
  registerWidget,
  getWidget,
  listWidgets,
  resolveLayout,
  clearRegistry,
} from "./registry.js";

// Types
export type {
  Widget,
  WidgetContext,
  WidgetOutput,
  SlotCost,
  LayoutConfig,
  RenderMode,
} from "./types.js";
export { DEVICE_BUDGET, ID_BLOCK_SIZE } from "./types.js";

// Helpers
export {
  textEl,
  imageEl,
  CANVAS_W,
  PAD_X,
  CONTENT_W,
  FONT_ID,
  BG_TRANSPARENT,
  HEADER_SIZE,
  SECTION_HEADER_SIZE,
  DATA_SIZE,
  HEADER_H,
  SECTION_HEADER_H,
  DATA_H,
  SECTION_GAP,
  CHART_W,
  SPARKLINE_H,
  HEATMAP_H,
  PNL_CURVE_H,
  GAUGE_W,
  GAUGE_H,
  VOLUME_H,
} from "./helpers.js";
