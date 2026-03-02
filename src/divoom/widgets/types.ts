/**
 * Widget System — Core Types
 *
 * Defines the interfaces that every widget must implement
 * and the engine uses for layout composition.
 */

import type { DisplayElement } from "../display.js";

// ─── Device Budget ──────────────────────────────────────────

/** Element slot cost declaration — how many device slots a widget needs. */
export interface SlotCost {
  text: number;
  image: number;
  netdata: number;
}

/**
 * Hard device limits for CustomControlMode.
 * Exceeding these will cause misrendering or silent element drops.
 *
 * Image elements: NON-FUNCTIONAL on TimesFrame. The device's curl client
 * (User-Agent: "DivoomApp/1.0 (compatible; curl/7.68.0)") FETCHES Image URLs
 * but NEVER RENDERS the downloaded pixel data. Confirmed by serving solid
 * RED/GREEN/BLUE JPEGs — all displayed as the canvas background color, proving
 * content is completely ignored. The only working image path is BackgroudImageAddr
 * (canvas background layer).
 *
 * Image budget set to 0 to force all widgets into text-only mode.
 */
export const DEVICE_BUDGET: Readonly<SlotCost> = {
  text: 6,
  image: 0, // Image elements fetch but never render — text-only device
  netdata: 6,
};

// ─── Background Compositing Config ──────────────────────────
// Parameterized control over the BackgroudImageAddr compositing layer.
// Every visual aspect is tunable at runtime via admin REST or env vars.

/** Per-widget background override — which widgets paint into the bg layer. */
export interface WidgetBgOverride {
  /** Widget ID */
  id: string;
  /** Whether this widget's background is enabled (default: true if widget has renderBackground) */
  enabled: boolean;
  /** Opacity override for this widget's background (0.0–1.0) */
  opacity?: number;
}

/** Master compositing configuration — lives in WidgetContext so all widgets can read it. */
export interface CompositeConfig {
  /** Master switch — false = solid black bg, no compositing overhead */
  enabled: boolean;
  /** Global brightness multiplier for all background visuals (0.0–1.0, default 0.3) */
  brightness: number;
  /** Canvas background color behind all composited layers (default "#000000" = see-through glass) */
  bgColor: string;
  /** Per-widget background overrides */
  widgetOverrides: WidgetBgOverride[];
  /** JPEG quality for the composite output (1–100, default 85) */
  jpegQuality: number;

  // ── Content parameters (what data feeds the background visuals) ──

  /** Sparkline ticker symbol (default "SPY") */
  sparklineTicker: string;
  /** Sparkline bar timeframe: "1d" | "5d" | "1mo" | "3mo" (default "1d") */
  sparklineTimeframe: string;
  /** Number of bars/candles for sparkline (default 78 — one regular session in 5min bars) */
  sparklineBars: number;
  /** Accent color for positive price movement (default "#00FF00") */
  accentUp: string;
  /** Accent color for negative price movement (default "#FF0000") */
  accentDown: string;
  /** Accent color for neutral/flat (default "#00FFFF") */
  accentNeutral: string;
}

/** Sensible defaults — dim enough for transparent glass, all widgets enabled */
export const DEFAULT_COMPOSITE_CONFIG: Readonly<CompositeConfig> = {
  enabled: false, // opt-in — must be explicitly enabled
  brightness: 0.3,
  bgColor: "#000000",
  widgetOverrides: [],
  jpegQuality: 85,
  sparklineTicker: "SPY",
  sparklineTimeframe: "1d",
  sparklineBars: 78,
  accentUp: "#00FF00",
  accentDown: "#FF0000",
  accentNeutral: "#00FFFF",
};

// ─── Widget Context ─────────────────────────────────────────

/** Read-only context provided to every widget on each render cycle. */
export interface WidgetContext {
  /** Current market session: "pre-market" | "regular" | "after-hours" | "closed" */
  session: string;
  /** Whether IBKR TWS is connected */
  ibkrConnected: boolean;
  /** Base URL for chart image endpoints (undefined = charts disabled) */
  chartBaseUrl: string | undefined;
  /** Canvas constants */
  canvas: {
    width: number;       // 800
    height: number;      // effective text zone height (splitY when composite active, 1280 otherwise)
    contentWidth: number; // 768
    padX: number;        // 16
  };
  /** Background compositing settings (undefined = compositing disabled) */
  composite?: CompositeConfig;
}

// ─── Widget Output ──────────────────────────────────────────

/** What a widget returns after rendering foreground elements. */
export interface WidgetOutput {
  elements: DisplayElement[];
}

/**
 * What a widget returns from renderBackground().
 * A raw RGBA pixel buffer for compositing into the BackgroudImageAddr layer.
 */
export interface BackgroundOutput {
  /** RGBA pixel buffer (width × height × 4 bytes) */
  pixels: Buffer;
  /** Region on the 800×1280 canvas where this content lives */
  region: { x: number; y: number; width: number; height: number };
}

// ─── Widget Interface ───────────────────────────────────────

export type RenderMode = "text" | "image" | "native" | "netdata";

/** A composable dashboard widget. */
export interface Widget {
  /** Unique identifier, e.g. "header", "indices", "spy-sparkline" */
  readonly id: string;
  /** Human-readable name for configurator UI */
  readonly name: string;
  /** Primary rendering mode */
  readonly renderMode: RenderMode;

  /** Declare element slot cost for budget validation. */
  slotCost(ctx: WidgetContext): SlotCost;

  /** Sync — declare height in canvas px. Return 0 to opt out this cycle. */
  getHeight(ctx: WidgetContext): number;

  /**
   * Async — fetch data, produce positioned DisplayElement[].
   * @param ctx    - shared context (session, ibkr, canvas)
   * @param origin - { y: starting Y, firstId: element ID, height: allocated px (≥ getHeight minimum) }
   */
  render(
    ctx: WidgetContext,
    origin: { y: number; firstId: number; height: number },
  ): Promise<WidgetOutput>;

  /**
   * Optional fallback: render entire widget as a single Image element.
   * Called by engine when the layout exceeds Text/NetData budget.
   * Widgets that can degrade should implement this.
   */
  renderAsImage?(
    ctx: WidgetContext,
    origin: { y: number; firstId: number; height: number },
  ): Promise<WidgetOutput>;

  /**
   * Optional background layer: render visual content into the compositing layer.
   *
   * Called by the engine when ctx.composite?.enabled is true.
   * Returns RGBA pixel data that gets composited into the 800×1280 BackgroudImageAddr
   * JPEG behind all Text elements. This is the only way to get chart visuals on
   * TimesFrame — DispList Image elements are non-functional.
   *
   * Widgets paint into their allocated region (origin.y → origin.y + origin.height).
   * The engine applies per-widget opacity and global brightness from CompositeConfig.
   *
   * @param ctx    - shared context including composite config
   * @param origin - allocated canvas region { y, height, width (usually 800) }
   * @returns BackgroundOutput with RGBA pixel buffer, or null to skip
   */
  renderBackground?(
    ctx: WidgetContext,
    origin: { y: number; height: number; width: number },
  ): Promise<BackgroundOutput | null>;
}

// ─── Layout Config ──────────────────────────────────────────

/** A named layout — list of widget IDs to render in order. */
export interface LayoutConfig {
  name: string;
  widgets: string[];
}

// ─── Engine Constants ───────────────────────────────────────

/**
 * Each widget gets a block of element IDs.
 * Prevents ID collisions without manual coordination.
 */
export const ID_BLOCK_SIZE = 20;
