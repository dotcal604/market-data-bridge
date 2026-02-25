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
 * IMPORTANT: TimesFrame (DeviceType "Frame") silently ignores Image elements —
 * the device accepts them (ReturnCode: 0) but never fetches the URL or renders
 * anything. 30+ diagnostic tests confirmed zero HTTP requests for image URLs.
 * Image budget is set to 0 to force all widgets into text-only mode.
 */
export const DEVICE_BUDGET: Readonly<SlotCost> = {
  text: 6,
  image: 0, // TimesFrame ignores Image elements entirely — text-only device
  netdata: 6,
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
    width: number;      // 800
    contentWidth: number; // 768
    padX: number;       // 16
  };
}

// ─── Widget Output ──────────────────────────────────────────

/** What a widget returns after rendering. */
export interface WidgetOutput {
  elements: DisplayElement[];
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
