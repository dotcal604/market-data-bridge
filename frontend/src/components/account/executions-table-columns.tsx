"use client";

import { createColumnHelper } from "@tanstack/react-table";
import type { Execution } from "@/lib/api/types";
import { Badge } from "@/components/ui/badge";
import { formatTimestamp, formatPrice } from "@/lib/utils/formatters";

const col = createColumnHelper<Execution>();

export const executionColumns = [
  col.accessor("time", {
    header: "Time",
    cell: (info) => (
      <span className="text-xs text-muted-foreground">
        {formatTimestamp(info.getValue())}
      </span>
    ),
  }),
  col.accessor("symbol", {
    header: "Symbol",
    cell: (info) => (
      <span className="font-mono text-sm font-semibold">{info.getValue()}</span>
    ),
  }),
  col.accessor("side", {
    header: "Side",
    cell: (info) => {
      const side = info.getValue();
      const isBuy = side.toUpperCase() === "BOT" || side.toUpperCase() === "BUY";
      return (
        <Badge
          variant={isBuy ? "default" : "destructive"}
          className={isBuy ? "bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30" : "bg-red-500/20 text-red-400 hover:bg-red-500/30"}
        >
          {isBuy ? "BUY" : "SELL"}
        </Badge>
      );
    },
  }),
  col.accessor("shares", {
    header: "Shares",
    cell: (info) => (
      <span className="font-mono text-xs">{info.getValue().toLocaleString()}</span>
    ),
  }),
  col.accessor("price", {
    header: "Price",
    cell: (info) => (
      <span className="font-mono text-xs">{formatPrice(info.getValue())}</span>
    ),
  }),
  col.accessor("commission", {
    header: "Commission",
    cell: (info) => (
      <span className="font-mono text-xs text-muted-foreground">
        {formatPrice(Math.abs(info.getValue()))}
      </span>
    ),
  }),
  col.accessor("realizedPnL", {
    header: "Realized P&L",
    cell: (info) => {
      const pnl = info.getValue();
      const isPositive = pnl > 0;
      const isNegative = pnl < 0;
      return (
        <span
          className={`font-mono text-xs ${
            isPositive
              ? "text-emerald-400"
              : isNegative
              ? "text-red-400"
              : "text-muted-foreground"
          }`}
        >
          {pnl > 0 ? "+" : ""}{formatPrice(pnl)}
        </span>
      );
    },
  }),
];
