"use client";

import { modelColor } from "@/lib/utils/colors";

const MODEL_LABELS: Record<string, string> = {
  "gpt-4o": "GPT",
  "claude-sonnet": "CLD",
  "gemini-flash": "GEM",
};

export function ModelAvatar({ modelId }: { modelId: string }) {
  const color = modelColor(modelId);
  const label = MODEL_LABELS[modelId] ?? modelId.slice(0, 3).toUpperCase();

  return (
    <div
      className="flex h-7 w-7 items-center justify-center rounded-md text-[10px] font-bold text-black"
      style={{ backgroundColor: color }}
    >
      {label}
    </div>
  );
}
