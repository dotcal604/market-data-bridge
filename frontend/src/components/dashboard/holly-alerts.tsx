"use client";

import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  type SortingState,
  type ColumnDef,
} from "@tanstack/react-table";
import { useState } from "react";
import type { HollyAlert } from "@/lib/api/types";
import { useHollyAlerts } from "@/lib/hooks/use-holly";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowUpDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatTimestamp, formatPrice } from "@/lib/utils/formatters";

// Color mapping for strategies
const strategyColors: Record<string, string> = {
  "BOP Signal": "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  "Gap Scanner": "bg-blue-500/10 text-blue-400 border-blue-500/20",
  "Momentum Scanner": "bg-purple-500/10 text-purple-400 border-purple-500/20",
  "Unusual Volume": "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  "Breakout Scanner": "bg-red-500/10 text-red-400 border-red-500/20",
};

function getStrategyColor(strategy: string | null): string {
  if (!strategy) return "bg-muted/10 text-muted-foreground border-muted/20";
  return strategyColors[strategy] ?? "bg-muted/10 text-muted-foreground border-muted/20";
}

const columns: ColumnDef<HollyAlert>[] = [
  {
    accessorKey: "alert_time",
    header: "Time",
    cell: ({ row }) => (
      <span className="font-mono text-xs text-muted-foreground">
        {formatTimestamp(row.original.alert_time)}
      </span>
    ),
    sortingFn: "datetime",
  },
  {
    accessorKey: "symbol",
    header: "Symbol",
    cell: ({ row }) => (
      <a
        href={`/market?symbol=${row.original.symbol}`}
        className="font-mono text-sm font-semibold hover:text-emerald-400 transition-colors"
      >
        {row.original.symbol}
      </a>
    ),
  },
  {
    accessorKey: "strategy",
    header: "Strategy",
    cell: ({ row }) => {
      const strategy = row.original.strategy ?? "Unknown";
      return (
        <Badge variant="outline" className={cn("text-[10px]", getStrategyColor(strategy))}>
          {strategy}
        </Badge>
      );
    },
  },
  {
    accessorKey: "entry_price",
    header: "Entry",
    cell: ({ row }) => (
      <span className="font-mono text-xs">
        {row.original.entry_price ? formatPrice(row.original.entry_price) : "—"}
      </span>
    ),
  },
  {
    accessorKey: "stop_price",
    header: "Stop",
    cell: ({ row }) => (
      <span className="font-mono text-xs">
        {row.original.stop_price ? formatPrice(row.original.stop_price) : "—"}
      </span>
    ),
  },
  {
    accessorKey: "shares",
    header: "Shares",
    cell: ({ row }) => (
      <span className="font-mono text-xs">
        {row.original.shares?.toLocaleString() ?? "—"}
      </span>
    ),
  },
  {
    accessorKey: "last_price",
    header: "Last",
    cell: ({ row }) => (
      <span className="font-mono text-xs">
        {row.original.last_price ? formatPrice(row.original.last_price) : "—"}
      </span>
    ),
  },
  {
    accessorKey: "segment",
    header: "Segment",
    cell: ({ row }) => (
      <span className="text-xs text-muted-foreground">
        {row.original.segment ?? "—"}
      </span>
    ),
  },
];

interface Props {
  limit?: number;
}

export function HollyAlerts({ limit = 50 }: Props) {
  const { data, isLoading, error } = useHollyAlerts({ limit });
  const [sorting, setSorting] = useState<SortingState>([
    { id: "alert_time", desc: true },
  ]);

  const table = useReactTable({
    data: data?.alerts ?? [],
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <Card className="bg-card">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
        <CardTitle className="text-lg font-semibold flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-emerald-400" />
          Holly AI Alerts
        </CardTitle>
        {data && (
          <span className="text-sm text-muted-foreground">
            {data.count} {data.count === 1 ? "alert" : "alerts"}
          </span>
        )}
      </CardHeader>
      <CardContent>
        {isLoading && (
          <div className="flex items-center justify-center p-8 text-sm text-muted-foreground">
            Loading Holly alerts...
          </div>
        )}

        {error && (
          <div className="flex items-center justify-center p-8 text-sm text-red-400">
            Error loading alerts: {error.message}
          </div>
        )}

        {data && data.alerts.length === 0 && (
          <div className="flex items-center justify-center p-8 text-sm text-muted-foreground">
            No Holly alerts yet. Import alerts via CSV to see data here.
          </div>
        )}

        {data && data.alerts.length > 0 && (
          <div className="rounded-lg border border-border">
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id}>
                    {headerGroup.headers.map((header) => (
                      <TableHead
                        key={header.id}
                        className={cn(
                          "text-xs font-medium",
                          header.column.getCanSort() && "cursor-pointer select-none"
                        )}
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        <div className="flex items-center gap-1">
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {header.column.getCanSort() && (
                            <ArrowUpDown className="h-3 w-3 text-muted-foreground" />
                          )}
                        </div>
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows.map((row) => (
                  <TableRow key={row.id} className="hover:bg-accent/30">
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id} className="py-3">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
