"use client";

import { useRouter } from "next/navigation";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  type SortingState,
} from "@tanstack/react-table";
import { useState } from "react";
import type { Evaluation } from "@/lib/api/types";
import { evalColumns } from "./eval-table-columns";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  evaluations: Evaluation[];
  selectedIds?: string[];
  onSelectionChange?: (ids: string[]) => void;
  selectionMode?: boolean;
}

export function EvalTable({ evaluations, selectedIds = [], onSelectionChange, selectionMode = false }: Props) {
  const router = useRouter();
  const [sorting, setSorting] = useState<SortingState>([
    { id: "timestamp", desc: true },
  ]);

  const handleCheckboxChange = (id: string, checked: boolean) => {
    if (!onSelectionChange) return;
    
    if (checked) {
      // Add to selection (max 5)
      if (selectedIds.length < 5) {
        onSelectionChange([...selectedIds, id]);
      }
    } else {
      // Remove from selection
      onSelectionChange(selectedIds.filter((selectedId) => selectedId !== id));
    }
  };

  const table = useReactTable({
    data: evaluations,
    columns: evalColumns,
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
              {selectionMode && (
                <TableHead className="w-12">
                  <span className="text-xs text-muted-foreground">Select</span>
                </TableHead>
              )}
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
          {table.getRowModel().rows.map((row) => {
            const isSelected = selectedIds.includes(row.original.id);
            const isDisabled = selectionMode && !isSelected && selectedIds.length >= 5;
            
            return (
              <TableRow
                key={row.id}
                className={cn(
                  "transition-colors",
                  !selectionMode && "cursor-pointer hover:bg-accent/50",
                  isSelected && "bg-accent/30"
                )}
                onClick={() => {
                  if (!selectionMode) {
                    router.push(`/evals/${row.original.id}`);
                  }
                }}
              >
                {selectionMode && (
                  <TableCell className="py-2">
                    <Checkbox
                      checked={isSelected}
                      disabled={isDisabled}
                      onCheckedChange={(checked) =>
                        handleCheckboxChange(row.original.id, checked === true)
                      }
                      onClick={(e) => e.stopPropagation()}
                    />
                  </TableCell>
                )}
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id} className="py-2">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            );
          })}
          {table.getRowModel().rows.length === 0 && (
            <TableRow>
              <TableCell
                colSpan={evalColumns.length + (selectionMode ? 1 : 0)}
                className="py-8 text-center text-sm text-muted-foreground"
              >
                No evaluations found
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
