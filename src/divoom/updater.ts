/**
 * Divoom Display Updater
 *
 * Periodically fetches live trading data and updates the Divoom Times Gate display.
 * Follows the same pattern as holly/watcher.ts: config-gated, polling, logger, shutdown.
 */

import { DivoomDisplay } from "./display.js";
import {
  buildDashboard,
  type PnLData,
  type Position,
  type HollyAlert,
  type MarketStatus,
  type RecentTrade,
} from "./dashboard.js";
import { config } from "../config.js";
import { logger } from "../logging.js";
import { getPnL } from "../ibkr/account.js";
import { isConnected } from "../ibkr/connection.js";
import { queryHollyAlerts } from "../db/database.js";
import { getQuote } from "../providers/yahoo.js";

const log = logger.child({ module: "divoom-updater" });

let timer: ReturnType<typeof setInterval> | null = null;
let display: DivoomDisplay | null = null;

/**
 * Fetch current P&L data
 */
async function fetchPnLData(): Promise<PnLData> {
  if (!isConnected()) {
    return {
      realizedPnL: 0,
      unrealizedPnL: 0,
      totalPnL: 0,
      winRate: 0,
      tradeCount: 0,
    };
  }

  try {
    const pnl = await getPnL();

    // Calculate win rate from today's executions
    const { queryExecutions } = await import("../db/database.js");
    const today = new Date().toISOString().split("T")[0];
    const todaysExecs = queryExecutions({ limit: 1000 }) as Array<Record<string, unknown>>;
    
    // Group by correlation_id to count trades (not individual executions)
    const tradeMap = new Map<string, number>();
    for (const exec of todaysExecs) {
      const timestamp = String(exec.timestamp ?? "");
      if (!timestamp.startsWith(today)) continue;
      
      const correlationId = String(exec.correlation_id ?? "");
      const pnl = Number(exec.realized_pnl ?? 0);
      if (correlationId && pnl !== 0) {
        tradeMap.set(correlationId, (tradeMap.get(correlationId) ?? 0) + pnl);
      }
    }

    const trades = Array.from(tradeMap.values());
    const winningTrades = trades.filter((pnl) => pnl > 0).length;
    const tradeCount = trades.length;
    const winRate = tradeCount > 0 ? winningTrades / tradeCount : 0;

    return {
      realizedPnL: pnl.realizedPnL ?? 0,
      unrealizedPnL: pnl.unrealizedPnL ?? 0,
      totalPnL: pnl.dailyPnL ?? 0,
      winRate,
      tradeCount,
    };
  } catch (err) {
    log.error({ err }, "Failed to fetch P&L");
    return {
      realizedPnL: 0,
      unrealizedPnL: 0,
      totalPnL: 0,
      winRate: 0,
      tradeCount: 0,
    };
  }
}

/**
 * Fetch current positions
 */
async function fetchPositions(): Promise<Position[]> {
  if (!isConnected()) {
    return [];
  }

  try {
    const { getPositions } = await import("../ibkr/account.js");
    const positions = await getPositions();
    
    // Note: IBKR getPositions() doesn't return current market price
    // To get unrealized P&L, we'd need to fetch quotes for each position
    // For the Divoom display, we show position count rather than individual P&L
    const positionsWithPnL: Position[] = [];
    for (const pos of positions) {
      positionsWithPnL.push({
        symbol: pos.symbol,
        quantity: pos.position,
        avgPrice: pos.avgCost,
        currentPrice: pos.avgCost, // No market price available from getPositions
        unrealizedPnL: 0, // Would need to fetch quotes to calculate
      });
    }
    
    return positionsWithPnL;
  } catch (err) {
    log.error({ err }, "Failed to fetch positions");
    return [];
  }
}

/**
 * Fetch latest Holly alert
 */
