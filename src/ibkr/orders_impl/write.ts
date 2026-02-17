import {
  EventName,
  ErrorCode,
  Contract,
  Order,
  isNonFatalError,
} from "@stoqey/ib";
import { getIB, getNextValidOrderId } from "./read.js"; // Reuse from read.js to avoid cycle/duplication? No, read.js exports it.
import {
  generateCorrelationId,
  insertOrder,
  updateOrderStatus as dbUpdateOrderStatus,
  getOrderByOrderId,
} from "../../db/database.js";
import { logOrder } from "../../logging.js";
import { config } from "../../config.js";
import { getOpenOrders } from "./read.js";
import { getPositions } from "../account.js";
import type {
  PlaceOrderParams,
  PlaceOrderResult,
  BracketOrderParams,
  BracketOrderResult,
  AdvancedBracketParams,
  AdvancedBracketResult,
  ModifyOrderParams,
  ModifyOrderResult,
  FlattenResult,
} from "./types.js";

// ── Place Order ──────────────────────────────────────────────────────────

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

  // Advanced fields
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

  // Write all 3 orders to DB
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

// ── Advanced Bracket Order ───────────────────────────────────────────────

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

  // Parent order
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

  // Take profit
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

  // Stop loss
  const slType = params.stopLoss.type;
  const slOrder: Order = {
    orderId: slId,
    action: reverseAction as any,
    orderType: slType as any,
    totalQuantity: params.quantity,
    parentId,
    ocaGroup,
    tif: "GTC" as any,
    transmit: true,
  };
  if (params.outsideRth) (slOrder as any).outsideRth = true;

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

  (tpOrder as any).ocaType = params.ocaType ?? 1;
  (slOrder as any).ocaType = params.ocaType ?? 1;

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
      resolve({
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
        status: parentStatus || "Submitted (awaiting confirmation)",
        correlation_id: correlationId,
      });
    }, config.ibkr.orderTimeoutMs);

    const onOrderStatus = (id: number, status: string) => {
      if (id === parentId) {
        parentStatus = status;
        if (["Filled", "PreSubmitted", "Submitted"].includes(status)) {
          if (settled) return;
          settled = true;
          cleanup();
          resolve({
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
      reject(new Error(`Advanced bracket error (${code}) on orderId ${id}: ${err.message}`));
    };

    const cleanup = () => {
      clearTimeout(timeout);
      ib.off(EventName.orderStatus, onOrderStatus);
      ib.off(EventName.error, onError);
    };

    ib.on(EventName.orderStatus, onOrderStatus);
    ib.on(EventName.error, onError);

    ib.placeOrder(parentId, contract, parentOrder);
    ib.placeOrder(tpId, contract, tpOrder);
    ib.placeOrder(slId, contract, slOrder);
  });
}

// ── Modify Order ─────────────────────────────────────────────────────────

export async function modifyOrder(params: ModifyOrderParams): Promise<ModifyOrderResult> {
  const ib = getIB();

  if (params.lmtPrice !== undefined && params.lmtPrice < 0) throw new Error("lmtPrice must be non-negative");
  if (params.auxPrice !== undefined && params.auxPrice < 0) throw new Error("auxPrice must be non-negative");
  if (params.totalQuantity !== undefined && params.totalQuantity <= 0) throw new Error("totalQuantity must be positive");

  const openOrders = await getOpenOrders();
  const existing = openOrders.find((o) => o.orderId === params.orderId);
  if (!existing) {
    throw new Error(`Order ${params.orderId} not found in open orders — cannot modify a filled/cancelled order`);
  }

  const modifiableStatuses = new Set(["PreSubmitted", "Submitted"]);
  if (!modifiableStatuses.has(existing.status)) {
    throw new Error(`Order ${params.orderId} is not modifiable (status: ${existing.status})`);
  }

  const contract: Contract = {
    symbol: existing.symbol,
    secType: existing.secType as any,
    exchange: existing.exchange || "SMART",
    currency: existing.currency || "USD",
  };

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

  if (existing.ocaGroup) {
    (order as any).ocaGroup = existing.ocaGroup;
  }

  if (params.trailingPercent !== undefined) {
    (order as any).trailingPercent = params.trailingPercent;
    modified.push(`trailingPercent→${params.trailingPercent}`);
  }
  if (params.trailStopPrice !== undefined) {
    (order as any).trailStopPrice = params.trailStopPrice;
    modified.push(`trailStopPrice→${params.trailStopPrice}`);
  }

  logOrder.info({ orderId: params.orderId, modified, order }, "Modifying order in-place via IBKR");

  const dbUpdate = () => {
    try {
      const { getDb } = require("../../db/database.js");
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
      dbUpdate();
      resolve(buildResult("Modified (timeout waiting for confirmation)"));
    }, config.ibkr.orderTimeoutMs);

    const onOrderStatus = (id: number, status: string) => {
      if (id !== params.orderId) return;
      if (settled) return;
      settled = true;
      cleanup();
      dbUpdate();
      resolve(buildResult(status));
    };

    const onError = (err: Error, code: ErrorCode, id: number) => {
      if (id !== params.orderId && id !== -1) return;
      if (isNonFatalError(code, err)) return;
      if (settled) return;
      settled = true;
      cleanup();
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

// ── Flatten All Positions ────────────────────────────────────────────────

export async function flattenAllPositions(): Promise<FlattenResult> {
  const positions = await getPositions();

  const cancelled = await cancelAllOrders();
  await new Promise((r) => setTimeout(r, 500));

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
        tif: "IOC",
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
