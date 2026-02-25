import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { publicRouter, router } from "./routes.js";
import { evalRouter } from "../eval/routes.js";
import { openApiAgentSpec } from "./openapi-agent.js";
import { handleAgentRequest, getActionCatalog } from "./agent.js";
import { config } from "../config.js";
import { requestLogger, logRest } from "../logging.js";
import { isConnected, getConnectionStatus } from "../ibkr/connection.js";
import { isDbWritable, insertMcpSession, updateMcpSessionActivity, closeMcpSession, getActiveMcpSessions } from "../db/database.js";
import { createMcpServer } from "../mcp/server.js";
import { initWebSocket } from "../ws/server.js";
import { getMetrics, getRecentIncidents } from "../ops/metrics.js";
import { isReady } from "../ops/readiness.js";
import { getCachedChart, getPlaceholderPng } from "../divoom/charts.js";
import { getDivoomState, getDivoomDisplay, forceRefresh } from "../divoom/updater.js";
import { renderLayout, CANVAS_W, PAD_X, CONTENT_W } from "../divoom/widgets/index.js";
import type { WidgetContext } from "../divoom/widgets/index.js";
import { getLayoutForSession } from "../divoom/widgets/layouts.js";
import { currentSession } from "../divoom/screens.js";

function apiKeyAuth(req: Request, res: Response, next: NextFunction): void {
  const key = config.rest.apiKey;
  if (!key) {
    next();
    return;
  }
  const provided =
    (req.headers["x-api-key"] as string) ??
    req.headers.authorization?.replace(/^Bearer\s+/i, "");
  const providedBuffer = Buffer.from(provided ?? "");
  const keyBuffer = Buffer.from(key);

  if (
    providedBuffer.length === keyBuffer.length &&
    timingSafeEqual(providedBuffer, keyBuffer)
  ) {
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
const frontendOutDir = path.resolve(process.cwd(), "frontend", "out");

function configureFrontendStaticHosting(app: express.Express): void {
  if (!existsSync(frontendOutDir)) {
    logRest.warn(
      { frontendOutDir },
      "Frontend static export not found — dashboard hosting disabled",
    );
    return;
  }

  app.use(express.static(frontendOutDir, { index: false }));
  app.get(/^\/(?!api|mcp|health|\.well-known|openapi\.json|openapi-agent\.json).*/, (_req, res) => {
    res.sendFile(path.join(frontendOutDir, "index.html"));
  });

  logRest.info({ frontendOutDir }, "Frontend static export hosting enabled");
}

// ── MCP-over-HTTP session management ────────────────────────────────
// Each ChatGPT conversation gets its own transport + MCP server instance.
// Sessions are keyed by the Mcp-Session-Id header.
const mcpSessions = new Map<string, StreamableHTTPServerTransport>();
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes idle timeout
const KEEPALIVE_INTERVAL_MS = 60 * 1000; // 60 seconds keepalive ping
const sessionTimers = new Map<string, ReturnType<typeof setTimeout>>();
const keepaliveIntervals = new Map<string, ReturnType<typeof setInterval>>();

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
        const keepalive = keepaliveIntervals.get(sessionId);
        if (keepalive) {
          clearInterval(keepalive);
          keepaliveIntervals.delete(sessionId);
        }
        closeMcpSession(sessionId);
      }
    }, SESSION_TTL_MS),
  );
}

// Log session recovery info on startup
function logSessionRecovery(): void {
  const activeSessions = getActiveMcpSessions();
  if (activeSessions.length > 0) {
    logRest.info(
      { count: activeSessions.length, sessions: activeSessions.map(s => s.id) },
      `Session recovery: ${activeSessions.length} sessions were active before restart — clients will need to reconnect`
    );
  }
}

// NOTE: Do NOT register process.on("uncaughtException"/"unhandledRejection") here.
// The main index.ts handlers own process lifecycle. Duplicate handlers here
// would shadow them and leave the process in a corrupted state.

