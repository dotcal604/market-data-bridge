/**
 * Divoom Dashboard Data Formatters
 *
 * Formats trading data for display on Divoom Times Gate.
 * Provides color-coded multi-line text output for P&L, positions, Holly alerts, and market status.
 */

import type { DashboardData } from "./display.js";

export interface PnLData {
  realizedPnL: number;
  unrealizedPnL: number;
  totalPnL: number;
  winRate: number;
  tradeCount: number;
}

export interface Position {
  symbol: string;
  quantity: number;
  avgPrice: number;
  currentPrice: number;
  unrealizedPnL: number;
}

export interface HollyAlert {
  symbol: string;
  strategy: string;
  entryPrice: number;
  stopPrice?: number;
  alertTime: string;
}

export interface MarketStatus {
  spy: number;
  qqq: number;
  spyChange?: number;
  qqqChange?: number;
}

export interface RecentTrade {
  symbol: string;
  quantity: number;
  price: number;
  side: "BUY" | "SELL";
  timestamp: string;
}

/**
 * Format P&L display with color coding
 */
export function formatPnLDisplay(pnlData: PnLData): { text: string; color: string } {
  const { totalPnL, winRate, tradeCount } = pnlData;
  const color = totalPnL >= 0 ? "#00FF00" : "#FF0000";
  const sign = totalPnL >= 0 ? "+" : "";
  
  const text = `PnL: ${sign}$${totalPnL.toFixed(2)} | WR: ${(winRate * 100).toFixed(1)}% (${tradeCount})`;
  
  return { text, color };
}

/**
 * Format position display (shows top N positions)
 */
export function formatPositionDisplay(positions: Position[], maxLines = 3): string[] {
  if (positions.length === 0) {
    return ["No open positions"];
  }

  // Sort by absolute unrealized P&L (largest movers first)
  const sorted = [...positions].sort((a, b) => Math.abs(b.unrealizedPnL) - Math.abs(a.unrealizedPnL));
  
  return sorted.slice(0, maxLines).map((pos) => {
    const pnlSign = pos.unrealizedPnL >= 0 ? "+" : "";
    return `${pos.symbol}: ${pos.quantity}@${pos.avgPrice.toFixed(2)} ${pnlSign}$${pos.unrealizedPnL.toFixed(2)}`;
  });
}

/**
 * Format Holly alert for display
 */
export function formatHollyAlert(alert: HollyAlert | null): { text: string; color: string } | null {
  if (!alert) return null;

  const stopText = alert.stopPrice ? ` SL:${alert.stopPrice.toFixed(2)}` : "";
  const text = `Holly: ${alert.symbol} ${alert.strategy} @${alert.entryPrice.toFixed(2)}${stopText}`;
  
  return { text, color: "#FF00FF" };
}

/**
 * Format market status (SPY/QQQ)
 */
export function formatMarketStatus(status: MarketStatus): { text: string; color: string } {
  let text = `SPY: ${status.spy.toFixed(2)} | QQQ: ${status.qqq.toFixed(2)}`;
  
  if (status.spyChange !== undefined) {
    const spySign = status.spyChange >= 0 ? "+" : "";
    text += ` | SPY ${spySign}${status.spyChange.toFixed(2)}%`;
  }
  
  // Color based on SPY change (green for up, red for down, white for neutral)
  let color = "#FFFFFF";
  if (status.spyChange !== undefined) {
    color = status.spyChange >= 0 ? "#00FF00" : "#FF0000";
  }
  
  return { text, color };
}

/**
 * Build complete dashboard data for display
 */
export function buildDashboard(
  pnlData: PnLData,
  positions: Position[],
  hollyAlert: HollyAlert | null,
  marketStatus: MarketStatus,
  recentTrade: RecentTrade | null
): DashboardData {
  return {
    pnl: pnlData.totalPnL,
    winRate: pnlData.winRate,
    tradeCount: pnlData.tradeCount,
    positions: positions.map((p) => ({
      symbol: p.symbol,
      quantity: p.quantity,
      avgPrice: p.avgPrice,
      currentPrice: p.currentPrice,
    })),
    hollyAlert: hollyAlert
      ? {
          symbol: hollyAlert.symbol,
          strategy: hollyAlert.strategy,
          entryPrice: hollyAlert.entryPrice,
        }
      : undefined,
    spy: marketStatus.spy,
    qqq: marketStatus.qqq,
    recentTrade: recentTrade
      ? {
          symbol: recentTrade.symbol,
          quantity: recentTrade.quantity,
          price: recentTrade.price,
          side: recentTrade.side,
          timestamp: recentTrade.timestamp,
        }
      : undefined,
  };
}

/**
 * Create a rotating display schedule
 * Returns an array of screen configs that rotate every intervalMs
 */
export interface ScreenConfig {
  type: "pnl" | "positions" | "holly" | "market";
  durationMs: number;
}

export function createRotationSchedule(intervalMs = 10000): ScreenConfig[] {
  return [
    { type: "pnl", durationMs: intervalMs },
    { type: "positions", durationMs: intervalMs },
    { type: "holly", durationMs: intervalMs },
    { type: "market", durationMs: intervalMs },
  ];
}
