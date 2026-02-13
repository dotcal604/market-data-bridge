"use client";

import { createColumnHelper } from "@tanstack/react-table";
import type { Evaluation } from "@/lib/api/types";
import { ScoreBadge } from "@/components/shared/score-badge";
import { DirectionBadge } from "@/components/shared/direction-badge";
import { Badge } from "@/components/ui/badge";
import { formatTimestamp, formatMs, formatPrice } from "@/lib/utils/formatters";

const col = createColumnHelper<Evaluation>();

export const evalColumns = [
  col.accessor("symbol", {
    header: "Symbol",
    cell: (info) => (
      <span className="font-mono text-sm font-semibold">{info.getValue()}</span>
    ),
  }),
  col.accessor("direction", {
    header: "Dir",
    cell: (info) => <DirectionBadge direction={info.getValue()} />,
  }),
  col.accessor("ensemble_trade_score", {
    header: "Score",
    cell: (info) => <ScoreBadge score={info.getValue()} />,
  }),
  col.accessor("ensemble_confidence", {
    header: "Conf",
    cell: (info) => (
      <span className="font-mono text-xs">
        {(info.getValue() * 100).toFixed(0)}%
      </span>
    ),
  }),
  col.accessor("ensemble_expected_rr", {
    header: "E[R:R]",
    cell: (info) => (
      <span className="font-mono text-xs">{info.getValue().toFixed(1)}</span>
    ),
  }),
  col.accessor("last_price", {
    header: "Price",
    cell: (info) => (
      <span className="font-mono text-xs">{formatPrice(info.getValue())}</span>
    ),
  }),
  col.accessor("rvol", {
    header: "RVOL",
    cell: (info) => (
      <span className="font-mono text-xs">{info.getValue().toFixed(1)}x</span>
    ),
  }),
  col.accessor("guardrail_allowed", {
    header: "Guardrail",
    cell: (info) => (
      <Badge
        variant={info.getValue() ? "default" : "destructive"}
        className="text-[10px]"
      >
        {info.getValue() ? "ALLOWED" : "BLOCKED"}
      </Badge>
    ),
  }),
  col.accessor("total_latency_ms", {
    header: "Latency",
    cell: (info) => (
      <span className="font-mono text-xs text-muted-foreground">
        {formatMs(info.getValue())}
      </span>
    ),
  }),
  col.accessor("timestamp", {
    header: "Time",
    cell: (info) => (
      <span className="text-xs text-muted-foreground">
        {formatTimestamp(info.getValue())}
      </span>
    ),
  }),
];
