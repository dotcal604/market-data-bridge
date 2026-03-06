import { fetchJson } from "./fetch-json";

const API_BASE = "/api";

// ── Types ──

export interface AnalyticsOverview {
  total_trades: number;
  win_rate: number;
  avg_pnl: number;
  total_pnl: number;
  sharpe: number;
  profit_factor: number;
  years: number;
  strategies: number;
  date_range: { start: string; end: string };
}

export interface FilterImpact {
  name: string;
  key: string;
  trades: number;
  retained_pct: number;
  wr: number;
  wr_lift: number;
  avg_pnl: number;
  total_pnl: number;
}

export interface FullStack {
  trades: number;
  wr: number;
  avg_pnl: number;
  total_pnl: number;
}

export interface EquityCurvePoint {
  n: number;
  pnl: number;
}

export interface EquityCurveSeries {
  points: EquityCurvePoint[];
  trades: number;
  wr: number;
}

export interface TODPerformance {
  bucket: string;
  trades: number;
  wr: number;
  avg_pnl: number;
  total_pnl: number;
}

export interface RegimePerformance {
  regime: string;
  trades: number;
  wr: number;
  avg_pnl: number;
  total_pnl: number;
}

export interface StrategyRow {
  strategy: string;
  trades: number;
  wr: number;
  avg_pnl: number;
  total_pnl: number;
  avg_hold: number;
  sharpe: number;
  profit_factor: number;
}

export interface YoYPerformance {
  year: number;
  trades: number;
  wr: number;
  avg_pnl: number;
  total_pnl: number;
}

export interface FilterDistribution {
  passing: number;
  trades: number;
}

export interface HollyAnalyticsDashboard {
  overview: AnalyticsOverview;
  filter_impact: FilterImpact[];
  full_stack: FullStack;
  equity_curves: Record<string, EquityCurveSeries>;
  tod_performance: TODPerformance[];
  regime_performance: RegimePerformance[];
  strategy_leaderboard: StrategyRow[];
  yoy_performance: YoYPerformance[];
  filter_distribution: FilterDistribution[];
}

// ── Client ──

interface AgentResponse<T> {
  action: string;
  result: T;
}

export const hollyAnalyticsClient = {
  async getDashboard(): Promise<HollyAnalyticsDashboard> {
    const response = await fetchJson<AgentResponse<HollyAnalyticsDashboard>>(
      `${API_BASE}/agent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "holly_analytics_dashboard" }),
      }
    );
    return response.result;
  },
};
