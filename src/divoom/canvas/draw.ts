/**
 * Canvas Widget System — DrawContext
 *
 * Provides rect-relative drawing helpers so widgets never deal
 * with absolute canvas coordinates. Each widget gets a DrawContext
 * bound to its allocated Rect — (0,0) means "top-left of my slot".
 *
 * Wraps @napi-rs/canvas CanvasRenderingContext2D with:
 *   - text()         — single-font text at relative (x, y)
 *   - richText()     — multi-segment colored text with per-segment fonts
 *   - sparkline()    — line chart with optional glow fill
 *   - separator()    — thin horizontal divider
 *   - blockBar()     — Unicode ████░░░░ rendered as colored text
 *   - progressBar()  — [████████░░] with percentage fill
 *   - fillRect()     — colored rectangle (for backgrounds, bars)
 *   - drawImage()    — image at relative coords with optional alpha
 */

import type { Image } from "@napi-rs/canvas";
import type { Rect, Palette } from "./types.js";

// ─── Segment Type ────────────────────────────────────────────

/** A segment of rich text: [text, color, font?] */
export type TextSegment = [text: string, color: string, font?: string];

// ─── DrawContext ─────────────────────────────────────────────

export class DrawContext {
  constructor(
    public readonly ctx: CanvasRenderingContext2D,
    public readonly rect: Rect,
    public readonly palette: Palette,
    public readonly defaultFont: string = "JBMono",
    public readonly iconFont: string = "Ph Light",
  ) {}

  // ── Coordinate Helpers ─────────────────────────────────────

  /** Convert relative x to absolute canvas x */
  private ax(x: number): number {
    return this.rect.x + x;
  }

  /** Convert relative y to absolute canvas y */
  private ay(y: number): number {
    return this.rect.y + y;
  }

  // ── Text ───────────────────────────────────────────────────

  /** Draw text at relative (x, y) with color and size */
  text(
    text: string,
    x: number,
    y: number,
    color: string,
    size: number,
    font?: string,
  ): void {
    this.ctx.font = `${size}px '${font ?? this.defaultFont}'`;
    this.ctx.fillStyle = color;
    this.ctx.fillText(text, this.ax(x), this.ay(y));
  }

  /** Draw multi-segment colored text (mixing fonts/colors inline) */
  richText(
    segments: TextSegment[],
    x: number,
    y: number,
    size: number,
  ): void {
    let curX = this.ax(x);
    const absY = this.ay(y);
    for (const [text, color, font] of segments) {
      this.ctx.font = `${size}px '${font ?? this.defaultFont}'`;
      this.ctx.fillStyle = color;
      this.ctx.fillText(text, curX, absY);
      curX += this.ctx.measureText(text).width;
    }
  }

  /** Measure text width in pixels (for alignment calculations) */
  measureText(text: string, size: number, font?: string): number {
    this.ctx.font = `${size}px '${font ?? this.defaultFont}'`;
    return this.ctx.measureText(text).width;
  }

  /** Draw right-aligned text at relative (x=right edge, y) */
  textRight(
    text: string,
    y: number,
    color: string,
    size: number,
    font?: string,
    rightMargin = 0,
  ): void {
    const w = this.measureText(text, size, font);
    this.text(text, this.rect.w - w - rightMargin, y, color, size, font);
  }

  // ── Shapes ─────────────────────────────────────────────────

  /** Fill a rectangle at relative coords */
  fillRect(x: number, y: number, w: number, h: number, color: string): void {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(this.ax(x), this.ay(y), w, h);
  }

  /** Draw an image at relative coords, scaled to fit within (w, h) */
  drawImage(
    img: Image,
    x: number,
    y: number,
    w: number,
    h: number,
    alpha = 1.0,
  ): void {
    const prev = this.ctx.globalAlpha;
    this.ctx.globalAlpha = alpha;
    this.ctx.drawImage(img as unknown as CanvasImageSource, this.ax(x), this.ay(y), w, h);
    this.ctx.globalAlpha = prev;
  }

  /** Vertical accent rail — draws a thick colored bar and returns x-offset past it */
  rail(y: number, h: number, color: string, width = 6, gap = 6): number {
    this.fillRect(0, y, width, h, color);
    return width + gap;
  }

