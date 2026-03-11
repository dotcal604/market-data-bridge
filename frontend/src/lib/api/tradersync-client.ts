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

interface AgentResponse<T> {
  action: string;
  result: T;
}

export const tradersyncClient = {
  async importCSV(csv: string): Promise<TraderSyncImportResult> {
    const response = await fetchJson<AgentResponse<TraderSyncImportResult>>(
      `${API_BASE}/agent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "tradersync_import", params: { csv } }),
      }
    );
    return response.result;
  },

  async getStats(): Promise<TraderSyncStats> {
    const response = await fetchJson<AgentResponse<TraderSyncStats>>(
      `${API_BASE}/agent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "tradersync_stats" }),
      }
    );
    return response.result;
  },
};
