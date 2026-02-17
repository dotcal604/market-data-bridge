import type { DriftReport, DriftAlert } from "./types";

const BASE = "/api/agent";

interface AgentResponse<T> {
  action: string;
  result: T;
  error?: string;
}

export const driftClient = {
  async getDriftReport(): Promise<DriftReport> {
    const response = await fetch(BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "drift_report" }),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch drift report: ${response.statusText}`);
    }

    const data: AgentResponse<DriftReport> = await response.json();
    if (data.error) {
      throw new Error(data.error);
    }

    return data.result;
  },

  async getDriftAlerts(limit = 50): Promise<{ count: number; alerts: DriftAlert[] }> {
    const response = await fetch(BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "drift_alerts", params: { limit } }),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch drift alerts: ${response.statusText}`);
    }

    const data: AgentResponse<{ count: number; alerts: DriftAlert[] }> = await response.json();
    if (data.error) {
      throw new Error(data.error);
    }

    return data.result;
  },
};
