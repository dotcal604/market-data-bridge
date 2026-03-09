/**
 * MCP session tracking domain module.
 */

import { getStmts } from "./connection.js";
const stmts = getStmts();

// ── Types ────────────────────────────────────────────────────────────────

export interface McpSessionRow {
  id: string;
  transport: string;
  created_at: string;
  last_active: string;
  tool_calls: number;
  closed_at: string | null;
}

// ── Functions ────────────────────────────────────────────────────────────

/**
 * Record a new MCP session.
 * @param sessionId Session UUID
 * @param transport Transport type (e.g. stdio, sse)
 */
export function insertMcpSession(sessionId: string, transport: string): void {
  const now = new Date().toISOString();
  stmts.insertMcpSession.run({
    id: sessionId,
    transport,
    created_at: now,
    last_active: now,
  });
}

/**
 * Update last active timestamp for an MCP session.
 * @param sessionId Session UUID
 */
export function updateMcpSessionActivity(sessionId: string): void {
  stmts.updateMcpSessionActivity.run({
    id: sessionId,
    last_active: new Date().toISOString(),
  });
}

/**
 * Mark an MCP session as closed.
 * @param sessionId Session UUID
 */
export function closeMcpSession(sessionId: string): void {
  stmts.closeMcpSession.run({
    id: sessionId,
    closed_at: new Date().toISOString(),
  });
}

/**
 * Get currently active MCP sessions.
 * @returns Array of active sessions
 */
export function getActiveMcpSessions(): McpSessionRow[] {
  return stmts.getActiveMcpSessions.all() as McpSessionRow[];
}

/**
 * Get MCP session statistics.
 * @returns Stats object
 */
export function getMcpSessionStats(): {
  total: number;
  active: number;
  avg_duration_seconds: number | null;
  total_tool_calls: number;
} {
  return stmts.getMcpSessionStats.get() as {
    total: number;
    active: number;
    avg_duration_seconds: number | null;
    total_tool_calls: number;
  };
}
