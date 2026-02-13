import { randomUUID } from "crypto";
import {
  insertCollabMessage,
  loadRecentCollab,
  clearCollabDb,
} from "../db/database.js";
import { logCollab } from "../logging.js";

export interface CollabMessage {
  id: string;
  author: "claude" | "chatgpt" | "user";
  content: string;
  timestamp: string;
  replyTo?: string;
  tags?: string[];
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

let messages: CollabMessage[] = [];

// Load persisted messages from DB on startup
export function initCollabFromDb() {
  try {
    const rows = loadRecentCollab(MAX_MESSAGES);
    messages = rows.map((r) => ({
      id: r.id,
      author: r.author as CollabMessage["author"],
      content: r.content,
      timestamp: r.created_at,
      ...(r.reply_to ? { replyTo: r.reply_to } : {}),
      ...(r.tags ? { tags: safeParseJsonArray(r.tags) } : {}),
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
  tag?: string;
  limit?: number;
}

export function readMessages(opts: ReadOptions = {}): CollabMessage[] {
  let result = messages;

  if (opts.since) {
    const sinceDate = new Date(opts.since).getTime();
    result = result.filter((m) => new Date(m.timestamp).getTime() > sinceDate);
  }
  if (opts.author) {
    result = result.filter((m) => m.author === opts.author);
  }
  if (opts.tag) {
    result = result.filter((m) => m.tags?.includes(opts.tag!));
  }

  const limit = Math.min(opts.limit ?? 50, 100);
  return result.slice(-limit);
}

export interface PostInput {
  author: "claude" | "chatgpt" | "user";
  content: string;
  replyTo?: string;
  tags?: string[];
}

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
    content: input.content.trim(),
    timestamp: new Date().toISOString(),
    ...(input.replyTo ? { replyTo: input.replyTo } : {}),
    ...(input.tags?.length ? { tags: input.tags } : {}),
  };

  messages.push(msg);

  // Dual-write to SQLite
  try {
    insertCollabMessage({
      id: msg.id,
      author: msg.author,
      content: msg.content,
      reply_to: msg.replyTo,
      tags: msg.tags,
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

export function getStats(): { totalMessages: number; byAuthor: Record<string, number> } {
  const byAuthor: Record<string, number> = {};
  for (const m of messages) {
    byAuthor[m.author] = (byAuthor[m.author] ?? 0) + 1;
  }
  return { totalMessages: messages.length, byAuthor };
}
