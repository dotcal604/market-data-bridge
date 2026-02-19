import {
  EventName,
  ErrorCode,
  Contract,
  Order,
  OrderState,
  Execution,
  CommissionReport,
  ExecutionFilter,
  isNonFatalError,
} from "@stoqey/ib";
import { getIB, getNextReqId } from "../connection.js";
import { config } from "../../config.js";
import type { OpenOrderData, CompletedOrderData, ExecutionData } from "./types.js";

// ── Open Orders ──────────────────────────────────────────────────────────

/**
 * Fetch all currently open orders.
 * @returns Promise resolving to list of open orders
 */
export async function getOpenOrders(): Promise<OpenOrderData[]> {
  const ib = getIB();

  return new Promise((resolve, reject) => {
    let settled = false;
    const orders: OpenOrderData[] = [];

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(orders);
    }, config.ibkr.orderTimeoutMs);

    const onOpenOrder = (
      orderId: number,
      contract: Contract,
      order: Order,
      orderState: OrderState
    ) => {
      orders.push({
        orderId,
        symbol: contract.symbol ?? "",
        secType: contract.secType ?? "",
        exchange: contract.exchange ?? "",
        currency: contract.currency ?? "",
        action: order.action ?? "",
        orderType: order.orderType ?? "",
        totalQuantity: (order.totalQuantity as number) ?? 0,
        lmtPrice: (order.lmtPrice as number) ?? null,
        auxPrice: (order.auxPrice as number) ?? null,
        status: orderState.status ?? "",
        remaining: (order.totalQuantity as number) ?? 0,
        tif: order.tif ?? "",
        parentId: order.parentId ?? 0,
        ocaGroup: (order as any).ocaGroup ?? "",
        account: order.account ?? "",
      });
    };

    const onEnd = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(orders);
    };

    const onError = (err: Error, code: ErrorCode) => {
      if (isNonFatalError(code, err)) return;
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`Open orders error (${code}): ${err.message}`));
    };

    const cleanup = () => {
      clearTimeout(timeout);
      ib.off(EventName.openOrder, onOpenOrder);
      ib.off(EventName.openOrderEnd, onEnd);
      ib.off(EventName.error, onError);
    };

    ib.on(EventName.openOrder, onOpenOrder);
    ib.on(EventName.openOrderEnd, onEnd);
    ib.on(EventName.error, onError);

    ib.reqAllOpenOrders();
  });
}

// ── Completed Orders ─────────────────────────────────────────────────────

/**
 * Fetch orders completed in the current session.
 * @returns Promise resolving to list of completed orders
 */
export async function getCompletedOrders(): Promise<CompletedOrderData[]> {
  const ib = getIB();

  return new Promise((resolve, reject) => {
    let settled = false;
    const orders: CompletedOrderData[] = [];

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(orders);
    }, config.ibkr.orderTimeoutMs);

    const onCompleted = (
      contract: Contract,
      order: Order,
      orderState: OrderState
    ) => {
      orders.push({
        orderId: order.orderId ?? 0,
        symbol: contract.symbol ?? "",
        secType: contract.secType ?? "",
        exchange: contract.exchange ?? "",
        currency: contract.currency ?? "",
        action: order.action ?? "",
        orderType: order.orderType ?? "",
        totalQuantity: (order.totalQuantity as number) ?? 0,
        lmtPrice: (order.lmtPrice as number) ?? null,
        auxPrice: (order.auxPrice as number) ?? null,
        status: orderState.status ?? "",
        filledQuantity: (orderState as any).filled ?? (order.totalQuantity as number) ?? 0,
        avgFillPrice: (orderState as any).avgFillPrice ?? 0,
        tif: order.tif ?? "",
        account: order.account ?? "",
        completedTime: (orderState as any).completedTime ?? "",
        completedStatus: (orderState as any).completedStatus ?? orderState.status ?? "",
      });
    };

    const onEnd = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(orders);
    };

    const onError = (err: Error, code: ErrorCode) => {
      if (isNonFatalError(code, err)) return;
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`Completed orders error (${code}): ${err.message}`));
    };

    const cleanup = () => {
      clearTimeout(timeout);
      ib.off(EventName.completedOrder, onCompleted);
      ib.off(EventName.completedOrdersEnd, onEnd);
      ib.off(EventName.error, onError);
    };

    ib.on(EventName.completedOrder, onCompleted);
    ib.on(EventName.completedOrdersEnd, onEnd);
    ib.on(EventName.error, onError);

    ib.reqCompletedOrders(false);
  });
}

