/**
 * src/db/database.ts — Barrel file
 *
 * All domain modules re-exported for backwards compatibility.
 * Existing imports like `import { insertOrder } from "../db/database.js"` continue to work.
 */

export { getDb, generateCorrelationId, isDbWritable, closeDb, db } from "./connection.js";
export * from "./orders.js";
export * from "./journal.js";
export * from "./account.js";
export * from "./collab.js";
export * from "./inbox.js";
export * from "./evals.js";
export * from "./eval-links.js";
export * from "./eval-analytics.js";
export * from "./weights.js";
export * from "./tradersync.js";
export * from "./holly.js";
export * from "./drift.js";
export * from "./sessions.js";
export * from "./analytics-jobs.js";
export * from "./flex.js";
