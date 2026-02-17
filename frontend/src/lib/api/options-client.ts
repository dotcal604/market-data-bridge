const API_BASE = "/api";

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`HTTP ${res.status}: ${errorText || res.statusText}`);
  }
  return res.json();
}

export interface OptionsChainData {
  symbol: string;
  expirations: string[];
  strikes: number[];
  calls: OptionContract[];
  puts: OptionContract[];
}

export interface OptionContract {
  contractSymbol: string;
  strike: number;
  expiration: string;
  type: "C" | "P";
  lastPrice: number | null;
  bid: number | null;
  ask: number | null;
  volume: number | null;
  openInterest: number | null;
  impliedVolatility: number | null;
  inTheMoney: boolean;
}

export const optionsClient = {
  async getOptionsChain(symbol: string, expiration?: string): Promise<OptionsChainData> {
    const params = expiration ? `?expiration=${expiration}` : "";
    return fetchJSON<OptionsChainData>(`${API_BASE}/options/${symbol}${params}`);
  },
};
