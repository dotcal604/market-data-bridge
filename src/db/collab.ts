/**
 * Collaboration messages domain module.
 */

import { getStmts } from "./connection.js";
const stmts = getStmts();

/**
 * Insert a message into the collaboration channel.
 * @param msg Message details
 */
export function insertCollabMessage(msg: {
  id: string;
  author: string;
  type?: string;
  content: string;
  reply_to?: string | null;
  tags?: string[] | null;
  metadata?: Record<string, unknown> | null;
  created_at: string;
}) {
  stmts.insertCollab.run({
    id: msg.id,
    author: msg.author,
    type: msg.type ?? "info",
    content: msg.content,
    reply_to: msg.reply_to ?? null,
    tags: msg.tags ? JSON.stringify(msg.tags) : null,
    metadata: msg.metadata ? JSON.stringify(msg.metadata) : null,
    created_at: msg.created_at,
  });
}

/**
 * Load recent collaboration messages.
 * @param limit Max messages to return
 * @returns Array of messages (oldest first)
 */
export function loadRecentCollab(limit: number = 200): Array<{
  id: string; author: string; type: string | null; content: string; reply_to: string | null; tags: string | null; metadata: string | null; created_at: string;
}> {
  const rows = stmts.getRecentCollab.all(limit) as Array<{
    id: string; author: string; type: string | null; content: string; reply_to: string | null; tags: string | null; metadata: string | null; created_at: string;
  }>;
  return rows.reverse(); // DB returns newest first, we want oldest first
}

/**
 * Clear all collaboration messages.
 * @returns Number of deleted messages
 */
export function clearCollabDb(): number {
  const info = stmts.deleteAllCollab.run();
  return info.changes;
}
