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
import { getIB, getNextReqId } from "./connection.js";
import {
  generateCorrelationId,
  insertOrder,
  updateOrderStatus as dbUpdateOrderStatus,
  insertExecution as dbInsertExecution,
  updateExecutionCommission,
  getOrderByOrderId,
} from "../db/database.js";
import { logOrder, logExec } from "../logging.js";
import { config } from "../config.js";

// ── Open Orders ──────────────────────────────────────────────────────────

export interface OpenOrderData {
  orderId: number;
  symbol: string;
  secType: string;
  exchange: string;
  currency: string;
  action: string;
  orderType: string;
  totalQuantity: number;
  lmtPrice: number | null;
  auxPrice: number | null;
  status: string;
  remaining: number;
  tif: string;
  parentId: number;
  ocaGroup: string;
  account: string;
}

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

export interface CompletedOrderData {
  orderId: number;
  symbol: string;
  secType: string;
  exchange: string;
  currency: string;
  action: string;
  orderType: string;
  totalQuantity: number;
  lmtPrice: number | null;
  auxPrice: number | null;
  status: string;
  filledQuantity: number;
  avgFillPrice: number;
  tif: string;
  account: string;
  completedTime: string;
  completedStatus: string;
}

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

export interface ExecutionData {
  execId: string;
  orderId: number;
  symbol: string;
  secType: string;
  exchange: string;
  currency: string;
  side: string;
  shares: number;
  price: number;
  cumQty: number;
  avgPrice: number;
  time: string;
  account: string;
  commission: number | null;
  realizedPnL: number | null;
}

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

// ── Place Order ──────────────────────────────────────────────────────────

export interface PlaceOrderParams {
  symbol: string;
  secType?: string;
  exchange?: string;
  currency?: string;
  action: string; // "BUY" | "SELL"
  orderType: string; // Any IBKR order type: MKT, LMT, STP, STP LMT, TRAIL, TRAIL LIMIT, REL, MIT, MOC, LOC, etc.
  totalQuantity: number;
  lmtPrice?: number;
  auxPrice?: number; // stop price, or trailing amount for TRAIL
  tif?: string; // "DAY" | "GTC" | "IOC" | "GTD" | "OPG" | "FOK" | "DTC"
  transmit?: boolean;
  parentId?: number; // for bracket child orders
  ocaGroup?: string;
  ocaType?: number; // 1=Cancel with block, 2=Reduce with block, 3=Reduce non-block
  // Trailing order fields
  trailingPercent?: number; // trailing stop as percentage (alternative to auxPrice)
  trailStopPrice?: number; // initial stop price anchor for trailing orders
  // Advanced order fields
  goodAfterTime?: string; // "YYYYMMDD HH:MM:SS timezone"
  goodTillDate?: string; // "YYYYMMDD HH:MM:SS timezone"
  outsideRth?: boolean; // allow execution outside regular trading hours
  hidden?: boolean; // hidden order (iceberg)
  discretionaryAmt?: number; // discretionary amount for REL orders
  // Algo fields
  algoStrategy?: string; // "Adaptive", "ArrivalPx", "DarkIce", "PctVol", "Twap", "Vwap", etc.
  algoParams?: Array<{ tag: string; value: string }>; // algo-specific params
  // Account / hedge fields
  account?: string;
  hedgeType?: string; // "D" (delta), "B" (beta), "F" (FX), "P" (pair)
  hedgeParam?: string;
  // DB tracking fields
  strategy_version?: string;
  order_source?: string;
  ai_confidence?: number;
  journal_id?: number;
}

// ── Order Validation ─────────────────────────────────────────────────────

export interface OrderValidationResult {
  valid: boolean;
  errors: string[];
}

const KNOWN_ORDER_TYPES = new Set([
  "MKT", "LMT", "STP", "STP LMT",
  "TRAIL", "TRAIL LIMIT",
  "REL", "MIT", "MOC", "LOC",
  "MKT PRT", "LIT", "PEG MID", "PEG MKT",
  "SNAP MID", "SNAP MKT", "SNAP PRIM",
  "MKT IF TOUCHED", "MKT ON CLOSE", "LMT ON CLOSE",
  "PASSV REL", "PEG BENCH",
]);

