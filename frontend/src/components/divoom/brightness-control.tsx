"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Sun } from "lucide-react";

interface BrightnessControlProps {
  initialValue: number;
  onBrightnessChange?: (value: number) => void;
  disabled?: boolean;
}

export function BrightnessControl({ initialValue, onBrightnessChange, disabled }: BrightnessControlProps) {
  const [value, setValue] = useState(initialValue);
  const [pending, setPending] = useState(false);

  function handleCommit(newValue: number[]) {
    const brightness = newValue[0];
    setValue(brightness);
    if (onBrightnessChange) {
      setPending(true);
      onBrightnessChange(brightness);
      // Reset pending after a short delay (will be replaced by mutation state)
      setTimeout(() => setPending(false), 600);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Sun className="h-4 w-4" />
          Brightness
          <Badge variant="outline" className="ml-auto font-mono text-xs">
            {value}%
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Slider
          min={0}
          max={100}
          step={5}
          value={[value]}
          onValueChange={(v) => setValue(v[0])}
          onValueCommit={handleCommit}
          disabled={disabled || pending}
          className="mt-1"
        />
        <div className="mt-2 flex justify-between text-[10px] text-muted-foreground">
          <span>0 (off)</span>
          <span>50</span>
          <span>100 (max)</span>
        </div>
      </CardContent>
    </Card>
  );
}
