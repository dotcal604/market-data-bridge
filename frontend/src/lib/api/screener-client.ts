import { fetchJson } from "./fetch-json";

const API_BASE = "/api";

export interface ScreenerResult {
  rank: number;
  symbol: string;
  longName: string | null;
  last: number | null;
  change: number | null;
  changePercent: number | null;
  volume: number | null;
  marketCap: number | null;
  exchange: string | null;
  bid: number | null;
  ask: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  sector: string | null;
  industry: string | null;
  trailingPE: number | null;
  averageVolume: number | null;
}

export interface ScreenerResponse {
  count: number;
  results: ScreenerResult[];
}

export const screenerClient = {
  async runScreener(screenerId: string, count: number): Promise<ScreenerResponse> {
    return fetchJson<ScreenerResponse>(`${API_BASE}/screener/run-with-quotes`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ screener_id: screenerId, count }),
    });
  },
};
