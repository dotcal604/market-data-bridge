"use client";

import { useStatus } from "@/lib/hooks/use-status";
import { SystemStatus } from "@/components/status/system-status";
import { MarketSession } from "@/components/status/market-session";
import { IbkrStatus } from "@/components/status/ibkr-status";
import { DataProviders } from "@/components/status/data-providers";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle } from "lucide-react";

export default function StatusPage() {
  const { data: status, isLoading, error } = useStatus();

  if (isLoading) {
    return (
      <div className="flex h-full flex-col gap-6 p-8">
        <div>
          <h1 className="text-2xl font-bold">System Status</h1>
          <p className="text-sm text-muted-foreground">
            Bridge status, market session, and data availability
          </p>
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </div>
      </div>
    );
  }

  if (error || !status) {
    return (
      <div className="flex h-full flex-col gap-6 p-8">
        <div>
          <h1 className="text-2xl font-bold">System Status</h1>
          <p className="text-sm text-muted-foreground">
            Bridge status, market session, and data availability
          </p>
        </div>
        <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-red-400/50 bg-red-400/10 p-8">
          <AlertCircle className="h-12 w-12 text-red-400" />
          <div className="text-center">
            <h3 className="text-lg font-semibold text-red-400">Unable to fetch status</h3>
            <p className="text-sm text-muted-foreground">
              {error instanceof Error ? error.message : "An unknown error occurred"}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-6 p-8">
      <div>
        <h1 className="text-2xl font-bold">System Status</h1>
        <p className="text-sm text-muted-foreground">
          Bridge status, market session, and data availability
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <SystemStatus status={status.status} timestamp={status.timestamp} />
        <MarketSession session={status.marketSession} easternTime={status.easternTime} />
        <IbkrStatus ibkr={status.ibkr} />
        <DataProviders marketData={status.marketData} screener={status.screener} />
      </div>
    </div>
  );
}
