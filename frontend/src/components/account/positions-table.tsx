"use client";

import { useState, useMemo } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  createColumnHelper,
  type SortingState,
} from "@tanstack/react-table";
import { usePositions } from "@/lib/hooks/use-account";
import { accountClient } from "@/lib/api/account-client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/utils/formatters";
import type { Position } from "@/lib/api/types";

interface PositionsTableProps {
  refreshInterval?: number;
}

interface PositionWithPrice extends Position {
  currentPrice: number | null;
  marketValue: number;
  unrealizedPnL: number;
  unrealizedPnLPercent: number;
}

const col = createColumnHelper<PositionWithPrice>();

const columns = [
  col.accessor("symbol", {
    header: "Symbol",
    cell: (info) => (
      <span className="font-mono text-sm font-semibold">{info.getValue()}</span>
    ),
  }),
  col.accessor("secType", {
    header: "Type",
    cell: (info) => (
      <span className="text-xs text-muted-foreground">{info.getValue()}</span>
    ),
  }),
  col.accessor("position", {
    header: "Qty",
    cell: (info) => {
      const qty = info.getValue();
      const isShort = qty < 0;
      return (
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm">{Math.abs(qty).toLocaleString()}</span>
          {isShort && (
            <Badge variant="destructive" className="text-[10px]">
              SHORT
            </Badge>
          )}
        </div>
      );
    },
  }),
  col.accessor("avgCost", {
    header: "Avg Cost",
    cell: (info) => (
      <span className="font-mono text-sm">${info.getValue().toFixed(2)}</span>
    ),
  }),
  col.accessor("currentPrice", {
    header: "Current Price",
    cell: (info) => {
      const price = info.getValue();
      return (
        <span className="font-mono text-sm">
          {price !== null ? `$${price.toFixed(2)}` : "—"}
        </span>
      );
    },
  }),
  col.accessor("unrealizedPnLPercent", {
    header: "Unrealized P&L %",
    cell: (info) => {
      const pnlPct = info.getValue();
      const colorClass =
        pnlPct > 0 ? "text-emerald-400" : pnlPct < 0 ? "text-red-400" : "text-muted-foreground";
      return (
        <span className={cn("font-mono text-sm font-semibold", colorClass)}>
          {pnlPct > 0 ? "+" : ""}
          {pnlPct.toFixed(2)}%
        </span>
      );
    },
  }),
  col.accessor("marketValue", {
    header: "Market Value",
    cell: (info) => {
      const value = info.getValue();
      return (
        <span className="font-mono text-sm">
          {value > 0 ? formatCurrency(value) : "—"}
        </span>
      );
    },
  }),
];

export function PositionsTable({ refreshInterval = 10_000 }: PositionsTableProps) {
  const [sorting, setSorting] = useState<SortingState>([]);
  
  const positionsQuery = usePositions(refreshInterval);

  // Fetch quotes for all positions
  const symbols = useMemo(
    () => positionsQuery.data?.positions?.map((p) => p.symbol) ?? [],
    [positionsQuery.data]
  );

  const quotesQuery = useQuery({
    queryKey: ["position-quotes", symbols],
    queryFn: async () => {
      if (symbols.length === 0) return {};
      const quotes = await Promise.all(
        symbols.map(async (symbol) => {
          try {
            const quote = await accountClient.getQuote(symbol);
            return { symbol, quote };
          } catch {
            return { symbol, quote: null };
          }
        })
      );
      return Object.fromEntries(
        quotes.map(({ symbol, quote }) => [symbol, quote?.last ?? null])
      );
    },
    enabled: symbols.length > 0,
    refetchInterval: refreshInterval,
  });

  const positionsWithPrices = useMemo<PositionWithPrice[]>(() => {
    if (!positionsQuery.data?.positions || !quotesQuery.data) return [];
    
    return positionsQuery.data.positions.map((position) => {
      const currentPrice = quotesQuery.data[position.symbol] ?? null;
      // Market value is always positive (absolute value of position × price)
      // If current price unavailable, market value is 0 to indicate stale/unknown value
      const marketValue = currentPrice !== null 
        ? Math.abs(currentPrice * position.position)
        : 0;
      const unrealizedPnL = currentPrice !== null
        ? (currentPrice - position.avgCost) * position.position
        : 0;
      const unrealizedPnLPercent = currentPrice !== null && position.avgCost !== 0
        ? (currentPrice - position.avgCost) / position.avgCost * 100
        : 0;

      return {
        ...position,
        currentPrice,
        marketValue,
        unrealizedPnL,
        unrealizedPnLPercent,
      };
    });
  }, [positionsQuery.data, quotesQuery.data]);

  const table = useReactTable({
    data: positionsWithPrices,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const isLoading = positionsQuery.isLoading || quotesQuery.isLoading;
  const hasError = positionsQuery.error || quotesQuery.error;
  const hasApiError = positionsQuery.data && 'error' in positionsQuery.data;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Open Positions</CardTitle>
      </CardHeader>
      <CardContent>
        {hasApiError && (
          <div className="text-sm text-red-400">
            {positionsQuery.data?.error || "Unknown error"}
          </div>
        )}

        {hasError && !hasApiError && (
          <div className="text-sm text-red-400">
            Error loading positions: {(positionsQuery.error as Error)?.message || (quotesQuery.error as Error)?.message}
          </div>
        )}

        {isLoading && (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        )}

        {!isLoading && !hasError && !hasApiError && positionsWithPrices.length === 0 && (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No open positions
          </div>
        )}

        {!isLoading && !hasError && !hasApiError && positionsWithPrices.length > 0 && (
          <div className="rounded-lg border border-border">
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id}>
                    {headerGroup.headers.map((header) => (
                      <TableHead
                        key={header.id}
                        className="cursor-pointer select-none hover:bg-accent/50"
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        <div className="flex items-center gap-1">
                          {flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                          <ArrowUpDown className="h-3 w-3 text-muted-foreground" />
                        </div>
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows.map((row) => (
                  <TableRow key={row.id}>
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>
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
