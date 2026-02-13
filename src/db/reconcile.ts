import { isConnected } from "../ibkr/connection.js";
import { getOpenOrders, getExecutions } from "../ibkr/orders.js";
import { getPositions } from "../ibkr/account.js";
import {
  getLiveOrders,
  insertPositionSnapshot,
  getLatestPositionSnapshot,
  updateOrderStatus,
} from "./database.js";
import { logReconcile } from "../logging.js";

/**
 * Two-phase boot reconciliation:
 *
 * Phase 1 (Passive): Mark all "live" orders in DB as RECONCILING,
 *   wait 3s for IBKR to push initial orderStatus callbacks.
 *
 * Phase 2 (Active): Issue reqOpenOrders + reqPositions, compare to DB.
 *   Log drift with severity levels:
 *   - INFO: expected (filled while offline, manual trades)
 *   - WARN: unknown orders not in local DB
 *   - ERROR: position mismatch
 *   Update DB to match reality, snapshot positions.
 */
export async function runReconciliation(): Promise<void> {
  if (!isConnected()) {
    logReconcile.warn("Skipping reconciliation — IBKR not connected");
    return;
  }

  logReconcile.info("Starting boot reconciliation...");

  // Phase 1: Mark live orders as RECONCILING
  const liveOrders = getLiveOrders() as any[];
  for (const order of liveOrders) {
    updateOrderStatus(order.order_id, "RECONCILING");
  }
  logReconcile.info({ count: liveOrders.length }, "Phase 1: Marked live orders as RECONCILING");

  // Wait 3s for IBKR to push initial orderStatus callbacks
  await new Promise((r) => setTimeout(r, 3000));

  // Phase 2: Active comparison
  logReconcile.info("Phase 2: Active reconciliation — querying IBKR state...");

  let ibkrOrders: Awaited<ReturnType<typeof getOpenOrders>> = [];
  let ibkrPositions: Awaited<ReturnType<typeof getPositions>> = [];

  try {
    [ibkrOrders, ibkrPositions] = await Promise.all([getOpenOrders(), getPositions()]);
  } catch (e: any) {
    logReconcile.error({ err: e }, "Failed to fetch IBKR state for reconciliation");
    // Revert RECONCILING → back to previous status
    for (const order of liveOrders) {
      updateOrderStatus(order.order_id, order.status);
    }
    return;
  }

  // Compare orders
  const ibkrOrderIds = new Set(ibkrOrders.map((o) => o.orderId));
  const dbOrderIds = new Set(liveOrders.map((o: any) => o.order_id));

  // Orders still in IBKR — update status in DB
  for (const ibkrOrder of ibkrOrders) {
    if (dbOrderIds.has(ibkrOrder.orderId)) {
      updateOrderStatus(ibkrOrder.orderId, ibkrOrder.status);
      logReconcile.info({ orderId: ibkrOrder.orderId, status: ibkrOrder.status }, "Reconciled order status");
    } else {
      logReconcile.warn({ orderId: ibkrOrder.orderId, symbol: ibkrOrder.symbol, status: ibkrOrder.status }, "Unknown open order in IBKR — not in local DB (placed externally?)");
    }
  }

  // DB orders not in IBKR — they were filled/cancelled while offline
  for (const dbOrder of liveOrders) {
    if (!ibkrOrderIds.has(dbOrder.order_id)) {
      // Check if persistent listeners already updated it from RECONCILING
      const currentStatus = dbOrder.status;
      if (currentStatus === "RECONCILING") {
        updateOrderStatus(dbOrder.order_id, "Inactive");
        logReconcile.info({ orderId: dbOrder.order_id, symbol: dbOrder.symbol }, "Order no longer in IBKR — marked Inactive (likely filled/cancelled while offline)");
      }
    }
  }

  // Compare positions with last snapshot
  const lastSnapshot = getLatestPositionSnapshot();
  if (lastSnapshot) {
    const lastMap = new Map(lastSnapshot.map((p: any) => [p.symbol, p.position]));
    for (const pos of ibkrPositions) {
      const lastQty = lastMap.get(pos.symbol) ?? 0;
      if (pos.position !== lastQty) {
        if (lastQty === 0) {
          logReconcile.info({ symbol: pos.symbol, position: pos.position }, "New position detected (opened while offline)");
        } else {
          logReconcile.error({ symbol: pos.symbol, expected: lastQty, actual: pos.position }, "Position mismatch — DB says different quantity than IBKR");
        }
      }
    }
    // Check for positions that disappeared
    for (const [symbol, qty] of lastMap) {
      if ((qty as number) !== 0 && !ibkrPositions.find((p) => p.symbol === symbol)) {
        logReconcile.info({ symbol, previousQty: qty }, "Position closed while offline");
      }
    }
  }

  // Snapshot current positions
  insertPositionSnapshot(
    ibkrPositions.map((p) => ({ symbol: p.symbol, position: p.position, avgCost: p.avgCost })),
    "reconcile",
  );

  logReconcile.info(
    { openOrders: ibkrOrders.length, positions: ibkrPositions.length },
    "Reconciliation complete",
  );
}
