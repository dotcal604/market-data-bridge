import dotenv from "dotenv";
dotenv.config();

// IBKR config is optional — only needed when TWS/Gateway is running for account data.
// Market data comes from Yahoo Finance and works without IBKR.
export const config = {
  ibkr: {
    host: process.env.IBKR_HOST ?? "127.0.0.1",
    port: parseInt(process.env.IBKR_PORT ?? "7496", 10),
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
};
