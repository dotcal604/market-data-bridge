"use client";

import { cn } from "@/lib/utils";

export type Timeframe = "1D" | "5D" | "1M" | "3M" | "1Y";

interface TimeframeSelectorProps {
  selected: Timeframe;
  onChange: (timeframe: Timeframe) => void;
  className?: string;
}

const TIMEFRAMES: Timeframe[] = ["1D", "5D", "1M", "3M", "1Y"];

export function TimeframeSelector({
  selected,
  onChange,
  className,
}: TimeframeSelectorProps) {
  return (
    <div className={cn("flex gap-2", className)}>
      {TIMEFRAMES.map((timeframe) => (
        <button
          key={timeframe}
          onClick={() => onChange(timeframe)}
          className={cn(
            "rounded px-3 py-1 text-sm font-medium transition-colors",
            selected === timeframe
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground hover:bg-muted/80"
          )}
        >
          {timeframe}
        </button>
      ))}
    </div>
  );
}
