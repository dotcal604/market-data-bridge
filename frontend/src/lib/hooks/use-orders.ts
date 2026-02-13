"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ordersClient } from "../api/orders-client";
import type { PlaceOrderRequest } from "../api/types";

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

export function usePlaceOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (order: PlaceOrderRequest) => ordersClient.placeOrder(order),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["open-orders"] });
    },
  });
}

export function useQuote(symbol: string | null, enabled = true) {
  return useQuery({
    queryKey: ["quote", symbol],
    queryFn: () => ordersClient.getQuote(symbol!),
    enabled: enabled && !!symbol && symbol.length > 0,
    refetchInterval: 5000,
    staleTime: 3000,
  });
}