async function fetchLatestHollyAlert(): Promise<HollyAlert | null> {
  try {
    const alerts = queryHollyAlerts({ limit: 1 });
    if (alerts.length === 0) return null;

    const alert = alerts[0];
    return {
      symbol: String(alert.symbol ?? ""),
      strategy: String(alert.strategy ?? ""),
      entryPrice: Number(alert.entry_price ?? 0),
      stopPrice: alert.stop_price != null ? Number(alert.stop_price) : undefined,
      alertTime: String(alert.alert_time ?? ""),
    };
  } catch (err) {
    log.error({ err }, "Failed to fetch Holly alert");
    return null;
  }
}

/**
 * Fetch market status (SPY/QQQ)
 */
async function fetchMarketStatus(): Promise<MarketStatus> {
  try {
    const [spyQuote, qqqQuote] = await Promise.all([
      getQuote("SPY"),
      getQuote("QQQ"),
    ]);

    return {
      spy: spyQuote.last ?? 0,
      qqq: qqqQuote.last ?? 0,
      spyChange: spyQuote.changePercent ?? undefined,
      qqqChange: qqqQuote.changePercent ?? undefined,
    };
  } catch (err) {
    log.error({ err }, "Failed to fetch market status");
    return { spy: 0, qqq: 0 };
  }
}

/**
 * Fetch the most recent trade
 */
async function fetchRecentTrade(): Promise<RecentTrade | null> {
  try {
    const { queryExecutions } = await import("../db/database.js");
    const execs = queryExecutions({ limit: 1 });
    if (execs.length === 0) return null;

    const exec = execs[0] as any;
    return {
      symbol: String(exec.symbol ?? ""),
      quantity: Number(exec.quantity ?? 0),
      price: Number(exec.price ?? 0),
      side: String(exec.side ?? "") as "BUY" | "SELL",
      timestamp: String(exec.timestamp ?? ""),
    };
  } catch (err) {
    log.error({ err }, "Failed to fetch recent trade");
    return null;
  }
}

/**
 * Update the display with latest data
 */
async function updateDisplay(): Promise<void> {
  if (!display) return;

  try {
    const [pnlData, positions, hollyAlert, marketStatus, recentTrade] = await Promise.all([
      fetchPnLData(),
      fetchPositions(),
      fetchLatestHollyAlert(),
      fetchMarketStatus(),
      fetchRecentTrade(),
    ]);

    const dashboardData = buildDashboard(pnlData, positions, hollyAlert, marketStatus, recentTrade);
    await display.sendDashboard(dashboardData);
    
    log.debug("Display updated successfully");
  } catch (err) {
    log.error({ err }, "Failed to update display");
  }
}

/**
 * Start the Divoom display updater
 */
export async function startDivoomUpdater(): Promise<void> {
  if (!config.divoom.enabled) {
    log.info("Divoom updater disabled (DIVOOM_ENABLED not set to true)");
    return;
  }

  if (!config.divoom.deviceIp) {
    log.warn("Divoom updater disabled (DIVOOM_DEVICE_IP not set)");
    return;
  }

  display = new DivoomDisplay(config.divoom.deviceIp);

  // Test connection
  const connected = await display.testConnection();
  if (!connected) {
    log.error({ deviceIp: config.divoom.deviceIp }, "Failed to connect to Divoom device");
    return;
  }

  log.info({
    deviceIp: config.divoom.deviceIp,
    refreshIntervalMs: config.divoom.refreshIntervalMs,
    brightness: config.divoom.brightness,
  }, "Divoom updater starting");

  // Set initial brightness
  try {
    await display.setBrightness(config.divoom.brightness);
  } catch (err) {
    log.warn({ err }, "Failed to set initial brightness");
  }

  // Initial update
  await updateDisplay();

  // Start periodic updates
  timer = setInterval(updateDisplay, config.divoom.refreshIntervalMs);
}

/**
 * Stop the Divoom display updater
 */
export async function stopDivoomUpdater(): Promise<void> {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }

  if (display) {
    try {
      await display.clear();
      log.info("Divoom updater stopped and display cleared");
    } catch (err) {
      log.warn({ err }, "Failed to clear display on shutdown");
    }
    display = null;
  }
}

/**
 * Get the current display instance (for testing/MCP tools)
 */
export function getDivoomDisplay(): DivoomDisplay | null {
  return display;
}
