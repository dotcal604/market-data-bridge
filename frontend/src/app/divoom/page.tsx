"use client";

import { DisplayPreview } from "@/components/divoom/display-preview";
import { StatusCard } from "@/components/divoom/status-card";
import { ChartThumbnails } from "@/components/divoom/chart-thumbnails";
import { BrightnessControl } from "@/components/divoom/brightness-control";
import { BackgroundControl } from "@/components/divoom/background-control";
import { Button } from "@/components/ui/button";
import { RefreshCw, Loader2 } from "lucide-react";
import {
  useDivoomStatus,
  useDivoomPreview,
  useDivoomBrightness,
  useDivoomRefresh,
} from "@/lib/hooks/use-divoom";

export default function DivoomPage() {
  const { data: status, isLoading: statusLoading } = useDivoomStatus();
  const { data: preview, isLoading: previewLoading, dataUpdatedAt } = useDivoomPreview();
  const brightnessMutation = useDivoomBrightness();
  const refreshMutation = useDivoomRefresh();

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">TimesFrame Display</h1>
          <p className="text-sm text-muted-foreground">
            Divoom TimesFrame market data dashboard
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refreshMutation.mutate()}
          disabled={refreshMutation.isPending}
        >
          {refreshMutation.isPending ? (
            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-3.5 w-3.5" />
          )}
          Refresh
        </Button>
      </div>

      {/* Main layout: preview left, controls right */}
      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        {/* Left: display preview */}
        <div>
          <DisplayPreview data={preview ?? null} loading={previewLoading} />
        </div>

        {/* Right: status, charts, brightness */}
        <div className="space-y-4">
          <StatusCard status={status ?? null} loading={statusLoading} />
          <BrightnessControl
            initialValue={status?.brightness ?? 80}
            onBrightnessChange={(v) => brightnessMutation.mutate(v)}
            disabled={!status?.connected}
          />
          <BackgroundControl />
          <ChartThumbnails refreshKey={dataUpdatedAt} />
        </div>
      </div>
    </div>
  );
}
