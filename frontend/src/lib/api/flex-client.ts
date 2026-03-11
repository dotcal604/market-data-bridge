import { fetchJson } from "./fetch-json";

const API_BASE = "/api";

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

/** Matches the SQL shape returned by getFlexStats() in src/db/flex.ts */
export interface FlexStats {
  total_trades: number;
  unique_symbols: number;
  accounts: number;
  total_bought: number;
  total_sold: number;
  total_commission: number;
  total_realized_pnl: number;
  total_net_cash: number;
  first_trade: string | null;
  last_trade: string | null;
  import_batches: number;
}

export const flexClient = {
  async fetchAndImport(): Promise<FlexImportResult> {
    return fetchJson<FlexImportResult>(`${API_BASE}/flex/fetch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
  },

  async importContent(content: string): Promise<FlexImportResult> {
    return fetchJson<FlexImportResult>(`${API_BASE}/flex/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
  },

  async getStats(): Promise<FlexStats> {
    return fetchJson<FlexStats>(`${API_BASE}/flex/stats`);
  },
};
