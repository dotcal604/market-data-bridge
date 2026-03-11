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

export interface FlexStats {
  total_trades: number;
  unique_symbols: number;
  import_batches: number;
  first_trade: string | null;
  last_trade: string | null;
  last_import: string | null;
}

interface AgentResponse<T> {
  action: string;
  result: T;
}

export const flexClient = {
  async fetchAndImport(): Promise<FlexImportResult> {
    const response = await fetchJson<AgentResponse<FlexImportResult>>(
      `${API_BASE}/agent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "flex_fetch" }),
      }
    );
    return response.result;
  },

  async getStats(): Promise<FlexStats> {
    const response = await fetchJson<AgentResponse<FlexStats>>(
      `${API_BASE}/agent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "flex_stats" }),
      }
    );
    return response.result;
  },
};
