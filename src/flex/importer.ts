/**
 * IBKR Flex Report Importer
 *
 * Three trigger modes:
 *   1. Ad hoc (MCP tool / REST button) — fetchAndImport()
 *   2. File drop (inbox watcher) — importFlexContent()
 *   3. Scheduled (scheduler.ts) — fetchAndImport() called on timer
 *
 * Parses Flex XML/CSV reports and upserts trades into flex_trades table.
 */

import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import { fetchFlexReport } from "./client.js";
import { parseFlexReport, type FlexTrade } from "./parser.js";
import { bulkInsertFlexTrades, getFlexStats, getFlexTrades, type FlexTradeQuery } from "../db/flex.js";
import { config } from "../config.js";
import { logger } from "../logging.js";

const log = logger.child({ module: "flex-importer" });

export interface FlexImportResult {
  batch_id: string;
  report_type: string;
  account_id: string;
  from_date: string;
  to_date: string;
  total_rows: number;
  inserted: number;
  skipped: number;
  errors: string[];
}

/**
 * Fetch a Flex report from IBKR and import into the database.
 * This is the main entry point for ad hoc and scheduled runs.
 */
export async function fetchAndImport(opts?: {
  queryId?: string;
  token?: string;
}): Promise<FlexImportResult> {
  const queryId = opts?.queryId ?? config.flex.queryId;
  const token = opts?.token ?? config.flex.token;

  if (!queryId) throw new Error("No Flex Query ID provided. Set IBKR_FLEX_QUERY_ID or pass queryId.");
  if (!token) throw new Error("No Flex token provided. Set IBKR_FLEX_TOKEN or pass token.");

  log.info({ queryId }, "Fetching Flex report from IBKR");

  const report = await fetchFlexReport(queryId, token);
  return importFlexContent(report.content);
}

/**
 * Import Flex report content (XML or CSV string).
 * Used by file-drop and direct content import.
 */
export function importFlexContent(content: string, batchId?: string): FlexImportResult {
  const batch = batchId ?? randomUUID().slice(0, 8);

  const parsed = parseFlexReport(content);

  if (parsed.trades.length === 0) {
    return {
      batch_id: batch,
      report_type: parsed.report_type,
      account_id: parsed.account_id,
      from_date: parsed.from_date,
      to_date: parsed.to_date,
      total_rows: parsed.total_rows,
      inserted: 0,
      skipped: 0,
      errors: parsed.errors.length > 0 ? parsed.errors : ["No trades found in report"],
    };
  }

  const rows = parsed.trades.map((t) => ({
    ...t,
    import_batch: batch,
  }));

  const { inserted, skipped } = bulkInsertFlexTrades(rows);

  log.info(
    { batch, reportType: parsed.report_type, account: parsed.account_id, inserted, skipped, errors: parsed.errors.length },
    "Flex report imported",
  );

  return {
    batch_id: batch,
    report_type: parsed.report_type,
    account_id: parsed.account_id,
    from_date: parsed.from_date,
    to_date: parsed.to_date,
    total_rows: parsed.total_rows,
    inserted,
    skipped,
    errors: parsed.errors,
  };
}

/**
 * Import a Flex report from a file path.
 */
export function importFlexFile(filePath: string): FlexImportResult {
  let content = readFileSync(filePath, "utf-8");
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
  return importFlexContent(content);
}

// Re-export query functions for convenience
export { getFlexStats, getFlexTrades, type FlexTradeQuery };
