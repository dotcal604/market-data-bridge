/**
 * File Format Detector
 *
 * Identifies data type from content structure — works with pre-parsed rows
 * (from any source: CSV, TSV, XLSX, JSON, JSONL, API responses, MCP tools)
 * or raw string content.
 */

export type FileFormat =
  // CSV-specific (need raw string for existing importers)
  | "tradersync"         // TraderSync trade_data.csv export
  | "holly_alerts"       // Trade Ideas Alert Logging CSV
  | "holly_trades"       // Trade Ideas Holly trade export (non-standard CSV)
  // Data types (from any source format)
  | "tradersync_json"    // TraderSync-shaped trade objects
  | "holly_alerts_json"  // Holly alert objects
  | "journal"            // Trade journal entries
  | "watchlist"          // Symbol watchlist
  | "eval_outcomes"      // Evaluation outcomes
  | "screener_snapshot"  // Screener result snapshots
  | "generic"            // Catch-all for unknown structured data
  | "unknown";

export interface DetectionResult {
  format: FileFormat;
  confidence: number; // 0-1
  reason: string;
  /** For JSON/parsed formats, the pre-parsed data */
  parsedData?: unknown[];
}

// ── Key Markers ───────────────────────────────────────────────────────────

// TraderSync CSV has these distinctive columns
const TRADERSYNC_CSV_MARKERS = ["Status", "Symbol", "Open Date", "Close Date", "Entry Price", "Exit Price", "R-Multiple"];
const TRADERSYNC_CSV_MIN_MATCH = 4;

// Holly Alert Logging CSV columns (case-insensitive)
const HOLLY_ALERT_CSV_MARKERS = ["symbol", "strategy", "entry price", "stop price", "shares"];
const HOLLY_ALERT_CSV_ALT = ["ticker", "entry time", "alert time", "smart stop"];
const HOLLY_ALERT_CSV_MIN_MATCH = 3;

// Holly trade export — non-standard CSV pattern
const HOLLY_TRADE_PATTERN = /^\d{4},\w{3},\d{1,2},"[\d:]+,\d{4}"/;

// JSON/row key markers (lowercase)
const TRADERSYNC_KEYS = ["symbol", "entry_price", "exit_price", "open_date", "side"];
const HOLLY_ALERT_KEYS = ["symbol", "strategy", "entry_price", "stop_price"];
const JOURNAL_REQUIRED = ["reasoning"];
const JOURNAL_CONTEXT = ["symbol", "tags", "strategy_version", "setup_type", "confidence_rating", "rule_followed"];
const EVAL_OUTCOME_KEYS = ["evaluation_id", "trade_taken"];
const EVAL_OUTCOME_CONTEXT = ["r_multiple", "exit_reason", "actual_entry_price", "actual_exit_price"];
const SCREENER_KEYS = ["symbol", "price"];
const SCREENER_CONTEXT = ["change_pct", "volume", "market_cap", "relative_volume", "screener_id"];
const WATCHLIST_INDICATORS = ["symbol"];

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Detect data type from raw string content (CSV, JSON, JSONL, etc.)
 */
export function detectFormat(content: string): DetectionResult {
  const trimmed = content.trim();
  if (!trimmed) {
    return { format: "unknown", confidence: 0, reason: "Empty content" };
  }

  // Try JSON/JSONL if content starts with [ or {
  if (trimmed[0] === "[" || trimmed[0] === "{") {
    return detectFromJsonContent(trimmed);
  }

  return detectFromCsvContent(trimmed);
}

/**
 * Detect data type from pre-parsed rows (from XLSX, API responses, etc.)
 * This is the universal detection path — works regardless of source format.
 */
