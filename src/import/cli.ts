#!/usr/bin/env npx tsx
/**
 * CLI: Import files into the database.
 *
 * Usage:
 *   npx tsx src/import/cli.ts <path-to-file>          Import a single file
 *   npx tsx src/import/cli.ts --watch [inbox-path]     Watch folder for new files
 *
 * Supports: CSV, TSV, JSON, JSONL, XLSX, ZIP (auto-detected).
 * Data types: TraderSync, Holly alerts/trades, journal entries, watchlists,
 *             eval outcomes, screener snapshots, generic structured data.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { importFile, importFromPath } from "./router.js";
import { startInboxWatcher, stopInboxWatcher } from "./watcher.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_INBOX = path.join(__dirname, "../../data/inbox");

const SUPPORTED_EXTENSIONS = new Set([
  ".csv", ".tsv", ".tab",
  ".json", ".jsonl", ".ndjson",
  ".xlsx", ".xls", ".xlsm", ".ods",
  ".zip",
]);

function printUsage(): void {
  console.log(`
Usage:
  npx tsx src/import/cli.ts <file>                Import a single file
  npx tsx src/import/cli.ts --watch [inbox-path]  Watch folder mode (default: data/inbox/)
  npx tsx src/import/cli.ts --help                Show this help

Supported file formats:
  Text:    .csv, .tsv, .json, .jsonl/.ndjson
  Binary:  .xlsx/.xls/.xlsm/.ods, .zip (extracts contents)

Supported data types (auto-detected):
  - TraderSync trade exports
  - Trade Ideas Holly alerts & trades
  - Trade journal entries
  - Symbol watchlists
  - Eval outcomes
  - Screener snapshots
  - Generic structured data (MCP/API responses)
`);
}

// Parse args
const args = process.argv.slice(2);

if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
  printUsage();
  process.exit(args.length === 0 ? 1 : 0);
}

if (args[0] === "--watch") {
  const inboxPath = args[1] ? path.resolve(args[1]) : DEFAULT_INBOX;

  console.log(`Watching for files in: ${inboxPath}`);
  console.log(`Supported: ${[...SUPPORTED_EXTENSIONS].join(", ")}`);
  console.log("Press Ctrl+C to stop.\n");

  startInboxWatcher({ inboxPath, pollIntervalMs: 3000 });

  const shutdown = () => {
    console.log("\nStopping watcher...");
    stopInboxWatcher();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
} else {
  // Single file import
  const filePath = path.resolve(args[0]);
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const ext = path.extname(filePath).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    console.error(`Unsupported file type: ${ext}`);
    console.error(`Supported: ${[...SUPPORTED_EXTENSIONS].join(", ")}`);
    process.exit(1);
  }

  console.log(`Importing: ${filePath}`);

  // Use importFromPath which handles both text and binary
  importFromPath(filePath).then((result) => {
    console.log(`\nImport complete (ID: ${result.import_id})`);
    console.log(`  Format:      ${result.format} (confidence: ${(result.confidence * 100).toFixed(0)}%)`);
    console.log(`  Source:      ${result.source_format}`);
    console.log(`  Detection:   ${result.detection_reason}`);
    console.log(`  Inserted:    ${result.inserted}`);
    console.log(`  Skipped:     ${result.skipped} (duplicates)`);
    console.log(`  Duration:    ${result.duration_ms}ms`);

    if (result.errors.length > 0) {
      console.log(`  Errors:      ${result.errors.length}`);
      for (const err of result.errors.slice(0, 10)) {
        console.log(`    - ${err}`);
      }
      if (result.errors.length > 10) {
        console.log(`    ... and ${result.errors.length - 10} more`);
      }
    }

    process.exit(result.errors.length > 0 && result.inserted === 0 ? 1 : 0);
  }).catch((err) => {
    console.error(`Import failed: ${err.message}`);
    process.exit(1);
  });
}