export function createApp(): express.Express {
  const app = express();

  // Log session recovery on startup
  logSessionRecovery();

  app.use(cors());
  app.use(express.json());

  // Request logging
  app.use(requestLogger);

  // Serve public routes (unauthenticated)
  app.use(publicRouter);

  // Serve OpenAPI agent spec (unauthenticated)
  app.get("/openapi-agent.json", (_req, res) => { res.json(openApiAgentSpec); });

  // ChatGPT JIT plugin discovery — /.well-known endpoints
  app.get("/.well-known/ai-plugin.json", (_req, res) => {
    res.json({
      schema_version: "v1",
      name_for_human: "Market Data Bridge",
      name_for_model: "market_data_bridge",
      description_for_human: "IBKR market data, quotes, orders, and AI ensemble trade evaluations.",
      description_for_model: "Access real-time market data, stock quotes, options chains, place orders, and run 3-model ensemble trade evaluations via IBKR. Call getGptInstructions first to see all available actions.",
      auth: { type: "none" },
      api: {
        type: "openapi",
        url: "https://api.klfh-dot-io.com/openapi-agent.json",
      },
      logo_url: "https://api.klfh-dot-io.com/favicon.ico",
      contact_email: "support@klfh-dot-io.com",
      legal_info_url: "https://klfh-dot-io.com",
    });
  });
  app.get("/.well-known/openapi.json", (_req, res) => {
    res.json(openApiAgentSpec);
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
    const connStatus = getConnectionStatus();
    const health = {
      status: "ok" as "ok" | "degraded",
      uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
      ibkr_connected: connStatus.connected,
      ibkr_uptime_seconds: connStatus.uptimeSinceConnect,
      ibkr_total_disconnects: connStatus.totalDisconnects,
      ibkr_reconnect_attempts: connStatus.reconnectAttempts,
      ibkr_client_id: connStatus.clientId,
      ibkr_mode: connStatus.mode,
      ibkr_tws_version: connStatus.twsVersion,
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

  // GET /health/connection — full connection event history (for debugging)
  app.get("/health/connection", (_req, res) => {
    res.json(getConnectionStatus());
  });

  // GET /health/deep — full ops metrics dashboard (for monitoring)
  app.get("/health/deep", (_req, res) => {
    const metrics = getMetrics();
    const recentIncidents = getRecentIncidents(10);
    res.json({
      ...metrics,
      recentIncidents,
      mcp_sessions: mcpSessions.size,
      db_writable: isDbWritable(),
    });
  });

  // GET /health/ready — readiness probe (returns 503 until fully initialized)
  // Use this for pm2 wait_ready, load balancers, and deploy scripts
  app.get("/health/ready", (_req, res) => {
    const ready = isReady();
    const connStatus = getConnectionStatus();
    const dbOk = isDbWritable();
    const status = {
      ready,
      db_writable: dbOk,
      ibkr_connected: connStatus.connected,
      rest_server: true,
      mcp_sessions: mcpSessions.size,
      timestamp: new Date().toISOString(),
    };
    if (!ready) {
      res.status(503).json(status);
    } else {
      res.json(status);
    }
  });

  // ── Divoom chart image endpoint (unauthenticated — device fetches directly) ──
  app.get("/api/divoom/charts/:type", (req: Request, res: Response) => {
    const chartType = req.params.type as string;
    const validTypes = [
      "spy-sparkline", "spy-candles", "sector-heatmap",
      "pnl-curve", "rsi-gauge", "vix-gauge",
      "volume-bars", "allocation",
      "indices-table", "movers-table", "news-panel", "portfolio-summary",
    ];
    if (!validTypes.includes(chartType)) {
      res.status(404).json({ error: `Unknown chart type: ${chartType}` });
      return;
    }

    const buffer = getCachedChart(chartType);
    if (!buffer) {
      // Return an opaque dark 1x1 PNG — device does NOT composite alpha
      res.set("Content-Type", "image/png");
      res.set("Cache-Control", "no-cache");
      res.send(getPlaceholderPng());
      return;
    }

    res.set("Content-Type", "image/png");
    res.set("Cache-Control", "no-cache, no-store");
    res.send(buffer);
  });

  // ── Divoom admin endpoints (authenticated) ──

  app.get("/api/divoom/status", apiKeyAuth, (_req: Request, res: Response) => {
    const state = getDivoomState();
    // Return status without preview data
    const { preview: _preview, ...status } = state;
    res.json({ data: status });
  });

  app.get("/api/divoom/preview", apiKeyAuth, (_req: Request, res: Response) => {
    const state = getDivoomState();
    // Widget engine provides element-based preview; legacy provides section-based
    if (state.enginePreview) {
      res.json({
        data: {
          type: "elements" as const,
          elements: state.enginePreview.elements.map((el, idx) => ({
            id: el.ID,
            y: el.StartY,
            height: el.Height,
            text: el.TextMessage ?? "",
            color: el.FontColor ?? "#FFFFFF",
            widget: state.enginePreview!.elementWidgets[idx] ?? "unknown",
          })),
          rendered: state.enginePreview.rendered,
          canvasHeight: 1280,
        },
      });
      return;
    }
    if (!state.preview) {
      res.json({ data: null });
      return;
    }
    res.json({ data: { type: "sections" as const, ...state.preview } });
  });

  app.post("/api/divoom/brightness", apiKeyAuth, async (req: Request, res: Response) => {
    const display = getDivoomDisplay();
    if (!display) {
      res.status(503).json({ error: "TimesFrame not active" });
      return;
    }
    const value = Number(req.body?.value);
    if (isNaN(value) || value < 0 || value > 100) {
      res.status(400).json({ error: "value must be 0-100" });
      return;
    }
    try {
      await display.setBrightness(value);
      res.json({ data: { brightness: value } });
    } catch (err) {
      res.status(500).json({ error: "Failed to set brightness" });
    }
  });

  app.post("/api/divoom/refresh", apiKeyAuth, async (_req: Request, res: Response) => {
    try {
      const result = await forceRefresh();
      res.json({ data: { message: result } });
    } catch (err) {
      res.status(500).json({ error: "Failed to refresh dashboard" });
    }
  });

  // Debug: inspect widget engine output without sending to device
  app.get("/api/divoom/debug/elements", apiKeyAuth, async (_req: Request, res: Response) => {
    try {
      const session = currentSession();
      const layout = getLayoutForSession(session);
      const ctx: WidgetContext = {
        session,
        ibkrConnected: isConnected(),
        chartBaseUrl: config.divoom.chartBaseUrl || undefined,
        canvas: { width: CANVAS_W, padX: PAD_X, contentWidth: CONTENT_W },
      };
      const result = await renderLayout(layout, ctx);
      res.json({
        data: {
          session,
          layout: layout.name,
          counts: result.counts,
          rendered: result.rendered,
          skipped: result.skipped,
          degraded: result.degraded,
          elementCount: result.elements.length,
          elements: result.elements.map((e) => ({
            ID: e.ID,
            Type: e.Type,
            StartY: e.StartY,
            Height: e.Height,
            ...(e.Type === "Image" ? { Url: e.Url } : {}),
            ...(e.Type === "Text" ? { TextMessage: e.TextMessage?.slice(0, 60), FontColor: e.FontColor } : {}),
          })),
        },
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
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
        insertMcpSession(id, "http");
        
        // Start keepalive ping (every 60s) for SSE connection
        const keepalive = setInterval(() => {
          // SSE keepalive is handled automatically by the transport
          // We just need to update activity tracking in DB
          updateMcpSessionActivity(id);
        }, KEEPALIVE_INTERVAL_MS);
        keepaliveIntervals.set(id, keepalive);
        
        logRest.info({ sessionId: id, total: mcpSessions.size }, "MCP session created");
      },
      onsessionclosed: (id: string) => {
        mcpSessions.delete(id);
        const timer = sessionTimers.get(id);
        if (timer) clearTimeout(timer);
        sessionTimers.delete(id);
        const keepalive = keepaliveIntervals.get(id);
        if (keepalive) clearInterval(keepalive);
        keepaliveIntervals.delete(id);
        closeMcpSession(id);
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

  // Agent dispatcher — single endpoint for ChatGPT Actions (no 30-op limit)
  app.post("/api/agent", apiKeyAuth, globalLimiter, (req, res) => { void handleAgentRequest(req, res); });
  
  // Agent action catalog — GET endpoint for action metadata
  app.get("/api/agent/catalog", apiKeyAuth, globalLimiter, (_req, res) => {
    res.json(getActionCatalog());
  });

  // Mount API routes with rate limiting (authenticated)
  app.use("/api", apiKeyAuth, globalLimiter, router);

  // Mount eval router (under /api/eval, inside auth)
  app.use("/api/eval", apiKeyAuth, evalLimiter, evalRouter);

  // Apply stricter rate limits to order and collab routes
  app.use("/api/order", orderLimiter);
  app.use("/api/orders", orderLimiter);
  app.use("/api/collab", collabLimiter);

  configureFrontendStaticHosting(app);
  
  return app;
}

export function startRestServer(): Promise<void> {
  return new Promise((resolve) => {
    const app = createApp();

    const httpServer = app.listen(config.rest.port, () => {
      logRest.info({ port: config.rest.port }, "REST server listening");
      logRest.info({ url: `http://localhost:${config.rest.port}/openapi.json` }, "OpenAPI spec available");
      logRest.info({ url: `http://localhost:${config.rest.port}/mcp` }, "MCP Streamable HTTP endpoint available");
      initWebSocket(httpServer);
      if (config.rest.apiKey) {
        logRest.info("API key authentication enabled");
      } else {
        logRest.warn("No REST_API_KEY set — endpoints are unauthenticated");
      }
      resolve();
    });
  });
}
