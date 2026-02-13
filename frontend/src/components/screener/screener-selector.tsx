"use client";

import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ScreenerFilters } from "@/lib/api/types";

interface Props {
  filters: ScreenerFilters;
  selectedScreener: string;
  onScreenerChange: (screenerId: string) => void;
  count: number;
  onCountChange: (count: number) => void;
}

export function ScreenerSelector({
  filters,
  selectedScreener,
  onScreenerChange,
  count,
  onCountChange,
}: Props) {
  return (
    <div className="flex items-center gap-4">
      <div className="flex-1">
        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
          Screener Type
        </label>
        <Select value={selectedScreener} onValueChange={onScreenerChange}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select a screener" />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(filters).map(([id, description]) => (
              <SelectItem key={id} value={id}>
                {description}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
          Count
        </label>
        <div className="flex gap-2">
          {[10, 20, 50].map((c) => (
            <Button
              key={c}
              variant={count === c ? "default" : "outline"}
              size="sm"
              onClick={() => onCountChange(c)}
              className="w-12"
            >
              {c}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
