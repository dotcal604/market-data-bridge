import type { AccountSummaryResponse, PositionsResponse } from "./types";

const API_BASE = "/api";

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
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

export const accountClient = {
  async getSummary(): Promise<AccountSummaryResponse> {
    return fetchJSON<AccountSummaryResponse>(`${API_BASE}/account/summary`);
  },

  async getPositions(): Promise<PositionsResponse> {
    return fetchJSON<PositionsResponse>(`${API_BASE}/account/positions`);
  },

  async getQuote(symbol: string): Promise<Quote> {
    return fetchJSON<Quote>(`${API_BASE}/quote/${symbol}`);
  },
};
