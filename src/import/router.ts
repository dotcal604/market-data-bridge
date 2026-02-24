/**
 * Import Router
 *
 * Routes detected file formats to the appropriate importer.
 * Tracks all imports in the import_history table for audit.
 */

import { randomUUID } from "crypto";
import { detectFormat, type FileFormat } from "./detector.js";
import { importTraderSyncCSV } from "../tradersync/importer.js";
import { importHollyAlerts } from "../holly/importer.js";
import { importHollyTrades } from "../holly/trade-importer.js";
import { insertImportRecord, updateImportRecord } from "./history.js";
import { logger } from "../logging.js";

const log = logger.child({ module: "import-router" });

export interface ImportFileResult {
  import_id: string;
  file_name: string;
  format: FileFormat;
  confidence: number;
  detection_reason: string;
  inserted: number;
  skipped: number;
  errors: string[];
  duration_ms: number;
}

/**
 * Import a file by detecting its format and routing to the right importer.
 * Records the import in history for audit trail.
 */
export function importFile(content: string, fileName: string): ImportFileResult {
  const startMs = Date.now();
  const importId = randomUUID().slice(0, 12);
  const detection = detectFormat(content);

  log.info({ importId, fileName, format: detection.format, confidence: detection.confidence }, "Import started");

  // Record start
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
    const durationMs = Date.now() - startMs;
    updateImportRecord(importId, {
      status: "failed",
      errors: JSON.stringify([`Unknown format: ${detection.reason}`]),
      duration_ms: durationMs,
    });
    return {
      import_id: importId,
      file_name: fileName,
      format: "unknown",
      confidence: 0,
      detection_reason: detection.reason,
      inserted: 0,
      skipped: 0,
      errors: [`Unknown format: ${detection.reason}`],
      duration_ms: durationMs,
    };
  }

  try {
    let inserted = 0;
    let skipped = 0;
    let errors: string[] = [];

    switch (detection.format) {
      case "tradersync": {
        const result = importTraderSyncCSV(content);
        inserted = result.inserted;
        skipped = result.skipped;
        errors = result.errors;
        break;
      }
      case "holly_alerts": {
        const result = importHollyAlerts(content);
        inserted = result.inserted;
        skipped = result.skipped;
        errors = result.errors;
        break;
      }
      case "holly_trades": {
        const result = importHollyTrades(content, importId);
        inserted = result.imported;
        skipped = result.skipped;
        errors = result.error_samples;
        break;
      }
    }

    const durationMs = Date.now() - startMs;

    updateImportRecord(importId, {
      status: errors.length > 0 && inserted === 0 ? "failed" : "completed",
      inserted,
      skipped,
      errors: JSON.stringify(errors),
      duration_ms: durationMs,
    });

    log.info({ importId, fileName, format: detection.format, inserted, skipped, errors: errors.length, durationMs }, "Import completed");

    return {
      import_id: importId,
      file_name: fileName,
      format: detection.format,
      confidence: detection.confidence,
      detection_reason: detection.reason,
      inserted,
      skipped,
      errors,
      duration_ms: durationMs,
    };
  } catch (e: any) {
    const durationMs = Date.now() - startMs;
    const errMsg = e.message ?? String(e);
    updateImportRecord(importId, {
      status: "failed",
      errors: JSON.stringify([errMsg]),
      duration_ms: durationMs,
    });
    log.error({ importId, fileName, err: errMsg }, "Import failed");
    return {
      import_id: importId,
      file_name: fileName,
      format: detection.format,
      confidence: detection.confidence,
      detection_reason: detection.reason,
      inserted: 0,
      skipped: 0,
      errors: [errMsg],
      duration_ms: durationMs,
    };
  }
}
