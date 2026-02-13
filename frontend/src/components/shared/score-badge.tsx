"use client";

import { scoreBg } from "@/lib/utils/colors";
import { formatScore } from "@/lib/utils/formatters";
import { cn } from "@/lib/utils";

export function ScoreBadge({ score, className }: { score: number; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 font-mono text-xs font-semibold",
        scoreBg(score),
        className
      )}
    >
      {formatScore(score)}
    </span>
  );
}
