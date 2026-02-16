"use client";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Clock, TrendingUp } from "lucide-react";

interface MarketSessionProps {
  session: "pre-market" | "regular" | "after-hours" | "closed";
  easternTime: string;
}

const SESSION_CONFIG = {
  "pre-market": {
    label: "Pre-Market",
    color: "text-yellow-400",
    bgColor: "border-yellow-400/50 bg-yellow-400/10 text-yellow-400",
    description: "4:00 AM - 9:30 AM ET",
  },
  "regular": {
    label: "Regular Hours",
    color: "text-emerald-400",
    bgColor: "border-emerald-400/50 bg-emerald-400/10 text-emerald-400",
    description: "9:30 AM - 4:00 PM ET",
  },
  "after-hours": {
    label: "After-Hours",
    color: "text-blue-400",
    bgColor: "border-blue-400/50 bg-blue-400/10 text-blue-400",
    description: "4:00 PM - 8:00 PM ET",
  },
  "closed": {
    label: "Market Closed",
    color: "text-red-400",
    bgColor: "border-red-400/50 bg-red-400/10 text-red-400",
    description: "Outside trading hours",
  },
};

export function MarketSession({ session, easternTime }: MarketSessionProps) {
  const config = SESSION_CONFIG[session];

  return (
    <Card className="p-6">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <h3 className="text-sm font-medium text-muted-foreground">Market Session</h3>
            <div className="flex items-center gap-2">
              <TrendingUp className={`h-5 w-5 ${config.color}`} />
              <Badge variant="outline" className={config.bgColor}>
                {config.label}
              </Badge>
            </div>
          </div>
        </div>
        
        <div className="space-y-2 border-t border-border pt-4">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Current Time (ET)</span>
            <span className="font-mono text-foreground">{easternTime}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Session Hours</span>
            <span className="text-foreground">{config.description}</span>
          </div>
        </div>
      </div>
    </Card>
  );
}
