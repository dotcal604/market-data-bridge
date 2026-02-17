import { fetchJson } from "./fetch-json";

const API_BASE = "/api";

export interface HollyAlert {
  id: number;
  alert_time: string;
  symbol: string;
  strategy: string | null;
  entry_price: number | null;
  stop_price: number | null;
  shares: number | null;
  last_price: number | null;
  segment: string | null;
  extra: string | null;
  import_batch: string | null;
  imported_at: string;
}

export interface HollyAlertsResponse {
  count: number;
  alerts: HollyAlert[];
}

export interface HollyStats {
  total_alerts: number;
  unique_symbols: number;
  unique_strategies: number;
  first_alert: string | null;
  last_alert: string | null;
  import_batches: number;
  days_with_alerts: number;
}

interface AgentResponse<T> {
  action: string;
  result: T;
}

export const hollyClient = {
  async getAlerts(params: {
    symbol?: string;
    strategy?: string;
    since?: string;
    limit?: number;
  } = {}): Promise<HollyAlertsResponse> {
    const response = await fetchJson<AgentResponse<HollyAlertsResponse>>(
      `${API_BASE}/agent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "holly_alerts",
          params: { limit: 50, ...params },
        }),
      }
    );
    return response.result;
  },

  async getStats(): Promise<HollyStats> {
    const response = await fetchJson<AgentResponse<HollyStats>>(
      `${API_BASE}/agent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "holly_stats",
        }),
      }
    );
    return response.result;
  },
};