export function validateOrder(params: PlaceOrderParams): OrderValidationResult {
  const errors: string[] = [];

  // Basic required fields
  if (!params.symbol) errors.push("symbol is required");
  if (!["BUY", "SELL"].includes(params.action)) errors.push("action must be BUY or SELL");
  if (!params.orderType) errors.push("orderType is required");
  if (!params.totalQuantity || params.totalQuantity <= 0) errors.push("totalQuantity must be positive");

  const ot = params.orderType;

  // Warn on unknown types (don't reject — IBKR may support more than we track)
  if (!KNOWN_ORDER_TYPES.has(ot)) {
    logOrder.warn({ orderType: ot }, "Unknown order type — passing through to IBKR");
  }

  // LMT requires lmtPrice
  if ((ot === "LMT" || ot === "STP LMT" || ot === "TRAIL LIMIT") && !params.lmtPrice) {
    errors.push(`${ot} requires lmtPrice`);
  }

  // STP / STP LMT requires auxPrice
  if ((ot === "STP" || ot === "STP LMT") && !params.auxPrice) {
    errors.push(`${ot} requires auxPrice (stop trigger price)`);
  }

  // TRAIL requires either auxPrice (trailing amount) or trailingPercent
  if (ot === "TRAIL" || ot === "TRAIL LIMIT") {
    if (!params.auxPrice && !params.trailingPercent) {
      errors.push(`${ot} requires auxPrice (trailing amount) or trailingPercent`);
    }
    if (params.auxPrice && params.trailingPercent) {
      errors.push(`${ot}: specify auxPrice OR trailingPercent, not both`);
    }
  }

  // OCA validation
  if (params.ocaType !== undefined && ![1, 2, 3].includes(params.ocaType)) {
    errors.push("ocaType must be 1 (cancel w/ block), 2 (reduce w/ block), or 3 (reduce non-block)");
  }

  // REL discretionary
  if (params.discretionaryAmt !== undefined && ot !== "REL") {
    errors.push("discretionaryAmt is only valid for REL orders");
  }

  return { valid: errors.length === 0, errors };
}

export interface PlaceOrderResult {
  orderId: number;
  symbol: string;
  action: string;
  orderType: string;
  totalQuantity: number;
  lmtPrice: number | null;
  auxPrice: number | null;
  status: string;
  correlation_id: string;
}

export async function placeOrder(params: PlaceOrderParams): Promise<PlaceOrderResult> {
  const ib = getIB();
  const orderId = await getNextValidOrderId();
  const correlationId = params.parentId ? (getOrderByOrderId(params.parentId) as any)?.correlation_id ?? generateCorrelationId() : generateCorrelationId();

  const contract: Contract = {
    symbol: params.symbol,
    secType: (params.secType ?? "STK") as any,
    exchange: params.exchange ?? "SMART",
    currency: params.currency ?? "USD",
  };

  const order: Order = {
    orderId,
    action: params.action as any,
    orderType: params.orderType as any,
    totalQuantity: params.totalQuantity,
    lmtPrice: params.lmtPrice ?? 0,
    auxPrice: params.auxPrice ?? 0,
    tif: (params.tif ?? "DAY") as any,
    transmit: params.transmit ?? true,
    parentId: params.parentId ?? 0,
    ocaGroup: params.ocaGroup ?? "",
  };

  // Advanced fields — only set if provided (avoids IBKR rejecting zero/empty defaults)
  if (params.ocaType !== undefined) (order as any).ocaType = params.ocaType;
  if (params.trailingPercent !== undefined) (order as any).trailingPercent = params.trailingPercent;
  if (params.trailStopPrice !== undefined) (order as any).trailStopPrice = params.trailStopPrice;
  if (params.goodAfterTime) (order as any).goodAfterTime = params.goodAfterTime;
  if (params.goodTillDate) (order as any).goodTillDate = params.goodTillDate;
  if (params.outsideRth !== undefined) (order as any).outsideRth = params.outsideRth;
  if (params.hidden !== undefined) (order as any).hidden = params.hidden;
  if (params.discretionaryAmt !== undefined) (order as any).discretionaryAmt = params.discretionaryAmt;
  if (params.algoStrategy) (order as any).algoStrategy = params.algoStrategy;
  if (params.algoParams) (order as any).algoParams = params.algoParams;
  if (params.account) (order as any).account = params.account;
  if (params.hedgeType) (order as any).hedgeType = params.hedgeType;
  if (params.hedgeParam) (order as any).hedgeParam = params.hedgeParam;

  logOrder.info({ orderId, symbol: params.symbol, orderType: params.orderType, order }, "Submitting order to IBKR");

  // Write to DB before sending to IBKR
  try {
    insertOrder({
      order_id: orderId,
      symbol: params.symbol,
      action: params.action,
      order_type: params.orderType,
      total_quantity: params.totalQuantity,
      lmt_price: params.lmtPrice,
      aux_price: params.auxPrice,
      tif: params.tif,
      sec_type: params.secType,
      exchange: params.exchange,
      currency: params.currency,
      strategy_version: params.strategy_version ?? "manual",
      order_source: params.order_source ?? "manual",
      ai_confidence: params.ai_confidence,
      correlation_id: correlationId,
      journal_id: params.journal_id,
      parent_order_id: params.parentId,
    });
    logOrder.info({ orderId, symbol: params.symbol, action: params.action, orderType: params.orderType, qty: params.totalQuantity, correlationId }, "Order recorded in DB");
  } catch (e: any) {
    logOrder.error({ err: e, orderId }, "Failed to write order to DB — continuing with placement");
  }

  return new Promise((resolve, reject) => {
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({
        orderId,
        symbol: params.symbol,
        action: params.action,
        orderType: params.orderType,
        totalQuantity: params.totalQuantity,
        lmtPrice: params.lmtPrice ?? null,
        auxPrice: params.auxPrice ?? null,
        status: "Submitted (timeout waiting for confirmation)",
        correlation_id: correlationId,
      });
    }, config.ibkr.orderTimeoutMs);

    const onOrderStatus = (
      id: number,
      status: string,
      filled: number,
      remaining: number,
      avgFillPrice: number
    ) => {
      if (id !== orderId) return;
      if (settled) return;
      settled = true;
      cleanup();
      resolve({
        orderId,
        symbol: params.symbol,
        action: params.action,
        orderType: params.orderType,
        totalQuantity: params.totalQuantity,
        lmtPrice: params.lmtPrice ?? null,
        auxPrice: params.auxPrice ?? null,
        status,
        correlation_id: correlationId,
      });
    };

    const onError = (err: Error, code: ErrorCode, id: number) => {
      if (id !== orderId && id !== -1) return;
      if (isNonFatalError(code, err)) return;
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`Place order error (${code}): ${err.message}`));
    };

    const cleanup = () => {
      clearTimeout(timeout);
      ib.off(EventName.orderStatus, onOrderStatus);
      ib.off(EventName.error, onError);
    };

    ib.on(EventName.orderStatus, onOrderStatus);
    ib.on(EventName.error, onError);

    ib.placeOrder(orderId, contract, order);
  });
}

