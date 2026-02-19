/**
 * Holly AI Alert File Watcher
 *
 * Polls a Trade Ideas Alert Logging CSV file for new rows.
 * When new content is detected (via mtime + file size), reads only
 * the new bytes, parses them as CSV, and imports into the DB.
 *
 * Enable in Trade Ideas: Toolbar → Alert Logging ON + per-window toggle ON.
 * Set HOLLY_WATCH_PATH to the CSV file path.
 */

import { statSync, readFileSync, existsSync } from "node:fs";
import { config } from "../config.js";
import { importHollyAlerts } from "./importer.js";
import { processNewAlerts } from "./auto-eval.js";
import { wsBroadcast } from "../ws/server.js";
import { logger } from "../logging.js";

const log = logger.child({ module: "holly-watcher" });

let timer: ReturnType<typeof setInterval> | null = null;
let lastSize = 0;
let headerLine = "";

/**
 * Check the watched file for new content and import any new rows.
 * Tracks byte offset so only new rows are processed.
 */
function poll(): void {
  const filePath = config.holly.watchPath;
  if (!filePath) return;

  try {
    if (!existsSync(filePath)) return;

    const stat = statSync(filePath);
    const currentSize = stat.size;

    // No change
    if (currentSize === lastSize) return;

    // File was truncated/replaced — reset and re-read from start
    if (currentSize < lastSize) {
      log.info("Holly alert file truncated/replaced — re-reading from start");
      lastSize = 0;
      headerLine = "";
    }

    // First read — capture header and full content
    if (lastSize === 0) {
      const content = readFileSync(filePath, "utf-8");
      const lines = content.split(/\r?\n/).filter((l) => l.trim());
      if (lines.length === 0) { lastSize = currentSize; return; }

      headerLine = lines[0];
      if (lines.length <= 1) { lastSize = currentSize; return; }

      // Import all data rows
      const csvContent = lines.join("\n");
      const result = importHollyAlerts(csvContent);
      if (result.inserted > 0) {
        log.info({ inserted: result.inserted, skipped: result.skipped }, "Holly watcher: initial import");
        triggerAutoEval(result);
      }
      lastSize = currentSize;
      return;
    }

    // Incremental read — read only new bytes
    const fd = require("node:fs").openSync(filePath, "r");
    const buf = Buffer.alloc(currentSize - lastSize);
    require("node:fs").readSync(fd, buf, 0, buf.length, lastSize);
    require("node:fs").closeSync(fd);

    const newContent = buf.toString("utf-8");
    const newLines = newContent.split(/\r?\n/).filter((l) => l.trim());

    if (newLines.length === 0) { lastSize = currentSize; return; }

    // Prepend header so csv-parse can map columns
    const csvContent = headerLine + "\n" + newLines.join("\n");
    const result = importHollyAlerts(csvContent);
    if (result.inserted > 0) {
      log.info({ inserted: result.inserted, skipped: result.skipped }, "Holly watcher: new alerts");
      triggerAutoEval(result);
    }
    if (result.errors.length > 0) {
      log.warn({ errors: result.errors }, "Holly watcher: parse errors");
    }

    lastSize = currentSize;
  } catch (err) {
    log.error({ err }, "Holly watcher poll error");
  }
}

export function startHollyWatcher(): void {
  const filePath = config.holly.watchPath;
  if (!filePath) {
    log.info("Holly watcher disabled (HOLLY_WATCH_PATH not set)");
    return;
  }

  log.info({ filePath, pollIntervalMs: config.holly.pollIntervalMs }, "Holly watcher starting");

  // Initial poll
  poll();

  timer = setInterval(poll, config.holly.pollIntervalMs);
}

export function stopHollyWatcher(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
    log.info("Holly watcher stopped");
  }
}

/**
 * Fire-and-forget auto-eval on newly imported alerts.
 * Runs async — doesn't block the poll loop.
 */
function triggerAutoEval(result: import("./importer.js").ImportResult): void {
  processNewAlerts(result, (data) => { wsBroadcast("signals", data); wsBroadcast("holly", data); })
    .then((r) => {
      if (r.evaluated > 0 || r.errors > 0) {
        log.info({ evaluated: r.evaluated, skipped: r.skipped, errors: r.errors }, "Auto-eval batch done");
      }
    })
    .catch((err) => log.error({ err }, "Auto-eval trigger failed"));
}

/** Reset internal state — for testing only */
export function _resetWatcher(): void {
  stopHollyWatcher();
  lastSize = 0;
  headerLine = "";
}
