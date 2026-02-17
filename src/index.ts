// ⚠️ suppress-stdout MUST be the first import — it redirects console.log → stderr
// before @stoqey/ib's logger initializes and pollutes MCP's stdio transport.
import "./suppress-stdout.js";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { connect, disconnect, isConnected, scheduleReconnect } from "./ibkr/connection.js";
import { createMcpServer } from "./mcp/server.js";
import { startRestServer } from "./rest/server.js";
import { logger, pruneOldLogs } from "./logging.js";
import { initCollabFromDb } from "./collab/store.js";
import { attachPersistentOrderListeners } from "./ibkr/orders.js";
import { runReconciliation } from "./db/reconcile.js";
import { closeDb } from "./db/database.js";
import { startScheduler, stopScheduler } from "./scheduler.js";
import { initWeights } from "./eval/ensemble/weights.js";
import { unsubscribeAll } from "./ibkr/subscriptions.js";
import { startHollyWatcher, stopHollyWatcher } from "./holly/watcher.js";

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

  // Initialize DB-backed collab store (loads persisted messages)
  initCollabFromDb();

  // Initialize eval ensemble weights (loads from data/weights.json + hot-reload)
  initWeights();

  // Prune old log files (keep 30 days)
  pruneOldLogs();

  // IBKR connection is optional — only needed for account data (positions, PnL).
  // Market data comes from Yahoo Finance and works without IBKR.
  try {
    await connect();
    logger.info("IBKR connected — account data available");

    // Attach persistent DB listeners for order/execution events
    attachPersistentOrderListeners();

    // Run boot reconciliation (compare DB state vs IBKR state)
    runReconciliation().catch((e) => {
      logger.error({ err: e }, "Boot reconciliation failed");
    });

    // Start periodic snapshots (account + positions every 5 min during market hours)
    startScheduler();

    // Start Holly AI alert file watcher (polls Trade Ideas CSV export)
    startHollyWatcher();
  } catch (e: any) {
    logger.warn({ err: e.message }, "IBKR not available — market data still works via Yahoo");
    logger.info("Will keep retrying IBKR connection in background...");
    scheduleReconnect();
  }

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
  const shutdown = () => {
    logger.info("Shutting down...");
    stopHollyWatcher();
    stopScheduler();
    unsubscribeAll();
    disconnect();
    closeDb();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Catch unhandled async rejections — log and shut down cleanly
  process.on("unhandledRejection", (reason, promise) => {
    logger.error({ reason, promise }, "Unhandled promise rejection — shutting down");
    shutdown();
  });

  // Catch uncaught sync exceptions
  process.on("uncaughtException", (err) => {
    logger.fatal({ err }, "Uncaught exception — shutting down");
    shutdown();
  });
}

main().catch((err) => {
  logger.fatal({ err }, "Fatal error");
  process.exit(1);
});
