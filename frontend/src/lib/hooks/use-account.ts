"use client";

import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { accountClient } from "../api/account-client";
import type { StatusResponse, AccountSummary, PnLData, IntradayPnLResponse } from "../api/types";
import { useWebSocket } from "./useWebSocket";

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
  const queryClient = useQueryClient();
  const { data: wsData } = useWebSocket<{ ibkr_connected: boolean }>("status");

  useEffect(() => {
    if (wsData) {
      queryClient.setQueryData(["status"], (old: StatusResponse | undefined) => {
        if (!old) return old;
        return {
          ...old,
          ibkr: {
            ...old.ibkr,
            connected: wsData.ibkr_connected,
          },
        };
      });
    }
  }, [wsData, queryClient]);

  return useQuery({
    queryKey: ["status"],
    queryFn: fetchStatus,
    refetchInterval,
  });
}

export function useAccountSummary(refetchInterval?: number) {
  const queryClient = useQueryClient();
  const { data: wsData } = useWebSocket<[string, string, string, string]>("account");

  useEffect(() => {
    if (wsData && Array.isArray(wsData) && wsData.length >= 2) {
      const [key, value] = wsData;
      const numValue = parseFloat(value);

      if (!isNaN(numValue)) {
        queryClient.setQueryData(
          ["account-summary"],
          (old: AccountSummary | undefined) => {
            if (!old) return old;
            const newData = { ...old };

            switch (key) {
              case "NetLiquidation":
                newData.netLiquidation = numValue;
                break;
              case "TotalCashValue":
                newData.totalCashValue = numValue;
                break;
              case "SettledCash":
                newData.settledCash = numValue;
                break;
              case "BuyingPower":
                newData.buyingPower = numValue;
                break;
              case "GrossPositionValue":
                newData.grossPositionValue = numValue;
                break;
              case "MaintMarginReq":
                newData.maintMarginReq = numValue;
                break;
              case "ExcessLiquidity":
                newData.excessLiquidity = numValue;
                break;
              case "AvailableFunds":
                newData.availableFunds = numValue;
                break;
            }
            return newData;
          }
        );
      }
    }
  }, [wsData, queryClient]);

  return useQuery({
    queryKey: ["account-summary"],
    queryFn: fetchAccountSummary,
    refetchInterval,
  });
}

export function usePnL(refetchInterval?: number) {
  const queryClient = useQueryClient();
  // account channel sends args: [key, value, currency, accountName]
  const { data: wsData } = useWebSocket<[string, string, string, string]>("account");

  useEffect(() => {
    if (wsData && Array.isArray(wsData) && wsData.length >= 2) {
      const [key, value] = wsData;
      const numValue = parseFloat(value);
      
      if (!isNaN(numValue)) {
        queryClient.setQueryData(["account-pnl"], (old: PnLData | undefined) => {
          if (!old) return old;
          const newData = { ...old };
          
          if (key === "UnrealizedPnL") newData.unrealizedPnL = numValue;
          if (key === "DailyPnL") newData.dailyPnL = numValue;
          if (key === "RealizedPnL") newData.realizedPnL = numValue;
          
          return newData;
        });
      }
    }
  }, [wsData, queryClient]);

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

export function useIntradayPnL(refetchInterval = 30_000) {
  return useQuery({
    queryKey: ["account-intraday-pnl"],
    queryFn: () => accountClient.getIntradayPnL(),
    refetchInterval,
  });
}