// ── Place Bracket Order ──────────────────────────────────────────────────

export interface BracketOrderParams {
  symbol: string;
  secType?: string;
  exchange?: string;
  currency?: string;
  action: string; // "BUY" | "SELL"
  totalQuantity: number;
  entryType: string; // "MKT" | "LMT"
  entryPrice?: number; // limit price for entry (required if entryType is LMT)
  takeProfitPrice: number;
  stopLossPrice: number;
  tif?: string;
  // DB tracking fields
  strategy_version?: string;
  order_source?: string;
  ai_confidence?: number;
  journal_id?: number;
}

export interface BracketOrderResult {
  parentOrderId: number;
  takeProfitOrderId: number;
  stopLossOrderId: number;
  symbol: string;
  action: string;
  totalQuantity: number;
  entryType: string;
  entryPrice: number | null;
  takeProfitPrice: number;
  stopLossPrice: number;
  status: string;
  correlation_id: string;
}

export async function placeBracketOrder(params: BracketOrderParams): Promise<BracketOrderResult> {
  const ib = getIB();
  const parentId = await getNextValidOrderId();
  const tpId = parentId + 1;
  const slId = parentId + 2;
  const correlationId = generateCorrelationId();

  const reverseAction = params.action === "BUY" ? "SELL" : "BUY";

  const contract: Contract = {
    symbol: params.symbol,
    secType: (params.secType ?? "STK") as any,
    exchange: params.exchange ?? "SMART",
    currency: params.currency ?? "USD",
  };

  // Parent order (entry)
  const parentOrder: Order = {
    orderId: parentId,
    action: params.action as any,
    orderType: params.entryType as any,
    totalQuantity: params.totalQuantity,
    lmtPrice: params.entryPrice ?? 0,
    tif: (params.tif ?? "DAY") as any,
    transmit: false, // don't transmit until all children are placed
  };

  // Take profit (limit order)
  const takeProfitOrder: Order = {
    orderId: tpId,
    action: reverseAction as any,
    orderType: "LMT" as any,
    totalQuantity: params.totalQuantity,
    lmtPrice: params.takeProfitPrice,
    parentId: parentId,
    tif: (params.tif ?? "GTC") as any,
    transmit: false,
  };

  // Stop loss (stop order)
  const stopLossOrder: Order = {
    orderId: slId,
    action: reverseAction as any,
    orderType: "STP" as any,
    totalQuantity: params.totalQuantity,
    auxPrice: params.stopLossPrice,
    parentId: parentId,
    tif: (params.tif ?? "GTC") as any,
    transmit: true, // transmit all three when the last one is placed
  };

  // Write all 3 orders to DB with shared correlation_id
  const dbFields = {
    strategy_version: params.strategy_version ?? "manual",
    order_source: params.order_source ?? "manual",
    ai_confidence: params.ai_confidence,
    correlation_id: correlationId,
    journal_id: params.journal_id,
  };
  try {
    insertOrder({ order_id: parentId, symbol: params.symbol, action: params.action, order_type: params.entryType, total_quantity: params.totalQuantity, lmt_price: params.entryPrice, sec_type: params.secType, exchange: params.exchange, currency: params.currency, ...dbFields });
    insertOrder({ order_id: tpId, symbol: params.symbol, action: reverseAction, order_type: "LMT", total_quantity: params.totalQuantity, lmt_price: params.takeProfitPrice, sec_type: params.secType, exchange: params.exchange, currency: params.currency, parent_order_id: parentId, ...dbFields });
    insertOrder({ order_id: slId, symbol: params.symbol, action: reverseAction, order_type: "STP", total_quantity: params.totalQuantity, aux_price: params.stopLossPrice, sec_type: params.secType, exchange: params.exchange, currency: params.currency, parent_order_id: parentId, ...dbFields });
    logOrder.info({ parentId, tpId, slId, symbol: params.symbol, correlationId }, "Bracket order recorded in DB");
  } catch (e: any) {
    logOrder.error({ err: e, parentId }, "Failed to write bracket order to DB — continuing with placement");
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let parentStatus = "";

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({
        parentOrderId: parentId,
        takeProfitOrderId: tpId,
        stopLossOrderId: slId,
        symbol: params.symbol,
        action: params.action,
        totalQuantity: params.totalQuantity,
        entryType: params.entryType,
        entryPrice: params.entryPrice ?? null,
        takeProfitPrice: params.takeProfitPrice,
        stopLossPrice: params.stopLossPrice,
        status: parentStatus || "Submitted (awaiting confirmation)",
        correlation_id: correlationId,
      });
    }, config.ibkr.orderTimeoutMs);

    const onOrderStatus = (
      id: number,
      status: string,
    ) => {
      if (id === parentId) {
        parentStatus = status;
        if (status === "Filled" || status === "PreSubmitted" || status === "Submitted") {
          if (settled) return;
          settled = true;
          cleanup();
          resolve({
            parentOrderId: parentId,
            takeProfitOrderId: tpId,
            stopLossOrderId: slId,
            symbol: params.symbol,
            action: params.action,
            totalQuantity: params.totalQuantity,
            entryType: params.entryType,
            entryPrice: params.entryPrice ?? null,
            takeProfitPrice: params.takeProfitPrice,
            stopLossPrice: params.stopLossPrice,
            status,
            correlation_id: correlationId,
          });
        }
      }
    };

    const onError = (err: Error, code: ErrorCode, id: number) => {
      if (id !== parentId && id !== tpId && id !== slId && id !== -1) return;
      if (isNonFatalError(code, err)) return;
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`Bracket order error (${code}) on orderId ${id}: ${err.message}`));
    };

    const cleanup = () => {
      clearTimeout(timeout);
      ib.off(EventName.orderStatus, onOrderStatus);
      ib.off(EventName.error, onError);
    };

    ib.on(EventName.orderStatus, onOrderStatus);
    ib.on(EventName.error, onError);

    // Place all three in sequence
    ib.placeOrder(parentId, contract, parentOrder);
    ib.placeOrder(tpId, contract, takeProfitOrder);
    ib.placeOrder(slId, contract, stopLossOrder);
  });
}

