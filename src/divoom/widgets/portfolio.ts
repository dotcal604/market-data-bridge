/**
 * Widget: Portfolio — Account summary (IBKR-dependent)
 *
 * When IBKR connected, renders as 1 Text element (2 lines):
 *   "| Day +$342  Net $24.1K"
 *   "| ########.. 80% deployed"
 *
 * Line 1: Daily P&L + net liquidation (colored by P&L sign)
 * Line 2: 10-segment visual exposure meter (# = 10% each, . = empty)
 *
 * When IBKR disconnected, self-opts-out via getHeight() === 0.
 * Showing stale portfolio data is worse than nothing — the layout
 * engine skips zero-height widgets and redistributes the space.
 *
 * Color: green/red by P&L direction · BgColor: dark blue tint.
 * Budget: 1 Text slot (connected) · 0 slots (disconnected).
 */

import type { Widget, WidgetContext, WidgetOutput, SlotCost } from "./types.js";
import { textEl, PANEL_PORTFOLIO_H, SectionBg } from "./helpers.js";
import { C, changeColor } from "../screens.js";
import { registerWidget } from "./registry.js";

const FONT_SIZE = 48;

/** Compact number format: $1234 → "$1.2K", $123456 → "$123K" */
function fmtCompact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `$${Math.round(abs / 1_000)}K`;
  if (abs >= 1_000) return `$${(abs / 1_000).toFixed(1)}K`;
  return `$${Math.round(abs)}`;
}

/**
 * Visual exposure meter: 10-segment bar using ASCII characters.
 * Each segment = 10% exposure. Filled = #, empty = .
 * Example: exposureBar(73) → "#######... 73%"
 *
 * (Unicode block chars █/░ garble on device FontID 52.)
 */
function exposureBar(pct: number): string {
  const clamped = Math.max(0, Math.min(100, pct));
  const filled = Math.round(clamped / 10);
  return "#".repeat(filled) + ".".repeat(10 - filled) + ` ${clamped}%`;
}

export const portfolioWidget: Widget = {
  id: "portfolio",
  name: "Portfolio Summary",
  renderMode: "text",

  slotCost(ctx: WidgetContext): SlotCost {
    return { text: ctx.ibkrConnected ? 1 : 0, image: 0, netdata: 0 };
  },

  getHeight(ctx: WidgetContext): number {
    // Opt out entirely when IBKR is disconnected — stale data > no data
    return ctx.ibkrConnected ? PANEL_PORTFOLIO_H : 0;
  },

  async render(
    ctx: WidgetContext,
    origin: { y: number; firstId: number; height: number },
  ): Promise<WidgetOutput> {
    // Engine only calls render() when getHeight() > 0, so ibkrConnected is true here.
    let dayPnl = 0;
    let netLiq = 0;
    let exposure = 0;

    try {
      const { getPnL, getAccountSummary } = await import("../../ibkr/account.js");
      const [pnl, summary] = await Promise.all([getPnL(), getAccountSummary()]);
      dayPnl = pnl.dailyPnL ?? 0;
      netLiq = summary.netLiquidation ?? 0;
      const grossPos = summary.grossPositionValue ?? 0;
      if (netLiq > 0) {
        exposure = Math.round((grossPos / netLiq) * 100);
      }
    } catch {
      // IBKR connected but data fetch failed — show zeroes with neutral color
    }

    const sign = dayPnl >= 0 ? "+" : "-";
    // Line 1: Daily P&L + net liquidation (primary info)
    // Line 2: Visual exposure meter — instant read of capital deployed
    const line1 = `| Day ${sign}${fmtCompact(dayPnl)}  Net ${fmtCompact(netLiq)}`;
    const line2 = `| ${exposureBar(exposure)} deployed`;
    const text = `${line1}\n${line2}`;
    const color = dayPnl !== 0 ? changeColor(dayPnl) : C.white;

    return {
      elements: [
        textEl(origin.firstId, origin.y, text, color, {
          height: origin.height,
          fontSize: FONT_SIZE,
          bgColor: SectionBg.portfolio,
        }),
      ],
    };
  },
};

registerWidget(portfolioWidget);
