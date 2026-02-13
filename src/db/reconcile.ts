import { isConnected } from "../ibkr/connection.js";
import { getOpenOrders, getExecutions } from "../ibkr/orders.js";
import { getPositions } from "../ibkr/account.js";
import {
  getLiveOrders,
  getLiveBracketCorrelations,
  getOrdersByCorrelation,
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

  // Phase 3: Bracket order integrity audit
  auditBracketOrders(ibkrOrderIds);

  logReconcile.info(
    { openOrders: ibkrOrders.length, positions: ibkrPositions.length },
    "Reconciliation complete",
  );
}

/**
 * Bracket order integrity audit.
 *
 * A bracket has 3 orders sharing a correlation_id:
 *   - parent (entry) — parent_order_id = 0 or null
 *   - take profit     — parent_order_id = parent.order_id
 *   - stop loss        — parent_order_id = parent.order_id
 *
 * Drift scenarios detected:
 *   1. Parent filled but children missing from IBKR → orphaned position with no protection
 *   2. Parent cancelled but children still alive → zombie TP/SL with no entry
 *   3. Only 1 or 2 of 3 orders exist → partial bracket (mid-submission disconnect)
 *   4. Child filled (TP or SL) but sibling still active → expected, TWS auto-cancels sibling
 */
function auditBracketOrders(ibkrOrderIds: Set<number>): void {
  const liveBrackets = getLiveBracketCorrelations();
  if (liveBrackets.length === 0) return;

  logReconcile.info({ count: liveBrackets.length }, "Auditing live bracket orders...");

  for (const { correlation_id } of liveBrackets) {
    const orders = getOrdersByCorrelation(correlation_id) as Array<{
      order_id: number;
      symbol: string;
      action: string;
      order_type: string;
      status: string;
      parent_order_id: number | null;
    }>;

    if (orders.length < 3) {
      // Partial bracket — likely mid-submission disconnect
      logReconcile.error(
        { correlationId: correlation_id, orderCount: orders.length, orders: orders.map((o) => ({ id: o.order_id, type: o.order_type, status: o.status })) },
        "BRACKET INCOMPLETE — fewer than 3 orders found. Possible mid-submission disconnect.",
      );
      continue;
    }

    const parent = orders.find((o) => !o.parent_order_id || o.parent_order_id === 0);
    const children = orders.filter((o) => o.parent_order_id && o.parent_order_id > 0);

    if (!parent) {
      logReconcile.error(
        { correlationId: correlation_id },
        "BRACKET ORPHANED — child orders exist but no parent found in DB.",
      );
      continue;
    }

    const parentInIbkr = ibkrOrderIds.has(parent.order_id);
    const childrenInIbkr = children.map((c) => ({
      ...c,
      inIbkr: ibkrOrderIds.has(c.order_id),
    }));

    // Case 1: Parent filled, children missing from IBKR
    if (
      (parent.status === "Filled" || !parentInIbkr) &&
      childrenInIbkr.every((c) => !c.inIbkr)
    ) {
      const allChildrenFilled = children.every((c) => c.status === "Filled" || c.status === "Cancelled" || c.status === "Inactive");
      if (!allChildrenFilled) {
        logReconcile.error(
          {
            correlationId: correlation_id,
            symbol: parent.symbol,
            parentId: parent.order_id,
            parentStatus: parent.status,
            children: childrenInIbkr.map((c) => ({ id: c.order_id, type: c.order_type, status: c.status, inIbkr: c.inIbkr })),
          },
          "BRACKET RISK — parent filled/gone but protection orders (TP/SL) not confirmed on IBKR. Position may be unprotected.",
        );
      }
    }

    // Case 2: Parent cancelled but children still alive on IBKR
    if (
      (parent.status === "Cancelled" || parent.status === "ApiCancelled" || parent.status === "Inactive") &&
      childrenInIbkr.some((c) => c.inIbkr)
    ) {
      logReconcile.error(
        {
          correlationId: correlation_id,
          symbol: parent.symbol,
          parentId: parent.order_id,
          parentStatus: parent.status,
          zombieChildren: childrenInIbkr.filter((c) => c.inIbkr).map((c) => ({ id: c.order_id, type: c.order_type })),
        },
        "BRACKET ZOMBIE — parent cancelled but child orders still alive on IBKR. Cancel children manually.",
      );
    }

    // Case 3: Partial presence on IBKR (some orders there, some not)
    const allInIbkr = parentInIbkr && childrenInIbkr.every((c) => c.inIbkr);
    const noneInIbkr = !parentInIbkr && childrenInIbkr.every((c) => !c.inIbkr);
    if (!allInIbkr && !noneInIbkr) {
      // Mixed state — only log as warning if parent is still active
      if (parent.status === "Submitted" || parent.status === "PreSubmitted") {
        logReconcile.warn(
          {
            correlationId: correlation_id,
            symbol: parent.symbol,
            parentId: parent.order_id,
            parentInIbkr,
            children: childrenInIbkr.map((c) => ({ id: c.order_id, type: c.order_type, inIbkr: c.inIbkr })),
          },
          "BRACKET PARTIAL — not all bracket orders visible on IBKR. May resolve via TWS auto-sync.",
        );
      }
    }

    // Case 4: All healthy — parent + children all on IBKR
    if (allInIbkr) {
      logReconcile.info(
        { correlationId: correlation_id, symbol: parent.symbol, parentId: parent.order_id },
        "Bracket healthy — all 3 orders confirmed on IBKR",
      );
    }
  }
}
