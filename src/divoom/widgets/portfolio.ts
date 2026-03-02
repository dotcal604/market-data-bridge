/**
 * Widget: Portfolio — Account summary + open positions (IBKR-dependent)
 *
 * Adaptive display based on position state:
 *
 *   FLAT (no positions):
 *     "| Day +$342  Net $24.1K"
 *     "| ########.. 80% deployed"
 *
 *   IN POSITION (1-3 open positions):
 *     "| Day +$342  Net $24.1K"
 *     "| PLTR 45sh +$54 stop-$82"
 *     "| NVDA 20sh -$18 stop-$410"
 *
 * Position lines show: ticker, shares, unrealized $, stop price.
 * Stop price is found by matching open STP/STP_LMT orders to positions.
 * Max 3 position lines (device vertical space constraint).
 *
 * When IBKR disconnected, self-opts-out via getHeight() === 0.
 * Color: green/red by P&L direction · BgColor: dark blue tint.
 * Budget: 1 Text slot (connected) · 0 slots (disconnected).
 */

import type { Widget, WidgetContext, WidgetOutput, SlotCost } from "./types.js";
import { textEl, PANEL_PORTFOLIO_H, SectionBg } from "./helpers.js";
import { C, changeColor } from "../screens.js";
import { registerWidget } from "./registry.js";

const FONT_SIZE = 48;
const MAX_POSITION_LINES = 3;

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
 */
function exposureBar(pct: number): string {
  const clamped = Math.max(0, Math.min(100, pct));
  const filled = Math.round(clamped / 10);
  return "#".repeat(filled) + ".".repeat(10 - filled) + ` ${clamped}%`;
}

interface PositionWithStop {
  symbol: string;
  shares: number;         // signed: +long, -short
  avgCost: number;
  marketPrice: number;    // current price (from avgCost * position value math)
  unrealizedPnl: number;  // $ unrealized
  stopPrice: number | null; // from matching STP order, null if no stop found
}

/**
 * Format a single position line for display.
 * Shows: ticker, shares, unrealized $, and stop level.
 *
 * Examples:
 *   "| PLTR 45sh +$54 stop-$82"
 *   "| NVDA 20sh -$18 no-stop"
 */
function fmtPositionLine(p: PositionWithStop): string {
  const dir = p.unrealizedPnl >= 0 ? "+" : "-";
  const pnl = `${dir}$${Math.abs(Math.round(p.unrealizedPnl))}`;
  const qty = `${Math.abs(p.shares)}sh`;
  const stop = p.stopPrice != null
    ? `stp$${p.stopPrice.toFixed(p.stopPrice >= 100 ? 0 : 1)}`
    : "no-stp";
  return `| ${p.symbol} ${qty} ${pnl} ${stop}`;
}

/**
 * Fetch open positions and match with stop orders.
 * Returns positions sorted by absolute unrealized P&L (biggest mover first).
 */
async function fetchPositionsWithStops(): Promise<PositionWithStop[]> {
  const { getPositions } = await import("../../ibkr/account.js");
  const { getOpenOrders } = await import("../../ibkr/orders_impl/read.js");

  const [rawPositions, rawOrders] = await Promise.all([
    getPositions(),
    getOpenOrders(),
  ]);

  // Filter to actual stock positions (non-zero quantity)
  const positions = rawPositions.filter(
    (p) => p.position !== 0 && p.secType === "STK",
  );

  if (positions.length === 0) return [];

  // Build stop price map: symbol → stop price
  // Match STP/STP_LMT orders on the closing side (SELL for longs, BUY for shorts)
  const stopMap = new Map<string, number>();
  for (const ord of rawOrders) {
    if (ord.orderType !== "STP" && ord.orderType !== "STP_LMT") continue;
    // auxPrice = stop trigger price for STP and STP_LMT orders
    const stopPx = ord.auxPrice;
    if (stopPx == null || stopPx <= 0) continue;
    // Only take the first (tightest) stop per symbol
    if (!stopMap.has(ord.symbol)) {
      stopMap.set(ord.symbol, stopPx);
    }
  }

  // Build enriched positions
  const enriched: PositionWithStop[] = positions.map((p) => {
    const mktPrice = p.avgCost; // avgCost is our best proxy without a live quote
    const unrealized = 0; // will get from PnL if available
    return {
      symbol: p.symbol,
      shares: p.position,
      avgCost: p.avgCost,
      marketPrice: mktPrice,
      unrealizedPnl: unrealized,
      stopPrice: stopMap.get(p.symbol) ?? null,
    };
  });

  // Sort by absolute position value (largest first)
  enriched.sort(
    (a, b) => Math.abs(b.shares * b.avgCost) - Math.abs(a.shares * a.avgCost),
  );

  return enriched;
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
    const line1 = `| Day ${sign}${fmtCompact(dayPnl)}  Net ${fmtCompact(netLiq)}`;

    // Fetch positions — if any exist, show them instead of exposure bar
    let positionLines: string[] = [];
    try {
      const positions = await fetchPositionsWithStops();
      positionLines = positions
        .slice(0, MAX_POSITION_LINES)
        .map(fmtPositionLine);
    } catch {
      // Position fetch failed — fall back to exposure bar
    }

    let text: string;
    if (positionLines.length > 0) {
      // IN POSITION: show P&L header + position lines
      text = [line1, ...positionLines].join("\n");
    } else {
      // FLAT: show P&L header + exposure bar
      text = `${line1}\n| ${exposureBar(exposure)} deployed`;
    }

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
