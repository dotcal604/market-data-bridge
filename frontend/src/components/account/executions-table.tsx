"use client";

import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  type SortingState,
} from "@tanstack/react-table";
import { useState, useEffect } from "react";
import type { Execution } from "@/lib/api/types";
import { executionColumns } from "./executions-table-columns";
import { useExecutions } from "@/lib/hooks/use-executions";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface ExecutionsTableProps {
  refreshInterval?: number;
}

export function ExecutionsTable({ refreshInterval = 30000 }: ExecutionsTableProps) {
  const [sorting, setSorting] = useState<SortingState>([
    { id: "time", desc: true },
  ]);
  const [symbolFilter, setSymbolFilter] = useState("");
  const [debouncedSymbol, setDebouncedSymbol] = useState("");

  // Debounce symbol filter
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSymbol(symbolFilter);
    }, 300);
    return () => clearTimeout(timer);
  }, [symbolFilter]);

  const { data, isLoading, error } = useExecutions(
    debouncedSymbol || undefined,
    undefined,
    undefined,
    refreshInterval
  );

  const executions = data?.executions ?? [];

  const table = useReactTable({
    data: executions,
    columns: executionColumns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <Card className="p-6">
      {/* Filter Bar */}
      <div className="mb-4 flex items-end gap-4">
        <div className="flex-1">
          <Label htmlFor="symbol-filter" className="text-xs text-muted-foreground">
            Symbol
          </Label>
          <Input
            id="symbol-filter"
            placeholder="Filter by symbol (e.g., AAPL)"
            value={symbolFilter}
            onChange={(e) => setSymbolFilter(e.target.value.toUpperCase())}
            className="mt-1"
          />
        </div>
      </div>

      {/* Connection Error */}
      {data?.error && (
        <div className="mb-4 rounded-md border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400">
          {data.error}
        </div>
      )}

      {/* Loading State */}
      {isLoading && (
        <div className="py-8 text-center text-sm text-muted-foreground">
          Loading executions...
        </div>
      )}

      {/* Error State */}
      {error && !data && (
        <div className="py-8 text-center text-sm text-red-400">
          Error: {error.message}
        </div>
      )}

      {/* Table */}
      {!isLoading && !error && (
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
                <TableRow
                  key={row.id}
                  className="transition-colors hover:bg-accent/50"
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className="py-2">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
              {table.getRowModel().rows.length === 0 && !data?.error && (
                <TableRow>
                  <TableCell
                    colSpan={executionColumns.length}
                    className="py-8 text-center text-sm text-muted-foreground"
                  >
                    No executions found
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Results Count */}
      {!isLoading && !error && data && (
        <div className="mt-3 text-xs text-muted-foreground">
          {data.count} execution{data.count !== 1 ? "s" : ""} found
        </div>
      )}
    </Card>
  );
}
