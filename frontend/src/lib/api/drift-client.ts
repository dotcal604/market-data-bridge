import { fetchJson } from "./fetch-json";

const API_BASE = "/api";

export interface DriftReport {
  overall: {
    total_evals: number;
    evals_with_outcomes: number;
    accuracy_last_50: number | null;
    accuracy_last_20: number | null;
    accuracy_last_10: number | null;
  };
  models: Record<string, {
    total: number;
    with_outcomes: number;
    accuracy_last_50: number | null;
    accuracy_last_20: number | null;
    accuracy_last_10: number | null;
  }>;
  calibration: Record<string, {
    predicted_avg: number;
    actual_rate: number;
    error: number;
    count: number;
  }>;
}

export interface DriftAlert {
  id: number;
  alert_type: string;
  model_id: string | null;
  metric_value: number;
  threshold: number;
  message: string;
  created_at: string;
}

interface AgentResponse<T> {
  action: string;
  result: T;
}

export const driftClient = {
  async getReport(): Promise<DriftReport> {
    const response = await fetchJson<AgentResponse<DriftReport>>(
      `${API_BASE}/agent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "drift_report" }),
      }
    );
    return response.result;
  },

  async getAlerts(limit = 50): Promise<{ count: number; alerts: DriftAlert[] }> {
    const response = await fetchJson<AgentResponse<{ count: number; alerts: DriftAlert[] }>>(
      `${API_BASE}/agent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "drift_alerts", params: { limit } }),
      }
    );
    return response.result;
  },
};
