import pino from "pino";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logsDir = path.join(__dirname, "../data/logs");
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

// Rotate log file daily — filename: bridge-YYYY-MM-DD.log
function logFilePath(): string {
  const date = new Date().toISOString().slice(0, 10);
  return path.join(logsDir, `bridge-${date}.log`);
}

// Multi-destination: stderr (human-readable) + file (JSON for parsing)
const transport = pino.transport({
  targets: [
    {
      target: "pino-pretty",
      options: {
        destination: 2, // stderr — safe for MCP stdio
        colorize: true,
        translateTime: "HH:MM:ss.l",
        ignore: "pid,hostname",
      },
      level: process.env.LOG_LEVEL ?? "info",
    },
    {
      target: "pino/file",
      options: {
        destination: logFilePath(),
        mkdir: true,
      },
      level: "debug", // file gets everything
    },
  ],
});

export const logger = pino(
  {
    level: "debug", // base level — targets filter individually
    base: { service: "market-bridge" },
  },
  transport,
);

// Typed child loggers for subsystems
export const logOrder = logger.child({ subsystem: "orders" });
export const logExec = logger.child({ subsystem: "executions" });
export const logIbkr = logger.child({ subsystem: "ibkr" });
export const logRest = logger.child({ subsystem: "rest" });
export const logCollab = logger.child({ subsystem: "collab" });
export const logReconcile = logger.child({ subsystem: "reconcile" });
export const logRisk = logger.child({ subsystem: "risk-gate" });
export const logDb = logger.child({ subsystem: "database" });
export const logAnalytics = logger.child({ subsystem: "analytics" });

// Express request logging middleware
import type { Request, Response, NextFunction } from "express";

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - start;

    // Feed ops metrics collector (lazy import to avoid circular deps)
    try {
      const { recordRequest } = require("./ops/metrics.js");
      recordRequest(req.path, res.statusCode, duration);
    } catch { /* metrics module may not be loaded yet during startup */ }

    logRest.info(
      {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        duration_ms: duration,
      },
      `${req.method} ${req.path} → ${res.statusCode} (${duration}ms)`,
    );
  });
  next();
}

// Clean up old log files (keep last N days)
export function pruneOldLogs(keepDays: number = 30) {
  try {
    const files = fs.readdirSync(logsDir).filter((f) => f.startsWith("bridge-") && f.endsWith(".log"));
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - keepDays);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    for (const file of files) {
      const dateMatch = file.match(/bridge-(\d{4}-\d{2}-\d{2})\.log/);
      if (dateMatch && dateMatch[1] < cutoffStr) {
        fs.unlinkSync(path.join(logsDir, file));
        logger.info({ file }, "Pruned old log file");
      }
    }
  } catch (e) {
    logger.warn({ err: e }, "Failed to prune old logs");
  }
}
