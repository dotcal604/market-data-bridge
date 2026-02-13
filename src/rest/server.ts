import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { router } from "./routes.js";
import { evalRouter } from "../eval/routes.js";
import { openApiSpec } from "./openapi.js";
import { config } from "../config.js";
import { requestLogger, logRest } from "../logging.js";
import { isConnected } from "../ibkr/connection.js";
import { isDbWritable } from "../db/database.js";
import { createMcpServer } from "../mcp/server.js";

function apiKeyAuth(req: Request, res: Response, next: NextFunction): void {
  const key = config.rest.apiKey;
  if (!key) {
    next();
    return;
  }
  const provided =
    (req.headers["x-api-key"] as string) ??
    req.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (provided === key) {
    next();
  } else {
    res.status(401).json({ error: "Unauthorized: invalid or missing API key" });
  }
}

// Rate limiters — keyed by API key, NOT IP (Cloudflare tunnel makes all external requests appear from localhost)
const keyGenerator = (req: Request): string =>
  (req.headers["x-api-key"] as string) ?? "anonymous";

// Suppress express-rate-limit IPv6 validation (we key by API key, not IP)
const rlOptions = { validate: { ip: false } } as const;

const globalLimiter = rateLimit({
  windowMs: 60_000, // 1 minute
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator,
  message: { error: "Rate limit exceeded — 100 requests/minute" },
  ...rlOptions,
});

const orderLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator,
  message: { error: "Order rate limit exceeded — 10 orders/minute" },
  ...rlOptions,
});

const collabLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator,
  message: { error: "Collab rate limit exceeded — 30 requests/minute" },
  ...rlOptions,
});

const evalLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator,
  message: { error: "Eval rate limit exceeded — 10 evaluations/minute" },
  ...rlOptions,
});

const startTime = Date.now();

// ── MCP-over-HTTP session management ────────────────────────────────
// Each ChatGPT conversation gets its own transport + MCP server instance.
// Sessions are keyed by the Mcp-Session-Id header.
const mcpSessions = new Map<string, StreamableHTTPServerTransport>();
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes idle timeout
const sessionTimers = new Map<string, ReturnType<typeof setTimeout>>();

function touchSession(sessionId: string): void {
  const existing = sessionTimers.get(sessionId);
  if (existing) clearTimeout(existing);
  sessionTimers.set(
    sessionId,
    setTimeout(() => {
      const transport = mcpSessions.get(sessionId);
      if (transport) {
        logRest.info({ sessionId }, "MCP session expired — cleaning up");
        void transport.close();
        mcpSessions.delete(sessionId);
        sessionTimers.delete(sessionId);
      }
    }, SESSION_TTL_MS),
  );
}

// Prevent uncaught errors from killing the process during RTH
process.on("uncaughtException", (err) => {
  logRest.error({ err }, "Uncaught exception — keeping server alive");
});
process.on("unhandledRejection", (reason) => {
  logRest.error({ reason }, "Unhandled rejection — keeping server alive");
});

