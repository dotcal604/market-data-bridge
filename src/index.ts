// ⚠️ suppress-stdout MUST be the first import — it redirects console.log → stderr
// before @stoqey/ib's logger initializes and pollutes MCP's stdio transport.
import "./suppress-stdout.js";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { connect, disconnect, isConnected, onReconnect, scheduleReconnect } from "./ibkr/connection.js";
import { createMcpServer } from "./mcp/server.js";
import { startRestServer } from "./rest/server.js";
import { logger, pruneOldLogs } from "./logging.js";
import { initCollabFromDb } from "./collab/store.js";
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

type Mode = "mcp" | "rest" | "both";

function parseMode(): Mode {
  const idx = process.argv.indexOf("--mode");
  if (idx !== -1 && process.argv[idx + 1]) {
    const val = process.argv[idx + 1].toLowerCase();
    if (val === "mcp" || val === "rest" || val === "both") return val;
  }
  return "both";
}

async function main() {
  const mode = parseMode();
  logger.info({ mode }, "Market Bridge starting");

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

  // Initialize eval ensemble weights (loads from data/weights.json + hot-reload)
  initWeights();

  // Initialize Bayesian recalibration (loads priors from disk)
  initRecalibration();

  // Prune old log files (keep 30 days)
  pruneOldLogs();

  // IBKR connection is only needed for REST/both modes.
  // MCP-only processes proxy through the REST bridge and must NOT connect
  // to TWS — doing so creates clientId collisions and phantom connections
  // that churn in TWS's API Connections panel.
  if (mode !== "mcp") {
    try {
      await connect();
      logger.info("IBKR connected — account data available");

      // Attach persistent DB listeners for order/execution events
      attachPersistentOrderListeners();

      // Register reconnect hook: re-attach order listeners + reconcile DB
      // This runs on every TWS reconnect (clientId collision, network blip, TWS restart)
      onReconnect(() => {
        resetPersistentListenerGuard();
        attachPersistentOrderListeners();
        logger.info("Re-attached persistent order listeners after reconnect");

        // Re-run reconciliation to sync DB with IBKR after disconnect
        runReconciliation().catch((e) => {
          logger.error({ err: e }, "Post-reconnect reconciliation failed");
        });
      }, "order-listeners+reconciliation");

      // Run boot reconciliation (compare DB state vs IBKR state)
      runReconciliation().catch((e) => {
        logger.error({ err: e }, "Boot reconciliation failed");
      });

      // Start periodic snapshots (account + positions every 5 min during market hours)
      startScheduler();
    } catch (e: any) {
      logger.warn({ err: e.message }, "IBKR not available — market data still works via Yahoo");
      logger.info("Will keep retrying IBKR connection in background...");
      scheduleReconnect();
    }
  } else {
    logger.info("MCP-only mode — skipping IBKR connection (REST bridge handles it)");
  }

  // Start Holly AI alert file watcher (polls Trade Ideas CSV export)
  // Runs independently of IBKR — watches a local CSV file
  startHollyWatcher();

  // Start Divoom display updater (sends live trading data to pixel art display)
  // Runs independently — polls data and updates display periodically
  await startDivoomUpdater();

  // Start REST server
  if (mode === "rest" || mode === "both") {
    await startRestServer();
  }

  // Start MCP server on stdio
  if (mode === "mcp" || mode === "both") {
    const mcpServer = createMcpServer();
    const transport = new StdioServerTransport();
    await mcpServer.connect(transport);
    logger.info("MCP server running on stdio");
  }

  // Graceful shutdown
  const shutdown = async () => {
    logger.info("Shutting down...");
    stopHollyWatcher();
    await stopDivoomUpdater();
    stopScheduler();
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
    logger.error({ reason, unhandledCount }, "Unhandled promise rejection (swallowed — keeping server alive)");
    // If we get 50+ unhandled rejections, something is truly broken — restart
    if (unhandledCount >= 50) {
      logger.fatal({ unhandledCount }, "Too many unhandled rejections — shutting down");
      shutdown().catch((e) => logger.error({ err: e }, "Shutdown error"));
    }
  });

  // Catch uncaught sync exceptions — these are more serious but we still
  // try to keep alive unless it's clearly fatal (OOM, stack overflow, etc.)
  process.on("uncaughtException", (err) => {
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