export function detectFromRows(rows: Array<Record<string, unknown>>): DetectionResult {
  if (rows.length === 0) {
    return { format: "unknown", confidence: 0, reason: "No rows to analyze" };
  }

  // Collect all keys from sample (lowercase)
  const sample = rows.slice(0, 10);
  const sampleKeys = new Set<string>();
  for (const row of sample) {
    for (const key of Object.keys(row)) {
      sampleKeys.add(key.toLowerCase());
    }
  }

  // Check _type hint first (explicit tagging from MCP/API sources)
  const firstRow = sample[0];
  if (typeof firstRow._type === "string") {
    const hint = firstRow._type.toLowerCase();
    if (hint.includes("journal")) return { format: "journal", confidence: 1, reason: `Explicit _type: ${firstRow._type}`, parsedData: rows };
    if (hint.includes("watchlist")) return { format: "watchlist", confidence: 1, reason: `Explicit _type: ${firstRow._type}`, parsedData: rows };
    if (hint.includes("outcome")) return { format: "eval_outcomes", confidence: 1, reason: `Explicit _type: ${firstRow._type}`, parsedData: rows };
    if (hint.includes("screener")) return { format: "screener_snapshot", confidence: 1, reason: `Explicit _type: ${firstRow._type}`, parsedData: rows };
    if (hint.includes("tradersync") || hint.includes("trade")) return { format: "tradersync_json", confidence: 1, reason: `Explicit _type: ${firstRow._type}`, parsedData: rows };
    if (hint.includes("holly") || hint.includes("alert")) return { format: "holly_alerts_json", confidence: 1, reason: `Explicit _type: ${firstRow._type}`, parsedData: rows };
    // Explicit type we don't recognize → generic with the type tag
    return { format: "generic", confidence: 0.9, reason: `Explicit _type: ${firstRow._type} (unrecognized, storing as generic)`, parsedData: rows };
  }

  // Eval outcomes (most specific — requires evaluation_id)
  const outcomeMatches = EVAL_OUTCOME_KEYS.filter((k) => sampleKeys.has(k));
  const outcomeContext = EVAL_OUTCOME_CONTEXT.filter((k) => sampleKeys.has(k));
  if (outcomeMatches.length >= 2) {
    return { format: "eval_outcomes", confidence: 0.95, reason: `Matched eval outcome keys: ${[...outcomeMatches, ...outcomeContext].join(", ")}`, parsedData: rows };
  }

  // TraderSync-style trades (needs entry+exit+date+side)
  const tsMatches = TRADERSYNC_KEYS.filter((k) => sampleKeys.has(k));
  if (tsMatches.length >= 4) {
    return { format: "tradersync_json", confidence: tsMatches.length / TRADERSYNC_KEYS.length, reason: `Matched TraderSync keys: ${tsMatches.join(", ")}`, parsedData: rows };
  }

  // Holly alerts (needs symbol+strategy+entry_price+stop)
  const hollyMatches = HOLLY_ALERT_KEYS.filter((k) => sampleKeys.has(k));
  if (hollyMatches.length >= 3) {
    return { format: "holly_alerts_json", confidence: hollyMatches.length / HOLLY_ALERT_KEYS.length, reason: `Matched Holly alert keys: ${hollyMatches.join(", ")}`, parsedData: rows };
  }

  // Journal entries (requires "reasoning")
  const journalReq = JOURNAL_REQUIRED.filter((k) => sampleKeys.has(k));
  const journalCtx = JOURNAL_CONTEXT.filter((k) => sampleKeys.has(k));
  if (journalReq.length >= 1 && (journalCtx.length >= 1 || sampleKeys.has("symbol"))) {
    return { format: "journal", confidence: Math.min((journalReq.length + journalCtx.length * 0.3) / 2, 1), reason: `Matched journal keys: ${[...journalReq, ...journalCtx].join(", ")}`, parsedData: rows };
  }

  // Screener snapshots (symbol+price with change/volume context)
  const screenerReq = SCREENER_KEYS.filter((k) => sampleKeys.has(k));
  const screenerCtx = SCREENER_CONTEXT.filter((k) => sampleKeys.has(k));
  if (screenerReq.length >= 2 && screenerCtx.length >= 1) {
    return { format: "screener_snapshot", confidence: Math.min((screenerReq.length + screenerCtx.length) / 5, 1), reason: `Matched screener keys: ${[...screenerReq, ...screenerCtx].join(", ")}`, parsedData: rows };
  }

  // Watchlist — simple: only has "symbol" (and maybe "notes", "list_name")
  const wlMatches = WATCHLIST_INDICATORS.filter((k) => sampleKeys.has(k));
  if (wlMatches.length >= 1 && sampleKeys.size <= 4) {
    return { format: "watchlist", confidence: 0.7, reason: `Simple symbol list (${sampleKeys.size} keys)`, parsedData: rows };
  }

  // Generic — structured data we can store but don't recognize
  if (sampleKeys.size > 0) {
    return { format: "generic", confidence: 0.5, reason: `Unrecognized structure with ${sampleKeys.size} keys: ${[...sampleKeys].slice(0, 8).join(", ")}`, parsedData: rows };
  }

  return { format: "unknown", confidence: 0, reason: "No recognizable structure" };
}

