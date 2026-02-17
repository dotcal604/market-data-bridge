import type { OptionsChainData } from "./types";

const API_BASE = "/api";

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`HTTP ${res.status}: ${errorText || res.statusText}`);
  }
  return res.json();
}

export const optionsClient = {
  async getOptionsChain(symbol: string, expiration?: string): Promise<OptionsChainData> {
    const params = expiration ? `?expiration=${expiration}` : "";
    return fetchJSON<OptionsChainData>(`${API_BASE}/options/${symbol}${params}`);
  },
};
