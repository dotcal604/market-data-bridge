import { wsServer } from "./server.js";
import { EventName, Contract, Execution } from "@stoqey/ib";
import { getIB, isConnected } from "../ibkr/connection.js";
import { logger } from "../logging.js";
import { getPositions } from "../ibkr/account.js";
import { getOpenOrders } from "../ibkr/orders.js";

const logBroadcast = logger.child({ module: "ws-broadcast" });

let listenersAttached = false;

/**
 * Attach WebSocket broadcasters to IBKR events
 * Called after IBKR connection is established
 */
export function attachWebSocketBroadcasters(): void {
  if (!isConnected()) {
    logBroadcast.warn("Cannot attach WebSocket broadcasters: IBKR not connected");
    return;
  }

  if (listenersAttached) {
    logBroadcast.debug("WebSocket broadcasters already attached");
    return;
  }

  listenersAttached = true;
  const ib = getIB();

  // Broadcast order status changes
  ib.on(EventName.orderStatus, (orderId: number, status: string, filled: number, remaining: number, avgFillPrice: number) => {
    logBroadcast.debug({ orderId, status }, "Broadcasting order status update");
    wsServer.broadcast("orders", {
      orderId,
      status,
      filled,
      remaining,
      avgFillPrice,
      timestamp: new Date().toISOString(),
    });

    // If order is filled, also refresh positions
    if (status === "Filled") {
      broadcastPositionsUpdate();
    }
  });

  // Broadcast execution details
  ib.on(EventName.execDetails, (_reqId: number, contract: Contract, execution: Execution) => {
    logBroadcast.debug({ orderId: execution.orderId, execId: execution.execId }, "Broadcasting execution");
    wsServer.broadcast("executions", {
      execId: execution.execId,
      orderId: execution.orderId,
      symbol: contract.symbol,
      secType: contract.secType,
      side: execution.side,
      shares: execution.shares,
      price: execution.price,
      cumQty: execution.cumQty,
      avgPrice: execution.avgPrice,
      time: execution.time,
      timestamp: new Date().toISOString(),
    });

    // Execution means position changed
    broadcastPositionsUpdate();
  });

  // Broadcast account value updates
  ib.on(EventName.accountSummary, (reqId: number, account: string, tag: string, value: string, currency: string) => {
    logBroadcast.debug({ account, tag }, "Broadcasting account summary update");
    wsServer.broadcast("account", {
      account,
      tag,
      value,
      currency,
      timestamp: new Date().toISOString(),
    });
  });

  logBroadcast.info("WebSocket broadcasters attached to IBKR events");
}

/**
 * Detach WebSocket broadcasters (for cleanup)
 */
export function detachWebSocketBroadcasters(): void {
  if (!listenersAttached) return;

  // Note: In production, we don't actually remove these listeners
  // because they're shared with the persistent DB listeners.
  // This function is here for symmetry and future use.
  
  listenersAttached = false;
  logBroadcast.info("WebSocket broadcasters detached");
}

/**
 * Manually trigger a positions broadcast
 * Useful after an execution or when positions change
 */
async function broadcastPositionsUpdate(): Promise<void> {
  try {
    // Small delay to let IBKR process the change
    await new Promise((resolve) => setTimeout(resolve, 100));
    
    const positions = await getPositions();
    wsServer.broadcast("positions", {
      type: "full_snapshot",
      positions,
      timestamp: new Date().toISOString(),
    });
    logBroadcast.debug("Broadcasted full positions snapshot");
  } catch (err: any) {
    logBroadcast.error({ err }, "Failed to broadcast positions update");
  }
}

/**
 * Manually trigger an orders broadcast
 */
export async function broadcastOrdersUpdate(): Promise<void> {
  try {
    const orders = await getOpenOrders();
    wsServer.broadcast("orders", {
      type: "full_snapshot",
      orders,
      timestamp: new Date().toISOString(),
    });
    logBroadcast.debug("Broadcasted full orders snapshot");
  } catch (err: any) {
    logBroadcast.error({ err }, "Failed to broadcast orders update");
  }
}
