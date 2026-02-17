"use client";

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
import { Skeleton } from "@/components/ui/skeleton";
import { formatPrice, formatTimestamp } from "@/lib/utils/formatters";
import { AlertCircle } from "lucide-react";

export function HollyAlerts() {
  const { data, isLoading, error } = useHollyAlerts({ limit: 50 });

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Holly AI Alerts</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <AlertCircle className="h-4 w-4" />
            <span>Failed to load alerts</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Holly AI Alerts</CardTitle>
        <p className="text-sm text-muted-foreground">
          Recent Trade Ideas alerts (auto-refresh every 30s)
        </p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 10 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : data && data.alerts.length > 0 ? (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Strategy</TableHead>
                  <TableHead>Entry Price</TableHead>
                  <TableHead>Alert Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.alerts.map((alert) => (
                  <TableRow key={alert.id}>
                    <TableCell className="font-mono font-semibold">
                      {alert.symbol}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {alert.strategy ?? "—"}
                    </TableCell>
                    <TableCell className="font-mono">
                      {formatPrice(alert.entry_price)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatTimestamp(alert.alert_time)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No alerts found</p>
        )}
      </CardContent>
    </Card>
  );
}
