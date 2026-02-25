/**
 * Widget: Portfolio — Account summary & PnL
 *
 * When IBKR is connected: shows Day P&L, Unrealized P&L, Net Liq, and
 * Exposure across 4 data rows, plus an optional PnL curve image.
 * When disconnected: shows a single "IBKR disconnected" message.
 *
 * Has renderAsImage() hook for budget degradation (passthrough for now).
 *
 * TODO: Wire up real IBKR account data via updater/data layer.
 * Currently uses placeholder values for layout development.
 */

import type { Widget, WidgetContext, WidgetOutput, SlotCost } from "./types.js";
import {
  textEl,
  imageEl,
  SECTION_HEADER_SIZE,
  SECTION_HEADER_H,
  DATA_SIZE,
  DATA_H,
  SECTION_GAP,
  PNL_CURVE_H,
} from "./helpers.js";
import { C, changeColor, fmtDollar } from "../screens.js";
import { registerWidget } from "./registry.js";

const DATA_ROWS = 4;
const ROW_H = DATA_H - 2;
const ROW_FONT = DATA_SIZE - 2;

export const portfolioWidget: Widget = {
  id: "portfolio",
  name: "Portfolio Summary",
  renderMode: "text",

  slotCost(ctx: WidgetContext): SlotCost {
    if (!ctx.ibkrConnected) {
      // Disconnected: 1 header text + 1 data text = 2, but spec says 1
      // We'll show header + disconnect message as a single text element
      return { text: 1, image: 0, netdata: 0 };
    }

    if (ctx.chartBaseUrl) {
      // Connected + chart: 4 data rows (text) + 1 PnL curve (image)
      // Header is skipped in chart mode to save a Text slot
      return { text: DATA_ROWS, image: 1, netdata: 0 };
    }

    // Connected, no chart: 1 header + 4 data rows
    return { text: 1 + DATA_ROWS, image: 0, netdata: 0 };
  },

  getHeight(ctx: WidgetContext): number {
    if (!ctx.ibkrConnected) {
      return SECTION_HEADER_H + DATA_H + SECTION_GAP;
    }

    const base = SECTION_HEADER_H + DATA_ROWS * ROW_H;
    return ctx.chartBaseUrl
      ? base + PNL_CURVE_H + SECTION_GAP
      : base + SECTION_GAP;
  },

  async render(
    ctx: WidgetContext,
    origin: { y: number; firstId: number },
  ): Promise<WidgetOutput> {
    const elements = [];
    let id = origin.firstId;
    let y = origin.y;

    // ── Disconnected state ─────────────────────────────────
    if (!ctx.ibkrConnected) {
      elements.push(
        textEl(id++, y, "\u25b8 PORTFOLIO  disconnected", C.gray, {
          fontSize: SECTION_HEADER_SIZE,
          height: SECTION_HEADER_H,
        }),
      );
      return { elements };
    }

    // ── Connected state ────────────────────────────────────

    // Section header (skip if chartBaseUrl to save a Text slot)
    if (!ctx.chartBaseUrl) {
      elements.push(
        textEl(id++, y, "\u25b8 PORTFOLIO", C.cyan, {
          fontSize: SECTION_HEADER_SIZE,
          height: SECTION_HEADER_H,
        }),
      );
      y += SECTION_HEADER_H;
    } else {
      // Even without a text header, reserve the vertical space
      y += SECTION_HEADER_H;
    }

    // Fetch account data via dynamic import (avoids hard dep on IBKR module)
    let dayPnl = 0;
    let unrealizedPnl = 0;
    let netLiq = 0;
    let exposure = 0;

    try {
      const { getPnL, getAccountSummary } = await import("../../ibkr/account.js");
      const [pnl, summary] = await Promise.all([getPnL(), getAccountSummary()]);
      dayPnl = pnl.dailyPnL ?? 0;
      unrealizedPnl = pnl.unrealizedPnL ?? 0;
      netLiq = summary.netLiquidation ?? 0;
      // Derive exposure % from gross position value vs net liquidation
      const grossPos = summary.grossPositionValue ?? 0;
      if (netLiq > 0) {
        exposure = Math.round((grossPos / netLiq) * 100);
      }
    } catch {
      // IBKR connected but data fetch failed — show zeroes
    }

    // Build data rows
    const pnlSign = dayPnl >= 0 ? "+" : "";
    const unlSign = unrealizedPnl >= 0 ? "+" : "";

    const rows: Array<{ text: string; color: string }> = [
      {
        text: `Day P&L:   ${pnlSign}$${fmtDollar(Math.abs(dayPnl))}`,
        color: changeColor(dayPnl),
      },
      {
        text: `Unrl P&L:  ${unlSign}$${fmtDollar(Math.abs(unrealizedPnl))}`,
        color: changeColor(unrealizedPnl),
      },
      {
        text: `Net Liq:   $${fmtDollar(netLiq)}`,
        color: C.white,
      },
      {
        text: `Exposure:  ${exposure}%`,
        color: C.white,
      },
    ];

    // Emit data rows
    for (let i = 0; i < DATA_ROWS; i++) {
      const row = rows[i];
      elements.push(
        textEl(id++, y, row.text, row.color, {
          fontSize: ROW_FONT,
          height: ROW_H,
        }),
      );
      y += ROW_H;
    }

    // Optional PnL curve image
    if (ctx.chartBaseUrl) {
      elements.push(
        imageEl(
          id++,
          y,
          `${ctx.chartBaseUrl}/api/divoom/charts/pnl-curve`,
          { height: PNL_CURVE_H },
        ),
      );
    }

    return { elements };
  },

  /**
   * Image fallback for budget degradation.
   * Currently passes through to text render. When a portfolio-summary
   * chart endpoint is implemented, this will emit a single Image
   * element, saving all Text slots for 1 Image slot.
   */
  async renderAsImage(
    ctx: WidgetContext,
    origin: { y: number; firstId: number },
  ): Promise<WidgetOutput> {
    // TODO: when chart endpoint is ready, render as:
    // imageEl(origin.firstId, origin.y,
    //   `${ctx.chartBaseUrl}/api/divoom/charts/portfolio-summary`,
    //   { height: this.getHeight(ctx) - SECTION_GAP })
    return this.render(ctx, origin);
  },
};

registerWidget(portfolioWidget);
