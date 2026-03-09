/**
 * Eval-Execution auto-link domain module.
 */

import { getDb, getStmts } from "./connection.js";
const stmts = getStmts();

/**
 * Link an evaluation to an execution order.
 * @param row Link details
 */
export function insertEvalExecutionLink(row: {
  evaluation_id: string;
  order_id: number;
  exec_id?: string | null;
  link_type: string;
  confidence?: number | null;
  symbol: string;
  direction?: string | null;
}): void {
  stmts.insertEvalExecutionLink.run({
    evaluation_id: row.evaluation_id,
    order_id: row.order_id,
    exec_id: row.exec_id ?? null,
    link_type: row.link_type,
    confidence: row.confidence ?? null,
    symbol: row.symbol,
    direction: row.direction ?? null,
  });
}

/**
 * Get links for an evaluation.
 * @param evaluationId Evaluation ID
 * @returns Array of links
 */
export function getLinksForEval(evaluationId: string): Array<Record<string, unknown>> {
  return stmts.getLinksForEval.all(evaluationId) as Array<Record<string, unknown>>;
}

/**
 * Get links for an order.
 * @param orderId Order ID
 * @returns Array of links
 */
export function getLinksForOrder(orderId: number): Array<Record<string, unknown>> {
  return stmts.getLinksForOrder.all(orderId) as Array<Record<string, unknown>>;
}

/**
 * Find recent evaluations for a symbol (for heuristic linking).
 * @param symbol Stock symbol
 * @param since ISO timestamp
 * @returns Array of evaluations
 */
export function getRecentEvalsForSymbol(symbol: string, since: string): Array<Record<string, unknown>> {
  return stmts.getRecentEvalsForSymbol.all(symbol, since) as Array<Record<string, unknown>>;
}

/**
 * Get executions that haven't been linked to an evaluation yet.
 * @param since ISO timestamp
 * @returns Array of executions
 */
export function getUnlinkedExecutions(since: string): Array<Record<string, unknown>> {
  return stmts.getUnlinkedExecutions.all(since) as Array<Record<string, unknown>>;
}

/**
 * Get all executions for a correlation ID.
 * @param correlationId Correlation UUID
 * @returns Array of executions
 */
export function getExecutionsByCorrelation(correlationId: string): Array<Record<string, unknown>> {
  return stmts.getExecutionsByCorrelation.all(correlationId) as Array<Record<string, unknown>>;
}

/**
 * Get execution by ID.
 * @param execId Execution ID
 * @returns Execution record or undefined
 */
export function getExecutionByExecId(execId: string): Record<string, unknown> | undefined {
  return stmts.getExecutionByExecId.get(execId) as Record<string, unknown> | undefined;
}

/**
 * Get statistics on auto-linking performance.
 * @returns Stats object
 */
export function getAutoLinkStats(): Record<string, unknown> {
  const linkStats = stmts.getAutoLinkStats.get() as { total: number; explicit_links: number; heuristic_links: number; avg_confidence: number | null } | undefined ?? { total: 0, explicit_links: 0, heuristic_links: 0, avg_confidence: null };

  const outcomeCount = getDb().prepare(`
    SELECT COUNT(DISTINCT eel.evaluation_id) as count
    FROM eval_execution_links eel
    JOIN outcomes o ON o.evaluation_id = eel.evaluation_id
  `).get() as { count: number };

  return {
    ...linkStats,
    outcomes_recorded: outcomeCount?.count ?? 0,
  };
}

/**
 * Get recent auto-links.
 * @param limit Max links to return
 * @returns Array of links
 */
export function getRecentLinks(limit: number = 20): Array<Record<string, unknown>> {
  return stmts.getRecentLinks.all(limit) as Array<Record<string, unknown>>;
}
