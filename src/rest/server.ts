import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import path from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";
import { spawn } from "child_process";
import { createProxyMiddleware } from "http-proxy-middleware";
import { router } from "./routes.js";
import { evalRouter } from "../eval/routes.js";
import { openApiSpec } from "./openapi.js";
import { config } from "../config.js";
import { requestLogger, logRest } from "../logging.js";
import { isConnected } from "../ibkr/connection.js";
import { isDbWritable } from "../db/database.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

export function startRestServer(): Promise<void> {
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

    // GET /health — detailed health check (unauthenticated)
    app.get("/health", (_req, res) => {
      const health = {
        status: "ok" as "ok" | "degraded",
        uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
        ibkr_connected: isConnected(),
        db_writable: isDbWritable(),
        rest_server: true,
        timestamp: new Date().toISOString(),
      };
      if (!health.ibkr_connected || !health.db_writable) {
        health.status = "degraded";
      }
      res.json(health);
    });

    // Check for Next.js standalone build
    const standaloneServerPath = path.join(__dirname, "../../frontend/.next/standalone/frontend/server.js");
    const nextFrontendPort = 3001;
    
    if (existsSync(standaloneServerPath)) {
      // Start Next.js standalone server on port 3001
      logRest.info("Starting Next.js standalone server...");
      const nextProcess = spawn("node", [standaloneServerPath], {
        env: { ...process.env, PORT: String(nextFrontendPort), HOSTNAME: "127.0.0.1" },
        stdio: "pipe",
      });

      nextProcess.stdout?.on("data", (data) => {
        logRest.debug(`Next.js: ${data.toString().trim()}`);
      });

      nextProcess.stderr?.on("data", (data) => {
        logRest.error(`Next.js: ${data.toString().trim()}`);
      });

      nextProcess.on("exit", (code) => {
        logRest.error({ code }, "Next.js server exited");
      });

      // Mount API routes
      app.use("/api", apiKeyAuth, globalLimiter, router);
      app.use("/api/eval", apiKeyAuth, evalLimiter, evalRouter);
      app.use("/api/order", orderLimiter);
      app.use("/api/orders", orderLimiter);
      app.use("/api/collab", collabLimiter);

      // Proxy all other requests to Next.js
      app.use(
        "*",
        createProxyMiddleware({
          target: `http://127.0.0.1:${nextFrontendPort}`,
          changeOrigin: true,
          ws: true,
        })
      );

      app.listen(config.rest.port, () => {
        logRest.info({ port: config.rest.port }, "REST server listening (with Next.js frontend)");
        logRest.info({ nextPort: nextFrontendPort }, "Next.js proxied internally");
        logRest.info({ url: `http://localhost:${config.rest.port}/openapi.json` }, "OpenAPI spec available");
        if (config.rest.apiKey) {
          logRest.info("API key authentication enabled");
        } else {
          logRest.warn("No REST_API_KEY set — endpoints are unauthenticated");
        }
        resolve();
      });
    } else {
      // API-only mode (no frontend)
      logRest.info("Next.js standalone build not found — API-only mode");

      app.get("/", (_req, res) => {
        res.json({
          name: "market-data-bridge",
          version: "3.0.0",
          docs: "/openapi.json",
          api: "/api/status",
        });
      });

      // Mount API routes
      app.use("/api", apiKeyAuth, globalLimiter, router);
      app.use("/api/eval", apiKeyAuth, evalLimiter, evalRouter);
      app.use("/api/order", orderLimiter);
      app.use("/api/orders", orderLimiter);
      app.use("/api/collab", collabLimiter);

      app.listen(config.rest.port, () => {
        logRest.info({ port: config.rest.port }, "REST server listening (API-only)");
        logRest.info({ url: `http://localhost:${config.rest.port}/openapi.json` }, "OpenAPI spec available");
        if (config.rest.apiKey) {
          logRest.info("API key authentication enabled");
        } else {
          logRest.warn("No REST_API_KEY set — endpoints are unauthenticated");
        }
        resolve();
      });
    }
  });
}