// ── Advanced Bracket Order (supports trailing stop, OCA) ─────────────────

export interface AdvancedBracketParams {
  symbol: string;
  secType?: string;
  exchange?: string;
  currency?: string;
  action: string; // "BUY" | "SELL"
  quantity: number;
  entry: { type: string; price?: number };
  takeProfit: { type: string; price: number };
  stopLoss: {
    type: string; // "STP", "TRAIL", "TRAIL LIMIT", "STP LMT"
    price?: number;
    trailingAmount?: number;
    trailingPercent?: number;
    lmtPrice?: number; // for TRAIL LIMIT or STP LMT
  };
  tif?: string;
  outsideRth?: boolean;
  ocaType?: 1 | 2 | 3;
  // DB tracking
  strategy_version?: string;
  order_source?: string;
  ai_confidence?: number;
  journal_id?: number;
}

export interface AdvancedBracketResult {
  parentOrderId: number;
  takeProfitOrderId: number;
  stopLossOrderId: number;
  ocaGroup: string;
  symbol: string;
  action: string;
  quantity: number;
  entry: { type: string; price: number | null };
  takeProfit: { type: string; price: number };
  stopLoss: { type: string; price?: number; trailingAmount?: number; trailingPercent?: number };
  status: string;
  correlation_id: string;
}

