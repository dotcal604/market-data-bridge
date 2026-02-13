"use client";

import { useRouter } from "next/navigation";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  createColumnHelper,
  type SortingState,
} from "@tanstack/react-table";
import { useState } from "react";
import type { ScreenerResult } from "@/lib/api/types";
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
import { formatPrice, formatDecimalPercent } from "@/lib/utils/formatters";

interface Props {
  results: ScreenerResult[];
}

const columnHelper = createColumnHelper<ScreenerResult>();

const columns = [
  columnHelper.accessor("rank", {
    header: "#",
    cell: (info) => (
      <span className="font-mono text-xs text-muted-foreground">
        {info.getValue()}
      </span>
    ),
    size: 40,
  }),
  columnHelper.accessor("symbol", {
    header: "Symbol",
    cell: (info) => (
      <span className="font-mono font-semibold">{info.getValue()}</span>
    ),
    size: 80,
  }),
  columnHelper.accessor("longName", {
    header: "Name",
    cell: (info) => (
      <span className="truncate text-sm">{info.getValue() ?? "—"}</span>
    ),
    size: 200,
  }),
  columnHelper.accessor("last", {
    header: "Last",
    cell: (info) => (
      <span className="font-mono text-sm">
        {formatPrice(info.getValue())}
      </span>
    ),
    size: 80,
  }),
  columnHelper.accessor("changePercent", {
    header: "Change %",
    cell: (info) => {
      const value = info.getValue();
      if (value == null) return <span className="text-muted-foreground">—</span>;
      const isPositive = value >= 0;
      return (
        <span
          className={cn(
            "font-mono text-sm font-medium",
            isPositive ? "text-emerald-400" : "text-red-400"
          )}
        >
          {isPositive ? "+" : ""}
          {formatDecimalPercent(value)}
        </span>
      );
    },
    size: 100,
  }),
  columnHelper.accessor("volume", {
    header: "Volume",
    cell: (info) => {
      const value = info.getValue();
      if (value == null) return <span className="text-muted-foreground">—</span>;
      return (
        <span className="font-mono text-sm">
          {value >= 1_000_000
            ? `${(value / 1_000_000).toFixed(2)}M`
            : value >= 1_000
            ? `${(value / 1_000).toFixed(0)}K`
            : value.toLocaleString()}
        </span>
      );
    },
    size: 100,
  }),
  columnHelper.accessor("sector", {
    header: "Sector",
    cell: (info) => (
      <span className="text-xs text-muted-foreground">
        {info.getValue() ?? "—"}
      </span>
    ),
    size: 150,
  }),
  columnHelper.accessor("trailingPE", {
    header: "P/E",
    cell: (info) => {
      const value = info.getValue();
      if (value == null) return <span className="text-muted-foreground">—</span>;
      return <span className="font-mono text-sm">{value.toFixed(2)}</span>;
    },
    size: 80,
  }),
];

export function ResultsTable({ results }: Props) {
  const router = useRouter();
  const [sorting, setSorting] = useState<SortingState>([]);

  const table = useReactTable({
    data: results,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
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
                    {flexRender(
                      header.column.columnDef.header,
                      header.getContext()
                    )}
                    {header.column.getCanSort() && (
                      <ArrowUpDown className="h-3 w-3 opacity-50" />
                    )}
                  </div>
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columns.length} className="h-24 text-center">
                <span className="text-sm text-muted-foreground">
                  No results found
                </span>
              </TableCell>
            </TableRow>
          ) : (
            table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                className="cursor-pointer hover:bg-accent/50"
                onClick={() => {
                  const symbol = row.original.symbol;
                  if (symbol) {
                    router.push(`/account?symbol=${symbol}`);
                  }
                }}
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
  );
}
