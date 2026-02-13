"use client";

import { useQuery } from "@tanstack/react-query";
import { accountClient } from "../api/account-client";

export function useAccountSummary(refetchInterval = 10_000) {
  return useQuery({
    queryKey: ["account-summary"],
    queryFn: () => accountClient.getSummary(),
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
