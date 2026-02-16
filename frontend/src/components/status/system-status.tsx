"use client";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Circle, CheckCircle2, Clock } from "lucide-react";
import { formatTimestamp } from "@/lib/utils/formatters";

interface SystemStatusProps {
  status: string;
  timestamp: string;
}

export function SystemStatus({ status, timestamp }: SystemStatusProps) {
  const isReady = status === "ready";

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h3 className="text-sm font-medium text-muted-foreground">System Status</h3>
          <div className="flex items-center gap-2">
            {isReady ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-400" />
            ) : (
              <Circle className="h-5 w-5 text-red-400" />
            )}
            <Badge
              variant="outline"
              className={
                isReady
                  ? "border-emerald-400/50 bg-emerald-400/10 text-emerald-400"
                  : "border-red-400/50 bg-red-400/10 text-red-400"
              }
            >
              {status.toUpperCase()}
            </Badge>
          </div>
        </div>
        <div className="text-right">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            <span className="font-mono">{formatTimestamp(timestamp)}</span>
          </div>
        </div>
      </div>
    </Card>
  );
}
