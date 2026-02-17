/**
 * Trailing Stop Executor
 *
 * Live trailing stop order management via IBKR.
 * Monitors open positions and modifies stop-loss orders as price moves favorably,
 * implementing trailing stop strategies from the optimizer.
 */

import { getIB, getNextReqId } from "../ibkr/connection.js";
import { Order, Contract } from "@stoqey/ib";
import { logger } from "../logging.js";
import { getOpenOrders, type OpenOrderData } from "../ibkr/orders.js";
import { getDb } from "../db/database.js";

const log = logger.child({ module: "trailing-stop-executor" });

// ── Types ────────────────────────────────────────────────────────────────

export interface TrailingStopConfig {
  /** Trail type */
  type: "fixed_pct" | "atr_multiple" | "breakeven_trail";
  /** Trailing distance as % of price (for fixed_pct) */
  trail_pct?: number;
  /** ATR multiplier (for atr_multiple) */
  atr_mult?: number;
  /** R-multiple to move to breakeven (for breakeven_trail) */
  be_trigger_r?: number;
  /** Trail % after breakeven (for breakeven_trail) */
  post_be_trail_pct?: number;
}

export interface PositionState {
  symbol: string;
  quantity: number;
  avgCost: number;
  currentPrice: number;
  unrealizedPnL: number;
  stopOrderId?: number;
  stopPrice?: number;
  highWaterMark: number; // highest price seen for long, lowest for short
  breakevenTriggered: boolean;
}

export interface ExecutorState {
  positions: Map<string, PositionState>;
  config: TrailingStopConfig;
  running: boolean;
}

// ── State ────────────────────────────────────────────────────────────────

let executorState: ExecutorState = {
  positions: new Map(),
  config: {
    type: "fixed_pct",
    trail_pct: 2.0,
  },
  running: false,
};

// ── Core Functions ───────────────────────────────────────────────────────

/**
 * Calculate new stop price based on trailing strategy
 */
export function calculateTrailingStop(
  position: PositionState,
  config: TrailingStopConfig
): number | null {
  const isLong = position.quantity > 0;
  const { type, trail_pct, atr_mult, be_trigger_r, post_be_trail_pct } = config;

  if (type === "fixed_pct" && trail_pct !== undefined) {
    const trailDistance = position.highWaterMark * (trail_pct / 100);
    return isLong
      ? position.highWaterMark - trailDistance
      : position.highWaterMark + trailDistance;
  }

  if (type === "atr_multiple" && atr_mult !== undefined) {
    // Simplified: use 2% of price as ATR proxy
    const atr = position.avgCost * 0.02;
    const trailDistance = atr * atr_mult;
    return isLong
      ? position.highWaterMark - trailDistance
      : position.highWaterMark + trailDistance;
  }

  if (type === "breakeven_trail") {
    // Check if breakeven trigger hit
    const rMultiple = position.unrealizedPnL / (position.avgCost * Math.abs(position.quantity) * 0.02);
    
    if (rMultiple >= (be_trigger_r || 1.0)) {
      // Move to breakeven or trail from there
      const trailDistance = position.avgCost * ((post_be_trail_pct || 1.0) / 100);
      
      if (!position.breakevenTriggered) {
        // First time hitting breakeven
        return position.avgCost;
      } else {
        // Trail from current high water mark
        return isLong
          ? position.highWaterMark - trailDistance
          : position.highWaterMark + trailDistance;
      }
    }
  }

  return null;
}

/**
 * Modify an existing stop order with new stop price
 */
export async function modifyStopOrder(
  orderId: number,
  newStopPrice: number,
  preserveOcaGroup?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const ib = getIB();
    
    // Get current order details
    const openOrders = await getOpenOrders();
    const existingOrder = openOrders.find(o => o.orderId === orderId);
    
    if (!existingOrder) {
      return { success: false, error: "Order not found" };
    }

    // Only modify orders with status PreSubmitted or Submitted
    if (existingOrder.status !== "PreSubmitted" && existingOrder.status !== "Submitted") {
      return { success: false, error: `Cannot modify order with status ${existingOrder.status}` };
    }

    // Create modified order
    const order: Order = {
      action: existingOrder.action === "BUY" ? "SELL" : "BUY",
      orderType: "STP",
      totalQuantity: existingOrder.totalQuantity,
      auxPrice: newStopPrice,
      transmit: true,
    };

    // Preserve OCA group if provided
    if (preserveOcaGroup) {
      (order as any).ocaGroup = preserveOcaGroup;
    } else if (existingOrder.ocaGroup) {
      (order as any).ocaGroup = existingOrder.ocaGroup;
    }

    const contract: Contract = {
      symbol: existingOrder.symbol,
      secType: existingOrder.secType,
      exchange: existingOrder.exchange,
      currency: existingOrder.currency,
    };

    // Place modified order
    ib.placeOrder(orderId, contract, order);
    
    log.info({
      orderId,
      symbol: existingOrder.symbol,
      oldStop: existingOrder.auxPrice,
      newStop: newStopPrice,
      ocaGroup: (order as any).ocaGroup,
    }, "Modified trailing stop order");

    return { success: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.error({ err, orderId, newStopPrice }, "Failed to modify stop order");
    return { success: false, error };
  }
}

