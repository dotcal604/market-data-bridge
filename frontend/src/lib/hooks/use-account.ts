"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { accountClient } from "../api/account-client";
import type { StatusResponse, AccountSummary, PnLData } from "../api/types";
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

export function useStatus(refetchInterval?: number) {
  return useQuery({
    queryKey: ["status"],
    queryFn: fetchStatus,
    refetchInterval,
  });
}

export function useAccountSummary(refetchInterval?: number) {
  const queryClient = useQueryClient();
  const [useWebSocketData, setUseWebSocketData] = useState(false);

  // Try WebSocket first
  const { data: wsData, connected } = useWebSocket<any>({
    channel: "account",
    enabled: true,
    onData: (data) => {
      // When we receive WebSocket data, update the query cache
      if (data && data.tag && data.value) {
        setUseWebSocketData(true);
        // Invalidate to trigger a fresh fetch with WS data
        queryClient.invalidateQueries({ queryKey: ["account-summary"] });
      }
    },
  });

  // Fallback to polling if WebSocket disconnects
  useEffect(() => {
    if (!connected && useWebSocketData) {
      setUseWebSocketData(false);
    }
  }, [connected, useWebSocketData]);

  return useQuery({
    queryKey: ["account-summary"],
    queryFn: fetchAccountSummary,
    // Use longer interval when WebSocket is connected, faster when polling
    refetchInterval: connected && useWebSocketData ? 60_000 : (refetchInterval ?? 10_000),
  });
}

export function usePnL(refetchInterval?: number) {
  return useQuery({
    queryKey: ["account-pnl"],
    queryFn: fetchPnL,
    refetchInterval,
  });
}

export function usePositions(refetchInterval = 10_000) {
  const queryClient = useQueryClient();
  const [useWebSocketData, setUseWebSocketData] = useState(false);

  // Try WebSocket first
  const { data: wsData, connected } = useWebSocket<any>({
    channel: "positions",
    enabled: true,
    onData: (data) => {
      // When we receive WebSocket data, update the query cache
      if (data) {
        setUseWebSocketData(true);
        queryClient.invalidateQueries({ queryKey: ["account-positions"] });
      }
    },
  });

  // Fallback to polling if WebSocket disconnects
  useEffect(() => {
    if (!connected && useWebSocketData) {
      setUseWebSocketData(false);
    }
  }, [connected, useWebSocketData]);

  return useQuery({
    queryKey: ["account-positions"],
    queryFn: () => accountClient.getPositions(),
    // Use longer interval when WebSocket is connected, faster when polling
    refetchInterval: connected && useWebSocketData ? 60_000 : refetchInterval,
  });
}

