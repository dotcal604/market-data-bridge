import type { NewsResponse, EarningsData, TrendingSymbol } from "./types";
import { fetchJson } from "./fetch-json";

export const marketClient = {
  getNews(query: string) {
    return fetchJson<NewsResponse>(`/api/news/${encodeURIComponent(query)}`);
  },

  getEarnings(symbol: string) {
    return fetchJson<EarningsData>(`/api/earnings/${symbol}`);
  },

  getTrending() {
    return fetchJson<TrendingSymbol[]>("/api/trending");
  },
};