export async function placeAdvancedBracket(params: AdvancedBracketParams): Promise<AdvancedBracketResult> {
  const ib = getIB();
  const parentId = await getNextValidOrderId();
  const tpId = parentId + 1;
  const slId = parentId + 2;
  const correlationId = generateCorrelationId();
  const ocaGroup = `bracket_${parentId}_${Date.now()}`;

  const reverseAction = params.action === "BUY" ? "SELL" : "BUY";

  const contract: Contract = {
    symbol: params.symbol,
    secType: (params.secType ?? "STK") as any,
    exchange: params.exchange ?? "SMART",
    currency: params.currency ?? "USD",
  };

  // Parent order (entry)
  const parentOrder: Order = {
    orderId: parentId,
    action: params.action as any,
    orderType: params.entry.type as any,
    totalQuantity: params.quantity,
    lmtPrice: params.entry.price ?? 0,
    tif: (params.tif ?? "DAY") as any,
    transmit: false,
  };
  if (params.outsideRth) (parentOrder as any).outsideRth = true;

  // Take profit (child)
  const tpOrder: Order = {
    orderId: tpId,
    action: reverseAction as any,
    orderType: params.takeProfit.type as any,
    totalQuantity: params.quantity,
    lmtPrice: params.takeProfit.price,
    parentId,
    ocaGroup,
    tif: "GTC" as any,
    transmit: false,
  };
  if (params.outsideRth) (tpOrder as any).outsideRth = true;

  // Stop loss (child — supports TRAIL, TRAIL LIMIT, STP, STP LMT)
  const slType = params.stopLoss.type;
  const slOrder: Order = {
    orderId: slId,
    action: reverseAction as any,
    orderType: slType as any,
    totalQuantity: params.quantity,
    parentId,
    ocaGroup,
    tif: "GTC" as any,
    transmit: true, // last child — transmits the whole bracket
  };
  if (params.outsideRth) (slOrder as any).outsideRth = true;

  // Set stop/trail fields based on type
  if (slType === "STP" || slType === "STP LMT") {
    slOrder.auxPrice = params.stopLoss.price ?? 0;
    if (slType === "STP LMT") slOrder.lmtPrice = params.stopLoss.lmtPrice ?? params.stopLoss.price ?? 0;
  } else if (slType === "TRAIL" || slType === "TRAIL LIMIT") {
    if (params.stopLoss.trailingPercent) {
      (slOrder as any).trailingPercent = params.stopLoss.trailingPercent;
    } else if (params.stopLoss.trailingAmount) {
      slOrder.auxPrice = params.stopLoss.trailingAmount;
    }
    if (params.stopLoss.price) (slOrder as any).trailStopPrice = params.stopLoss.price;
    if (slType === "TRAIL LIMIT") slOrder.lmtPrice = params.stopLoss.lmtPrice ?? 0;
  }

  // OCA type: cancel with block (when one child fills, cancel the other)
  (tpOrder as any).ocaType = params.ocaType ?? 1;
  (slOrder as any).ocaType = params.ocaType ?? 1;

  // Write all 3 to DB
  const dbFields = {
    strategy_version: params.strategy_version ?? "manual",
    order_source: params.order_source ?? "manual",
    ai_confidence: params.ai_confidence,
    correlation_id: correlationId,
    journal_id: params.journal_id,
  };
  try {
    insertOrder({ order_id: parentId, symbol: params.symbol, action: params.action, order_type: params.entry.type, total_quantity: params.quantity, lmt_price: params.entry.price, sec_type: params.secType, exchange: params.exchange, currency: params.currency, ...dbFields });
    insertOrder({ order_id: tpId, symbol: params.symbol, action: reverseAction, order_type: params.takeProfit.type, total_quantity: params.quantity, lmt_price: params.takeProfit.price, sec_type: params.secType, exchange: params.exchange, currency: params.currency, parent_order_id: parentId, ...dbFields });
    insertOrder({ order_id: slId, symbol: params.symbol, action: reverseAction, order_type: slType, total_quantity: params.quantity, aux_price: params.stopLoss.price ?? params.stopLoss.trailingAmount, sec_type: params.secType, exchange: params.exchange, currency: params.currency, parent_order_id: parentId, ...dbFields });
    logOrder.info({ parentId, tpId, slId, ocaGroup, symbol: params.symbol, correlationId }, "Advanced bracket recorded in DB");
  } catch (e: any) {
    logOrder.error({ err: e, parentId }, "Failed to write advanced bracket to DB — continuing");
  }

  logOrder.info({ parentOrder, tpOrder, slOrder }, "Submitting advanced bracket to IBKR");

  return new Promise((resolve, reject) => {
    let settled = false;
    let parentStatus = "";

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(buildResult(parentStatus || "Submitted (awaiting confirmation)"));
    }, config.ibkr.orderTimeoutMs);

    const onOrderStatus = (id: number, status: string) => {
      if (id === parentId) {
        parentStatus = status;
        if (["Filled", "PreSubmitted", "Submitted"].includes(status)) {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(buildResult(status));
        }
      }
    };

    const onError = (err: Error, code: ErrorCode, id: number) => {
      if (id !== parentId && id !== tpId && id !== slId && id !== -1) return;
      if (isNonFatalError(code, err)) return;
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`Advanced bracket error (${code}) on orderId ${id}: ${err.message}`));
    };

    const cleanup = () => {
      clearTimeout(timeout);
      ib.off(EventName.orderStatus, onOrderStatus);
      ib.off(EventName.error, onError);
    };

    function buildResult(status: string): AdvancedBracketResult {
      return {
        parentOrderId: parentId,
        takeProfitOrderId: tpId,
        stopLossOrderId: slId,
        ocaGroup,
        symbol: params.symbol,
        action: params.action,
        quantity: params.quantity,
        entry: { type: params.entry.type, price: params.entry.price ?? null },
        takeProfit: { type: params.takeProfit.type, price: params.takeProfit.price },
        stopLoss: {
          type: slType,
          price: params.stopLoss.price,
          trailingAmount: params.stopLoss.trailingAmount,
          trailingPercent: params.stopLoss.trailingPercent,
        },
        status,
        correlation_id: correlationId,
      };
    }

    ib.on(EventName.orderStatus, onOrderStatus);
    ib.on(EventName.error, onError);

    ib.placeOrder(parentId, contract, parentOrder);
    ib.placeOrder(tpId, contract, tpOrder);
    ib.placeOrder(slId, contract, slOrder);
  });
}

