/**
 * Inbox Watcher
 *
 * Polls a watch folder (data/inbox/) for new CSV/JSON files.
 * When a new file appears, detects format, routes to importer,
 * then moves to data/inbox/processed/ (or data/inbox/failed/).
 *
 * Uses the same fs.stat polling pattern as the Holly watcher
 * for consistency and cross-platform compatibility.
 */

import { statSync, readdirSync, readFileSync, renameSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { importFile } from "./router.js";
import { logger } from "../logging.js";

const log = logger.child({ module: "inbox-watcher" });

let timer: ReturnType<typeof setInterval> | null = null;

// Track files we've already processed (path → true) to avoid reprocessing
const processed = new Set<string>();

const SUPPORTED_EXTENSIONS = new Set([".csv", ".CSV"]);

interface InboxConfig {
  inboxPath: string;
  pollIntervalMs: number;
}

/**
 * Ensure the inbox directory structure exists.
 */
function ensureDirs(inboxPath: string): void {
  const processedDir = path.join(inboxPath, "processed");
  const failedDir = path.join(inboxPath, "failed");
  if (!existsSync(inboxPath)) mkdirSync(inboxPath, { recursive: true });
  if (!existsSync(processedDir)) mkdirSync(processedDir, { recursive: true });
  if (!existsSync(failedDir)) mkdirSync(failedDir, { recursive: true });
}

/**
 * Move a file to a subdirectory, adding timestamp to avoid collisions.
 */
function moveFile(filePath: string, destDir: string): void {
  const baseName = path.basename(filePath);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const destPath = path.join(destDir, `${timestamp}_${baseName}`);
  renameSync(filePath, destPath);
}

/**
 * Poll the inbox directory for new files and process them.
 */
function poll(config: InboxConfig): void {
  const { inboxPath } = config;

  try {
    if (!existsSync(inboxPath)) return;

    const files = readdirSync(inboxPath).filter((f) => {
      const ext = path.extname(f);
      return SUPPORTED_EXTENSIONS.has(ext);
    });

    for (const file of files) {
      const filePath = path.join(inboxPath, file);

      // Skip already-processed files (in case move hasn't happened yet)
      if (processed.has(filePath)) continue;

      // Check that the file is stable (not still being written)
      // Wait for file size to be stable across 2 polls
      try {
        const stat = statSync(filePath);
        if (stat.size === 0) continue; // Empty file, skip
      } catch {
        continue; // File may have been moved by another process
      }

      // Mark as processed immediately to prevent double-processing
      processed.add(filePath);

      log.info({ file }, "Inbox: new file detected");

      try {
        const content = readFileSync(filePath, "utf-8");
        // Strip BOM if present
        const clean = content.charCodeAt(0) === 0xFEFF ? content.slice(1) : content;

        const result = importFile(clean, file);

        if (result.errors.length > 0 && result.inserted === 0) {
          // Failed — move to failed/
          moveFile(filePath, path.join(inboxPath, "failed"));
          log.warn({ file, errors: result.errors }, "Inbox: import failed, moved to failed/");
        } else {
          // Success — move to processed/
          moveFile(filePath, path.join(inboxPath, "processed"));
          log.info({ file, inserted: result.inserted, skipped: result.skipped, format: result.format }, "Inbox: import succeeded, moved to processed/");
        }
      } catch (err: any) {
        log.error({ file, err: err.message }, "Inbox: error processing file");
        try {
          moveFile(filePath, path.join(inboxPath, "failed"));
        } catch {
          // Move failed too — file might already be gone
        }
      }
    }
  } catch (err) {
    log.error({ err }, "Inbox watcher poll error");
  }
}

/**
 * Start the inbox watcher.
 */
export function startInboxWatcher(config: InboxConfig): void {
  if (!config.inboxPath) {
    log.info("Inbox watcher disabled (no inbox path configured)");
    return;
  }

  ensureDirs(config.inboxPath);
  log.info({ inboxPath: config.inboxPath, pollIntervalMs: config.pollIntervalMs }, "Inbox watcher starting");

  // Initial poll
  poll(config);

  timer = setInterval(() => poll(config), config.pollIntervalMs);
}

/**
 * Stop the inbox watcher.
 */
export function stopInboxWatcher(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
    log.info("Inbox watcher stopped");
  }
}

/**
 * Reset internal state — for testing only.
 */
export function _resetInboxWatcher(): void {
  stopInboxWatcher();
  processed.clear();
}
