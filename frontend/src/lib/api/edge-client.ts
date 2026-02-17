import { fetchJson } from "./fetch-json";

const API_BASE = "/api";

export interface RollingMetrics {
  date: string;
  cumulative_trades: number;
  rolling_win_rate: number;
  rolling_avg_r: number;
  rolling_sharpe: number;
  rolling_sortino: number;
  rolling_max_dd: number;
  equity_curve: number;
}

export interface CurrentStats {
  win_rate: number;
  avg_r: number;
  sharpe: number;
  sortino: number;
  max_drawdown: number;
  profit_factor: number;
  total_trades: number;
  expectancy: number;
  edge_score: number;
}

export interface WalkForwardWindow {
  train_start: string;
  train_end: string;
  test_start: string;
  test_end: string;
  train_size: number;
  test_size: number;
  test_win_rate: number;
  test_avg_r: number;
  test_sharpe: number;
  optimal_weights: { claude: number; gpt4o: number; gemini: number; k: number };
}

export interface WalkForwardResult {
  windows: WalkForwardWindow[];
  aggregate: {
    oos_win_rate: number;
    oos_avg_r: number;
    oos_sharpe: number;
    total_oos_trades: number;
    total_windows: number;
    edge_stable: boolean;
    edge_decay_detected: boolean;
  };
}

export interface FeatureAttribution {
  feature: string;
  win_rate_when_high: number;
  win_rate_when_low: number;
  lift: number;
  sample_high: number;
  sample_low: number;
  significant: boolean;
}

export interface EdgeReport {
  rolling_metrics: RollingMetrics[];
  current: CurrentStats;
  walk_forward: WalkForwardResult | null;
  feature_attribution: FeatureAttribution[];
}

interface AgentResponse<T> {
  action: string;
  result: T;
}

export const edgeClient = {
  async getReport(days = 90): Promise<EdgeReport> {
    const response = await fetchJson<AgentResponse<EdgeReport>>(
      `${API_BASE}/agent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "edge_report",
          params: { days, include_walk_forward: true },
        }),
      }
    );
    return response.result;
  },

  async getWalkForward(days = 180): Promise<WalkForwardResult> {
    const response = await fetchJson<AgentResponse<WalkForwardResult>>(
      `${API_BASE}/agent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "walk_forward",
          params: { days },
        }),
      }
    );
    return response.result;
  },
};