// ── Modify Order ─────────────────────────────────────────────────────────
// IBKR modifies an order in-place when you call placeOrder() with the SAME
// orderId.  This avoids the cancel→reopen race that breaks OCA/bracket links.

export interface ModifyOrderParams {
  orderId: number;
  // Fields that can be modified on a live order:
  lmtPrice?: number;
  auxPrice?: number; // stop trigger price
  totalQuantity?: number;
  orderType?: string; // e.g. change STP → STP LMT
  tif?: string;
  // Trailing fields
  trailingPercent?: number;
  trailStopPrice?: number;
}

export interface ModifyOrderResult {
  orderId: number;
  symbol: string;
  action: string;
  orderType: string;
  totalQuantity: number;
  lmtPrice: number | null;
  auxPrice: number | null;
  status: string;
  modified: string[]; // list of fields that were changed
}

export async function modifyOrder(params: ModifyOrderParams): Promise<ModifyOrderResult> {
  const ib = getIB();

  // 0. Input validation
  if (params.lmtPrice !== undefined && params.lmtPrice < 0) throw new Error("lmtPrice must be non-negative");
  if (params.auxPrice !== undefined && params.auxPrice < 0) throw new Error("auxPrice must be non-negative");
  if (params.totalQuantity !== undefined && params.totalQuantity <= 0) throw new Error("totalQuantity must be positive");

  // 1. Fetch the live order from TWS to get current contract + order state
  const openOrders = await getOpenOrders();
  const existing = openOrders.find((o) => o.orderId === params.orderId);
  if (!existing) {
    throw new Error(`Order ${params.orderId} not found in open orders — cannot modify a filled/cancelled order`);
  }

  // Only modify orders in a working state
  const modifiableStatuses = new Set(["PreSubmitted", "Submitted"]);
  if (!modifiableStatuses.has(existing.status)) {
    throw new Error(`Order ${params.orderId} is not modifiable (status: ${existing.status})`);
  }

  // 2. Build contract from the existing order's fields
  const contract: Contract = {
    symbol: existing.symbol,
    secType: existing.secType as any,
    exchange: existing.exchange || "SMART",
    currency: existing.currency || "USD",
  };

  // 3. Build the modified order — start with existing values, overlay changes
  const modified: string[] = [];
  const newLmtPrice = params.lmtPrice ?? (existing.lmtPrice as number) ?? 0;
  const newAuxPrice = params.auxPrice ?? (existing.auxPrice as number) ?? 0;
  const newQuantity = params.totalQuantity ?? existing.totalQuantity;
  const newOrderType = params.orderType ?? existing.orderType;
  const newTif = params.tif ?? existing.tif;

  if (params.lmtPrice !== undefined) modified.push(`lmtPrice→${params.lmtPrice}`);
  if (params.auxPrice !== undefined) modified.push(`auxPrice→${params.auxPrice}`);
  if (params.totalQuantity !== undefined) modified.push(`totalQuantity→${params.totalQuantity}`);
  if (params.orderType !== undefined) modified.push(`orderType→${params.orderType}`);
  if (params.tif !== undefined) modified.push(`tif→${params.tif}`);

  if (modified.length === 0) {
    throw new Error("No fields to modify — provide at least one of: lmtPrice, auxPrice, totalQuantity, orderType, tif");
  }

  const order: Order = {
    orderId: params.orderId,
    action: existing.action as any,
    orderType: newOrderType as any,
    totalQuantity: newQuantity,
    lmtPrice: newLmtPrice,
    auxPrice: newAuxPrice,
    tif: newTif as any,
    transmit: true,
    parentId: existing.parentId ?? 0,
  };

  // Preserve OCA group — critical for bracket orders
  if (existing.ocaGroup) {
    (order as any).ocaGroup = existing.ocaGroup;
  }

  // Trailing fields — only set if provided (avoids IBKR rejecting zero defaults)
  if (params.trailingPercent !== undefined) {
    (order as any).trailingPercent = params.trailingPercent;
    modified.push(`trailingPercent→${params.trailingPercent}`);
  }
  if (params.trailStopPrice !== undefined) {
    (order as any).trailStopPrice = params.trailStopPrice;
    modified.push(`trailStopPrice→${params.trailStopPrice}`);
  }

  logOrder.info({ orderId: params.orderId, modified, order }, "Modifying order in-place via IBKR");

  // 4. Build DB update (but defer execution until IBKR confirms)
  const dbUpdate = () => {
    try {
      const { getDb } = require("../db/database.js");
      const db = getDb();
      const setClauses: string[] = [];
      const values: any = { order_id: params.orderId };

      if (params.lmtPrice !== undefined) { setClauses.push("lmt_price = @lmt_price"); values.lmt_price = params.lmtPrice; }
      if (params.auxPrice !== undefined) { setClauses.push("aux_price = @aux_price"); values.aux_price = params.auxPrice; }
      if (params.totalQuantity !== undefined) { setClauses.push("total_quantity = @total_quantity"); values.total_quantity = params.totalQuantity; }
      if (params.orderType !== undefined) { setClauses.push("order_type = @order_type"); values.order_type = params.orderType; }
      if (params.tif !== undefined) { setClauses.push("tif = @tif"); values.tif = params.tif; }
      setClauses.push("updated_at = datetime('now')");

      if (setClauses.length > 1) {
        db.prepare(`UPDATE orders SET ${setClauses.join(", ")} WHERE order_id = @order_id`).run(values);
      }
    } catch (e: any) {
      logOrder.error({ err: e, orderId: params.orderId }, "Failed to update modified order in DB");
    }
  };

  // 5. Send to IBKR — same orderId = in-place modification
  return new Promise((resolve, reject) => {
    let settled = false;

    const buildResult = (status: string): ModifyOrderResult => ({
      orderId: params.orderId,
      symbol: existing.symbol,
      action: existing.action,
      orderType: newOrderType,
      totalQuantity: newQuantity,
      lmtPrice: newLmtPrice || null,
      auxPrice: newAuxPrice || null,
      status,
      modified,
    });

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      dbUpdate(); // Still update DB on timeout — order likely accepted
      resolve(buildResult("Modified (timeout waiting for confirmation)"));
    }, config.ibkr.orderTimeoutMs);

    const onOrderStatus = (id: number, status: string) => {
      if (id !== params.orderId) return;
      if (settled) return;
      settled = true;
      cleanup();
      dbUpdate(); // DB update AFTER IBKR confirms
      resolve(buildResult(status));
    };

    const onError = (err: Error, code: ErrorCode, id: number) => {
      if (id !== params.orderId && id !== -1) return;
      if (isNonFatalError(code, err)) return;
      if (settled) return;
      settled = true;
      cleanup();
      // No DB update on rejection — order still has old values
      reject(new Error(`Modify order error (${code}): ${err.message}`));
    };

    const cleanup = () => {
      clearTimeout(timeout);
      ib.off(EventName.orderStatus, onOrderStatus);
      ib.off(EventName.error, onError);
    };

    ib.on(EventName.orderStatus, onOrderStatus);
    ib.on(EventName.error, onError);

    ib.placeOrder(params.orderId, contract, order);
  });
}

