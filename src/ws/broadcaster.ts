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
 * 
 * Note: In production, we intentionally don't remove these event listeners
 * because they are shared with persistent DB listeners (attachPersistentOrderListeners).
 * Both systems need the same events, so we keep a single set of listeners active.
 * If WebSocket functionality is disabled in the future, the DB listeners will
 * still function normally. This function exists for API consistency and future use
 * if we need to support dynamic WebSocket enable/disable.
 */
export function detachWebSocketBroadcasters(): void {
  if (!listenersAttached) return;
  
  listenersAttached = false;
  logBroadcast.info("WebSocket broadcasters detached");
}

/**
 * Manually trigger a positions broadcast
 * Useful after an execution or when positions change
 */
async function broadcastPositionsUpdate(): Promise<void> {
  try {
    // Wait for IBKR to process the position change and make it available via reqPositions
    // 100ms is conservative for local IBKR Gateway/TWS communication
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
