import { fetchJson } from "./fetch-json";

const STATUS_BASE = "/api/status";

export interface StatusResponse {
  status: string;
  easternTime: string;
  marketSession: "pre-market" | "regular" | "after-hours" | "closed";
  marketData: string;
  screener: string;
  ibkr: {
    connected: boolean;
    host: string;
    port: number;
    clientId: number;
    note: string;
  };
  timestamp: string;
}

export const statusClient = {
  getStatus(): Promise<StatusResponse> {
    return fetchJson<StatusResponse>(STATUS_BASE);
  },
};
