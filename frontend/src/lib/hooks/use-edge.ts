"use client";

import { useQuery } from "@tanstack/react-query";
import { edgeClient } from "../api/edge-client";

export function useEdgeReport(days = 90, includeWalkForward = true) {
  return useQuery({
    queryKey: ["edge-report", days, includeWalkForward],
    queryFn: () => edgeClient.getReport(days, includeWalkForward),
    refetchInterval: 120_000, // 2 min — heavier query
  });
}
