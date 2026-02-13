"use client";

import { createColumnHelper } from "@tanstack/react-table";
import type { JournalEntry } from "@/lib/api/types";
import { Badge } from "@/components/ui/badge";
import { formatTimestamp, formatPrice } from "@/lib/utils/formatters";

const col = createColumnHelper<JournalEntry>();

export const journalColumns = [
  col.accessor("created_at", {
    header: "Date",
    cell: (info) => (
      <span className="text-xs text-muted-foreground">
        {formatTimestamp(info.getValue())}
      </span>
    ),
  }),
  col.accessor("symbol", {
    header: "Symbol",
    cell: (info) => (
      <span className="font-mono text-sm font-semibold">
        {info.getValue() ?? "-"}
      </span>
    ),
  }),
  col.accessor("strategy_version", {
    header: "Strategy",
    cell: (info) => (
      <span className="text-xs text-muted-foreground">
        {info.getValue() ?? "-"}
      </span>
    ),
  }),
  col.accessor("tags", {
    header: "Tags",
    cell: (info) => {
      const tagsStr = info.getValue();
      if (!tagsStr) return <span className="text-xs text-muted-foreground">-</span>;
      
      try {
        const tags = JSON.parse(tagsStr) as string[];
        return (
          <div className="flex gap-1">
            {tags.slice(0, 2).map((tag, i) => (
              <Badge key={i} variant="outline" className="text-[10px]">
                {tag}
              </Badge>
            ))}
            {tags.length > 2 && (
              <span className="text-xs text-muted-foreground">+{tags.length - 2}</span>
            )}
          </div>
        );
      } catch {
        return <span className="text-xs text-muted-foreground">-</span>;
      }
    },
  }),
  col.accessor("reasoning", {
    header: "Reasoning",
    cell: (info) => {
      const reasoning = info.getValue();
      const truncated = reasoning.length > 80 ? reasoning.slice(0, 80) + "..." : reasoning;
      return (
        <span className="text-xs text-muted-foreground" title={reasoning}>
          {truncated}
        </span>
      );
    },
  }),
  col.accessor("spy_price", {
    header: "SPY",
    cell: (info) => {
      const value = info.getValue();
      return (
        <span className="font-mono text-xs">
          {value ? formatPrice(value) : "-"}
        </span>
      );
    },
  }),
  col.accessor("vix_level", {
    header: "VIX",
    cell: (info) => {
      const value = info.getValue();
      return (
        <span className="font-mono text-xs">
          {value ? value.toFixed(1) : "-"}
        </span>
      );
    },
  }),
];
