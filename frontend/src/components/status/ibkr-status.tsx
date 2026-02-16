"use client";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Circle, Server, AlertCircle } from "lucide-react";

interface IbkrStatusProps {
  ibkr: {
    connected: boolean;
    host: string;
    port: number;
    clientId: number;
    note: string;
  };
}

export function IbkrStatus({ ibkr }: IbkrStatusProps) {
  return (
    <Card className="p-6">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <h3 className="text-sm font-medium text-muted-foreground">IBKR Connection</h3>
            <div className="flex items-center gap-2">
              <Circle
                className={
                  ibkr.connected
                    ? "h-2 w-2 fill-emerald-400 text-emerald-400"
                    : "h-2 w-2 fill-red-400 text-red-400"
                }
              />
              <Badge
                variant="outline"
                className={
                  ibkr.connected
                    ? "border-emerald-400/50 bg-emerald-400/10 text-emerald-400"
                    : "border-red-400/50 bg-red-400/10 text-red-400"
                }
              >
                {ibkr.connected ? "Connected" : "Disconnected"}
              </Badge>
            </div>
          </div>
        </div>

        <div className="space-y-2 border-t border-border pt-4">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Host</span>
            <span className="font-mono text-foreground">{ibkr.host}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Port</span>
            <span className="font-mono text-foreground">{ibkr.port}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Client ID</span>
            <span className="font-mono text-foreground">{ibkr.clientId}</span>
          </div>
        </div>

        <div className="flex items-start gap-2 rounded-md bg-muted/50 p-3">
          {ibkr.connected ? (
            <Server className="h-4 w-4 text-emerald-400 mt-0.5" />
          ) : (
            <AlertCircle className="h-4 w-4 text-yellow-400 mt-0.5" />
          )}
          <p className="text-xs text-muted-foreground leading-relaxed">{ibkr.note}</p>
        </div>
      </div>
    </Card>
  );
}