// ── Executions / Fills ───────────────────────────────────────────────────

/**
 * Fetch recent executions matching filter.
 * @param filter Optional filters (symbol, secType, time)
 * @returns Promise resolving to list of executions
 */
export async function getExecutions(filter?: {
  symbol?: string;
  secType?: string;
  time?: string;
}): Promise<ExecutionData[]> {
  const ib = getIB();
  const reqId = getNextReqId();

  return new Promise((resolve, reject) => {
    let settled = false;
    const execMap = new Map<string, ExecutionData>();

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve([...execMap.values()]);
    }, config.ibkr.executionTimeoutMs);

    const onExecDetails = (
      id: number,
      contract: Contract,
      execution: Execution
    ) => {
      if (id !== reqId) return;
      const execId = execution.execId ?? "";
      execMap.set(execId, {
        execId,
        orderId: execution.orderId ?? 0,
        symbol: contract.symbol ?? "",
        secType: contract.secType ?? "",
        exchange: execution.exchange ?? "",
        currency: contract.currency ?? "",
        side: execution.side ?? "",
        shares: execution.shares ?? 0,
        price: execution.price ?? 0,
        cumQty: execution.cumQty ?? 0,
        avgPrice: execution.avgPrice ?? 0,
        time: execution.time ?? "",
        account: execution.acctNumber ?? "",
        commission: null,
        realizedPnL: null,
      });
    };

    const onCommission = (report: CommissionReport) => {
      const exec = execMap.get(report.execId ?? "");
      if (exec) {
        exec.commission = report.commission ?? null;
        exec.realizedPnL = report.realizedPNL ?? null;
      }
    };

    const onEnd = (id: number) => {
      if (id !== reqId) return;
      // Wait 500ms for commission reports to arrive
      setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve([...execMap.values()]);
      }, 500);
    };

    const onError = (err: Error, code: ErrorCode, id: number) => {
      if (id !== reqId) return;
      if (isNonFatalError(code, err)) return;
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`Executions error (${code}): ${err.message}`));
    };

    const cleanup = () => {
      clearTimeout(timeout);
      ib.off(EventName.execDetails, onExecDetails);
      ib.off(EventName.execDetailsEnd, onEnd);
      ib.off(EventName.commissionReport, onCommission);
      ib.off(EventName.error, onError);
    };

    ib.on(EventName.execDetails, onExecDetails);
    ib.on(EventName.execDetailsEnd, onEnd);
    ib.on(EventName.commissionReport, onCommission);
    ib.on(EventName.error, onError);

    const execFilter: ExecutionFilter = {};
    if (filter?.symbol) execFilter.symbol = filter.symbol;
    if (filter?.secType) execFilter.secType = filter.secType as any;
    if (filter?.time) execFilter.time = filter.time;

    ib.reqExecutions(reqId, execFilter);
  });
}

// ── Next Valid Order ID ──────────────────────────────────────────────────

/**
 * Request the next valid order ID from IBKR.
 * @returns Promise resolving to new order ID
 */
export async function getNextValidOrderId(): Promise<number> {
  const ib = getIB();

  return new Promise((resolve, reject) => {
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("Timed out waiting for next valid order ID"));
    }, 5000);

    const onNextId = (orderId: number) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(orderId);
    };

    const onError = (err: Error, code: ErrorCode) => {
      if (isNonFatalError(code, err)) return;
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`nextValidId error (${code}): ${err.message}`));
    };

    const cleanup = () => {
      clearTimeout(timeout);
      ib.off(EventName.nextValidId, onNextId);
      ib.off(EventName.error, onError);
    };

    ib.on(EventName.nextValidId, onNextId);
    ib.on(EventName.error, onError);

    ib.reqIds();
  });
}
