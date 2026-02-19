// ⚠️ suppress-stdout MUST be the first import — it redirects console.log → stderr
// before @stoqey/ib's logger initializes and pollutes MCP's stdio transport.
import "./suppress-stdout.js";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { connect, disconnect, isConnected, onReconnect, scheduleReconnect } from "./ibkr/connection.js";
import { createMcpServer } from "./mcp/server.js";
import { startRestServer } from "./rest/server.js";
import { logger, pruneOldLogs } from "./logging.js";
import { initCollabFromDb } from "./collab/store.js";
import { initInboxFromDb } from "./inbox/store.js";
import { attachPersistentOrderListeners, resetPersistentListenerGuard } from "./ibkr/orders.js";
import { runReconciliation } from "./db/reconcile.js";
import { closeDb } from "./db/database.js";
import { startScheduler, stopScheduler } from "./scheduler.js";
import { initWeights } from "./eval/ensemble/weights.js";
import { initRecalibration } from "./eval/ensemble/recalibration-hook.js";
import { unsubscribeAll } from "./ibkr/subscriptions.js";
import { startHollyWatcher, stopHollyWatcher } from "./holly/watcher.js";
import { startDivoomUpdater, stopDivoomUpdater } from "./divoom/updater.js";
import { config } from "./config.js";
import { validateConfig } from "./config-validator.js";
import { recordIncident, incrementUnhandledRejections, stopMetrics } from "./ops/metrics.js";
import { setReady } from "./ops/readiness.js";

type Mode = "mcp" | "rest" | "both";

