"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ordersClient } from "../api/orders-client";
import { useWebSocket } from "./useWebSocket";

export function useOpenOrders(refreshInterval = 5000) {
  const queryClient = useQueryClient();
  const [useWebSocketData, setUseWebSocketData] = useState(false);

  // Try WebSocket first
  const { data: wsData, connected } = useWebSocket<any>({
    channel: "orders",
    enabled: true,
    onData: (data) => {
      // When we receive WebSocket data, invalidate orders cache
      if (data) {
        setUseWebSocketData(true);
        queryClient.invalidateQueries({ queryKey: ["open-orders"] });
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
    queryKey: ["open-orders"],
    queryFn: () => ordersClient.getOpenOrders(),
    // Use longer interval when WebSocket is connected (30s backup poll)
    // Use shorter interval when polling actively (5s for responsiveness)
    // The 30s interval ensures we catch any missed WebSocket messages
    // while minimizing server load when real-time updates are working
    refetchInterval: connected && useWebSocketData ? 30_000 : refreshInterval,
  });
}

export function useCompletedOrders(refreshInterval = 30000) {
  return useQuery({
    queryKey: ["completed-orders"],
    queryFn: () => ordersClient.getCompletedOrders(),
    refetchInterval: refreshInterval,
  });
}

export function useCancelOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (orderId: number) => ordersClient.cancelOrder(orderId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["open-orders"] });
    },
  });
}

export function useCancelAllOrders() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => ordersClient.cancelAllOrders(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["open-orders"] });
    },
  });
}
