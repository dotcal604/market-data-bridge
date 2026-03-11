#!/usr/bin/env npx tsx
/**
 * CLI: Import IBKR Flex reports into the database.
 *
 * Usage:
 *   Fetch from IBKR:  npx tsx src/flex/cli.ts fetch [queryId] [token]
 *   Import file:       npx tsx src/flex/cli.ts import <path-to-report>
 */
import fs from "fs";
import path from "path";

const command = process.argv[2];

if (!command || command === "--help" || command === "-h") {
  console.log(`
IBKR Flex Report CLI

Usage:
  npx tsx src/flex/cli.ts fetch [queryId] [token]
    Fetch a Flex report from IBKR and import trades.
    Defaults to IBKR_FLEX_QUERY_ID and IBKR_FLEX_TOKEN env vars.

  npx tsx src/flex/cli.ts import <path-to-report>
    Import a local Flex report file (XML or CSV).
`);
  process.exit(0);
}

async function main() {
  if (command === "fetch") {
    const { fetchAndImport } = await import("./importer.js");
    const queryId = process.argv[3] || undefined;
    const token = process.argv[4] || undefined;

    console.log("Fetching Flex report from IBKR...");
    const result = await fetchAndImport({ queryId, token });

    console.log(`\nFetch complete (batch: ${result.batch_id})`);
    console.log(`  Report type: ${result.report_type}`);
    console.log(`  Account:     ${result.account_id}`);
    console.log(`  Date range:  ${result.from_date} → ${result.to_date}`);
    console.log(`  Total rows:  ${result.total_rows}`);
    console.log(`  Inserted:    ${result.inserted}`);
    console.log(`  Skipped:     ${result.skipped} (duplicates)`);
    if (result.errors.length > 0) {
      console.log(`  Errors:      ${result.errors.length}`);
      for (const err of result.errors.slice(0, 10)) {
        console.log(`    - ${err}`);
      }
    }
  } else if (command === "import") {
    const filePath = process.argv[3];
    if (!filePath) {
      console.error("Usage: npx tsx src/flex/cli.ts import <path-to-report>");
      process.exit(1);
    }

    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) {
      console.error(`File not found: ${resolved}`);
      process.exit(1);
    }

    const { importFlexFile } = await import("./importer.js");
    console.log(`Importing Flex report from: ${resolved}`);
    const result = importFlexFile(resolved);

    console.log(`\nImport complete (batch: ${result.batch_id})`);
    console.log(`  Report type: ${result.report_type}`);
    console.log(`  Account:     ${result.account_id}`);
    console.log(`  Date range:  ${result.from_date} → ${result.to_date}`);
    console.log(`  Total rows:  ${result.total_rows}`);
    console.log(`  Inserted:    ${result.inserted}`);
    console.log(`  Skipped:     ${result.skipped} (duplicates)`);
    if (result.errors.length > 0) {
      console.log(`  Errors:      ${result.errors.length}`);
      for (const err of result.errors.slice(0, 10)) {
        console.log(`    - ${err}`);
      }
    }
  } else {
    console.error(`Unknown command: ${command}`);
    console.error("Use 'fetch' or 'import'. Run with --help for usage.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
