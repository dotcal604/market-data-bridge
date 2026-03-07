import { randomUUID } from "crypto";
import {
  insertCollabMessage,
  loadRecentCollab,
  clearCollabDb,
} from "../db/database.js";
import { logCollab } from "../logging.js";

export type CollabMessageType = "info" | "request" | "decision" | "handoff" | "blocker";

export interface CollabMessage {
  id: string;
  author: "claude" | "chatgpt" | "user";
  type: CollabMessageType;
  content: string;
  timestamp: string;
  replyTo?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

const MAX_MESSAGES = 200;
const MAX_CONTENT_LENGTH = 8000;

/** Safely parse a JSON string as string[]; returns [] on any failure. */
function safeParseJsonArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Safely parse a JSON string as Record<string, unknown>; returns undefined on failure. */
function safeParseJsonObject(raw: string | null): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && !Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

let messages: CollabMessage[] = [];

/**
 * Initialize in-memory message store from database persistence.
 */
export function initCollabFromDb() {
  try {
    const rows = loadRecentCollab(MAX_MESSAGES);
    messages = rows.map((r) => ({
      id: r.id,
      author: r.author as CollabMessage["author"],
      type: (r.type ?? "info") as CollabMessageType,
      content: r.content,
      timestamp: r.created_at,
      ...(r.reply_to ? { replyTo: r.reply_to } : {}),
      ...(r.tags ? { tags: safeParseJsonArray(r.tags) } : {}),
      ...(r.metadata ? { metadata: safeParseJsonObject(r.metadata) } : {}),
    }));
    logCollab.info({ count: messages.length }, "Loaded collab messages from DB");
  } catch (e: any) {
    logCollab.error({ err: e }, "Failed to load collab messages from DB — starting fresh");
    messages = [];
  }
}

export interface ReadOptions {
  since?: string;
  author?: "claude" | "chatgpt" | "user";
  type?: CollabMessageType;
  tag?: string;
  limit?: number;
}

/**
 * Read messages from the collaboration channel.
 * @param opts Filter options (since, author, tag, limit)
 * @returns Array of messages
 */
export function readMessages(opts: ReadOptions = {}): CollabMessage[] {
  let result = messages;

  if (opts.since) {
    const sinceDate = new Date(opts.since).getTime();
    result = result.filter((m) => new Date(m.timestamp).getTime() > sinceDate);
  }
  if (opts.author) {
    result = result.filter((m) => m.author === opts.author);
  }
  if (opts.type) {
    result = result.filter((m) => m.type === opts.type);
  }
  if (opts.tag) {
    result = result.filter((m) => m.tags?.includes(opts.tag!));
  }

  const limit = Math.min(opts.limit ?? 50, 100);
  return result.slice(-limit);
}

export interface PostInput {
  author: "claude" | "chatgpt" | "user";
  type?: CollabMessageType;
  content: string;
  replyTo?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

/**
 * Post a new message to the collaboration channel.
 * @param input Message content and metadata
 * @returns The created message
 */
export function postMessage(input: PostInput): CollabMessage {
  if (!input.content || input.content.trim().length === 0) {
    throw new Error("Message content cannot be empty");
  }
  if (input.content.length > MAX_CONTENT_LENGTH) {
    throw new Error(`Message content exceeds ${MAX_CONTENT_LENGTH} character limit`);
  }
  if (input.replyTo && !messages.find((m) => m.id === input.replyTo)) {
    throw new Error(`replyTo message id "${input.replyTo}" not found`);
  }

  const msg: CollabMessage = {
    id: randomUUID(),
    author: input.author,
    type: input.type ?? "info",
    content: input.content.trim(),
    timestamp: new Date().toISOString(),
    ...(input.replyTo ? { replyTo: input.replyTo } : {}),
    ...(input.tags?.length ? { tags: input.tags } : {}),
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };

  messages.push(msg);

  // Dual-write to SQLite
  try {
    insertCollabMessage({
      id: msg.id,
      author: msg.author,
      type: msg.type,
      content: msg.content,
      reply_to: msg.replyTo,
      tags: msg.tags,
      metadata: msg.metadata,
      created_at: msg.timestamp,
    });
  } catch (e: any) {
    logCollab.error({ err: e, msgId: msg.id }, "Failed to persist collab message to DB");
  }

  if (messages.length > MAX_MESSAGES) {
    messages = messages.slice(-MAX_MESSAGES);
  }

  return msg;
}

/**
 * Clear all messages from the collaboration channel.
 * @returns Object containing cleared count
 */
export function clearMessages(): { cleared: number } {
  const count = messages.length;
  messages = [];
  try {
    clearCollabDb();
  } catch (e: any) {
    logCollab.error({ err: e }, "Failed to clear collab messages from DB");
  }
  return { cleared: count };
}

/**
 * Get message statistics.
 * @returns Object with total count and breakdown by author
 */
export function getStats(): { totalMessages: number; byAuthor: Record<string, number>; byType: Record<string, number> } {
  const byAuthor: Record<string, number> = {};
  const byType: Record<string, number> = {};
  for (const m of messages) {
    byAuthor[m.author] = (byAuthor[m.author] ?? 0) + 1;
    byType[m.type] = (byType[m.type] ?? 0) + 1;
  }
  return { totalMessages: messages.length, byAuthor, byType };
}