// ── Cancel Order ─────────────────────────────────────────────────────────

export async function cancelOrder(orderId: number): Promise<{ orderId: number; status: string }> {
  const ib = getIB();

  return new Promise((resolve, reject) => {
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ orderId, status: "Cancel requested (timeout waiting for confirmation)" });
    }, 5000);

    const onOrderStatus = (id: number, status: string) => {
      if (id !== orderId) return;
      if (status === "Cancelled" || status === "ApiCancelled") {
        if (settled) return;
        settled = true;
        cleanup();
        resolve({ orderId, status });
      }
    };

    const onError = (err: Error, code: ErrorCode, id: number) => {
      if (id !== orderId) return;
      if (isNonFatalError(code, err)) return;
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`Cancel order error (${code}): ${err.message}`));
    };

    const cleanup = () => {
      clearTimeout(timeout);
      ib.off(EventName.orderStatus, onOrderStatus);
      ib.off(EventName.error, onError);
    };

    ib.on(EventName.orderStatus, onOrderStatus);
    ib.on(EventName.error, onError);

    ib.cancelOrder(orderId);
  });
}

// ── Cancel All Orders ────────────────────────────────────────────────────

export async function cancelAllOrders(): Promise<{ status: string }> {
  const ib = getIB();
  ib.reqGlobalCancel();
  return { status: "Global cancel requested" };
}

