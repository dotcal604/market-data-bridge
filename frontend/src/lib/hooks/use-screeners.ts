import { useQuery } from "@tanstack/react-query";
import { screenerClient } from "@/lib/api/screener-client";

export function useScreenerFilters() {
  return useQuery({
    queryKey: ["screener-filters"],
    queryFn: () => screenerClient.getFilters(),
    staleTime: 5 * 60 * 1000, // 5 minutes - filters rarely change
  });
}

export function useRunScreener(screenerId: string, count: number, enabled = true) {
  return useQuery({
    queryKey: ["screener-results", screenerId, count],
    queryFn: () => screenerClient.runScreener(screenerId, count),
    enabled: enabled && !!screenerId,
    staleTime: 60 * 1000, // 1 minute
  });
}
