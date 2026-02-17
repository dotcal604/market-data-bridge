"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { accountClient } from "../api/account-client";
import type { StatusResponse, AccountSummary, PnLData, IntradayPnLResponse } from "../api/types";

const API_BASE = "/api";

async function fetchStatus(): Promise<StatusResponse> {
  const res = await fetch(`${API_BASE}/status`);
  if (!res.ok) throw new Error(`Failed to fetch status (${res.status}: ${res.statusText})`);
  return res.json();
}

async function fetchAccountSummary(): Promise<AccountSummary> {
  const res = await fetch(`${API_BASE}/account/summary`);
  if (!res.ok) throw new Error(`Failed to fetch account summary (${res.status}: ${res.statusText})`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

async function fetchPnL(): Promise<PnLData> {
  const res = await fetch(`${API_BASE}/account/pnl`);
  if (!res.ok) throw new Error(`Failed to fetch P&L (${res.status}: ${res.statusText})`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

async function fetchIntradayPnL(): Promise<IntradayPnLResponse> {
  const res = await fetch(`${API_BASE}/account/pnl/intraday`);
  if (!res.ok) throw new Error(`Failed to fetch intraday P&L (${res.status}: ${res.statusText})`);
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

export function useIntradayPnL(refetchInterval?: number) {
  return useQuery({
    queryKey: ["account-pnl-intraday"],
    queryFn: fetchIntradayPnL,
    refetchInterval,
  });
}

export function usePositions(refetchInterval = 10_000) {
  return useQuery({
    queryKey: ["account-positions"],
    queryFn: () => accountClient.getPositions(),
    refetchInterval,
  });
}

export function useFlattenConfig(refetchInterval = 30_000) {
  return useQuery({
    queryKey: ["flatten-config"],
    queryFn: () => accountClient.getFlattenConfig(),
    refetchInterval,
  });
}

export function useSetFlattenEnabled() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) => accountClient.setFlattenEnabled(enabled),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["flatten-config"] });
    },
  });
}

export function useFlattenAllPositions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => accountClient.flattenAllPositions(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["account-positions"] });
      queryClient.invalidateQueries({ queryKey: ["flatten-config"] });
    },
  });
}
