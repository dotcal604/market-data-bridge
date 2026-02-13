import type { ExecutionHistoryResponse } from "./types";

const BASE = "/api/account";

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const executionsClient = {
  getExecutions(symbol?: string, secType?: string, time?: string) {
    const params = new URLSearchParams();
    if (symbol) params.set("symbol", symbol);
    if (secType) params.set("secType", secType);
    if (time) params.set("time", time);
    const query = params.toString();
    const url = query ? `${BASE}/executions?${query}` : `${BASE}/executions`;
    return fetchJson<ExecutionHistoryResponse>(url);
  },
};
