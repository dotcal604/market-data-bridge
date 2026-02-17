import { useQuery } from "@tanstack/react-query";
import { optionsClient } from "@/lib/api/options-client";

export function useOptionsChain(symbol: string | null, expiration?: string) {
  return useQuery({
    queryKey: ["options-chain", symbol, expiration],
    queryFn: () => optionsClient.getOptionsChain(symbol!, expiration),
    enabled: !!symbol,
    staleTime: 30000, // 30 seconds
    refetchInterval: 30000, // Auto-refresh every 30 seconds
  });
}
