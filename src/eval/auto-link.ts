/**
 * Auto-link evaluations to executions and outcomes.
 *
 * Two strategies:
 *   1. Explicit — eval_id passed on order placement, stored on orders table
 *   2. Heuristic — match by symbol + direction + time window (30 min default)
 *
 * Position close detection:
 *   - commissionReport with realizedPNL triggers a 2s delayed check
 *   - If net position for the correlation_id is zero → record outcome
 */
import { logger } from "../logging.js";
import {
  insertEvalExecutionLink,
  getRecentEvalsForSymbol,
  getEvaluationById,
  getOutcomeForEval,
  insertOutcome,
  getExecutionsByCorrelation,
  getOrderByOrderId,
  getLinksForOrder,
  getLinksForEval,
  getExecutionByExecId,
} from "../db/database.js";

const log = logger.child({ subsystem: "auto-link" });

// ── Types ──────────────────────────────────────────────────────────────────

export interface EvalCandidate {
  id: string;
  symbol: string;
  direction: string | null;
  entry_price: number | null;
  stop_price: number | null;
  timestamp: string;
  ensemble_should_trade: number | null;
}

export interface ExecutionRecord {
  exec_id: string;
  order_id: number;
  symbol: string;
  side: string; // "BOT" | "SLD"
  price: number;
  timestamp: string;
  eval_id?: string | null;
}

// ── Pure Functions (no side effects, fully testable) ───────────────────────

/**
 * Find the best matching evaluation for an execution.
 * Filters by symbol + direction + time window, scores by proximity.
 */
export function findMatchingEval(
  execution: ExecutionRecord,
  candidates: EvalCandidate[],
  windowMs: number = 30 * 60 * 1000,
): { eval: EvalCandidate; confidence: number } | null {
  const execTime = new Date(execution.timestamp).getTime();
  const execDirection = execution.side === "BOT" ? "long" : "short";

  const scored = candidates
    .filter((c) => {
      if (c.symbol !== execution.symbol) return false;
      // Direction must match (or eval has no direction)
      if (c.direction && c.direction !== execDirection) return false;
      // Eval must be before execution and within window
      const evalTime = new Date(c.timestamp).getTime();
      const delta = execTime - evalTime;
      return delta >= 0 && delta <= windowMs;
    })
    .map((c) => {
      const evalTime = new Date(c.timestamp).getTime();
      const timeDelta = execTime - evalTime;
      // Time score: 1.0 at t=0, decays linearly to 0 at windowMs
      const timeScore = 1 - timeDelta / windowMs;
      // Price score: bonus if eval entry_price is close to execution price
      let priceScore = 0;
      if (c.entry_price != null && c.entry_price > 0) {
        const priceDelta = Math.abs(execution.price - c.entry_price) / c.entry_price;
        priceScore = Math.max(0, 1 - priceDelta * 10); // 10% deviation → 0
      }
      // Weighted: 70% time proximity, 30% price proximity
      const confidence = timeScore * 0.7 + priceScore * 0.3;
      return { eval: c, confidence };
    })
    .sort((a, b) => b.confidence - a.confidence);

  if (scored.length === 0) return null;
  const best = scored[0];
  if (best.confidence < 0.1) return null; // too weak
  return best;
}

/**
 * Compute R-multiple for a completed trade.
 * R = (exit - entry) / (entry - stop) for longs
 * R = (entry - exit) / (stop - entry) for shorts
 * Returns null if stop equals entry (division by zero).
 */
export function computeRMultiple(
  direction: string,
  entryPrice: number,
  exitPrice: number,
  stopPrice: number,
): number | null {
  if (direction === "long") {
    const risk = entryPrice - stopPrice;
    if (risk === 0) return null;
    return (exitPrice - entryPrice) / risk;
  } else {
    const risk = stopPrice - entryPrice;
    if (risk === 0) return null;
    return (entryPrice - exitPrice) / risk;
  }
}

