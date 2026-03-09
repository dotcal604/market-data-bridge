/**
 * Account and position snapshots domain module.
 */

import { getDb, getStmts } from "./connection.js";
const stmts = getStmts();

/**
 * Snapshot current positions state.
 * @param positions Array of position objects
 * @param source Source of snapshot (e.g. "reconcile")
 */
export function insertPositionSnapshot(positions: any[], source: string = "reconcile") {
  stmts.insertPositionSnapshot.run({ positions: JSON.stringify(positions), source });
}

/**
 * Get the most recent positions snapshot.
 * @returns Array of positions or null
 */
export function getLatestPositionSnapshot(): any[] | null {
  const row = stmts.getLatestPositionSnapshot.get() as { positions: string } | undefined;
  if (!row) return null;
  return JSON.parse(row.positions);
}

/**
 * Snapshot account balances.
 * @param data Account balance details
 */
export function insertAccountSnapshot(data: {
  net_liquidation?: number;
  total_cash_value?: number;
  buying_power?: number;
  daily_pnl?: number;
  unrealized_pnl?: number;
  realized_pnl?: number;
}) {
  stmts.insertAccountSnapshot.run({
    net_liquidation: data.net_liquidation ?? null,
    total_cash_value: data.total_cash_value ?? null,
    buying_power: data.buying_power ?? null,
    daily_pnl: data.daily_pnl ?? null,
    unrealized_pnl: data.unrealized_pnl ?? null,
    realized_pnl: data.realized_pnl ?? null,
  });
}

/**
 * Query recent account snapshots.
 * @param limit Max snapshots to return
 * @returns Array of snapshots
 */
export function queryAccountSnapshots(limit: number = 100) {
  return stmts.queryAccountSnapshots.all(limit);
}

/** Get the most recent net_liquidation from account snapshots (for live equity in risk gate). */
export function getLatestNetLiquidation(): number | null {
  const row = getDb().prepare(
    `SELECT net_liquidation FROM account_snapshots WHERE net_liquidation IS NOT NULL ORDER BY created_at DESC LIMIT 1`
  ).get() as { net_liquidation: number } | undefined;
  return row?.net_liquidation ?? null;
}
