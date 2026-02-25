/**
 * Import Router
 *
 * Routes detected file formats to the appropriate importer.
 * Handles both raw string content (CSV, JSON, JSONL) and pre-parsed rows
 * (from XLSX, API responses, MCP tools).
 *
 * Tracks all imports in the import_history table for audit.
 */

import { randomUUID } from "crypto";
import path from "path";
import { readFileSync } from "fs";
import { detectFormat, detectFromRows, type FileFormat } from "./detector.js";
import { parseByExtension, parseTsv, parseXlsx, parseJsonl, type ParsedContent } from "./parsers.js";
import { importTraderSyncCSV } from "../tradersync/importer.js";
import { importHollyAlerts } from "../holly/importer.js";
import { importHollyTrades } from "../holly/trade-importer.js";
import {
  importWatchlist,
  importSymbolList,
  importJournalEntries,
  importEvalOutcomes,
  importScreenerSnapshots,
  importGenericData,
} from "./importers.js";
import { insertImportRecord, updateImportRecord } from "./history.js";
import { logger } from "../logging.js";

const log = logger.child({ module: "import-router" });

export interface ImportFileResult {
  import_id: string;
  file_name: string;
  format: FileFormat;
  confidence: number;
  detection_reason: string;
  source_format: string; // "csv" | "tsv" | "json" | "jsonl" | "xlsx" | "zip"
  inserted: number;
  skipped: number;
  errors: string[];
  duration_ms: number;
}

// ── Main entry: raw string content (CSV, JSON, JSONL) ─────────────────────

/**
 * Import a file by detecting its format and routing to the right importer.
 * For text-based formats (CSV, JSON, JSONL).
 */
export function importFile(content: string, fileName: string): ImportFileResult {
  const startMs = Date.now();
  const importId = randomUUID().slice(0, 12);
  const ext = path.extname(fileName).toLowerCase();

  // For TSV files, parse to rows first and detect from structure
  if (ext === ".tsv" || ext === ".tab") {
    const parsed = parseTsv(content);
    return importFromParsedRows(parsed.rows, fileName, importId, "tsv", startMs);
  }

  // For JSONL/NDJSON, parse to rows first
  if (ext === ".jsonl" || ext === ".ndjson") {
    const parsed = parseJsonl(content);
    return importFromParsedRows(parsed.rows, fileName, importId, "jsonl", startMs);
  }

  // For CSV/JSON, use string-based detection (existing importers need raw CSV)
  const detection = detectFormat(content);

  log.info({ importId, fileName, format: detection.format, confidence: detection.confidence }, "Import started");

  insertImportRecord({
    import_id: importId,
    file_name: fileName,
    format: detection.format,
    confidence: detection.confidence,
    detection_reason: detection.reason,
    status: "processing",
    inserted: 0,
    skipped: 0,
    errors: "[]",
  });

  if (detection.format === "unknown") {
    return finishImport(importId, fileName, "unknown", 0, detection.reason, ext.replace(".", "") || "csv", 0, 0, [`Unknown format: ${detection.reason}`], startMs);
  }

  try {
    const result = routeStringContent(content, detection, importId);
    return finishImport(importId, fileName, detection.format, detection.confidence, detection.reason, ext.replace(".", "") || "csv", result.inserted, result.skipped, result.errors, startMs);
  } catch (e: any) {
    return finishImport(importId, fileName, detection.format, detection.confidence, detection.reason, ext.replace(".", "") || "csv", 0, 0, [e.message ?? String(e)], startMs);
  }
}

// ── Binary content (XLSX, ZIP) ────────────────────────────────────────────

/**
 * Import a binary file (XLSX, ZIP).
 */
export async function importBinaryFile(buffer: Buffer, fileName: string): Promise<ImportFileResult> {
  const startMs = Date.now();
  const importId = randomUUID().slice(0, 12);
  const ext = path.extname(fileName).toLowerCase();

  try {
    const parsed = await parseByExtension(buffer, ext);
    if ("then" in parsed) {
      // parseByExtension returned a promise (ZIP)
      const resolved = await parsed;
      return importFromParsedRows(resolved.rows, fileName, importId, resolved.sourceFormat, startMs);
    }
    return importFromParsedRows((parsed as ParsedContent).rows, fileName, importId, (parsed as ParsedContent).sourceFormat, startMs);
  } catch (e: any) {
    return finishImport(importId, fileName, "unknown", 0, e.message, ext.replace(".", ""), 0, 0, [e.message], startMs);
  }
}

/**
 * Import from a file path — handles both text and binary formats.
 */
