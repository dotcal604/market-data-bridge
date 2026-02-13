import type { JournalEntry } from "./types";

const BASE = "/api/journal";

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

interface JournalResponse {
  count: number;
  entries: JournalEntry[];
}

export const journalClient = {
  async getEntries(params?: { symbol?: string; strategy?: string; limit?: number; offset?: number }) {
    const searchParams = new URLSearchParams();
    if (params?.symbol) searchParams.set("symbol", params.symbol);
    if (params?.strategy) searchParams.set("strategy", params.strategy);
    if (params?.limit) searchParams.set("limit", String(params.limit));
    // Note: offset is not supported by the backend API
    
    const query = searchParams.toString();
    const response = await fetchJson<JournalResponse>(`${BASE}${query ? `?${query}` : ""}`);
    return response.entries;
  },

  getById(id: number) {
    return fetchJson<JournalEntry>(`${BASE}/${id}`);
  },

  create(data: {
    symbol?: string;
    strategy_version?: string;
    reasoning: string;
    ai_recommendations?: string;
    tags?: string[];
    spy_price?: number;
    vix_level?: number;
    gap_pct?: number;
    relative_volume?: number;
    time_of_day?: string;
    session_type?: string;
    spread_pct?: number;
  }) {
    return fetchJson<{ id: number }>(`${BASE}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  },

  update(id: number, data: { outcome_tags?: string[]; notes?: string }) {
    return fetchJson<JournalEntry>(`${BASE}/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  },
};
