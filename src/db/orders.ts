/**
 * Orders and executions domain module.
 */

import { getDb, getStmts } from "./connection.js";
const stmts = getStmts();

/**
 * Insert a new order record into the database.
 * @param data Order details
 */
export function insertOrder(data: {
  order_id: number;
  symbol: string;
  action: string;
  order_type: string;
  total_quantity: number;
  lmt_price?: number | null;
  aux_price?: number | null;
  tif?: string;
  sec_type?: string;
  exchange?: string;
  currency?: string;
  status?: string;
  strategy_version?: string;
  order_source?: string;
  ai_confidence?: number | null;
  correlation_id: string;
  journal_id?: number | null;
  parent_order_id?: number | null;
  eval_id?: string | null;
}) {
  return stmts.insertOrder.run({
    order_id: data.order_id,
    symbol: data.symbol,
    action: data.action,
    order_type: data.order_type,
    total_quantity: data.total_quantity,
    lmt_price: data.lmt_price ?? null,
    aux_price: data.aux_price ?? null,
    tif: data.tif ?? "DAY",
    sec_type: data.sec_type ?? "STK",
    exchange: data.exchange ?? "SMART",
    currency: data.currency ?? "USD",
    status: data.status ?? "PendingSubmit",
    strategy_version: data.strategy_version ?? "manual",
    order_source: data.order_source ?? "manual",
    ai_confidence: data.ai_confidence ?? null,
    correlation_id: data.correlation_id,
    journal_id: data.journal_id ?? null,
    parent_order_id: data.parent_order_id ?? null,
    eval_id: data.eval_id ?? null,
  });
}

/**
 * Update the status of an existing order.
 * @param orderId Order ID
 * @param status New status
 * @param filled Quantity filled (optional)
 * @param avgPrice Average fill price (optional)
 */
export function updateOrderStatus(orderId: number, status: string, filled?: number, avgPrice?: number) {
  if (filled !== undefined) {
    stmts.updateOrderStatus.run({
      order_id: orderId,
      status,
      filled_quantity: filled,
      avg_fill_price: avgPrice ?? null,
    });
  } else {
    stmts.updateOrderStatusOnly.run({ order_id: orderId, status });
  }
}

/**
 * Insert a new execution record.
 * @param data Execution details
 */
export function insertExecution(data: {
  exec_id: string;
  order_id: number;
  symbol: string;
  side: string;
  shares: number;
  price: number;
  cum_qty?: number;
  avg_price?: number;
  commission?: number | null;
  realized_pnl?: number | null;
  correlation_id: string;
  timestamp: string;
}) {
  return stmts.insertExecution.run({
    exec_id: data.exec_id,
    order_id: data.order_id,
    symbol: data.symbol,
    side: data.side,
    shares: data.shares,
    price: data.price,
    cum_qty: data.cum_qty ?? null,
    avg_price: data.avg_price ?? null,
    commission: data.commission ?? null,
    realized_pnl: data.realized_pnl ?? null,
    correlation_id: data.correlation_id,
    timestamp: data.timestamp,
  });
}

/**
 * Update commission and realized P&L for an execution.
 * @param execId Execution ID
 * @param commission Commission amount
 * @param realizedPnl Realized P&L (optional)
 */
export function updateExecutionCommission(execId: string, commission: number, realizedPnl: number | null) {
  stmts.updateExecutionCommission.run({ exec_id: execId, commission, realized_pnl: realizedPnl ?? null });
}

/**
 * Query historical orders.
 * @param opts Filters (symbol, strategy, limit)
 * @returns Array of orders
 */
export function queryOrders(opts: { symbol?: string; strategy?: string; limit?: number } = {}) {
  const limit = opts.limit ?? 100;
  if (opts.symbol) return stmts.queryOrdersBySymbol.all(opts.symbol, limit);
  if (opts.strategy) return stmts.queryOrdersByStrategy.all(opts.strategy, limit);
  return stmts.queryOrders.all(limit);
}

/**
 * Query historical executions.
 * @param opts Filters (symbol, limit)
 * @returns Array of executions
 */
export function queryExecutions(opts: { symbol?: string; limit?: number } = {}) {
  const limit = opts.limit ?? 100;
  if (opts.symbol) return stmts.queryExecutionsBySymbol.all(opts.symbol, limit);
  return stmts.queryExecutions.all(limit);
}

/**
 * Get an order by its numeric ID.
 * @param orderId IBKR order ID
 * @returns Order record or undefined
 */
export function getOrderByOrderId(orderId: number) {
  return stmts.getOrderByOrderId.get(orderId);
}

/**
 * Get all orders sharing a correlation ID.
 * @param correlationId Correlation UUID
 * @returns Array of orders
 */
export function getOrdersByCorrelation(correlationId: string) {
  return stmts.getOrdersByCorrelation.all(correlationId);
}

/**
 * Find correlation IDs for active bracket orders.
 * @returns Array of correlation IDs
 */
export function getLiveBracketCorrelations(): Array<{ correlation_id: string }> {
  // Find correlation_ids where child orders exist (parent_order_id set)
  // and at least one order in the group is still live.
  return getDb().prepare(`
    SELECT DISTINCT o1.correlation_id
    FROM orders o1
    WHERE o1.parent_order_id IS NOT NULL
      AND o1.parent_order_id > 0
      AND EXISTS (
        SELECT 1 FROM orders o2
        WHERE o2.correlation_id = o1.correlation_id
          AND o2.status IN ('PendingSubmit', 'PreSubmitted', 'Submitted', 'RECONCILING')
      )
  `).all() as Array<{ correlation_id: string }>;
}

/**
 * Get all currently active orders (Pending, Submitted, etc).
 * @returns Array of active orders
 */
export function getLiveOrders() {
  return stmts.getLiveOrders.all();
}
