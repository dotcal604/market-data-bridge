import {
  EventName,
  Contract,
  Execution,
  CommissionReport,
} from "@stoqey/ib";
import { getIB } from "../connection.js";
import {
  updateOrderStatus as dbUpdateOrderStatus,
  insertExecution as dbInsertExecution,
  updateExecutionCommission,
  getOrderByOrderId,
} from "../../db/database.js";
import { tryLinkExecution, schedulePositionCloseCheck } from "../../eval/auto-link.js";
import { logOrder, logExec } from "../../logging.js";

let persistentListenersAttached = false;

export function attachPersistentOrderListeners() {
  if (persistentListenersAttached) return;
  persistentListenersAttached = true;

  const ib = getIB();

  // Track all order status changes
  ib.on(EventName.orderStatus, (orderId: number, status: string, filled: number, remaining: number, avgFillPrice: number) => {
    try {
      const existing = getOrderByOrderId(orderId);
      if (!existing) return; // Order not in our DB (placed externally)
      dbUpdateOrderStatus(orderId, status, filled, avgFillPrice || undefined);
      logOrder.info({ orderId, status, filled, remaining, avgFillPrice }, "Order status updated");
    } catch (e: any) {
      logOrder.error({ err: e, orderId, status }, "Failed to update order status in DB");
    }
  });

  // Track all execution details
  ib.on(EventName.execDetails, (_reqId: number, contract: Contract, execution: Execution) => {
    try {
      const orderId = execution.orderId ?? 0;
      const existing = getOrderByOrderId(orderId) as any;
      if (!existing) return; // Order not in our DB
      const execId = execution.execId ?? "";
      dbInsertExecution({
        exec_id: execId,
        order_id: orderId,
        symbol: contract.symbol ?? "",
        side: execution.side ?? "",
        shares: execution.shares ?? 0,
        price: execution.price ?? 0,
        cum_qty: execution.cumQty ?? undefined,
        avg_price: execution.avgPrice ?? undefined,
        correlation_id: existing.correlation_id,
        timestamp: execution.time ?? new Date().toISOString(),
      });
      logExec.info({ execId, orderId, symbol: contract.symbol, side: execution.side, shares: execution.shares, price: execution.price }, "Execution recorded");

      // Auto-link execution to evaluation
      tryLinkExecution({
        exec_id: execId,
        order_id: orderId,
        symbol: contract.symbol ?? "",
        side: execution.side ?? "",
        price: execution.price ?? 0,
        timestamp: execution.time ?? new Date().toISOString(),
        eval_id: existing.eval_id ?? null,
      });
    } catch (e: any) {
      logExec.error({ err: e, orderId: execution.orderId }, "Failed to write execution to DB");
    }
  });

  // Track commission reports
  ib.on(EventName.commissionReport, (report: CommissionReport) => {
    try {
      const execId = report.execId ?? "";
      if (!execId) return;
      updateExecutionCommission(execId, report.commission ?? 0, report.realizedPNL ?? null);
      logExec.info({ execId, commission: report.commission, realizedPnl: report.realizedPNL }, "Commission report recorded");

      // Auto-link: schedule position close check when IBKR reports realized PNL
      if (report.realizedPNL != null && report.realizedPNL < 1e307) {
        schedulePositionCloseCheck(execId, report.realizedPNL);
      }
    } catch (e: any) {
      logExec.error({ err: e, execId: report.execId }, "Failed to update commission in DB");
    }
  });

  logOrder.info("Persistent order/execution DB listeners attached");
}
