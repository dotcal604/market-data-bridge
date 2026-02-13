"use client";

import { Circle } from "lucide-react";
import { useEffect, useState } from "react";

function useBackendStatus() {
  const [status, setStatus] = useState<"connected" | "disconnected" | "checking">("checking");

  useEffect(() => {
    let mounted = true;
    const check = async () => {
      try {
        const res = await fetch("/api/status");
        if (mounted) setStatus(res.ok ? "connected" : "disconnected");
      } catch {
        if (mounted) setStatus("disconnected");
      }
    };
    check();
    const interval = setInterval(check, 15_000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  return status;
}

export function TopBar() {
  const status = useBackendStatus();

  return (
    <header className="flex h-12 items-center justify-between border-b border-border bg-card px-6">
      <div />

      <div className="flex items-center gap-4">
        {/* Connection indicator */}
        <div className="flex items-center gap-2 text-xs">
          <Circle
            className={
              status === "connected"
                ? "h-2 w-2 fill-emerald-400 text-emerald-400"
                : status === "disconnected"
                  ? "h-2 w-2 fill-red-400 text-red-400"
                  : "h-2 w-2 fill-yellow-400 text-yellow-400"
            }
          />
          <span className="font-mono text-muted-foreground">
            {status === "connected" ? "API Connected" : status === "disconnected" ? "Disconnected" : "Checking..."}
          </span>
        </div>
      </div>
    </header>
  );
}