  /** Separator line across the widget width */
  separator(y: number, color?: string, inset = 0, thickness = 3): void {
    this.ctx.strokeStyle = color ?? this.palette.dimGray;
    this.ctx.lineWidth = thickness;
    this.ctx.beginPath();
    this.ctx.moveTo(this.ax(inset), this.ay(y));
    this.ctx.lineTo(this.ax(this.rect.w - inset), this.ay(y));
    this.ctx.stroke();
  }

  // ── Charts ─────────────────────────────────────────────────

  /** Line sparkline chart with optional glow fill underneath */
  sparkline(
    data: number[],
    x: number,
    y: number,
    w: number,
    h: number,
    color: string,
    opts: { lineWidth?: number; glow?: boolean } = {},
  ): void {
    if (data.length < 2) return;
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    const stepX = w / (data.length - 1);
    const lineWidth = opts.lineWidth ?? 2;
    const glow = opts.glow ?? true;

    const absX = this.ax(x);
    const absY = this.ay(y);

    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = lineWidth;
    this.ctx.lineJoin = "round";
    this.ctx.lineCap = "round";
    this.ctx.beginPath();
    for (let i = 0; i < data.length; i++) {
      const px = absX + i * stepX;
      const py = absY + h - ((data[i] - min) / range) * h;
      if (i === 0) this.ctx.moveTo(px, py);
      else this.ctx.lineTo(px, py);
    }
    this.ctx.stroke();

    // Subtle glow fill under the line
    if (glow) {
      this.ctx.globalAlpha = 0.08;
      this.ctx.fillStyle = color;
      this.ctx.lineTo(absX + w, absY + h);
      this.ctx.lineTo(absX, absY + h);
      this.ctx.closePath();
      this.ctx.fill();
      this.ctx.globalAlpha = 1.0;
    }
  }

  /** Block bar: ████░░░░ — textured text-rendered bar for relative comparisons */
  blockBar(
    x: number, y: number,
    value: number, maxValue: number,
    chars: number, size: number,
    color: string, trackColor?: string,
  ): void {
    const filled = Math.round((value / maxValue) * chars);
    const filledStr = "\u2588".repeat(filled);
    const emptyStr = "\u2591".repeat(Math.max(0, chars - filled));
    this.text(filledStr, x, y, color, size);
    if (emptyStr && trackColor) {
      const filledW = this.measureText(filledStr, size);
      this.text(emptyStr, x + filledW, y, trackColor, size);
    }
  }

  /** Horizontal bar chart — a single filled bar with optional background track */
  bar(
    x: number,
    y: number,
    maxWidth: number,
    h: number,
    value: number,
    maxValue: number,
    color: string,
    trackColor?: string,
  ): void {
    const fillW = Math.round((value / maxValue) * maxWidth);
    if (trackColor) {
      this.fillRect(x, y, maxWidth, h, trackColor);
    }
    this.fillRect(x, y, fillW, h, color);
  }

  // ── Unicode Art ────────────────────────────────────────────

  /** Block bar: ████░░░░ — filled + empty shade as text string */
  static blockBar(value: number, max: number, width: number): string {
    const filled = Math.round((value / max) * width);
    return "\u2588".repeat(filled) + "\u2591".repeat(Math.max(0, width - filled));
  }

  /** Vertical bars from data array — each value maps to ▁-█ */
  static verticalBars(data: number[]): string {
    const BLOCKS = " \u2581\u2582\u2583\u2584\u2585\u2586\u2587\u2588";
    const max = Math.max(...data);
    const min = Math.min(...data);
    const range = max - min || 1;
    return data
      .map((v) => {
        const level = Math.round(((v - min) / range) * 8);
        return BLOCKS[Math.max(1, Math.min(8, level))];
      })
      .join("");
  }

  /** Progress bar: ████████░░ as text string */
  static progressBar(pct: number, width: number): string {
    const filled = Math.round((pct / 100) * width);
    return "\u2588".repeat(filled) + "\u2591".repeat(Math.max(0, width - filled));
  }
}

// ─── Factory ─────────────────────────────────────────────────

/**
 * Create a DrawContext for a widget's allocated Rect.
 * Widgets call this at the start of render() to get rect-relative drawing.
 */
export function createDrawContext(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  palette: Palette,
): DrawContext {
  return new DrawContext(ctx, rect, palette);
}
