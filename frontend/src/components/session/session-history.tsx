"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useExecutions } from "@/lib/hooks/use-executions";
import { useSession } from "@/lib/hooks/use-session";
import { Clock, TrendingUp, TrendingDown, Lock, Unlock, RefreshCw } from "lucide-react";

function formatTime(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatPnl(pnl: number): string {
  const sign = pnl >= 0 ? "+" : "";
  return `${sign}$${pnl.toFixed(2)}`;
}

export function SessionHistory() {
  const { data: session, isLoading: sessionLoading } = useSession();
  const { data: executions, isLoading: execLoading } = useExecutions();

  if (sessionLoading || execLoading) {
    return <Skeleton className="h-96 rounded-lg" />;
  }

  const recentExecs = executions?.executions?.slice(0, 10) ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Session Activity</CardTitle>
      </CardHeader>
      <CardContent>
        {/* Session Status Summary */}
        {session && (
          <div className="mb-4 space-y-2 rounded-md border border-border bg-muted/30 p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Session Date</span>
              <span className="font-mono text-sm">{session.date}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Status</span>
              <Badge variant={session.locked ? "destructive" : "default"}>
                {session.locked ? (
                  <>
                    <Lock className="mr-1 h-3 w-3" />
                    Locked
                  </>
                ) : (
                  <>
                    <Unlock className="mr-1 h-3 w-3" />
                    Active
                  </>
                )}
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Daily P&L</span>
              <span
                className={`font-mono text-sm font-bold ${
                  session.realizedPnl >= 0 ? "text-emerald-400" : "text-red-400"
                }`}
              >
                {formatPnl(session.realizedPnl)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Trades</span>
              <span className="font-mono text-sm">
                {session.tradeCount} / {session.limits.maxDailyTrades}
              </span>
            </div>
            {session.consecutiveLosses > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Consecutive Losses</span>
                <span
                  className={`font-mono text-sm font-bold ${
                    session.consecutiveLosses >= session.limits.consecutiveLossLimit
                      ? "text-red-400"
                      : "text-yellow-400"
                  }`}
                >
                  {session.consecutiveLosses}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Recent Executions */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Clock className="h-3 w-3" />
            Recent Executions
          </div>

          {recentExecs.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-sm text-muted-foreground">No executions today</p>
            </div>
          ) : (
            <div className="space-y-1">
              {recentExecs.map((exec, idx) => {
                const side = exec.side?.toUpperCase() || "";
                const isBuy = side === "BUY" || side === "BOT";
                const Icon = isBuy ? TrendingUp : TrendingDown;
                const sideColor = isBuy ? "text-emerald-400" : "text-red-400";

                return (
                  <div
                    key={idx}
                    className="flex items-center justify-between rounded-md border border-border/50 bg-card px-3 py-2 text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <Icon className={`h-3 w-3 ${sideColor}`} />
                      <span className="font-mono font-medium">{exec.symbol}</span>
                      <Badge variant="outline" className="font-mono text-[10px]">
                        {side}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-mono">{exec.shares}@${exec.price?.toFixed(2)}</span>
                      <span className="text-muted-foreground">
                        {formatTime(exec.time || "")}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Lock Reason if Locked */}
        {session?.locked && session.lockReason && (
          <div className="mt-4 rounded-md border border-red-600/30 bg-red-600/10 p-3">
            <div className="flex items-start gap-2">
              <Lock className="mt-0.5 h-4 w-4 text-red-400" />
              <div>
                <p className="text-xs font-medium text-red-400">Session Locked</p>
                <p className="mt-1 text-xs text-muted-foreground">{session.lockReason}</p>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
