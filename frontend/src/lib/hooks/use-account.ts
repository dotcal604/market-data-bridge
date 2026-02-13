"use client";

import { useQuery } from "@tanstack/react-query";
import type { StatusResponse, AccountSummary, PnLData } from "../api/types";

const API_BASE = "/api";

async function fetchStatus(): Promise<StatusResponse> {
  const res = await fetch(`${API_BASE}/status`);
  if (!res.ok) throw new Error("Failed to fetch status");
  return res.json();
}

async function fetchAccountSummary(): Promise<AccountSummary> {
  const res = await fetch(`${API_BASE}/account/summary`);
  if (!res.ok) throw new Error("Failed to fetch account summary");
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

async function fetchPnL(): Promise<PnLData> {
  const res = await fetch(`${API_BASE}/account/pnl`);
  if (!res.ok) throw new Error("Failed to fetch P&L");
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

export function useStatus(refetchInterval?: number) {
  return useQuery({
    queryKey: ["status"],
    queryFn: fetchStatus,
    refetchInterval,
  });
}

export function useAccountSummary(refetchInterval?: number) {
  return useQuery({
    queryKey: ["account-summary"],
    queryFn: fetchAccountSummary,
    refetchInterval,
  });
}

export function usePnL(refetchInterval?: number) {
  return useQuery({
    queryKey: ["account-pnl"],
    queryFn: fetchPnL,
    refetchInterval,
  });
}