/**
 * Determine if a set of executions nets to a closed (zero) position.
 * BOT adds shares, SLD subtracts shares.
 */
export function isPositionClosed(
  executions: Array<{ side: string; shares: number }>,
): boolean {
  let net = 0;
  for (const e of executions) {
    if (e.side === "BOT") net += e.shares;
    else if (e.side === "SLD") net -= e.shares;
  }
  return Math.abs(net) < 0.001; // floating point tolerance
}

// ── Side-Effect Functions (called from event handlers) ─────────────────────

/** Pending close-check timers keyed by correlation_id */
const pendingCloseChecks = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Called from execDetails handler. Links an execution to an evaluation.
 * Strategy: explicit if eval_id exists on the order, else heuristic match.
 */
export function tryLinkExecution(exec: ExecutionRecord): void {
  try {
    const direction = exec.side === "BOT" ? "long" : "short";

    // Strategy 1: Explicit link (eval_id on the order)
    if (exec.eval_id) {
      const evaluation = getEvaluationById(exec.eval_id);
      if (evaluation) {
        insertEvalExecutionLink({
          evaluation_id: exec.eval_id,
          order_id: exec.order_id,
          exec_id: exec.exec_id,
          link_type: "explicit",
          confidence: 1.0,
          symbol: exec.symbol,
          direction,
        });
        log.info({ evalId: exec.eval_id, execId: exec.exec_id, type: "explicit" }, "Eval-execution link created");
        return;
      }
    }

    // Strategy 2: Heuristic match (symbol + direction + 30min window)
    const since = new Date(new Date(exec.timestamp).getTime() - 30 * 60 * 1000).toISOString();
    const recentEvals = getRecentEvalsForSymbol(exec.symbol, since) as unknown as EvalCandidate[];

    const match = findMatchingEval(exec, recentEvals);
    if (match && match.confidence >= 0.3) {
      // Check we haven't already linked this eval to this order
      const existingLinks = getLinksForOrder(exec.order_id);
      const alreadyLinked = existingLinks.some((l: any) => l.evaluation_id === match.eval.id);
      if (!alreadyLinked) {
        insertEvalExecutionLink({
          evaluation_id: match.eval.id,
          order_id: exec.order_id,
          exec_id: exec.exec_id,
          link_type: "heuristic",
          confidence: match.confidence,
          symbol: exec.symbol,
          direction,
        });
        log.info(
          { evalId: match.eval.id, execId: exec.exec_id, confidence: match.confidence.toFixed(2), type: "heuristic" },
          "Eval-execution link created",
        );
      }
    }
  } catch (e: any) {
    log.error({ err: e, execId: exec.exec_id }, "Failed to auto-link execution");
  }
}

/**
 * Called from commissionReport handler.
 * Schedules a delayed position-close check (2s debounce per correlation_id).
 * IBKR sends realizedPNL = 1.7976931348623157e+308 when PNL unavailable — filter that.
 */
export function schedulePositionCloseCheck(execId: string, realizedPnl: number): void {
  try {
    // Look up the order for this execution to get correlation_id
    const exec = (getExecutionByExecId(execId) ?? null) as any;
    if (!exec) return;

    const correlationId: string = exec.correlation_id;
    if (!correlationId) return;

    // Debounce: cancel any pending check for this correlation
    const existing = pendingCloseChecks.get(correlationId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      pendingCloseChecks.delete(correlationId);
      checkAndRecordOutcome(correlationId, realizedPnl);
    }, 2000);

    pendingCloseChecks.set(correlationId, timer);
  } catch (e: any) {
    log.error({ err: e, execId }, "Failed to schedule position close check");
  }
}

/**
 * Check if all executions for a correlation_id net to zero.
 * If so, find the linked eval and auto-record an outcome.
 */
