import type { ScreenerFilters, ScreenerResponse } from "./types";
import { fetchJson } from "./fetch-json";

const BASE = "/api/screener";

export const screenerClient = {
  getFilters() {
    return fetchJson<ScreenerFilters>(`${BASE}/filters`);
  },

  runScreener(screenerId: string, count = 20) {
    return fetchJson<ScreenerResponse>(`${BASE}/run-with-quotes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        screener_id: screenerId,
        count,
      }),
    });
  },
};
