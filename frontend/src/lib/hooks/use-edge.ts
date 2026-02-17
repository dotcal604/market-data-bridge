"use client";

import { useQuery } from "@tanstack/react-query";
import { edgeClient } from "../api/edge-client";

export function useEdgeReport(days = 90) {
  return useQuery({
    queryKey: ["edge-report", days],
    queryFn: () => edgeClient.getReport(days),
    refetchInterval: 120_000, // 2 min — heavier query
  });
}