/**
 * Update position state with new price data
 */
export function updatePosition(
  symbol: string,
  currentPrice: number,
  quantity: number,
  avgCost: number,
  unrealizedPnL: number,
  stopOrderId?: number,
  stopPrice?: number
): void {
  const existing = executorState.positions.get(symbol);
  const isLong = quantity > 0;

  let highWaterMark = currentPrice;
  let breakevenTriggered = false;

  if (existing) {
    // Update high water mark (peak favorable price)
    if (isLong) {
      highWaterMark = Math.max(existing.highWaterMark, currentPrice);
    } else {
      highWaterMark = Math.min(existing.highWaterMark, currentPrice);
    }
    breakevenTriggered = existing.breakevenTriggered;

    // Check if breakeven was just triggered
    if (!breakevenTriggered && executorState.config.type === "breakeven_trail") {
      const rMultiple = unrealizedPnL / (avgCost * Math.abs(quantity) * 0.02);
      if (rMultiple >= (executorState.config.be_trigger_r || 1.0)) {
        breakevenTriggered = true;
        log.info({ symbol, rMultiple }, "Breakeven trigger activated");
      }
    }
  }

  executorState.positions.set(symbol, {
    symbol,
    quantity,
    avgCost,
    currentPrice,
    unrealizedPnL,
    stopOrderId,
    stopPrice,
    highWaterMark,
    breakevenTriggered,
  });
}

/**
 * Remove a position from tracking (e.g., position closed)
 */
export function removePosition(symbol: string): void {
  executorState.positions.delete(symbol);
  log.info({ symbol }, "Position removed from tracking");
}

/**
 * Process all tracked positions and update trailing stops as needed
 */
export async function processTrailingStops(): Promise<{
  processed: number;
  modified: number;
  errors: string[];
}> {
  const results = {
    processed: 0,
    modified: 0,
    errors: [] as string[],
  };

  if (!executorState.running) {
    return results;
  }

  for (const [symbol, position] of executorState.positions) {
    results.processed++;

    if (!position.stopOrderId) {
      continue; // No stop order to modify
    }

    const newStopPrice = calculateTrailingStop(position, executorState.config);
    
    if (!newStopPrice) {
      continue; // No modification needed
    }

    // Only tighten stops, never loosen
    const isLong = position.quantity > 0;
    const shouldModify = position.stopPrice
      ? (isLong ? newStopPrice > position.stopPrice : newStopPrice < position.stopPrice)
      : true;

    if (!shouldModify) {
      continue;
    }

    const result = await modifyStopOrder(position.stopOrderId, newStopPrice);
    
    if (result.success) {
      position.stopPrice = newStopPrice;
      results.modified++;
    } else {
      results.errors.push(`${symbol}: ${result.error}`);
    }
  }

  return results;
}

/**
 * Start the trailing stop executor
 */
export function startExecutor(config?: TrailingStopConfig): void {
  if (config) {
    executorState.config = config;
  }
  executorState.running = true;
  log.info({ config: executorState.config }, "Trailing stop executor started");
}

/**
 * Stop the trailing stop executor
 */
export function stopExecutor(): void {
  executorState.running = false;
  log.info("Trailing stop executor stopped");
}

/**
 * Get current executor state
 */
export function getExecutorState(): ExecutorState {
  return {
    ...executorState,
    positions: new Map(executorState.positions),
  };
}

/**
 * Reset executor state (for testing)
 */
export function resetExecutor(): void {
  executorState = {
    positions: new Map(),
    config: {
      type: "fixed_pct",
      trail_pct: 2.0,
    },
    running: false,
  };
}
