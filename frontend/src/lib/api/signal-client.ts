import { fetchJson } from "./fetch-json";

const API_BASE = "/api";

export interface Signal {
  id: number;
  holly_alert_id: number | null;
  evaluation_id: string | null;
  symbol: string;
  direction: "long" | "short";
  strategy: string | null;
  ensemble_score: number | null;
  should_trade: number;
  prefilter_passed: number;
  created_at: string;
}

export interface SignalFeedResponse {
  count: number;
  signals: Signal[];
}

export interface SignalStats {
  total_signals: number;
  tradeable_signals: number;
  blocked_signals: number;
  long_signals: number;
  short_signals: number;
}

export interface AutoEvalStatus {
  enabled: boolean;
  running: number;
  maxConcurrent: number;
  dedupWindowMin: number;
}

interface AgentResponse<T> {
  action: string;
  result: T;
}

export const signalClient = {
  async getSignals(params: {
    symbol?: string;
    direction?: string;
    since?: string;
    limit?: number;
  } = {}): Promise<SignalFeedResponse> {
    const response = await fetchJson<AgentResponse<SignalFeedResponse>>(
      `${API_BASE}/agent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "signal_feed",
          params: { limit: 50, ...params },
        }),
      }
    );
    return response.result;
  },

  async getStats(): Promise<SignalStats> {
    const response = await fetchJson<AgentResponse<SignalStats>>(
      `${API_BASE}/agent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "signal_stats" }),
      }
    );
    return response.result;
  },

  async getAutoEvalStatus(): Promise<AutoEvalStatus> {
    const response = await fetchJson<AgentResponse<AutoEvalStatus>>(
      `${API_BASE}/agent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "auto_eval_status" }),
      }
    );
    return response.result;
  },

  async toggleAutoEval(enabled: boolean): Promise<AutoEvalStatus> {
    const response = await fetchJson<AgentResponse<AutoEvalStatus>>(
      `${API_BASE}/agent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "auto_eval_toggle",
          params: { enabled },
        }),
      }
    );
    return response.result;
  },
};
