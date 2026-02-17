import type {
  HollyAlertsResponse,
  HollyStats,
  HollySymbolsResponse,
  AgentResponse,
} from "./types";

/**
 * Holly AI Alerts API client
 * Calls POST /api/agent with action-based dispatcher pattern
 */

const BASE = "/api/agent";

async function agentRequest<T>(action: string, params?: Record<string, unknown>): Promise<T> {
  const res = await fetch(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, params: params ?? {} }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }

  const data = (await res.json()) as AgentResponse<T>;
  return data.result;
}

export const hollyClient = {
  /**
   * Fetch recent Holly alerts with optional filters
   */
  async getAlerts(params?: {
    symbol?: string;
    strategy?: string;
    limit?: number;
    since?: string;
  }): Promise<HollyAlertsResponse> {
    return agentRequest<HollyAlertsResponse>("holly_alerts", params);
  },

  /**
   * Fetch Holly alert statistics
   */
  async getStats(): Promise<HollyStats> {
    return agentRequest<HollyStats>("holly_stats");
  },

  /**
   * Fetch latest Holly symbols
   */
  async getSymbols(limit = 20): Promise<HollySymbolsResponse> {
    return agentRequest<HollySymbolsResponse>("holly_symbols", { limit });
  },
};
