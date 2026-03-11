import { fetchJson } from "./fetch-json";

const API_BASE = "/api";

export interface TraderSyncImportResult {
  batch_id: string;
  total_parsed: number;
  inserted: number;
  skipped: number;
  errors: string[];
}

/** Matches the SQL shape returned by getTraderSyncStats() in src/db/tradersync.ts */
export interface TraderSyncStats {
  total_trades: number;
  wins: number;
  losses: number;
  win_rate: number | null;
  avg_r: number | null;
  total_pnl: number | null;
  avg_pnl: number | null;
  total_net: number | null;
  unique_symbols: number;
  first_trade: string | null;
  last_trade: string | null;
  import_batches: number;
}

export const tradersyncClient = {
  async importCSV(csv: string): Promise<TraderSyncImportResult> {
    return fetchJson<TraderSyncImportResult>(`${API_BASE}/tradersync/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csv }),
    });
  },

  async getStats(): Promise<TraderSyncStats> {
    return fetchJson<TraderSyncStats>(`${API_BASE}/tradersync/stats`);
  },
};
