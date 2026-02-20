import dotenv from "dotenv";
import { existsSync, readFileSync } from "fs";

dotenv.config();

// ── ClientId collision guard ────────────────────────────────────────────
// Each MCP client sets IBKR_CLIENT_ID via its own JSON config env vars.
// If .env also sets it, dotenv wins and ALL clients get the same base → collision.
// Detect this at startup and warn loudly.
try {
  const envPath = new URL("../.env", import.meta.url);
  if (existsSync(envPath)) {
    const envContent = readFileSync(envPath, "utf-8");
    if (/^IBKR_CLIENT_ID\s*=/m.test(envContent)) {
      console.error(
        "[CONFIG] ⚠️  WARNING: .env sets IBKR_CLIENT_ID — this overrides per-client " +
        "config and causes clientId collisions. Remove it from .env! " +
        "See MEMORY.md 'IBKR ClientId Map' for correct setup.",
      );
    }
  }
} catch { /* non-fatal — don't crash over a guard check */ }

// IBKR config is optional — only needed when TWS/Gateway is running for account data.
// Market data comes from Yahoo Finance and works without IBKR.
export const config = {
  ibkr: {
    host: process.env.IBKR_HOST ?? "127.0.0.1",
    port: parseInt(process.env.IBKR_PORT ?? "7497", 10),
    clientId: parseInt(process.env.IBKR_CLIENT_ID ?? "0", 10),
    maxClientIdRetries: 5,
    orderTimeoutMs: parseInt(process.env.IBKR_ORDER_TIMEOUT_MS ?? "10000", 10),
    executionTimeoutMs: parseInt(process.env.IBKR_EXECUTION_TIMEOUT_MS ?? "15000", 10),
  },
  rest: {
    port: parseInt(process.env.REST_PORT ?? "3000", 10),
    apiKey: process.env.REST_API_KEY ?? "",
  },
  holly: {
    watchPath: process.env.HOLLY_WATCH_PATH ?? "",
    pollIntervalMs: parseInt(process.env.HOLLY_POLL_INTERVAL_MS ?? "5000", 10),
  },
  drift: {
    accuracyThreshold: parseFloat(process.env.DRIFT_ACCURACY_THRESHOLD ?? "0.55"),
    calibrationThreshold: parseFloat(process.env.DRIFT_CALIBRATION_THRESHOLD ?? "0.15"),
    enabled: (process.env.DRIFT_ALERTS_ENABLED ?? "true") !== "false",
  },
  autoEval: {
    enabled: (process.env.AUTO_EVAL_ENABLED ?? "false") === "true",
    dedupWindowMin: parseInt(process.env.AUTO_EVAL_DEDUP_WINDOW_MIN ?? "5", 10),
    maxConcurrent: parseInt(process.env.AUTO_EVAL_MAX_CONCURRENT ?? "3", 10),
  },
  orchestrator: {
    weights: {
      gpt: parseFloat(process.env.ORCHESTRATOR_WEIGHT_GPT ?? "0.4"),
      gemini: parseFloat(process.env.ORCHESTRATOR_WEIGHT_GEMINI ?? "0.3"),
      claude: parseFloat(process.env.ORCHESTRATOR_WEIGHT_CLAUDE ?? "0.3"),
    },
    requiredAgreement: parseFloat(process.env.ORCHESTRATOR_REQUIRED_AGREEMENT ?? "0.6"),
  },
  divoom: {
    enabled: process.env.DIVOOM_ENABLED === "true",
    deviceIp: process.env.DIVOOM_DEVICE_IP ?? "",
    refreshIntervalMs: parseInt(process.env.DIVOOM_REFRESH_MS ?? "10000", 10),
    brightness: parseInt(process.env.DIVOOM_BRIGHTNESS ?? "80", 10),
  },
  ops: {
    webhookUrl: process.env.OPS_WEBHOOK_URL ?? "",
  },
  risk: {
    /** Default per-trade risk percentage of account equity */
    riskPercent: parseFloat(process.env.RISK_PERCENT ?? "1"),
    /** Maximum position size as a percentage of account equity */
    maxPositionPercent: parseFloat(process.env.MAX_POSITION_PERCENT ?? "10"),
  },
  models: {
    anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
    openaiApiKey: process.env.OPENAI_API_KEY ?? "",
    googleApiKey: process.env.GOOGLE_AI_API_KEY ?? process.env.GOOGLE_API_KEY ?? "",
  },
  gemini: {
    apiKey: process.env.GOOGLE_AI_API_KEY ?? process.env.GOOGLE_API_KEY ?? "",
    model: process.env.GEMINI_MODEL ?? "gemini-2.0-flash",
    timeoutMs: parseInt(process.env.GEMINI_TIMEOUT_MS ?? "10000", 10),
  },
  inbox: {
    ttlDays: parseInt(process.env.INBOX_TTL_DAYS ?? "7", 10),
  },
};
