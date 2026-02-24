#!/usr/bin/env npx tsx
/**
 * CLI: Import files into the database.
 *
 * Usage:
 *   npx tsx src/import/cli.ts <path-to-file>          Import a single file
 *   npx tsx src/import/cli.ts --watch [inbox-path]     Watch folder for new files
 *
 * Supports: TraderSync CSV, Holly alert CSV, Holly trade CSV.
 * Format is auto-detected from file content.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { importFile } from "./router.js";
import { startInboxWatcher, stopInboxWatcher } from "./watcher.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_INBOX = path.join(__dirname, "../../data/inbox");

function printUsage(): void {
  console.log(`
Usage:
  npx tsx src/import/cli.ts <file.csv>             Import a single file
  npx tsx src/import/cli.ts --watch [inbox-path]   Watch folder mode (default: data/inbox/)
  npx tsx src/import/cli.ts --help                 Show this help

Supported formats (auto-detected):
  - TraderSync trade_data.csv exports
  - Trade Ideas Holly alert CSVs
  - Trade Ideas Holly trade export CSVs
`);
}

// Parse args
const args = process.argv.slice(2);

if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
  printUsage();
  process.exit(args.length === 0 ? 1 : 0);
}

if (args[0] === "--watch") {
  // Watch mode
  const inboxPath = args[1] ? path.resolve(args[1]) : DEFAULT_INBOX;

  console.log(`Watching for files in: ${inboxPath}`);
  console.log("Press Ctrl+C to stop.\n");

  startInboxWatcher({ inboxPath, pollIntervalMs: 3000 });

  // Graceful shutdown
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
  if (ext !== ".csv") {
    console.error(`Unsupported file type: ${ext} (only .csv supported)`);
    process.exit(1);
  }

  console.log(`Importing: ${filePath}`);

  let content = fs.readFileSync(filePath, "utf-8");
  // Strip BOM
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);

  const result = importFile(content, path.basename(filePath));

  console.log(`\nImport complete (ID: ${result.import_id})`);
  console.log(`  Format:     ${result.format} (confidence: ${(result.confidence * 100).toFixed(0)}%)`);
  console.log(`  Detection:  ${result.detection_reason}`);
  console.log(`  Inserted:   ${result.inserted}`);
  console.log(`  Skipped:    ${result.skipped} (duplicates)`);
  console.log(`  Duration:   ${result.duration_ms}ms`);

  if (result.errors.length > 0) {
    console.log(`  Errors:     ${result.errors.length}`);
    for (const err of result.errors.slice(0, 10)) {
      console.log(`    - ${err}`);
    }
    if (result.errors.length > 10) {
      console.log(`    ... and ${result.errors.length - 10} more`);
    }
  }

  process.exit(result.errors.length > 0 && result.inserted === 0 ? 1 : 0);
}
