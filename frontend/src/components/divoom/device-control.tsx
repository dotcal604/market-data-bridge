"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Monitor, Moon, Sun, Loader2 } from "lucide-react";
import {
  useDivoomDevice,
  useDivoomSetDevice,
} from "@/lib/hooks/use-divoom";

export function DeviceControl() {
  const { data: device, isLoading } = useDivoomDevice();
  const mutation = useDivoomSetDevice();

  const [refreshSec, setRefreshSec] = useState(10);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [compositeEnabled, setCompositeEnabled] = useState(false);

  // Sync from server state
  useEffect(() => {
    if (!device) return;
    setRefreshSec(Math.round(device.refreshIntervalMs / 1000));
    setTheme(device.theme);
    setCompositeEnabled(device.compositeEnabled);
  }, [device]);

  function commitRefresh(val: number[]) {
    const sec = val[0];
    setRefreshSec(sec);
    mutation.mutate({ refreshIntervalMs: sec * 1000 });
  }

  function commitTheme(t: "dark" | "light") {
    setTheme(t);
    mutation.mutate({ theme: t });
  }

  function commitComposite(enabled: boolean) {
    setCompositeEnabled(enabled);
    mutation.mutate({ compositeEnabled: enabled });
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Monitor className="h-4 w-4" />
          Device Settings
          {mutation.isPending && (
            <Loader2 className="ml-auto h-3 w-3 animate-spin text-muted-foreground" />
          )}
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* ── 1. Refresh Rate ─────────────────────── */}
        <div>
          <div className="mb-1.5 flex items-center gap-2 text-xs text-muted-foreground">
            Refresh Rate
            <Badge variant="outline" className="ml-auto font-mono text-[10px]">
              {refreshSec}s
            </Badge>
          </div>
          <Slider
            min={4}
            max={30}
            step={1}
            value={[refreshSec]}
            onValueChange={(v) => setRefreshSec(v[0])}
            onValueCommit={commitRefresh}
            disabled={mutation.isPending}
            className="mt-1"
          />
          <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
            <span>4s (fast)</span>
            <span>10s</span>
            <span>30s (slow)</span>
          </div>
        </div>

        {/* ── 2. Theme ────────────────────────────── */}
        <div>
          <div className="mb-1.5 text-xs text-muted-foreground">Theme</div>
          <div className="flex gap-1">
            <Button
              variant={theme === "dark" ? "default" : "outline"}
              size="sm"
              className="flex-1 gap-1.5 text-xs"
              onClick={() => commitTheme("dark")}
              disabled={mutation.isPending}
            >
              <Moon className="h-3.5 w-3.5" />
              Dark
            </Button>
            <Button
              variant={theme === "light" ? "default" : "outline"}
              size="sm"
              className="flex-1 gap-1.5 text-xs"
              onClick={() => commitTheme("light")}
              disabled={mutation.isPending}
            >
              <Sun className="h-3.5 w-3.5" />
              Light
            </Button>
          </div>
        </div>

        {/* ── 3. Composite Rendering ──────────────── */}
        <div className="flex items-center gap-3">
          <Switch
            checked={compositeEnabled}
            onCheckedChange={commitComposite}
            disabled={mutation.isPending}
          />
          <div className="flex flex-1 items-center gap-2">
            <span className="text-xs">Composite Rendering</span>
            <Badge
              variant={compositeEnabled ? "default" : "secondary"}
              className="ml-auto font-mono text-[10px]"
            >
              {compositeEnabled ? "ON" : "OFF"}
            </Badge>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
