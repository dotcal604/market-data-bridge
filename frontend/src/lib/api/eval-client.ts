import type {
  EvalDetail,
  EvalHistoryResponse,
  EvalStats,
  EnsembleWeights,
  EvalResponse,
} from "./types";

const BASE = "/api/eval";

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const evalClient = {
  evaluate(symbol: string, direction = "long", entryPrice?: number, stopPrice?: number) {
    return fetchJson<EvalResponse>(`${BASE}/evaluate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        symbol,
        direction,
        entry_price: entryPrice ?? null,
        stop_price: stopPrice ?? null,
      }),
    });
  },

  getHistory(limit = 50, symbol?: string) {
    const params = new URLSearchParams({ limit: String(limit) });
    if (symbol) params.set("symbol", symbol);
    return fetchJson<EvalHistoryResponse>(`${BASE}/history?${params}`);
  },

  getById(id: string) {
    return fetchJson<EvalDetail>(`${BASE}/${id}`);
  },

  getStats() {
    return fetchJson<EvalStats>(`${BASE}/stats`);
  },

  getWeights() {
    return fetchJson<EnsembleWeights>(`${BASE}/weights`);
  },

  recordOutcome(evaluationId: string, data: {
    trade_taken?: boolean;
    actual_entry_price?: number;
    actual_exit_price?: number;
    r_multiple?: number;
    exit_reason?: string;
    notes?: string;
  }) {
    return fetchJson<{ success: boolean }>(`${BASE}/outcome`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ evaluation_id: evaluationId, ...data }),
    });
  },
};
