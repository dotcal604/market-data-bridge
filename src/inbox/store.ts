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
  pruneInboxDb,
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

/**
 * Prune inbox items older than `days` from both SQLite and in-memory buffer.
 * Returns count of pruned items.
 */
export function pruneInbox(days: number = 7): { dbPruned: number; memoryPruned: number } {
  // Prune SQLite
  let dbPruned = 0;
  try {
    dbPruned = pruneInboxDb(days);
  } catch (e: any) {
    log.error({ err: e }, "Failed to prune inbox DB");
  }

  // Prune in-memory buffer
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).getTime();
  const before = items.length;
  items = items.filter((i) => new Date(i.created_at).getTime() >= cutoff);
  const memoryPruned = before - items.length;

  if (dbPruned > 0 || memoryPruned > 0) {
    log.info({ dbPruned, memoryPruned, days }, "Inbox pruned");
  }
  return { dbPruned, memoryPruned };
}

// ── Inbox Digest (time-windowed summary rollup) ──────────────────────────

export interface InboxDigest {
  window: string;
  since: string;
  summary: string;
  fills: { count: number; totalPnl: number; totalCommission: number; symbols: string[] };
  signals: { count: number; traded: number; passed: number; symbols: string[] };
  driftAlerts: { count: number; types: string[] };
  orderStatus: { count: number; symbols: string[] };
}

/**
 * Generate a time-windowed digest of inbox events.
 * Aggregates fills, signals, drift alerts, and order status into a summary.
 */
export function getInboxDigest(hours: number = 24): InboxDigest {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  const sinceISO = since.toISOString();
  const window = hours >= 24 ? `${Math.round(hours / 24)}d` : `${hours}h`;

  const recent = items.filter((i) => new Date(i.created_at).getTime() >= since.getTime());

  // Fills
  const fills = recent.filter((i) => i.type === "fill");
  let totalPnl = 0;
  let totalCommission = 0;
  const fillSymbols = new Set<string>();
  for (const f of fills) {
    totalPnl += (f.body.realized_pnl as number) ?? (f.body.realizedPnL as number) ?? 0;
    totalCommission += (f.body.commission as number) ?? 0;
    if (f.symbol) fillSymbols.add(f.symbol);
  }

  // Signals
  const signals = recent.filter((i) => i.type === "signal");
  const traded = signals.filter((s) => s.body.should_trade === true || s.body.traded === true).length;
  const passed = signals.length - traded;
  const signalSymbols = new Set<string>();
  for (const s of signals) { if (s.symbol) signalSymbols.add(s.symbol); }

  // Drift alerts
  const driftAlerts = recent.filter((i) => i.type === "drift_alert");
  const alertTypes = new Set<string>();
  for (const d of driftAlerts) { alertTypes.add((d.body.alert_type as string) ?? "unknown"); }

  // Order status
  const orderStatus = recent.filter((i) => i.type === "order_status");
  const orderSymbols = new Set<string>();
  for (const o of orderStatus) { if (o.symbol) orderSymbols.add(o.symbol); }

  // Build summary string
  const parts: string[] = [];
  if (fills.length > 0) {
    parts.push(`${fills.length} fill${fills.length > 1 ? "s" : ""} (${totalPnl >= 0 ? "+" : ""}$${totalPnl.toFixed(2)} PnL)`);
  }
  if (signals.length > 0) {
    parts.push(`${signals.length} signal${signals.length > 1 ? "s" : ""} (${traded} traded)`);
  }
  if (driftAlerts.length > 0) {
    parts.push(`${driftAlerts.length} drift alert${driftAlerts.length > 1 ? "s" : ""}`);
  }
  if (orderStatus.length > 0) {
    parts.push(`${orderStatus.length} order update${orderStatus.length > 1 ? "s" : ""}`);
  }
  const summary = parts.length > 0
    ? `Last ${window}: ${parts.join(", ")}`
    : `Last ${window}: No inbox activity`;

  return {
    window,
    since: sinceISO,
    summary,
    fills: { count: fills.length, totalPnl, totalCommission, symbols: [...fillSymbols] },
    signals: { count: signals.length, traded, passed, symbols: [...signalSymbols] },
    driftAlerts: { count: driftAlerts.length, types: [...alertTypes] },
    orderStatus: { count: orderStatus.length, symbols: [...orderSymbols] },
  };
}
