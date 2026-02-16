"use client";

import { Card } from "@/components/ui/card";
import { CheckCircle2, Database } from "lucide-react";

interface DataProvidersProps {
  marketData: string;
  screener: string;
}

export function DataProviders({ marketData, screener }: DataProvidersProps) {
  return (
    <Card className="p-6">
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-muted-foreground">Data Providers</h3>
        
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="h-5 w-5 text-emerald-400" />
            <div className="flex-1">
              <div className="text-sm font-medium text-foreground">Market Data</div>
              <div className="text-xs text-muted-foreground">{marketData}</div>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            <CheckCircle2 className="h-5 w-5 text-emerald-400" />
            <div className="flex-1">
              <div className="text-sm font-medium text-foreground">Screener</div>
              <div className="text-xs text-muted-foreground">{screener}</div>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}
