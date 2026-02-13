"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ordersClient } from "../api/orders-client";

export function useOpenOrders(refreshInterval = 5000) {
  return useQuery({
    queryKey: ["open-orders"],
    queryFn: () => ordersClient.getOpenOrders(),
    refetchInterval: refreshInterval,
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
