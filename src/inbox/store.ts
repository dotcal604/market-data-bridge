/**
 * Inbox store — event buffer for ChatGPT polling.
 *
 * ChatGPT is stateless (REST request/response), so it has no way to know
 * that fills, signals, or drift alerts happened between conversations.
 * This inbox buffers notable events. ChatGPT polls via `check_inbox` at
 * the start of each session.
 *
 * Pattern mirrors src/collab/store.ts: in-memory array + SQLite dual-write.
 */
import { randomUUID } from "crypto";
import {
  insertInboxItem as dbInsert,
  loadRecentInbox,
  markInboxItemRead as dbMarkRead,
  markAllInboxItemsRead as dbMarkAllRead,
  clearInboxDb,
  getInboxCounts as dbGetCounts,
  type InboxItemRow,
} from "../db/database.js";
import { wsBroadcast } from "../ws/server.js";
import { logger } from "../logging.js";

const log = logger.child({ module: "inbox" });

export type InboxType = "fill" | "signal" | "drift_alert" | "order_status";

export interface InboxItem {
  id: string;
  type: InboxType;
  symbol: string | null;
  title: string;
  body: Record<string, unknown>;
  read: boolean;
  created_at: string;
}

const MAX_ITEMS = 500;

let items: InboxItem[] = [];

function rowToItem(row: InboxItemRow): InboxItem {
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(row.body);
  } catch {
    body = { raw: row.body };
  }
  return {
    id: row.id,
    type: row.type as InboxType,
    symbol: row.symbol,
    title: row.title,
    body,
    read: row.read === 1,
    created_at: row.created_at,
  };
}

/** Load persisted inbox items from DB on startup. */
export function initInboxFromDb(): void {
  try {
    const rows = loadRecentInbox(MAX_ITEMS);
    items = rows.map(rowToItem);
    log.info({ count: items.length }, "Loaded inbox items from DB");
  } catch (e: any) {
    log.error({ err: e }, "Failed to load inbox from DB — starting fresh");
    items = [];
  }
}

/** Append a new event to the inbox. Called from event hooks. */
export function appendInboxItem(input: {
  type: InboxType;
  symbol?: string | null;
  title: string;
  body: Record<string, unknown>;
}): InboxItem {
  const item: InboxItem = {
    id: randomUUID(),
    type: input.type,
    symbol: input.symbol ?? null,
    title: input.title,
    body: input.body,
    read: false,
    created_at: new Date().toISOString(),
  };

  items.push(item);

  // Dual-write to SQLite
  try {
    dbInsert({
      id: item.id,
      type: item.type,
      symbol: item.symbol,
      title: item.title,
      body: JSON.stringify(item.body),
      created_at: item.created_at,
    });
  } catch (e: any) {
    log.error({ err: e, id: item.id }, "Failed to persist inbox item to DB");
  }

  // Broadcast via WebSocket for Claude/real-time clients
  try {
    wsBroadcast("inbox", item);
  } catch { /* non-fatal */ }

  // Trim in-memory buffer
  if (items.length > MAX_ITEMS) {
    items = items.slice(-MAX_ITEMS);
  }

  return item;
}

/** Read inbox items with optional filters. */
export function readInbox(opts: {
  since?: string;
  type?: string;
  symbol?: string;
  unreadOnly?: boolean;
  limit?: number;
} = {}): InboxItem[] {
  let result = items;

  if (opts.since) {
    const sinceDate = new Date(opts.since).getTime();
    result = result.filter((i) => new Date(i.created_at).getTime() > sinceDate);
  }
  if (opts.type) {
    result = result.filter((i) => i.type === opts.type);
  }
  if (opts.symbol) {
    const sym = opts.symbol.toUpperCase();
    result = result.filter((i) => i.symbol?.toUpperCase() === sym);
  }
  if (opts.unreadOnly) {
    result = result.filter((i) => !i.read);
  }

  const limit = Math.min(opts.limit ?? 50, 200);
  return result.slice(-limit);
}

/** Mark specific items as read. */
export function markRead(ids: string[]): number {
  let count = 0;
  for (const id of ids) {
    const item = items.find((i) => i.id === id);
    if (item && !item.read) {
      item.read = true;
      count++;
      try { dbMarkRead(id); } catch { /* non-fatal */ }
    }
  }
  return count;
}

/** Mark all items as read. */
export function markAllRead(): number {
  let count = 0;
  for (const item of items) {
    if (!item.read) {
      item.read = true;
      count++;
    }
  }
  try { dbMarkAllRead(); } catch { /* non-fatal */ }
  return count;
}

/** Clear all inbox items. */
export function clearInbox(): { cleared: number } {
  const count = items.length;
  items = [];
  try { clearInboxDb(); } catch { /* non-fatal */ }
  return { cleared: count };
}

/** Get inbox statistics. */
export function getInboxStats(): {
  total: number;
  unread: number;
  byType: Record<string, { total: number; unread: number }>;
} {
  const byType: Record<string, { total: number; unread: number }> = {};
  for (const item of items) {
    if (!byType[item.type]) byType[item.type] = { total: 0, unread: 0 };
    byType[item.type].total++;
    if (!item.read) byType[item.type].unread++;
  }
  const unread = items.filter((i) => !i.read).length;
  return { total: items.length, unread, byType };
}
