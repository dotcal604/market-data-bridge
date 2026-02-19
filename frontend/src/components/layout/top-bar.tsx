"use client";

import { Circle } from "lucide-react";
import { useEffect, useState } from "react";
import { useWebSocket } from "@/lib/hooks/useWebSocket";

type ConnectionMode = "ws" | "polling" | "checking";

function useBackendStatus() {
  const [apiOk, setApiOk] = useState<boolean | null>(null);
  const { data: wsStatus, connected: wsConnected } = useWebSocket<{ ibkr_connected: boolean }>("status");

  // REST fallback — poll every 15s to confirm API reachability
  useEffect(() => {
    let mounted = true;
    const check = async () => {
      try {
        const res = await fetch("/api/status");
        if (mounted) setApiOk(res.ok);
      } catch {
        if (mounted) setApiOk(false);
      }
    };
    check();
    const interval = setInterval(check, 15_000);
    return () => { mounted = false; clearInterval(interval); };
  }, []);

  const mode: ConnectionMode = wsConnected ? "ws" : apiOk === null ? "checking" : "polling";
  const connected = wsConnected || apiOk === true;
  const ibkrConnected = wsStatus?.ibkr_connected ?? false;

  return { mode, connected, ibkrConnected };
}

export function TopBar() {
  const { mode, connected, ibkrConnected } = useBackendStatus();

  const dotColor = connected
    ? mode === "ws"
      ? "h-2 w-2 fill-emerald-400 text-emerald-400"
      : "h-2 w-2 fill-yellow-400 text-yellow-400"
    : "h-2 w-2 fill-red-400 text-red-400";

  const label = !connected
    ? "Disconnected"
    : mode === "checking"
      ? "Checking..."
      : mode === "ws"
        ? `WS${ibkrConnected ? " · IBKR" : ""}`
        : "Polling";

  return (
    <header className="flex h-12 items-center justify-between border-b border-border bg-card px-6">
      <div />

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 text-xs">
          <Circle className={dotColor} />
          <span className="font-mono text-muted-foreground">{label}</span>
        </div>
      </div>
    </header>
  );
}
