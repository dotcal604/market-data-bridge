import { fetchJson } from "./fetch-json";

const API_BASE = "/api";

// ── Types ────────────────────────────────────────────────────────────────

export interface OptimizerParams {
  trail_pct?: number;
  atr_multiplier?: number;
  atr_period?: number;
  tp_pct?: number;
  trigger_pct?: number;
  trail_pct_after?: number;
  volume_multiplier?: number;
  lookback_bars?: number;
  partial_tp_pct?: number;
  partial_size?: number;
  max_hold_minutes?: number;
}

export interface StrategyExitSummary {
  strategy: string;
  direction: string;
  exit_rule: string;
  params: OptimizerParams;
  trade_count: number;
  win_rate: number;
  profit_factor: number;
  sharpe: number;
  avg_hold_minutes: number;
  profitable: boolean;
  walk_forward_validated: boolean;
  walk_forward_sharpe?: number;
  walk_forward_pf?: number;
}

export interface ExitSuggestion {
  policy: {
    hard_stop: number;
    tp_ladder: Array<{ label: string; price: number; qty_pct: number }>;
    runner: {
      trail_pct: number;
      atr_multiple: number | null;
      time_stop_min: number | null;
      be_trail: boolean;
      post_be_trail_pct: number | null;
    };
    protect_trigger: {
      r_multiple: number;
      dollars_per_share: number | null;
      new_stop: string;
    };
    giveback_guard: {
      max_ratio: number;
      min_mfe_dollars: number;
    };
    archetype: string | null;
    source: string;
  };
  source: "holly_optimized" | "recommended_fallback";
  walk_forward_validated: boolean;
  optimizer_data?: {
    strategy_key: string;
    exit_rule: string;
    params: OptimizerParams;
    trade_count: number;
    win_rate: number;
    profit_factor: number;
    sharpe: number;
    avg_hold_minutes: number;
  };
  walk_forward?: {
    test_sharpe: number;
    test_pf: number;
    test_wr: number;
    method: string;
    n_folds: number | null;
  };
  notes: string[];
}

export interface OptimizerMeta {
  generated_at: string;
  data_range: string;
  total_trades: number;
  strategies_count: number;
  profitable_count: number;
  global_filters: {
    exclude_strategies: string[];
    min_stop_buffer_pct: number;
    price_range: [number, number];
  };
  walk_forward?: {
    generated_at: string;
    method: string;
    n_folds: number | null;
    robust_count: number;
    overfit_count: number;
    total_evaluated: number;
  };
}

interface AgentResponse<T> {
  action: string;
  result: T;
}

// ── Client ───────────────────────────────────────────────────────────────

export const exitOptimizerClient = {
  async getSummary(): Promise<{ count: number; strategies: StrategyExitSummary[] }> {
    const response = await fetchJson<AgentResponse<{ count: number; strategies: StrategyExitSummary[] }>>(
      `${API_BASE}/agent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "optimal_exit_summary" }),
      },
    );
    return response.result;
  },

  async getMeta(): Promise<OptimizerMeta> {
    const response = await fetchJson<AgentResponse<OptimizerMeta>>(
      `${API_BASE}/agent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "optimal_exit_meta" }),
      },
    );
    return response.result;
  },

  async suggestExits(params: {
    symbol: string;
    direction: "long" | "short";
    entry_price: number;
    stop_price: number;
    total_shares?: number;
    strategy?: string;
  }): Promise<ExitSuggestion> {
    const response = await fetchJson<AgentResponse<ExitSuggestion>>(
      `${API_BASE}/agent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "suggest_exits", params }),
      },
    );
    return response.result;
  },

  async reload(): Promise<{ reloaded: boolean; message: string }> {
    const response = await fetchJson<AgentResponse<{ reloaded: boolean; message: string }>>(
      `${API_BASE}/agent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "optimal_exit_reload" }),
      },
    );
    return response.result;
  },
};
