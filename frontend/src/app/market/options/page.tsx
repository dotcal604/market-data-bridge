"use client";

import { useState } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  createColumnHelper,
  type SortingState,
} from "@tanstack/react-table";
import { ArrowUpDown, TrendingUp } from "lucide-react";
import { SymbolSearch } from "@/components/market/SymbolSearch";
import { useOptionsChain } from "@/lib/hooks/use-options";
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
import { cn } from "@/lib/utils";
import type { OptionContract } from "@/lib/api/types";

const col = createColumnHelper<OptionContract>();

const columns = [
  col.accessor("strike", {
    header: ({ column }) => (
      <button
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        className="flex items-center gap-1 hover:text-foreground"
      >
        Strike
        <ArrowUpDown className="h-3 w-3" />
      </button>
    ),
    cell: (info) => (
      <span className="font-mono text-sm font-semibold">
        ${info.getValue().toFixed(2)}
      </span>
    ),
  }),
  col.accessor("lastPrice", {
    header: "Last",
    cell: (info) => {
      const val = info.getValue();
      return (
        <span className="font-mono text-sm">
          {val !== null ? `$${val.toFixed(2)}` : "—"}
        </span>
      );
    },
  }),
  col.accessor("bid", {
    header: "Bid",
    cell: (info) => {
      const val = info.getValue();
      return (
        <span className="font-mono text-sm">
          {val !== null ? `$${val.toFixed(2)}` : "—"}
        </span>
      );
    },
  }),
  col.accessor("ask", {
    header: "Ask",
    cell: (info) => {
      const val = info.getValue();
      return (
        <span className="font-mono text-sm">
          {val !== null ? `$${val.toFixed(2)}` : "—"}
        </span>
      );
    },
  }),
  col.accessor("volume", {
    header: ({ column }) => (
      <button
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        className="flex items-center gap-1 hover:text-foreground"
      >
        Volume
        <ArrowUpDown className="h-3 w-3" />
      </button>
    ),
    cell: (info) => {
      const val = info.getValue();
      return (
        <span className="font-mono text-sm">
          {val !== null ? val.toLocaleString() : "—"}
        </span>
      );
    },
  }),
  col.accessor("openInterest", {
    header: ({ column }) => (
      <button
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        className="flex items-center gap-1 hover:text-foreground"
      >
        OI
        <ArrowUpDown className="h-3 w-3" />
      </button>
    ),
    cell: (info) => {
      const val = info.getValue();
      return (
        <span className="font-mono text-sm">
          {val !== null ? val.toLocaleString() : "—"}
        </span>
      );
    },
  }),
  col.accessor("impliedVolatility", {
    header: ({ column }) => (
      <button
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        className="flex items-center gap-1 hover:text-foreground"
      >
        IV
        <ArrowUpDown className="h-3 w-3" />
      </button>
    ),
    cell: (info) => {
      const val = info.getValue();
      return (
        <span className="font-mono text-sm">
          {val !== null ? `${(val * 100).toFixed(1)}%` : "—"}
        </span>
      );
    },
  }),
];

interface OptionsTableProps {
  data: OptionContract[];
  title: string;
  type: "calls" | "puts";
}

function OptionsTable({ data, title, type }: OptionsTableProps) {
  const [sorting, setSorting] = useState<SortingState>([]);

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span>{title}</span>
          <Badge variant={type === "calls" ? "default" : "destructive"} className="text-xs">
            {data.length} contracts
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <TableHead key={header.id} className="text-muted-foreground">
                      {flexRender(header.column.columnDef.header, header.getContext())}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={columns.length} className="h-24 text-center">
                    <span className="text-sm text-muted-foreground">No contracts available</span>
                  </TableCell>
                </TableRow>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <TableRow
                    key={row.id}
                    className={cn(
                      row.original.inTheMoney
                        ? type === "calls"
                          ? "bg-emerald-400/5 hover:bg-emerald-400/10"
                          : "bg-red-400/5 hover:bg-red-400/10"
                        : "hover:bg-accent"
                    )}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

export default function OptionsChainPage() {
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [selectedExpiration, setSelectedExpiration] = useState<string | undefined>(undefined);

  const { data, isLoading, error } = useOptionsChain(selectedSymbol, selectedExpiration);

  return (
    <div className="flex h-screen flex-col">
      <div className="border-b border-border px-6 py-4">
        <div className="flex items-center gap-4">
          <TrendingUp className="h-6 w-6 text-emerald-400" />
          <h1 className="text-2xl font-bold">Options Chain</h1>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="p-6 space-y-6">
          {/* Symbol Search */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Search Symbol</CardTitle>
            </CardHeader>
            <CardContent>
              <SymbolSearch onSelect={setSelectedSymbol} className="max-w-md" />
              {selectedSymbol && (
                <div className="mt-4">
                  <span className="text-sm text-muted-foreground">Selected: </span>
                  <span className="font-mono text-sm font-semibold">{selectedSymbol}</span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Expiration Selector */}
          {data && data.expirations.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Expiration Date</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => setSelectedExpiration(undefined)}
                    className={cn(
                      "rounded-md px-4 py-2 text-sm font-medium transition-colors",
                      !selectedExpiration
                        ? "bg-emerald-400 text-black"
                        : "bg-card border border-border text-foreground hover:bg-accent"
                    )}
                  >
                    All Expirations
                  </button>
                  {data.expirations.map((exp) => (
                    <button
                      key={exp}
                      onClick={() => setSelectedExpiration(exp)}
                      className={cn(
                        "rounded-md px-4 py-2 font-mono text-sm font-medium transition-colors",
                        selectedExpiration === exp
                          ? "bg-emerald-400 text-black"
                          : "bg-card border border-border text-foreground hover:bg-accent"
                      )}
                    >
                      {exp.slice(0, 4)}-{exp.slice(4, 6)}-{exp.slice(6, 8)}
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Loading State */}
          {isLoading && (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <Skeleton className="h-6 w-32" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-64 w-full" />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <Skeleton className="h-6 w-32" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-64 w-full" />
                </CardContent>
              </Card>
            </div>
          )}

          {/* Error State */}
          {error && (
            <Card>
              <CardContent className="py-8">
                <div className="text-center">
                  <p className="text-sm text-red-400">
                    Error loading options chain: {error.message}
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Options Tables */}
          {data && !isLoading && (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <OptionsTable data={data.calls} title="Calls" type="calls" />
              <OptionsTable data={data.puts} title="Puts" type="puts" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