// ── Internal ──────────────────────────────────────────────────────────────

function detectFromJsonContent(content: string): DetectionResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (e: any) {
    return { format: "unknown", confidence: 0, reason: `Invalid JSON: ${e.message}` };
  }

  // Wrap single object in array
  const items: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
  if (items.length === 0) {
    return { format: "unknown", confidence: 0, reason: "Empty JSON array" };
  }

  // Check if all items are strings → watchlist (simple symbol list)
  if (items.every((item) => typeof item === "string")) {
    const symbols = items as string[];
    const looksLikeSymbols = symbols.every((s) => s.length <= 20 && /^[A-Z0-9.\-^]+$/i.test(s.trim()));
    if (looksLikeSymbols) {
      return {
        format: "watchlist",
        confidence: 0.9,
        reason: `JSON array of ${symbols.length} symbol strings`,
        parsedData: symbols.map((s) => ({ symbol: s.trim().toUpperCase() })),
      };
    }
  }

  // Must be objects for row-based detection
  const rows = items.filter(
    (item): item is Record<string, unknown> =>
      item !== null && typeof item === "object" && !Array.isArray(item),
  );
  if (rows.length === 0) {
    return { format: "unknown", confidence: 0, reason: "JSON array does not contain objects" };
  }

  return detectFromRows(rows);
}

function detectFromCsvContent(content: string): DetectionResult {
  const lines = content.split(/\r?\n/);
  if (lines.length < 2) {
    return { format: "unknown", confidence: 0, reason: "File has fewer than 2 lines" };
  }

  // Check for Holly trade export (non-standard CSV) first
  for (let i = 1; i < Math.min(lines.length, 5); i++) {
    if (HOLLY_TRADE_PATTERN.test(lines[i])) {
      return { format: "holly_trades", confidence: 0.95, reason: "Matched Holly trade CSV pattern (quoted compound datetime fields)" };
    }
  }

  // Parse header columns
  const headerLine = lines[0];
  const headers = headerLine.split(",").map((h) => h.trim().replace(/^"|"$/g, ""));

  // Check TraderSync CSV
  const tsMatches = TRADERSYNC_CSV_MARKERS.filter((m) => headers.some((h) => h === m));
  if (tsMatches.length >= TRADERSYNC_CSV_MIN_MATCH) {
    return {
      format: "tradersync",
      confidence: Math.min(tsMatches.length / TRADERSYNC_CSV_MARKERS.length, 1),
      reason: `Matched ${tsMatches.length}/${TRADERSYNC_CSV_MARKERS.length} TraderSync columns: ${tsMatches.join(", ")}`,
    };
  }

  // Check Holly alerts CSV
  const headersLower = headers.map((h) => h.toLowerCase());
  const hollyMatches = HOLLY_ALERT_CSV_MARKERS.filter((m) => headersLower.includes(m));
  const hollyAlt = HOLLY_ALERT_CSV_ALT.filter((m) => headersLower.includes(m));
  const totalHolly = hollyMatches.length + hollyAlt.length;
  if (totalHolly >= HOLLY_ALERT_CSV_MIN_MATCH) {
    return {
      format: "holly_alerts",
      confidence: Math.min(totalHolly / (HOLLY_ALERT_CSV_MARKERS.length + HOLLY_ALERT_CSV_ALT.length) + 0.3, 1),
      reason: `Matched ${totalHolly} Holly alert columns: ${[...hollyMatches, ...hollyAlt].join(", ")}`,
    };
  }

  // Check if it's a simple symbol list (one column or one symbol per line)
  if (headers.length === 1 || (headers.length <= 2 && headersLower.includes("symbol"))) {
    const dataLines = lines.slice(1).filter((l) => l.trim());
    const allSymbolLike = dataLines.every((l) => /^[A-Z0-9.\-^,\t]{1,20}$/i.test(l.trim()));
    if (allSymbolLike && dataLines.length > 0) {
      return { format: "watchlist", confidence: 0.8, reason: `Simple symbol list CSV (${dataLines.length} symbols)` };
    }
  }

  return { format: "unknown", confidence: 0, reason: `No known format detected. Headers: ${headers.slice(0, 8).join(", ")}` };
}