// ── Flatten All Positions (EOD close-out) ────────────────────────────────

export interface FlattenResult {
  flattened: PlaceOrderResult[];
  cancelled: { status: string };
  skipped: string[];
  timestamp: string;
}

/**
 * Market-sell all open positions. Cancels open orders first, then sends
 * opposing MKT orders for every non-zero position.  Bypasses risk-gate
 * (this IS the risk-gate — protecting against overnight exposure).
 */
export async function flattenAllPositions(): Promise<FlattenResult> {
  const { getPositions } = await import("./account.js");
  const positions = await getPositions();

  // 1. Cancel all open orders first (stops, brackets, etc.)
  const cancelled = await cancelAllOrders();

  // Small delay so cancels propagate before we send closing orders
  await new Promise((r) => setTimeout(r, 500));

  // 2. Close every non-zero position with a MKT order
  const flattened: PlaceOrderResult[] = [];
  const skipped: string[] = [];

  for (const pos of positions) {
    if (pos.position === 0) {
      skipped.push(pos.symbol);
      continue;
    }
    const action = pos.position > 0 ? "SELL" : "BUY";
    const qty = Math.abs(pos.position);

    try {
      const result = await placeOrder({
        symbol: pos.symbol,
        secType: pos.secType,
        exchange: "SMART",
        currency: pos.currency,
        action,
        orderType: "MKT",
        totalQuantity: qty,
        tif: "IOC", // Immediate-or-cancel — don't leave hanging
        order_source: "flatten_eod",
        strategy_version: "flatten",
      });
      flattened.push(result);
    } catch (e: any) {
      logOrder.error({ err: e, symbol: pos.symbol, action, qty }, "Flatten order failed");
      skipped.push(`${pos.symbol} (error: ${e.message})`);
    }
  }

  logOrder.info(
    { flattened: flattened.length, skipped: skipped.length },
    `Flatten complete: closed ${flattened.length} positions`,
  );

  return {
    flattened,
    cancelled,
    skipped,
    timestamp: new Date().toISOString(),
  };
}

// ── Persistent DB Listeners ─────────────────────────────────────────────
// These run for the lifetime of the process, writing all IBKR order/exec
// events to the database regardless of which request triggered them.

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
    } catch (e: any) {
      logExec.error({ err: e, execId: report.execId }, "Failed to update commission in DB");
    }
  });

  logOrder.info("Persistent order/execution DB listeners attached");
}
