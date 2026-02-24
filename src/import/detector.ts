/**
 * File Format Detector
 *
 * Identifies the type of data file (TraderSync CSV, Holly alerts, Holly trades, generic)
 * by examining column headers and content patterns.
 */

export type FileFormat =
  | "tradersync"    // TraderSync trade_data.csv export
  | "holly_alerts"  // Trade Ideas Alert Logging CSV
  | "holly_trades"  // Trade Ideas Holly trade export (non-standard CSV)
  | "unknown";

export interface DetectionResult {
  format: FileFormat;
  confidence: number; // 0-1
  reason: string;
}

// TraderSync CSV has these distinctive columns
const TRADERSYNC_MARKERS = ["Status", "Symbol", "Open Date", "Close Date", "Entry Price", "Exit Price", "R-Multiple"];
const TRADERSYNC_MIN_MATCH = 4;

// Holly Alert Logging CSV has these columns (case-insensitive matching)
const HOLLY_ALERT_MARKERS = ["symbol", "strategy", "entry price", "stop price", "shares"];
const HOLLY_ALERT_ALT_MARKERS = ["ticker", "entry time", "alert time", "smart stop"];
const HOLLY_ALERT_MIN_MATCH = 3;

// Holly trade export has a distinctive non-standard format with quoted compound fields
// Pattern: YYYY,Mon,DD,"HH:MM:SS,YYYY",Mon,DD,"HH:MM:SS,...
const HOLLY_TRADE_PATTERN = /^\d{4},\w{3},\d{1,2},"[\d:]+,\d{4}"/;

/**
 * Detect the format of a CSV file from its content.
 */
export function detectFormat(content: string): DetectionResult {
  const trimmed = content.trim();
  if (!trimmed) {
    return { format: "unknown", confidence: 0, reason: "Empty content" };
  }

  const lines = trimmed.split(/\r?\n/);
  if (lines.length < 2) {
    return { format: "unknown", confidence: 0, reason: "File has fewer than 2 lines" };
  }

  const headerLine = lines[0];

  // Check for Holly trade export (non-standard CSV) — check data lines, not header
  // The header also follows the quoted-compound pattern
  for (let i = 1; i < Math.min(lines.length, 5); i++) {
    if (HOLLY_TRADE_PATTERN.test(lines[i])) {
      return { format: "holly_trades", confidence: 0.95, reason: "Matched Holly trade CSV pattern (quoted compound datetime fields)" };
    }
  }

  // Parse header columns for standard CSV detection
  const headers = headerLine.split(",").map((h) => h.trim().replace(/^"|"$/g, ""));

  // Check TraderSync
  const tsMatches = TRADERSYNC_MARKERS.filter((m) =>
    headers.some((h) => h === m),
  );
  if (tsMatches.length >= TRADERSYNC_MIN_MATCH) {
    const confidence = Math.min(tsMatches.length / TRADERSYNC_MARKERS.length, 1);
    return {
      format: "tradersync",
      confidence,
      reason: `Matched ${tsMatches.length}/${TRADERSYNC_MARKERS.length} TraderSync columns: ${tsMatches.join(", ")}`,
    };
  }

  // Check Holly alerts (case-insensitive)
  const headersLower = headers.map((h) => h.toLowerCase());
  const hollyMatches = HOLLY_ALERT_MARKERS.filter((m) =>
    headersLower.includes(m),
  );
  const hollyAltMatches = HOLLY_ALERT_ALT_MARKERS.filter((m) =>
    headersLower.includes(m),
  );
  const totalHollyMatches = hollyMatches.length + hollyAltMatches.length;

  if (totalHollyMatches >= HOLLY_ALERT_MIN_MATCH) {
    const maxPossible = HOLLY_ALERT_MARKERS.length + HOLLY_ALERT_ALT_MARKERS.length;
    const confidence = Math.min(totalHollyMatches / maxPossible + 0.3, 1);
    return {
      format: "holly_alerts",
      confidence,
      reason: `Matched ${totalHollyMatches} Holly alert columns: ${[...hollyMatches, ...hollyAltMatches].join(", ")}`,
    };
  }

  return { format: "unknown", confidence: 0, reason: `No known format detected. Headers: ${headers.slice(0, 8).join(", ")}` };
}
