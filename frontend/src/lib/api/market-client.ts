const API_BASE = "/api";

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`HTTP ${res.status}: ${errorText || res.statusText}`);
  }
  return res.json();
}

export interface SearchResult {
  symbol: string;
  name: string;
  exch: string;
  type: string;
  exchDisp: string;
  typeDisp: string;
}

export interface SearchResponse {
  count: number;
  results: SearchResult[];
}

export interface Quote {
  symbol: string;
  bid: number | null;
  ask: number | null;
  last: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
  change: number | null;
  changePercent: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  source: string;
}

export interface StockDetails {
  symbol: string;
  name: string;
  sector: string;
  industry: string;
  marketCap: number | null;
  fiftyTwoWeekLow: number | null;
  fiftyTwoWeekHigh: number | null;
  trailingPE: number | null;
  forwardPE: number | null;
  dividendYield: number | null;
  beta: number | null;
  averageVolume: number | null;
  float: number | null;
  description: string;
}

export interface Financials {
  symbol: string;
  currentPrice: number | null;
  targetHighPrice: number | null;
  targetLowPrice: number | null;
  targetMeanPrice: number | null;
  targetMedianPrice: number | null;
  recommendationMean: number | null;
  recommendationKey: string | null;
  numberOfAnalystOpinions: number | null;
  totalCash: number | null;
  totalDebt: number | null;
  totalRevenue: number | null;
  revenuePerShare: number | null;
  returnOnEquity: number | null;
  freeCashflow: number | null;
  operatingCashflow: number | null;
  earningsGrowth: number | null;
  revenueGrowth: number | null;
  grossMargins: number | null;
  ebitdaMargins: number | null;
  operatingMargins: number | null;
  profitMargins: number | null;
}

export const marketClient = {
  async searchSymbols(query: string): Promise<SearchResponse> {
    const params = new URLSearchParams({ q: query });
    return fetchJSON<SearchResponse>(`${API_BASE}/search?${params}`);
  },

  async getQuote(symbol: string): Promise<Quote> {
    return fetchJSON<Quote>(`${API_BASE}/quote/${symbol}`);
  },

  async getStockDetails(symbol: string): Promise<StockDetails> {
    return fetchJSON<StockDetails>(`${API_BASE}/details/${symbol}`);
  },

  async getFinancials(symbol: string): Promise<Financials> {
    return fetchJSON<Financials>(`${API_BASE}/financials/${symbol}`);
  },
};