export async function importFromPath(filePath: string): Promise<ImportFileResult> {
  const fileName = path.basename(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const binaryExts = new Set([".xlsx", ".xls", ".xlsm", ".ods", ".zip"]);

  if (binaryExts.has(ext)) {
    const buffer = readFileSync(filePath);
    return importBinaryFile(buffer, fileName);
  }

  let content = readFileSync(filePath, "utf-8");
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
  return importFile(content, fileName);
}

// ── Pre-parsed rows (from XLSX, TSV, API, MCP tools) ─────────────────────

/**
 * Import pre-parsed rows — the universal import path.
 * Works for data from any source: XLSX sheets, API responses, MCP tool output.
 */
export function importRows(
  rows: Array<Record<string, unknown>>,
  opts?: { fileName?: string; dataType?: string; source?: string },
): ImportFileResult {
  const startMs = Date.now();
  const importId = randomUUID().slice(0, 12);
  const fileName = opts?.fileName ?? "api-import";
  return importFromParsedRows(rows, fileName, importId, opts?.source ?? "api", startMs, opts?.dataType);
}

// ── Internal routing ──────────────────────────────────────────────────────

function importFromParsedRows(
  rows: Array<Record<string, unknown>>,
  fileName: string,
  importId: string,
  sourceFormat: string,
  startMs: number,
  forceType?: string,
): ImportFileResult {
  if (rows.length === 0) {
    return finishImport(importId, fileName, "unknown", 0, "No rows to import", sourceFormat, 0, 0, ["No data rows found"], startMs);
  }

  // If forceType is provided, use it; otherwise detect
  let format: FileFormat;
  let confidence: number;
  let reason: string;

  if (forceType) {
    format = forceType as FileFormat;
    confidence = 1;
    reason = `Explicit type: ${forceType}`;
  } else {
    const detection = detectFromRows(rows);
    format = detection.format;
    confidence = detection.confidence;
    reason = detection.reason;
    if (detection.parsedData) {
      rows = detection.parsedData as Array<Record<string, unknown>>;
    }
  }

  insertImportRecord({
    import_id: importId,
    file_name: fileName,
    format,
    confidence,
    detection_reason: reason,
    status: "processing",
    inserted: 0,
    skipped: 0,
    errors: "[]",
  });

  try {
    const result = routeRows(rows, format, importId);
    return finishImport(importId, fileName, format, confidence, reason, sourceFormat, result.inserted, result.skipped, result.errors, startMs);
  } catch (e: any) {
    return finishImport(importId, fileName, format, confidence, reason, sourceFormat, 0, 0, [e.message ?? String(e)], startMs);
  }
}

/**
 * Route raw string content to importers (for CSV formats that need raw strings).
 */
function routeStringContent(
  content: string,
  detection: { format: FileFormat; parsedData?: unknown[] },
  importId: string,
): { inserted: number; skipped: number; errors: string[] } {
  switch (detection.format) {
    case "tradersync": {
      const r = importTraderSyncCSV(content);
      return { inserted: r.inserted, skipped: r.skipped, errors: r.errors };
    }
    case "holly_alerts": {
      const r = importHollyAlerts(content);
      return { inserted: r.inserted, skipped: r.skipped, errors: r.errors };
    }
    case "holly_trades": {
      const r = importHollyTrades(content, importId);
      return { inserted: r.imported, skipped: r.skipped, errors: r.error_samples };
    }
    case "watchlist": {
      // CSV watchlist — use the symbol list parser
      const r = importSymbolList(content, undefined, importId);
      return r;
    }
    default: {
      // For JSON-detected types, route through the rows path
      if (detection.parsedData) {
        return routeRows(detection.parsedData as Array<Record<string, unknown>>, detection.format, importId);
      }
      return { inserted: 0, skipped: 0, errors: [`No importer for format: ${detection.format}`] };
    }
  }
}

/**
 * Route pre-parsed rows to the appropriate importer.
 */
function routeRows(
  rows: Array<Record<string, unknown>>,
  format: FileFormat,
  importId: string,
): { inserted: number; skipped: number; errors: string[] } {
  switch (format) {
    case "tradersync_json": {
      // Convert JSON rows to CSV for the existing TraderSync importer
      // This is a bit roundabout but reuses the battle-tested CSV parser
      return importGenericData(rows, "tradersync", undefined, importId);
    }
    case "holly_alerts_json": {
      return importGenericData(rows, "holly_alert", undefined, importId);
    }
    case "journal": {
      return importJournalEntries(rows);
    }
    case "watchlist": {
      const items = rows.map((r) => ({
        symbol: String(r.symbol ?? r.Symbol ?? r.ticker ?? r.Ticker ?? ""),
        notes: typeof r.notes === "string" ? r.notes : undefined,
        list_name: typeof r.list_name === "string" ? r.list_name : undefined,
        source: typeof r.source === "string" ? r.source : undefined,
      }));
      return importWatchlist(items, importId);
    }
    case "eval_outcomes": {
      return importEvalOutcomes(rows);
    }
    case "screener_snapshot": {
      return importScreenerSnapshots(rows, undefined, importId);
    }
    case "generic": {
      const dataType = typeof rows[0]?._type === "string" ? rows[0]._type : undefined;
      const source = typeof rows[0]?._source === "string" ? rows[0]._source : undefined;
      return importGenericData(rows, dataType, source, importId);
    }
    default:
      return importGenericData(rows, undefined, undefined, importId);
  }
}

/**
 * Finalize import: update history record and return result.
 */
function finishImport(
  importId: string,
  fileName: string,
  format: FileFormat,
  confidence: number,
  reason: string,
  sourceFormat: string,
  inserted: number,
  skipped: number,
  errors: string[],
  startMs: number,
): ImportFileResult {
  const durationMs = Date.now() - startMs;
  const status = errors.length > 0 && inserted === 0 ? "failed" : "completed";

  updateImportRecord(importId, {
    status,
    inserted,
    skipped,
    errors: JSON.stringify(errors),
    duration_ms: durationMs,
  });

  if (inserted > 0) {
    log.info({ importId, fileName, format, sourceFormat, inserted, skipped, durationMs }, "Import completed");
  } else if (errors.length > 0) {
    log.warn({ importId, fileName, format, errors: errors.slice(0, 3) }, "Import failed");
  }

  return {
    import_id: importId,
    file_name: fileName,
    format,
    confidence,
    detection_reason: reason,
    source_format: sourceFormat,
    inserted,
    skipped,
    errors,
    duration_ms: durationMs,
  };
}