function parseMode(): Mode {
  const idx = process.argv.indexOf("--mode");
  if (idx !== -1 && process.argv[idx + 1]) {
    const val = process.argv[idx + 1].toLowerCase();
    if (val === "mcp" || val === "rest" || val === "both") return val;
  }
  return "both";
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function main() {
  const mode = parseMode();

  // Minimal startup line (always). Verbose env dump only with MCP_DEBUG=1.
  process.stderr.write(`[MCP] PID=${process.pid} PPID=${process.ppid} mode=${mode} ts=${new Date().toISOString()}\n`);
  if (process.env.MCP_DEBUG === "1") {
    process.stderr.write(
      `[MCP-DIAG] clientId=${config.ibkr.clientId} port=${config.ibkr.port} ` +
      `DB_PATH=${process.env.DB_PATH ?? "(unset)"} FLATTEN=${process.env.FLATTEN_ENABLED ?? "(unset)"}\n`
    );
  }

  logger.info({ mode }, "Market Bridge starting");

  if (process.uptime() < 5) {
    recordIncident("crash_loop", "critical", "Process restarted within 5s — possible crash loop");
  }

  // Validate configuration early
  const validation = validateConfig(config);
  if (validation.warnings.length > 0) {
    for (const warning of validation.warnings) {
      logger.warn(warning);
    }
  }
  if (validation.errors.length > 0) {
    for (const error of validation.errors) {
      logger.error(error);
    }
    throw new Error("Configuration validation failed. Please fix the errors above.");
  }

  // Initialize DB-backed collab store (loads persisted messages)
  initCollabFromDb();

  // Initialize inbox store (loads persisted event buffer for ChatGPT polling)
  initInboxFromDb();

  // Initialize eval ensemble weights (loads from data/weights.json + hot-reload)
  initWeights();

  // Initialize Bayesian recalibration (loads priors from disk)
  initRecalibration();

  // Prune old log files (keep 30 days)
  pruneOldLogs();

  // ── Crash loop detection ──
  // pm2 sets PM2_RESTART_COUNT on restarts. If it's > 0 AND uptime < 5s,
  // we just crashed and were restarted. Give TWS time to clean up.
  const pm2Restarts = parseInt(process.env.PM2_RESTART_COUNT ?? "0", 10);
  if (pm2Restarts > 0 && process.uptime() < 5) {
    recordIncident("crash_loop", "critical", `Process restarted within ${Math.round(process.uptime())}s — pm2 restart #${pm2Restarts}`);
    logger.warn({ pm2Restarts }, "Crash loop detected — delaying IBKR connect by 5s to let TWS clean up");
    await new Promise((r) => setTimeout(r, 5000));
  }

  // A) Connect to TWS — all modes try this.
  // MCP connects directly for tool calls instead of proxying through REST.
  try {
    logger.info("Delaying IBKR connect by 5s to allow TWS cleanup");
    await sleep(5_000);
    await connect();
    logger.info("IBKR connected — account data available");
  } catch (e: any) {
    logger.warn({ err: e.message }, "IBKR not available — market data still works via Yahoo");
    logger.info("Will keep retrying IBKR connection in background...");
    scheduleReconnect();
  }

  // B) Background automation — only the always-on bridge process (rest/both).
  // MCP processes are lean: connect + serve tools, no scheduler/flatten/reconciliation.
  // Running these in multiple MCP clients risks duplicate EOD flatten orders.
  if (mode !== "mcp") {
    attachPersistentOrderListeners();

    onReconnect(() => {
      resetPersistentListenerGuard();
      attachPersistentOrderListeners();
      logger.info("Re-attached persistent order listeners after reconnect");

      runReconciliation().catch((e) => {
        logger.error({ err: e }, "Post-reconnect reconciliation failed");
      });
    }, "order-listeners+reconciliation");

    runReconciliation().catch((e) => {
      logger.error({ err: e }, "Boot reconciliation failed");
    });

    startScheduler();
  } else {
    logger.info("MCP mode — connected to TWS for tools, no background automation");
  }

  // Holly watcher + Divoom updater only run in bridge mode (rest/both).
  // MCP clients are lean — no file watchers or display drivers.
  if (mode !== "mcp") {
    startHollyWatcher();
    await startDivoomUpdater();
  }

  // Start REST server
  if (mode === "rest" || mode === "both") {
    await startRestServer();
  }

  // Start MCP server on stdio
  if (mode === "mcp" || mode === "both") {
    const mcpServer = createMcpServer();
    const transport = new StdioServerTransport();
    
    // Add error handlers for stdio transport
    process.stdin.on("error", (err) => {
      logger.error({ err: err.message }, "MCP stdin error — attempting graceful shutdown");
      // Don't exit immediately — let shutdown handler run
      shutdown().catch((e) => logger.error({ err: e }, "Shutdown error after stdin failure"));
    });

    process.stdout.on("error", (err) => {
      logger.error({ err: err.message }, "MCP stdout error — attempting graceful shutdown");
      // Don't exit immediately — let shutdown handler run
      shutdown().catch((e) => logger.error({ err: e }, "Shutdown error after stdout failure"));
    });

    try {
      await mcpServer.connect(transport);
      logger.info("MCP server running on stdio");
    } catch (e: any) {
      logger.error({ err: e.message }, "MCP transport failed to connect");
    }
  }

  // ── Bridge fully initialized — accept connections ──
  setReady(true);
  logger.info({ mode }, "Bridge fully initialized — accepting connections");

  // Graceful shutdown
  const shutdown = async () => {
    logger.info("Shutting down...");
    setReady(false);
    stopHollyWatcher();
    await stopDivoomUpdater();
    stopScheduler();
    stopMetrics();
    unsubscribeAll();
    disconnect();
    closeDb();
    process.exit(0);
  };
  process.on("SIGINT", () => { shutdown().catch((e) => logger.error({ err: e }, "Shutdown error")); });
  process.on("SIGTERM", () => { shutdown().catch((e) => logger.error({ err: e }, "Shutdown error")); });

  // Catch unhandled async rejections — log but keep running.
  // Shutting down on every unhandled rejection kills the bridge 40x/day
  // during market hours when transient IBKR/network errors bubble up
  // through timer callbacks. The individual error is already logged;
  // pm2 handles restart if the process truly becomes unrecoverable.
  let unhandledCount = 0;
  process.on("unhandledRejection", (reason) => {
    unhandledCount++;
    incrementUnhandledRejections();
    const detail = reason instanceof Error ? reason.message : String(reason);
    recordIncident("unhandled_rejection", "warning", `#${unhandledCount}: ${detail.slice(0, 200)}`);
    logger.error({ reason, unhandledCount }, "Unhandled promise rejection (swallowed — keeping server alive)");
    // If we get 50+ unhandled rejections, something is truly broken — restart
    if (unhandledCount >= 50) {
      recordIncident("unhandled_rejection_flood", "critical", `${unhandledCount} unhandled rejections — shutting down`);
      logger.fatal({ unhandledCount }, "Too many unhandled rejections — shutting down");
      shutdown().catch((e) => logger.error({ err: e }, "Shutdown error"));
    }
  });

  // Catch uncaught sync exceptions — these are more serious but we still
  // try to keep alive unless it's clearly fatal (OOM, stack overflow, etc.)
  process.on("uncaughtException", (err) => {
    recordIncident("uncaught_exception", "critical", err.message?.slice(0, 200) ?? "unknown");
    logger.fatal({ err }, "Uncaught exception (keeping server alive — may be degraded)");
    // Only shut down for truly unrecoverable errors
    if (err.message?.includes("out of memory") || err.message?.includes("Maximum call stack")) {
      logger.fatal("Unrecoverable error — forcing exit");
      process.exit(1);
    }
  });
}

main().catch((err) => {
  logger.fatal({ err }, "Fatal error");
  process.exit(1);
});
