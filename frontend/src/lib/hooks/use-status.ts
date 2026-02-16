import { useQuery } from "@tanstack/react-query";
import { statusClient } from "../api/status-client";

export function useStatus() {
  return useQuery({
    queryKey: ["status"],
    queryFn: statusClient.getStatus,
    refetchInterval: 10_000, // Poll every 10 seconds
    staleTime: 5_000, // Consider fresh for 5 seconds
  });
}