export function startRestServer(): Promise<void> {
  return new Promise((resolve) => {
    const app = express();

    app.use(cors());
    app.use(express.json());

    // Request logging
    app.use(requestLogger);

    // Serve OpenAPI spec for ChatGPT actions (unauthenticated)
    // ?lite=true returns ≤30 operations (fits ChatGPT Actions limit, keeps memory enabled)
    app.get("/openapi.json", (req, res) => {
      if (req.query.lite === "true") {
        // operationId whitelist — exactly 30 operations for ChatGPT Actions
        const allow = new Set([
          "getGptInstructions", "getStatus", "getQuote",
          "getHistoricalBars", "getStockDetails", "searchSymbols",
          "getNews", "getFinancials", "getEarnings",
          "getRecommendations", "getTrending", "runScreener",
          "getOptionsChain", "getOptionQuote",
          "getAccountSummary", "getPositions", "getPnL",
          "getOpenOrders", "getCompletedOrders", "getExecutions",
          "placeOrder", "placeBracketOrder", "cancelOrder",
          "getSessionState", "sizePosition",
          "getCollabMessages", "postCollabMessage",
          "getJournal", "getOrdersHistory", "getExecutionsHistory",
        ]);
        const litePaths: Record<string, unknown> = {};
        for (const [path, methods] of Object.entries(openApiSpec.paths)) {
          const filtered: Record<string, unknown> = {};
          for (const [method, op] of Object.entries(methods as Record<string, { operationId?: string }>)) {
            if (op.operationId && allow.has(op.operationId)) {
              filtered[method] = op;
            }
          }
          if (Object.keys(filtered).length > 0) litePaths[path] = filtered;
        }
        res.json({ ...openApiSpec, paths: litePaths });
        return;
      }
      res.json(openApiSpec);
    });

    // Health check (unauthenticated)
    app.get("/", (_req, res) => {
      res.json({
        name: "market-data-bridge",
        version: "3.0.0",
        docs: "/openapi.json",
        api: "/api/status",
        mcp: "/mcp",
      });
    });

    // GET /health — detailed health check (unauthenticated)
    app.get("/health", (_req, res) => {
      const health = {
        status: "ok" as "ok" | "degraded",
        uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
        ibkr_connected: isConnected(),
        db_writable: isDbWritable(),
        rest_server: true,
        mcp_sessions: mcpSessions.size,
        timestamp: new Date().toISOString(),
      };
      if (!health.ibkr_connected || !health.db_writable) {
        health.status = "degraded";
      }
      res.json(health);
    });

    // ── MCP Streamable HTTP endpoint (for ChatGPT MCP connector) ──
    // POST /mcp — JSON-RPC requests (initialize, tool calls, etc.)
    app.post("/mcp", apiKeyAuth, async (req: Request, res: Response) => {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      let transport = sessionId ? mcpSessions.get(sessionId) : undefined;

      if (transport) {
        // Existing session — refresh TTL and forward request
        touchSession(sessionId!);
        await transport.handleRequest(req, res, req.body);
        return;
      }

      // New session — create transport + MCP server
      const newTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id: string) => {
          mcpSessions.set(id, newTransport);
          touchSession(id);
          logRest.info({ sessionId: id, total: mcpSessions.size }, "MCP session created");
        },
        onsessionclosed: (id: string) => {
          mcpSessions.delete(id);
          const timer = sessionTimers.get(id);
          if (timer) clearTimeout(timer);
          sessionTimers.delete(id);
          logRest.info({ sessionId: id, total: mcpSessions.size }, "MCP session closed");
        },
      });

      const server = createMcpServer();
      await server.connect(newTransport);
      await newTransport.handleRequest(req, res, req.body);
    });

    // GET /mcp — SSE stream for server-to-client notifications
    app.get("/mcp", apiKeyAuth, async (req: Request, res: Response) => {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      if (!sessionId || !mcpSessions.has(sessionId)) {
        res.status(400).json({ error: "Invalid or missing Mcp-Session-Id header" });
        return;
      }
      touchSession(sessionId);
      const transport = mcpSessions.get(sessionId)!;
      await transport.handleRequest(req, res);
    });

    // DELETE /mcp — close a session
    app.delete("/mcp", apiKeyAuth, async (req: Request, res: Response) => {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      if (!sessionId || !mcpSessions.has(sessionId)) {
        res.status(400).json({ error: "Invalid or missing Mcp-Session-Id header" });
        return;
      }
      const transport = mcpSessions.get(sessionId)!;
      await transport.handleRequest(req, res);
    });

    // Mount API routes with rate limiting (authenticated)
    app.use("/api", apiKeyAuth, globalLimiter, router);

    // Mount eval router (under /api/eval, inside auth)
    app.use("/api/eval", apiKeyAuth, evalLimiter, evalRouter);

    // Apply stricter rate limits to order and collab routes
    app.use("/api/order", orderLimiter);
    app.use("/api/orders", orderLimiter);
    app.use("/api/collab", collabLimiter);

    app.listen(config.rest.port, () => {
      logRest.info({ port: config.rest.port }, "REST server listening");
      logRest.info({ url: `http://localhost:${config.rest.port}/openapi.json` }, "OpenAPI spec available");
      logRest.info({ url: `http://localhost:${config.rest.port}/mcp` }, "MCP Streamable HTTP endpoint available");
      if (config.rest.apiKey) {
        logRest.info("API key authentication enabled");
      } else {
        logRest.warn("No REST_API_KEY set — endpoints are unauthenticated");
      }
      resolve();
    });
  });
}
