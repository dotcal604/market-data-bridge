/**
 * File Format Parsers
 *
 * Converts various file formats into a uniform representation:
 * an array of Record<string, unknown> objects (rows/items).
 *
 * Supports: CSV, TSV, JSON, JSONL, XLSX, ZIP (extracts contents).
 */

import { parse } from "csv-parse/sync";
import * as XLSX from "xlsx";

/**
 * Parsed file content — uniform representation across formats.
 */
export interface ParsedContent {
  /** The rows/items extracted from the file */
  rows: Array<Record<string, unknown>>;
  /** Original raw content (for CSV-specific importers that expect raw strings) */
  rawContent?: string;
  /** Source format that was parsed */
  sourceFormat: string;
  /** For ZIP files: individual file results */
  subFiles?: Array<{ fileName: string; parsed: ParsedContent }>;
}

/**
 * Parse CSV content into rows.
 */
export function parseCsv(content: string): ParsedContent {
  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  }) as Array<Record<string, string>>;
  return { rows: records, rawContent: content, sourceFormat: "csv" };
}

/**
 * Parse TSV (tab-separated) content into rows.
 */
export function parseTsv(content: string): ParsedContent {
  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
    delimiter: "\t",
  }) as Array<Record<string, string>>;
  return { rows: records, rawContent: content, sourceFormat: "tsv" };
}

/**
 * Parse JSON content (array of objects, or single object wrapped in array).
 */
export function parseJson(content: string): ParsedContent {
  const parsed = JSON.parse(content);
  const items: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
  const rows = items.filter(
    (item): item is Record<string, unknown> =>
      item !== null && typeof item === "object" && !Array.isArray(item),
  );
  return { rows, sourceFormat: "json" };
}

/**
 * Parse JSONL (newline-delimited JSON) content.
 */
export function parseJsonl(content: string): ParsedContent {
  const rows: Array<Record<string, unknown>> = [];
  const lines = content.split(/\r?\n/).filter((l) => l.trim());
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj !== null && typeof obj === "object" && !Array.isArray(obj)) {
        rows.push(obj as Record<string, unknown>);
      }
    } catch {
      // Skip unparseable lines
    }
  }
  return { rows, sourceFormat: "jsonl" };
}

/**
 * Parse XLSX/XLS/ODS content from a Buffer.
 * Returns rows from the first sheet (or all sheets if multi-sheet).
 */
export function parseXlsx(buffer: Buffer): ParsedContent {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const allRows: Array<Record<string, unknown>> = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: null,
    });
    // Add sheet name as metadata if multiple sheets
    if (workbook.SheetNames.length > 1) {
      for (const row of rows) {
        row._sheet = sheetName;
      }
    }
    allRows.push(...rows);
  }

  return { rows: allRows, sourceFormat: "xlsx" };
}

/**
 * Parse a ZIP archive, extracting and parsing each supported file inside.
 * Returns all rows from all files, plus sub-file metadata.
 */
export async function parseZip(buffer: Buffer): Promise<ParsedContent> {
  // Dynamic import to keep adm-zip optional
  const AdmZip = (await import("adm-zip")).default;
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();

  const allRows: Array<Record<string, unknown>> = [];
  const subFiles: Array<{ fileName: string; parsed: ParsedContent }> = [];

  for (const entry of entries) {
    if (entry.isDirectory) continue;

    const ext = entry.entryName.split(".").pop()?.toLowerCase() ?? "";
    const content = entry.getData();

    let parsed: ParsedContent | null = null;

    try {
      switch (ext) {
        case "csv":
          parsed = parseCsv(content.toString("utf-8"));
          break;
        case "tsv":
        case "tab":
          parsed = parseTsv(content.toString("utf-8"));
          break;
        case "json":
          parsed = parseJson(content.toString("utf-8"));
          break;
        case "jsonl":
        case "ndjson":
          parsed = parseJsonl(content.toString("utf-8"));
          break;
        case "xlsx":
        case "xls":
        case "xlsm":
        case "ods":
          parsed = parseXlsx(content);
          break;
        // Skip unsupported files silently
      }
    } catch {
      // Skip files that fail to parse
    }

    if (parsed && parsed.rows.length > 0) {
      // Tag rows with source file name
      for (const row of parsed.rows) {
        row._source_file = entry.entryName;
      }
      allRows.push(...parsed.rows);
      subFiles.push({ fileName: entry.entryName, parsed });
    }
  }

  return { rows: allRows, sourceFormat: "zip", subFiles };
}

/**
 * Detect and parse file content based on extension or content sniffing.
 */
export function parseByExtension(content: string | Buffer, ext: string): ParsedContent | Promise<ParsedContent> {
  const normalized = ext.toLowerCase().replace(/^\./, "");

  switch (normalized) {
    case "csv":
      return parseCsv(typeof content === "string" ? content : content.toString("utf-8"));
    case "tsv":
    case "tab":
      return parseTsv(typeof content === "string" ? content : content.toString("utf-8"));
    case "json":
      return parseJson(typeof content === "string" ? content : content.toString("utf-8"));
    case "jsonl":
    case "ndjson":
      return parseJsonl(typeof content === "string" ? content : content.toString("utf-8"));
    case "xlsx":
    case "xls":
    case "xlsm":
    case "ods":
      return parseXlsx(Buffer.isBuffer(content) ? content : Buffer.from(content, "utf-8"));
    case "zip":
      return parseZip(Buffer.isBuffer(content) ? content : Buffer.from(content, "utf-8"));
    default:
      // Try content sniffing
      const text = typeof content === "string" ? content : content.toString("utf-8");
      const trimmed = text.trim();
      if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
        // Could be JSON or JSONL
        try { return parseJson(text); } catch { /* not JSON */ }
        return parseJsonl(text);
      }
      // Default to CSV
      return parseCsv(text);
  }
}
