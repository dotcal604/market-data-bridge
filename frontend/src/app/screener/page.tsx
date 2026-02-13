"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  createColumnHelper,
  type SortingState,
} from "@tanstack/react-table";
import { useScreenerResults } from "@/lib/hooks/use-screeners";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ScreenerResult } from "@/lib/api/screener-client";

const SCREENER_OPTIONS = [
  { id: "day_gainers", label: "Day Gainers" },
  { id: "day_losers", label: "Day Losers" },
  { id: "most_actives", label: "Most Actives" },
  { id: "small_cap_gainers", label: "Small Cap Gainers" },
  { id: "undervalued_large_caps", label: "Undervalued Large Caps" },
  { id: "aggressive_small_caps", label: "Aggressive Small Caps" },
  { id: "growth_technology_stocks", label: "Growth Technology Stocks" },
];

const COUNT_OPTIONS = [10, 20, 50];

const col = createColumnHelper<ScreenerResult>();

export default function ScreenerPage() {
  const router = useRouter();
  const [screenerId, setScreenerId] = useState("day_gainers");
  const [count, setCount] = useState(20);
  const [sorting, setSorting] = useState<SortingState>([]);

  const { data, isLoading, error } = useScreenerResults(screenerId, count);

  const columns = useMemo(
    () => [
      col.accessor("symbol", {
        header: ({ column }) => {
          return (
            <button
              className="flex items-center gap-1 font-semibold"
              onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
            >
              Symbol
              <ArrowUpDown className="h-3 w-3" />
            </button>
          );
        },
        cell: (info) => (
          <span className="font-mono text-sm font-semibold">{info.getValue()}</span>
        ),
      }),
      col.accessor("longName", {
        header: "Name",
        cell: (info) => (
          <span className="text-sm">{info.getValue() ?? "—"}</span>
        ),
      }),
      col.accessor("last", {
        header: ({ column }) => {
          return (
            <button
              className="flex items-center gap-1 font-semibold"
              onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
            >
              Price
              <ArrowUpDown className="h-3 w-3" />
            </button>
          );
        },
        cell: (info) => {
          const price = info.getValue();
          return (
            <span className="font-mono text-sm">
              {price !== null ? `$${price.toFixed(2)}` : "—"}
            </span>
          );
        },
      }),
      col.accessor("change", {
        header: ({ column }) => {
          return (
            <button
              className="flex items-center gap-1 font-semibold"
              onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
            >
              Change
              <ArrowUpDown className="h-3 w-3" />
            </button>
          );
        },
        cell: (info) => {
          const change = info.getValue();
          if (change === null) return <span className="text-sm">—</span>;
          const colorClass =
            change > 0 ? "text-emerald-400" : change < 0 ? "text-red-400" : "text-muted-foreground";
          return (
            <span className={cn("font-mono text-sm font-semibold", colorClass)}>
              {change > 0 ? "+" : ""}
              ${change.toFixed(2)}
            </span>
          );
        },
      }),
      col.accessor("changePercent", {
        header: ({ column }) => {
          return (
            <button
              className="flex items-center gap-1 font-semibold"
              onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
            >
              Change%
              <ArrowUpDown className="h-3 w-3" />
            </button>
          );
        },
        cell: (info) => {
          const changePercent = info.getValue();
          if (changePercent === null) return <span className="text-sm">—</span>;
          const colorClass =
            changePercent > 0
              ? "text-emerald-400"
              : changePercent < 0
              ? "text-red-400"
              : "text-muted-foreground";
          return (
            <span className={cn("font-mono text-sm font-semibold", colorClass)}>
              {changePercent > 0 ? "+" : ""}
              {changePercent.toFixed(2)}%
            </span>
          );
        },
      }),
      col.accessor("volume", {
        header: ({ column }) => {
          return (
            <button
              className="flex items-center gap-1 font-semibold"
              onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
            >
              Volume
              <ArrowUpDown className="h-3 w-3" />
            </button>
          );
        },
        cell: (info) => {
          const volume = info.getValue();
          if (volume === null) return <span className="text-sm">—</span>;
          return (
            <span className="font-mono text-sm">
              {volume.toLocaleString()}
            </span>
          );
        },
      }),
      col.accessor("marketCap", {
        header: ({ column }) => {
          return (
            <button
              className="flex items-center gap-1 font-semibold"
              onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
            >
              Market Cap
              <ArrowUpDown className="h-3 w-3" />
            </button>
          );
        },
        cell: (info) => {
          const marketCap = info.getValue();
          if (marketCap === null) return <span className="text-sm">—</span>;
          const formatted =
            marketCap >= 1e12
              ? `$${(marketCap / 1e12).toFixed(2)}T`
              : marketCap >= 1e9
              ? `$${(marketCap / 1e9).toFixed(2)}B`
              : marketCap >= 1e6
              ? `$${(marketCap / 1e6).toFixed(2)}M`
              : `$${marketCap.toLocaleString()}`;
          return <span className="font-mono text-sm">{formatted}</span>;
        },
      }),
      col.accessor("trailingPE", {
        header: ({ column }) => {
          return (
            <button
              className="flex items-center gap-1 font-semibold"
              onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
            >
              PE
              <ArrowUpDown className="h-3 w-3" />
            </button>
          );
        },
        cell: (info) => {
          const pe = info.getValue();
          return (
            <span className="font-mono text-sm">
              {pe !== null ? pe.toFixed(2) : "—"}
            </span>
          );
        },
      }),
    ],
    []
  );

  const table = useReactTable({
    data: data?.results ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onSortingChange: setSorting,
    state: {
      sorting,
    },
  });

  const handleRowClick = (symbol: string) => {
    router.push(`/market?symbol=${symbol}`);
  };

  return (
    <div className="flex h-screen flex-col">
      {/* Header */}
      <div className="border-b border-border bg-background px-6 py-4">
        <h1 className="text-2xl font-bold">Stock Screener</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Filter and discover stocks by various criteria
        </p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-7xl space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Screener Options</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                {/* Screener Type Selector */}
                <div className="flex-1">
                  <label className="mb-2 block text-sm font-medium">
                    Screener Type
                  </label>
                  <Select value={screenerId} onValueChange={setScreenerId}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SCREENER_OPTIONS.map((option) => (
                        <SelectItem key={option.id} value={option.id}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Count Selector */}
                <div>
                  <label className="mb-2 block text-sm font-medium">
                    Results Count
                  </label>
                  <div className="flex gap-2">
                    {COUNT_OPTIONS.map((countOption) => (
                      <Button
                        key={countOption}
                        variant={count === countOption ? "default" : "outline"}
                        size="sm"
                        onClick={() => setCount(countOption)}
                      >
                        {countOption}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Results Table */}
          <Card>
            <CardHeader>
              <CardTitle>
                Results {data && `(${data.count})`}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {error && (
                <div className="rounded-md border border-red-400/30 bg-red-400/10 p-4">
                  <p className="text-sm text-red-400">
                    {error instanceof Error ? error.message : "Failed to load screener results"}
                  </p>
                </div>
              )}

              {isLoading && (
                <div className="space-y-2">
                  {[...Array(5)].map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              )}

              {!isLoading && !error && data && (
                <div className="rounded-md border border-border">
                  <Table>
                    <TableHeader>
                      {table.getHeaderGroups().map((headerGroup) => (
                        <TableRow key={headerGroup.id}>
                          {headerGroup.headers.map((header) => (
                            <TableHead key={header.id}>
                              {header.isPlaceholder
                                ? null
                                : flexRender(
                                    header.column.columnDef.header,
                                    header.getContext()
                                  )}
                            </TableHead>
                          ))}
                        </TableRow>
                      ))}
                    </TableHeader>
                    <TableBody>
                      {table.getRowModel().rows.length === 0 ? (
                        <TableRow>
                          <TableCell
                            colSpan={columns.length}
                            className="h-24 text-center text-muted-foreground"
                          >
                            No results found
                          </TableCell>
                        </TableRow>
                      ) : (
                        table.getRowModel().rows.map((row) => (
                          <TableRow
                            key={row.id}
                            className="cursor-pointer"
                            onClick={() => handleRowClick(row.original.symbol)}
                          >
                            {row.getVisibleCells().map((cell) => (
                              <TableCell key={cell.id}>
                                {flexRender(
                                  cell.column.columnDef.cell,
                                  cell.getContext()
                                )}
                              </TableCell>
                            ))}
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
