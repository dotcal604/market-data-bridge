import type { BarData, HistoricalBarsResponse } from "./types";
import { fetchJson } from "./fetch-json";

const BASE = "/api";

export const marketClient = {
  getHistoricalBars(symbol: string, period = "3mo", interval = "1d") {
    const params = new URLSearchParams({ period, interval });
    return fetchJson<HistoricalBarsResponse>(`${BASE}/history/${symbol}?${params}`);
  },
};
