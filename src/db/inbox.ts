/**
 * Inbox (event buffer) domain module.
 */

import { getStmts } from "./connection.js";
const stmts = getStmts();

// ── Types ────────────────────────────────────────────────────────────────

export interface InboxItemRow {
  id: string;
  type: string;
  symbol: string | null;
  title: string;
  body: string;
  read: number;
  created_at: string;
}

// ── Functions ────────────────────────────────────────────────────────────

/**
 * Insert a new inbox item.
 * @param item Inbox item details
 */
export function insertInboxItem(item: {
  id: string;
  type: string;
  symbol?: string | null;
  title: string;
  body: string;
  created_at: string;
}): void {
  stmts.insertInbox.run({
    id: item.id,
    type: item.type,
    symbol: item.symbol ?? null,
    title: item.title,
    body: typeof item.body === "string" ? item.body : JSON.stringify(item.body),
    created_at: item.created_at,
  });
}

/**
 * Load recent inbox items.
 * @param limit Max items to return
 * @returns Array of items (oldest first)
 */
export function loadRecentInbox(limit: number = 500): InboxItemRow[] {
  const rows = stmts.getRecentInbox.all(limit) as InboxItemRow[];
  return rows.reverse(); // oldest first
}

/**
 * Mark a specific inbox item as read.
 * @param id Item ID
 */
export function markInboxItemRead(id: string): void {
  stmts.markInboxRead.run(id);
}

/**
 * Mark all inbox items as read.
 * @returns Number of updated items
 */
export function markAllInboxItemsRead(): number {
  const info = stmts.markAllInboxRead.run();
  return info.changes;
}

/**
 * Delete all inbox items.
 * @returns Number of deleted items
 */
export function clearInboxDb(): number {
  const info = stmts.deleteAllInbox.run();
  return info.changes;
}

/**
 * Get total and unread counts for inbox.
 * @returns Object with total and unread counts
 */
export function getInboxCounts(): { total: number; unread: number } {
  const row = stmts.countInbox.get() as { total: number; unread: number };
  return { total: row.total ?? 0, unread: row.unread ?? 0 };
}

/** Delete inbox items older than `days` from SQLite. Returns count of pruned rows. */
export function pruneInboxDb(days: number = 7): number {
  const info = stmts.pruneInbox.run(days);
  return info.changes;
}
