// ── Shared types used across the eval subsystem ──────────────────────────

/** Bar data from Yahoo/IBKR providers */
export interface BarData {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** Quote data from Yahoo/IBKR providers */
export interface QuoteData {
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
  marketCap: number | null;
  timestamp: string;
  source?: string;
}

/** Stock details from Yahoo provider */
export interface StockDetails {
  symbol: string;
  longName: string | null;
  shortName: string | null;
  marketCap: number | null;
  [key: string]: unknown;
}
