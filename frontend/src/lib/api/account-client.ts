import type { AccountSummaryResponse, PositionsResponse, FlattenConfig, FlattenResult, IntradayPnLResponse } from "./types";

const API_BASE = "/api";

async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }
  return res.json();
}

async function postJSON<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }
  return res.json();
}

export interface Quote {
  symbol: string;
  bid: number | null;
  ask: number | null;
  last: number | null;
  source: string;
}

export interface PortfolioExposure {
  grossExposure: number;
  netExposure: number;
  percentDeployed: number;
  largestPositionPercent: number;
  largestPosition: string | null;
  sectorBreakdown: Record<string, number>;
  betaWeightedExposure: number;
  portfolioHeat: number;
  positionCount: number;
  netLiquidation: number;
}

export const accountClient = {
  async getSummary(): Promise<AccountSummaryResponse> {
    return fetchJSON<AccountSummaryResponse>(`${API_BASE}/account/summary`);
  },

  async getPositions(): Promise<PositionsResponse> {
    return fetchJSON<PositionsResponse>(`${API_BASE}/account/positions`);
  },

  async getQuote(symbol: string): Promise<Quote> {
    return fetchJSON<Quote>(`${API_BASE}/quote/${symbol}`, { cache: "no-store" });
  },

  async getFlattenConfig(): Promise<FlattenConfig> {
    return fetchJSON<FlattenConfig>(`${API_BASE}/flatten/config`);
  },

  async setFlattenEnabled(enabled: boolean): Promise<{ status: string }> {
    return postJSON<{ status: string }>(`${API_BASE}/flatten/enable`, { enabled });
  },

  async flattenAllPositions(): Promise<FlattenResult> {
    return postJSON<FlattenResult>(`${API_BASE}/positions/flatten`);
  },

  async getIntradayPnL(): Promise<IntradayPnLResponse> {
    return fetchJSON<IntradayPnLResponse>(`${API_BASE}/account/pnl/intraday`);
  },

  async getPortfolioExposure(): Promise<PortfolioExposure> {
    return fetchJSON<PortfolioExposure>(`${API_BASE}/portfolio/exposure`);
  },
};
