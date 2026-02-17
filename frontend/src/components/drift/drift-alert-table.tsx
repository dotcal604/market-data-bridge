"use client";

import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import type { DriftAlert } from "@/lib/api/types";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatTimestamp } from "@/lib/utils/formatters";
import { AlertTriangle } from "lucide-react";

const col = createColumnHelper<DriftAlert>();

function getSeverityColor(alertType: DriftAlert["alert_type"]) {
  switch (alertType) {
    case "regime_shift":
      return "destructive";
    case "accuracy_low":
      return "destructive";
    case "calibration_high":
      return "default";
    default:
      return "secondary";
  }
}

function getSeverityLabel(alertType: DriftAlert["alert_type"]) {
  switch (alertType) {
    case "regime_shift":
      return "Regime Shift";
    case "accuracy_low":
      return "Low Accuracy";
    case "calibration_high":
      return "High Calibration Error";
    default:
      return alertType;
  }
}

const columns = [
  col.accessor("timestamp", {
    header: "Time",
    cell: (info) => (
      <span className="text-xs text-muted-foreground">
        {formatTimestamp(info.getValue())}
      </span>
    ),
  }),
  col.accessor("alert_type", {
    header: "Severity",
    cell: (info) => (
      <Badge variant={getSeverityColor(info.getValue())}>
        {getSeverityLabel(info.getValue())}
      </Badge>
    ),
  }),
  col.accessor("model_id", {
    header: "Model",
    cell: (info) => (
      <span className="font-mono text-xs">
        {info.getValue() ?? "All Models"}
      </span>
    ),
  }),
  col.accessor("metric_value", {
    header: "Value",
    cell: (info) => (
      <span className="font-mono text-xs">
        {(info.getValue() * 100).toFixed(1)}%
      </span>
    ),
  }),
  col.accessor("threshold", {
    header: "Threshold",
    cell: (info) => (
      <span className="font-mono text-xs text-muted-foreground">
        {(info.getValue() * 100).toFixed(1)}%
      </span>
    ),
  }),
  col.accessor("message", {
    header: "Message",
    cell: (info) => (
      <span className="text-xs text-muted-foreground">{info.getValue()}</span>
    ),
  }),
];

interface DriftAlertTableProps {
  alerts: DriftAlert[];
}

export function DriftAlertTable({ alerts }: DriftAlertTableProps) {
  const table = useReactTable({
    data: alerts,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <Card className="bg-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <AlertTriangle className="h-5 w-5 text-yellow-400" />
          Drift Alerts
        </CardTitle>
      </CardHeader>
      <CardContent>
        {alerts.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-sm text-muted-foreground">No drift alerts</p>
          </div>
        ) : (
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
                {table.getRowModel().rows.map((row) => (
                  <TableRow key={row.id}>
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext()
                        )}
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
