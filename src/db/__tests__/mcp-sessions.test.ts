import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";

describe("MCP Session Tracking", () => {
  let db: Database.Database;

  beforeEach(() => {
    // Create in-memory database for testing
    db = new Database(":memory:");
    
    // Create the schema
    db.exec(`
      CREATE TABLE mcp_sessions (
        id TEXT PRIMARY KEY,
        transport TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_active TEXT NOT NULL DEFAULT (datetime('now')),
        tool_calls INTEGER NOT NULL DEFAULT 0,
        closed_at TEXT
      );
    `);
  });

  it("should insert a new MCP session", () => {
    const sessionId = "test-session-1";
    const now = new Date().toISOString();
    
    const stmt = db.prepare(`
      INSERT INTO mcp_sessions (id, transport, created_at, last_active)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(sessionId, "http", now, now);

    const session = db.prepare("SELECT * FROM mcp_sessions WHERE id = ?").get(sessionId) as any;
    expect(session).toBeDefined();
    expect(session.id).toBe(sessionId);
    expect(session.transport).toBe("http");
    expect(session.tool_calls).toBe(0);
    expect(session.closed_at).toBeNull();
  });

  it("should update session activity and increment tool calls", () => {
    const sessionId = "test-session-2";
    const now = new Date().toISOString();
    
    db.prepare(`
      INSERT INTO mcp_sessions (id, transport, created_at, last_active)
      VALUES (?, ?, ?, ?)
    `).run(sessionId, "http", now, now);

    const laterTime = new Date(Date.now() + 60000).toISOString();
    db.prepare(`
      UPDATE mcp_sessions SET last_active = ?, tool_calls = tool_calls + 1
      WHERE id = ?
    `).run(laterTime, sessionId);

    const session = db.prepare("SELECT * FROM mcp_sessions WHERE id = ?").get(sessionId) as any;
    expect(session.tool_calls).toBe(1);
    expect(session.last_active).toBe(laterTime);
  });

  it("should close a session", () => {
    const sessionId = "test-session-3";
    const now = new Date().toISOString();
    
    db.prepare(`
      INSERT INTO mcp_sessions (id, transport, created_at, last_active)
      VALUES (?, ?, ?, ?)
    `).run(sessionId, "http", now, now);

    const closeTime = new Date(Date.now() + 120000).toISOString();
    db.prepare("UPDATE mcp_sessions SET closed_at = ? WHERE id = ?").run(closeTime, sessionId);

    const session = db.prepare("SELECT * FROM mcp_sessions WHERE id = ?").get(sessionId) as any;
    expect(session.closed_at).toBe(closeTime);
  });

  it("should get only active sessions", () => {
    const now = new Date().toISOString();
    
    // Create two sessions
    db.prepare(`
      INSERT INTO mcp_sessions (id, transport, created_at, last_active)
      VALUES (?, ?, ?, ?)
    `).run("active-1", "http", now, now);
    
    db.prepare(`
      INSERT INTO mcp_sessions (id, transport, created_at, last_active)
      VALUES (?, ?, ?, ?)
    `).run("closed-1", "http", now, now);

    // Close one session
    db.prepare("UPDATE mcp_sessions SET closed_at = ? WHERE id = ?").run(now, "closed-1");

    const activeSessions = db.prepare(`
      SELECT * FROM mcp_sessions WHERE closed_at IS NULL ORDER BY created_at DESC
    `).all();

    expect(activeSessions).toHaveLength(1);
    expect((activeSessions[0] as any).id).toBe("active-1");
  });

  it("should calculate session statistics correctly", () => {
    const now = new Date().toISOString();
    const later = new Date(Date.now() + 300000).toISOString(); // 5 minutes later
    
    // Create 3 sessions
    db.prepare(`
      INSERT INTO mcp_sessions (id, transport, created_at, last_active, tool_calls)
      VALUES (?, ?, ?, ?, ?)
    `).run("session-1", "http", now, now, 5);
    
    db.prepare(`
      INSERT INTO mcp_sessions (id, transport, created_at, last_active, tool_calls)
      VALUES (?, ?, ?, ?, ?)
    `).run("session-2", "http", now, now, 3);
    
    db.prepare(`
      INSERT INTO mcp_sessions (id, transport, created_at, last_active, tool_calls)
      VALUES (?, ?, ?, ?, ?)
    `).run("session-3", "stdio", now, now, 7);

    // Close two sessions
    db.prepare("UPDATE mcp_sessions SET closed_at = ? WHERE id = ?").run(later, "session-1");
    db.prepare("UPDATE mcp_sessions SET closed_at = ? WHERE id = ?").run(later, "session-2");

    const stats = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN closed_at IS NULL THEN 1 ELSE 0 END) as active,
        AVG(CASE WHEN closed_at IS NOT NULL THEN (julianday(closed_at) - julianday(created_at)) * 86400 ELSE NULL END) as avg_duration_seconds,
        SUM(tool_calls) as total_tool_calls
      FROM mcp_sessions
    `).get() as any;

    expect(stats.total).toBe(3);
    expect(stats.active).toBe(1);
    expect(stats.total_tool_calls).toBe(15); // 5 + 3 + 7
    expect(stats.avg_duration_seconds).toBeGreaterThan(0);
  });

  it("should handle multiple transports", () => {
    const now = new Date().toISOString();
    
    db.prepare(`
      INSERT INTO mcp_sessions (id, transport, created_at, last_active)
      VALUES (?, ?, ?, ?)
    `).run("http-session", "http", now, now);
    
    db.prepare(`
      INSERT INTO mcp_sessions (id, transport, created_at, last_active)
      VALUES (?, ?, ?, ?)
    `).run("stdio-session", "stdio", now, now);

    const allSessions = db.prepare("SELECT * FROM mcp_sessions").all();
    expect(allSessions).toHaveLength(2);
    
    const transports = new Set(allSessions.map((s: any) => s.transport));
    expect(transports).toContain("http");
    expect(transports).toContain("stdio");
  });
});
