import { useQuery } from "@tanstack/react-query";
import { screenerClient } from "../api/screener-client";

export function useScreenerResults(screenerId: string, count: number) {
  return useQuery({
    queryKey: ["screener", screenerId, count],
    queryFn: () => screenerClient.runScreener(screenerId, count),
    staleTime: 60_000, // 1 minute
    enabled: !!screenerId,
  });
}
