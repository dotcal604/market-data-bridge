import { getDb } from "../db/database.js";
import { logger } from "../logging.js";
import { modifyOrder } from "../ibkr/orders.js";
import { runPerStrategyOptimization, type TrailingStopParams } from "./trailing-stop-optimizer.js";

const log = logger.child({ module: "trailing-stop-executor" });

interface StrategyRow {
  strategy: string;
}

interface TrailingStopRow {
  strategy: string;
  params_json: string;
}

export interface TrailingStopRecommendation {
  symbol: string;
  strategy: string;
  params: TrailingStopParams;
  source: "table" | "optimized";
}

export interface AppliedTrailingStop {
  applied: boolean;
  symbol: string;
  strategy: string | null;
  trailingPercent: number | null;
  orderId: number | null;
  reason?: string;
}

function ensureTrailingStopTable(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS trailing_stop_per_strategy (
      strategy TEXT PRIMARY KEY,
      params_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

function resolveStrategyForSymbol(symbol: string): string | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT strategy
    FROM holly_alerts
    WHERE symbol = ? AND strategy IS NOT NULL
    ORDER BY alert_time DESC, id DESC
    LIMIT 1
  `).get(symbol) as StrategyRow | undefined;
  return row?.strategy ?? null;
}

function getStoredParamsForStrategy(strategy: string): TrailingStopParams | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT strategy, params_json
    FROM trailing_stop_per_strategy
    WHERE strategy = ?
  `).get(strategy) as TrailingStopRow | undefined;

  if (!row) return null;

  try {
    return JSON.parse(row.params_json) as TrailingStopParams;
  } catch (error) {
    log.warn({ err: error, strategy }, "Invalid trailing stop params_json in table");
    return null;
  }
}

function deriveTrailingPercent(params: TrailingStopParams): number | null {
  if (params.trail_pct && params.trail_pct > 0) return params.trail_pct * 100;
  if (params.tight_trail_pct && params.tight_trail_pct > 0) return params.tight_trail_pct * 100;
  if (params.post_be_trail_pct && params.post_be_trail_pct > 0) return params.post_be_trail_pct * 100;
  return null;
}

export function trailingStopRecommendation(symbol: string, strategy?: string): TrailingStopRecommendation | null {
  ensureTrailingStopTable();
  const resolvedStrategy = strategy ?? resolveStrategyForSymbol(symbol);
  if (!resolvedStrategy) return null;

  const tableParams = getStoredParamsForStrategy(resolvedStrategy);
  if (tableParams) {
    return {
      symbol,
      strategy: resolvedStrategy,
      params: tableParams,
      source: "table",
    };
  }

  const optimized = runPerStrategyOptimization({ minTrades: 1 }).find((entry) => entry.holly_strategy === resolvedStrategy);
  if (!optimized) return null;

  const db = getDb();
  db.prepare(`
    INSERT INTO trailing_stop_per_strategy(strategy, params_json, updated_at)
    VALUES(?, ?, datetime('now'))
    ON CONFLICT(strategy) DO UPDATE SET
      params_json = excluded.params_json,
      updated_at = excluded.updated_at
  `).run(resolvedStrategy, JSON.stringify(optimized.best_trailing.params));

  return {
    symbol,
    strategy: resolvedStrategy,
    params: optimized.best_trailing.params,
    source: "optimized",
  };
}

export async function applyTrailingStopToOrder(args: {
  symbol: string;
  orderId: number;
  strategy?: string;
}): Promise<AppliedTrailingStop> {
  const recommendation = trailingStopRecommendation(args.symbol, args.strategy);
  if (!recommendation) {
    return {
      applied: false,
      symbol: args.symbol,
      strategy: null,
      trailingPercent: null,
      orderId: args.orderId,
      reason: "No Holly strategy/recommendation found for symbol",
    };
  }

  const trailingPercent = deriveTrailingPercent(recommendation.params);
  if (!trailingPercent) {
    return {
      applied: false,
      symbol: args.symbol,
      strategy: recommendation.strategy,
      trailingPercent: null,
      orderId: args.orderId,
      reason: "Recommended params are not compatible with IBKR TRAIL percent",
    };
  }

  await modifyOrder({
    orderId: args.orderId,
    orderType: "TRAIL",
    trailingPercent,
  });

  return {
    applied: true,
    symbol: args.symbol,
    strategy: recommendation.strategy,
    trailingPercent,
    orderId: args.orderId,
  };
}
