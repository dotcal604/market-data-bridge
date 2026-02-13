import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { Server as HttpServer } from "http";
import { router } from "./routes.js";
import { evalRouter } from "../eval/routes.js";
import { openApiSpec } from "./openapi.js";
import { config } from "../config.js";
import { requestLogger, logRest } from "../logging.js";
import { isConnected } from "../ibkr/connection.js";
import { isDbWritable } from "../db/database.js";
import { wsServer } from "../ws/server.js";

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

// Prevent uncaught errors from killing the process during RTH
process.on("uncaughtException", (err) => {
  logRest.error({ err }, "Uncaught exception — keeping server alive");
});
process.on("unhandledRejection", (reason) => {
  logRest.error({ reason }, "Unhandled rejection — keeping server alive");
});

export function startRestServer(): Promise<HttpServer> {
  return new Promise((resolve) => {
    const app = express();

    app.use(cors());
    app.use(express.json());

    // Request logging
    app.use(requestLogger);

    // Serve OpenAPI spec for ChatGPT actions (unauthenticated)
    app.get("/openapi.json", (_req, res) => {
      res.json(openApiSpec);
    });

    // Health check (unauthenticated)
    app.get("/", (_req, res) => {
      res.json({
        name: "market-data-bridge",
        version: "3.0.0",
        docs: "/openapi.json",
        api: "/api/status",
        ws: "ws://localhost:3000",
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
        ws_clients: wsServer.getClientCount(),
        timestamp: new Date().toISOString(),
      };
      if (!health.ibkr_connected || !health.db_writable) {
        health.status = "degraded";
      }
      res.json(health);
    });

    // Mount API routes with rate limiting (authenticated)
    app.use("/api", apiKeyAuth, globalLimiter, router);

    // Mount eval router (under /api/eval, inside auth)
    app.use("/api/eval", apiKeyAuth, evalLimiter, evalRouter);

    // Apply stricter rate limits to order and collab routes
    app.use("/api/order", orderLimiter);
    app.use("/api/orders", orderLimiter);
    app.use("/api/collab", collabLimiter);

    const httpServer = app.listen(config.rest.port, () => {
      logRest.info({ port: config.rest.port }, "REST server listening");
      logRest.info({ url: `http://localhost:${config.rest.port}/openapi.json` }, "OpenAPI spec available");
      if (config.rest.apiKey) {
        logRest.info("API key authentication enabled");
      } else {
        logRest.warn("No REST_API_KEY set — endpoints are unauthenticated");
      }
      
      // Start WebSocket server
      wsServer.start(httpServer);
      logRest.info({ ws: `ws://localhost:${config.rest.port}` }, "WebSocket server ready");
      
      resolve(httpServer);
    });
  });
}
