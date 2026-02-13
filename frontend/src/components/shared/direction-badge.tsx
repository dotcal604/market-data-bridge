"use client";

import { directionBg } from "@/lib/utils/colors";
import { cn } from "@/lib/utils";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";

export function DirectionBadge({ direction, className }: { direction: string; className?: string }) {
  const Icon = direction === "long" ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-semibold uppercase",
        directionBg(direction),
        className
      )}
    >
      <Icon className="h-3 w-3" />
      {direction}
    </span>
  );
}
