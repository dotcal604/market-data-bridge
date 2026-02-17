"use client";

import { useQuery } from "@tanstack/react-query";
import { autopsyClient } from "../api/autopsy-client";

export function useAutopsyReport(since?: string, until?: string) {
  return useQuery({
    queryKey: ["autopsy-report", since, until],
    queryFn: () => autopsyClient.getReport(since, until),
    refetchInterval: 300_000, // 5 min — static historical data
  });
}
