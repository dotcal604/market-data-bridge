"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Palette, Droplets, Loader2 } from "lucide-react";
import {
  useDivoomBackground,
  useDivoomSetBackground,
} from "@/lib/hooks/use-divoom";

const TINTS = [
  { value: "neutral", label: "White", sample: "bg-white" },
  { value: "blue", label: "Blue", sample: "bg-blue-400" },
  { value: "green", label: "Green", sample: "bg-green-400" },
] as const;

const PRESETS = [
  { label: "Off", hex: "#000000" },
  { label: "Warm", hex: "#0D0C01" },
  { label: "Amber", hex: "#1A1000" },
  { label: "Teal", hex: "#001A1A" },
  { label: "Purple", hex: "#0D001A" },
  { label: "Red", hex: "#1A0000" },
];

export function BackgroundControl() {
  const { data: bg, isLoading } = useDivoomBackground();
  const mutation = useDivoomSetBackground();

  const [brightness, setBrightness] = useState(90);
  const [tint, setTint] = useState<"neutral" | "blue" | "green">("neutral");
  const [hexInput, setHexInput] = useState("");
  const [mode, setMode] = useState<"slider" | "hex">("slider");

  // Sync from server state
  useEffect(() => {
    if (!bg) return;
    setBrightness(bg.brightness);
    setTint(bg.tint);
    if (bg.color) {
      setHexInput(bg.color);
      setMode("hex");
    } else {
      setMode("slider");
    }
  }, [bg]);

  function commitBrightness(val: number[]) {
    setBrightness(val[0]);
    mutation.mutate({ brightness: val[0], color: null });
  }

  function commitTint(t: "neutral" | "blue" | "green") {
    setTint(t);
    mutation.mutate({ tint: t, color: null });
  }

  function commitHex(hex: string) {
    const normalized = hex.startsWith("#") ? hex : `#${hex}`;
    if (/^#[0-9a-fA-F]{6}$/.test(normalized)) {
      setHexInput(normalized);
      mutation.mutate({ color: normalized });
      setMode("hex");
    }
  }

  function clearHex() {
    setHexInput("");
    setMode("slider");
    mutation.mutate({ color: null, brightness, tint });
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const activeHex = mode === "hex" && hexInput;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Droplets className="h-4 w-4" />
          Panel Background
          <Badge variant="outline" className="ml-auto font-mono text-xs">
            {activeHex ? hexInput : `${brightness}% ${tint}`}
          </Badge>
          {mutation.isPending && (
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Brightness slider */}
        <div>
          <div className="mb-1.5 text-xs text-muted-foreground">
            Opacity (translucency)
          </div>
          <Slider
            min={0}
            max={100}
            step={1}
            value={[brightness]}
            onValueChange={(v) => setBrightness(v[0])}
            onValueCommit={commitBrightness}
            disabled={mode === "hex" || mutation.isPending}
            className="mt-1"
          />
          <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
            <span>0 (opaque)</span>
            <span>50</span>
            <span>100 (bright)</span>
          </div>
        </div>

        {/* Tint selector */}
        <div>
          <div className="mb-1.5 text-xs text-muted-foreground">Tint</div>
          <div className="flex gap-2">
            {TINTS.map((t) => (
              <button
                key={t.value}
                onClick={() => commitTint(t.value)}
                disabled={mode === "hex" || mutation.isPending}
                className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs transition-colors ${
                  tint === t.value && mode !== "hex"
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:border-primary/50"
                } disabled:opacity-40`}
              >
                <span
                  className={`inline-block h-2.5 w-2.5 rounded-full ${t.sample}`}
                />
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Hex color override */}
        <div>
          <div className="mb-1.5 flex items-center gap-2 text-xs text-muted-foreground">
            <Palette className="h-3 w-3" />
            Hex color (overrides slider)
          </div>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                placeholder="#0D0C01"
                value={hexInput}
                onChange={(e) => setHexInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && commitHex(hexInput)}
                className="font-mono text-xs pr-10"
                maxLength={7}
              />
              {/* Native color picker */}
              <input
                type="color"
                value={hexInput || "#000000"}
                onChange={(e) => {
                  setHexInput(e.target.value);
                  commitHex(e.target.value);
                }}
                className="absolute right-1.5 top-1/2 h-6 w-6 -translate-y-1/2 cursor-pointer rounded border-0 p-0"
                title="Color picker"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => commitHex(hexInput)}
              disabled={mutation.isPending || !hexInput}
            >
              Apply
            </Button>
            {activeHex && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearHex}
                disabled={mutation.isPending}
              >
                Clear
              </Button>
            )}
          </div>
        </div>

        {/* Color presets */}
        <div>
          <div className="mb-1.5 text-xs text-muted-foreground">Presets</div>
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p.hex}
                onClick={() => commitHex(p.hex)}
                disabled={mutation.isPending}
                className={`group flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] transition-colors ${
                  hexInput === p.hex
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:border-primary/50"
                }`}
                title={p.hex}
              >
                <span
                  className="inline-block h-3 w-3 rounded-sm border border-white/20"
                  style={{ backgroundColor: p.hex }}
                />
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
