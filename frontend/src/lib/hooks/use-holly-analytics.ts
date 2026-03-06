"use client";

import { useQuery } from "@tanstack/react-query";
import { hollyAnalyticsClient } from "@/lib/api/holly-analytics-client";

export function useHollyAnalytics() {
  return useQuery({
    queryKey: ["holly-analytics-dashboard"],
    queryFn: () => hollyAnalyticsClient.getDashboard(),
    refetchInterval: 300_000, // 5 min — static historical data
  });
}
