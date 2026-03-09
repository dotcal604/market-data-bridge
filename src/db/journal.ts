/**
 * Trade journal domain module.
 */

import { getStmts } from "./connection.js";
const stmts = getStmts();

/**
 * Insert a new trade journal entry.
 * @param data Journal entry details
 * @returns ID of the new entry
 */
export function insertJournalEntry(data: {
  symbol?: string;
  strategy_version?: string;
  reasoning: string;
  ai_recommendations?: string;
  tags?: string[];
  confidence_rating?: number;
  rule_followed?: boolean;
  setup_type?: string;
  spy_price?: number;
  vix_level?: number;
  gap_pct?: number;
  relative_volume?: number;
  time_of_day?: string;
  session_type?: string;
  spread_pct?: number;
}): number {
  const info = stmts.insertJournal.run({
    symbol: data.symbol ?? null,
    strategy_version: data.strategy_version ?? null,
    reasoning: data.reasoning,
    ai_recommendations: data.ai_recommendations ?? null,
    tags: data.tags ? JSON.stringify(data.tags) : null,
    confidence_rating: data.confidence_rating ?? null,
    rule_followed: data.rule_followed != null ? (data.rule_followed ? 1 : 0) : null,
    setup_type: data.setup_type ?? null,
    spy_price: data.spy_price ?? null,
    vix_level: data.vix_level ?? null,
    gap_pct: data.gap_pct ?? null,
    relative_volume: data.relative_volume ?? null,
    time_of_day: data.time_of_day ?? null,
    session_type: data.session_type ?? null,
    spread_pct: data.spread_pct ?? null,
  });
  const entryId = Number(info.lastInsertRowid);

  // Emit journal post to WebSocket clients asynchronously (with sequence ID for ordering)
  // Use setImmediate to schedule broadcast after DB write is complete
  setImmediate(() => {
    try {
      const { wsBroadcastWithSequence, getNextSequenceId } = require("../ws/server.js");
      const seqId = getNextSequenceId();
      wsBroadcastWithSequence("journal_posted", {
        type: "journal",
        action: "posted",
        entryId,
        symbol: data.symbol ?? null,
        reasoning: data.reasoning,
        timestamp: new Date().toISOString(),
      }, seqId);
    } catch {
      // WebSocket not available — this is non-fatal
    }
  });

  return entryId;
}

/**
 * Update an existing journal entry.
 * @param id Journal entry ID
 * @param data Fields to update
 */
export function updateJournalEntry(id: number, data: { outcome_tags?: string[]; notes?: string }) {
  stmts.updateJournal.run({
    id,
    outcome_tags: data.outcome_tags ? JSON.stringify(data.outcome_tags) : null,
    notes: data.notes ?? null,
  });
}

/**
 * Query trade journal entries.
 * @param opts Filters (symbol, strategy, limit)
 * @returns Array of journal entries
 */
export function queryJournal(opts: { symbol?: string; strategy?: string; limit?: number } = {}) {
  const limit = opts.limit ?? 100;
  if (opts.symbol) return stmts.queryJournalBySymbol.all(opts.symbol, limit);
  if (opts.strategy) return stmts.queryJournalByStrategy.all(opts.strategy, limit);
  return stmts.queryJournal.all(limit);
}

/**
 * Get a journal entry by ID.
 * @param id Entry ID
 * @returns Journal entry or undefined
 */
export function getJournalById(id: number) {
  return stmts.getJournalById.get(id);
}