function checkAndRecordOutcome(correlationId: string, realizedPnl: number): void {
  try {
    const executions = getExecutionsByCorrelation(correlationId) as Array<{
      exec_id: string;
      order_id: number;
      symbol: string;
      side: string;
      shares: number;
      price: number;
    }>;

    if (!isPositionClosed(executions)) return;

    // Find linked eval via any execution's order
    let evalId: string | null = null;
    for (const exec of executions) {
      const links = getLinksForOrder(exec.order_id) as Array<{ evaluation_id: string }>;
      if (links.length > 0) {
        evalId = links[0].evaluation_id;
        break;
      }
    }

    if (!evalId) return;

    // Check if outcome already exists
    const existingOutcome = getOutcomeForEval(evalId);
    if (existingOutcome) return;

    // Compute entry/exit prices from executions
    const buys = executions.filter((e) => e.side === "BOT");
    const sells = executions.filter((e) => e.side === "SLD");

    if (buys.length === 0 || sells.length === 0) return;

    // Volume-weighted average prices
    const vwap = (execs: typeof executions) => {
      const totalShares = execs.reduce((s, e) => s + e.shares, 0);
      return execs.reduce((s, e) => s + e.price * e.shares, 0) / totalShares;
    };

    const buyVwap = vwap(buys);
    const sellVwap = vwap(sells);

    // Get eval for direction + stop price
    const evaluation = getEvaluationById(evalId) as any;
    if (!evaluation) return;

    const direction = evaluation.direction ?? "long";
    const entryPrice = direction === "long" ? buyVwap : sellVwap;
    const exitPrice = direction === "long" ? sellVwap : buyVwap;

    // R-multiple (null if no stop_price)
    let rMultiple: number | null = null;
    if (evaluation.stop_price != null) {
      rMultiple = computeRMultiple(direction, entryPrice, exitPrice, evaluation.stop_price);
    }

    insertOutcome({
      evaluation_id: evalId,
      trade_taken: 1,
      decision_type: "took_trade",
      actual_entry_price: entryPrice,
      actual_exit_price: exitPrice,
      r_multiple: rMultiple,
      exit_reason: "auto_detected",
      recorded_at: new Date().toISOString(),
    });

    log.info(
      { evalId, symbol: evaluation.symbol, direction, entryPrice, exitPrice, rMultiple, realizedPnl },
      "Auto-recorded outcome on position close",
    );
  } catch (e: any) {
    log.error({ err: e, correlationId }, "Failed to auto-record outcome");
  }
}

/**
 * Reconcile closed positions on startup.
 * Called from reconcile.ts when a position is detected as closed while offline.
 */
export function reconcileClosedPosition(symbol: string): void {
  try {
    // Find recent unlinked executions for this symbol (last 24h)
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const recentEvals = getRecentEvalsForSymbol(symbol, since) as unknown as EvalCandidate[];

    if (recentEvals.length === 0) return;

    log.info({ symbol, evalCount: recentEvals.length }, "Attempting to reconcile closed position with evals");
    // The actual linking would have happened in tryLinkExecution during execution.
    // Here we just check if any linked evals are missing outcomes.
    for (const evalCandidate of recentEvals) {
      const existingOutcome = getOutcomeForEval(evalCandidate.id);
      if (existingOutcome) continue;

      // Check if this eval has any execution links
      const links = getLinksForEval(evalCandidate.id);
      if (links.length === 0) continue;

      // Mark as passed_setup if we can't compute entry/exit
      insertOutcome({
        evaluation_id: evalCandidate.id,
        trade_taken: 1,
        decision_type: "took_trade",
        exit_reason: "reconcile_closed_offline",
        recorded_at: new Date().toISOString(),
      });

      log.info({ evalId: evalCandidate.id, symbol }, "Reconciled outcome for offline-closed position");
    }
  } catch (e: any) {
    log.error({ err: e, symbol }, "Failed to reconcile closed position");
  }
}

