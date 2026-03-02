/**
 * Canvas Widget System — Core Types
 *
 * Grid-based layout engine: widgets are placed on a grid at explicit
 * (col, row) positions with (w, h) sizes in grid units. Like placing
 * tiles on a dashboard — drag to any cell, snap to grid.
 *
 * Same widget type can appear multiple times with different params
 * (e.g. two sparklines for SPY and QQQ at different grid positions).
 */

// ─── Geometry ────────────────────────────────────────────────

/** A rectangular region on the canvas */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// ─── Color Palette ──────────────────────────────────────────

export interface Palette {
  bg: string;
  green: string;
  red: string;
  cyan: string;
  yellow: string;
  orange: string;
  white: string;
  gray: string;
  dimGray: string;
  magenta: string;
  softWhite: string;
}

/** Dark palette — black bg = transparent glass on TimesFrame IPS panel */
export const DARK_PALETTE: Palette = {
  bg: "#000000",
  green: "#00DD55",
  red: "#EE3322",
  cyan: "#00CCEE",
  yellow: "#EEDD00",
  orange: "#FF9922",
  white: "#FFFFFF",
  gray: "#777777",
  dimGray: "#333333",
  magenta: "#FF44FF",
  softWhite: "#CCCCCC",
};

/** Light palette — white bg = opaque panel, text colors inverted for contrast */
export const LIGHT_PALETTE: Palette = {
  bg: "#FFFFFF",
  green: "#00AA44",
  red: "#CC2200",
  cyan: "#0088AA",
  yellow: "#AA9900",
  orange: "#CC7700",
  white: "#111111",
  gray: "#666666",
  dimGray: "#DDDDDD",
  magenta: "#CC33CC",
  softWhite: "#333333",
};

/** @deprecated Use DARK_PALETTE */
export const DEFAULT_PALETTE: Palette = DARK_PALETTE;

// ─── Phosphor Icon Codepoints ───────────────────────────────

export const Ph = {
  chartLine: "\uE154",
  chartLineUp: "\uE156",
  trendUp: "\uE4AE",
  trendDown: "\uE4AC",
  caretUp: "\uE13C",
  caretDown: "\uE136",
  lightning: "\uE2DE",
  clock: "\uE19A",
  timer: "\uE492",
  currencyDollar: "\uE550",
  shield: "\uE40A",
  fire: "\uE242",
  newspaper: "\uE344",
  link: "\uE2E2",
  cellSignal: "\uE142",
  warning: "\uE4E0",
  broadcast: "\uE0F2",
  plugConnected: "\uEB5A",
  eye: "\uE220",
  gauge: "\uE628",
  circle: "\uE18A",
  checkCircle: "\uE184",
} as const;

/** Phosphor icon per GICS sector — used as fallback in small treemap cells */
export const SECTOR_ICONS: Record<string, string> = {
  TECH: "\uE610",   // cpu
  HLTH: "\uE2A8",   // heart
  FINL: "\uE550",   // currencyDollar
  INDU: "\uE760",   // factory
  CONS: "\uE41E",   // shoppingCart
  ENER: "\uE2DE",   // lightning
  UTIL: "\uE2DC",   // lightbulb
  REAL: "\uE2C2",   // house
  MATL: "\uE1DA",   // cube
  COMM: "\uE0F2",   // broadcast
  STPL: "\uE262",   // forkKnife
};

// ─── Widget Definition ──────────────────────────────────────

/**
 * A canvas widget — draws into a Rect using Canvas2D.
 *
 * Widgets are pure drawing functions. They receive:
 * - ctx: the Canvas2D rendering context
 * - rect: their allocated region { x, y, w, h }
 * - params: instance-specific configuration
 * - palette: shared color scheme
 *
 * Same widget type can be instantiated multiple times with
 * different params (like two sparklines for SPY and QQQ).
 *
 * gridSize defines the widget's standard footprint on the grid.
 * Think standardized tile sizes: 1×1 (small square), 2×1 (wide),
 * 1×2 (tall), 2×2 (medium), 4×1 (full-width bar), 4×2 (full banner).
 * The engine auto-flows widgets onto the grid using their declared size.
 */
export interface CanvasWidget {
  /** Unique type ID, e.g. "sparkline", "gauge", "header" */
  readonly id: string;
  /** Human-readable name for UI */
  readonly name: string;
  /** Standard size on the grid: { w: columns, h: rows } */
  readonly gridSize: { w: number; h: number };
  /**
   * Draw the widget into its allocated rectangle.
   * Can be async (e.g. if fetching data).
   */
  render(
    ctx: CanvasRenderingContext2D,
    rect: Rect,
    params: Record<string, unknown>,
    palette: Palette,
  ): void | Promise<void>;
}

// ─── Layout Slot ────────────────────────────────────────────

/**
 * A widget placement in the layout — just say which widget + config.
 *
 * Widgets know their own size (gridSize). The engine auto-flows them
 * onto the grid: left-to-right, top-to-bottom, like placing tiles.
 * You don't pick coordinates — just list widgets in display order.
 *
 * The admin UI lets you reorder this list and the preview updates live.
 * Drag a gauge after a sparkline? It auto-packs into the next free spot.
 *
 * Optional col/row overrides exist for power-user edge cases, but
 * the normal workflow is: { widget: "sparkline", params: { label: "SPY" } }
 */
export interface Slot {
  /** Widget type ID (references CanvasWidget.id) */
  widget: string;
  /** Instance-specific params passed to render() */
  params?: Record<string, unknown>;
  /** Override: force grid column (0-based). Normally auto-placed. */
  col?: number;
  /** Override: force grid row (0-based). Normally auto-placed. */
  row?: number;
  /** Override: width in grid columns. Normally uses widget.gridSize.w */
  w?: number;
  /** Override: height in grid rows. Normally uses widget.gridSize.h */
  h?: number;
}

// ─── Canvas Config ──────────────────────────────────────────

export interface CanvasConfig {
  /** Canvas pixel width (800 for TimesFrame) */
  width: number;
  /** Canvas pixel height (1280 for TimesFrame) */
  height: number;
  /** Outer padding in pixels from canvas edge */
  padding: number;
  /** Color palette */
  palette: Palette;
  /** JPEG output quality (0-100) */
  jpegQuality: number;
  /** Number of grid columns */
  columns: number;
  /** Number of grid rows */
  rows: number;
  /** Gap between cells in pixels */
  gap: number;
}

export const DEFAULT_CONFIG: CanvasConfig = {
  width: 800,
  height: 1280,
  padding: 24,
  palette: DARK_PALETTE,
  jpegQuality: 92,
  columns: 4,
  rows: 12,
  gap: 8,
};

export const LIGHT_CONFIG: CanvasConfig = {
  ...DEFAULT_CONFIG,
  palette: LIGHT_PALETTE,
};
