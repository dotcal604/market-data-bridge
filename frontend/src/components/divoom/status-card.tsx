"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Monitor, Wifi, WifiOff, RefreshCw } from "lucide-react";
import type { DivoomStatusData } from "@/lib/api/types";

interface StatusCardProps {
  status: DivoomStatusData | null;
  loading?: boolean;
}

export function StatusCard({ status, loading }: StatusCardProps) {
  if (loading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Monitor className="h-4 w-4" />
            TimesFrame Display
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-4 w-3/4 animate-pulse rounded bg-muted" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!status) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Monitor className="h-4 w-4 text-muted-foreground" />
            TimesFrame Display
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Display not configured. Set <code className="font-mono text-xs">DIVOOM_ENABLED=true</code> and <code className="font-mono text-xs">DIVOOM_DEVICE_IP</code>.
          </p>
        </CardContent>
      </Card>
    );
  }

  const connected = status.connected;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Monitor className="h-4 w-4" />
          TimesFrame Display
          <Badge variant={connected ? "default" : "destructive"} className="ml-auto text-[10px]">
            {connected ? "Connected" : "Disconnected"}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
          <Row label="Device IP" value={status.deviceIp || "—"} />
          <Row label="Port" value={String(status.port)} />
          <Row label="Refresh" value={`${(status.refreshIntervalMs / 1000).toFixed(0)}s`} />
          <Row label="Brightness" value={`${status.brightness}%`} />
          <Row label="Session" value={status.lastSession || "—"} />
          <Row
            label="Data Source"
            value={status.lastIbkrConnected ? "LIVE" : "DLY"}
            valueClass={status.lastIbkrConnected ? "text-emerald-400" : "text-yellow-400"}
          />
        </div>
        {status.lastRefreshAt && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <RefreshCw className="h-3 w-3" />
            Last refresh: {new Date(status.lastRefreshAt).toLocaleTimeString()}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Row({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <>
      <span className="text-muted-foreground">{label}</span>
      <span className={valueClass ?? "font-mono text-foreground"}>{value}</span>
    </>
  );
}
