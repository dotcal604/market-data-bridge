"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Settings2,
  Loader2,
  ChevronDown,
  ChevronRight,
  Palette,
} from "lucide-react";
import {
  useDivoomComposite,
  useDivoomSetComposite,
} from "@/lib/hooks/use-divoom";
import type { CompositeSettings, SectionConfig } from "@/lib/api/types";

// ─── Section config metadata ──────────────────────────

type SectionKey = keyof CompositeSettings["sections"];

interface SectionMeta {
  key: SectionKey;
  label: string;
  min: number;
  max: number;
  step: number;
}

const SECTIONS: SectionMeta[] = [
  { key: "sparkline", label: "Sparkline", min: 100, max: 400, step: 10 },
  { key: "heatmap", label: "Heatmap", min: 100, max: 400, step: 10 },
  { key: "volume", label: "Volume", min: 60, max: 200, step: 10 },
  { key: "gauges", label: "Gauges", min: 20, max: 80, step: 5 },
];

const PALETTE_KEYS = [
  "green",
  "red",
  "cyan",
  "yellow",
  "orange",
  "magenta",
  "white",
  "dimGray",
  "muted",
] as const;

type PaletteKey = (typeof PALETTE_KEYS)[number];

// ─── Component ────────────────────────────────────────

export function CompositeControl() {
  const { data: composite, isLoading } = useDivoomComposite();
  const mutation = useDivoomSetComposite();

  // Local state synced from server
  const [splitY, setSplitY] = useState(740);
  const [jpegQuality, setJpegQuality] = useState(85);
  const [cacheTtlSec, setCacheTtlSec] = useState(20);
  const [sections, setSections] = useState<
    Record<SectionKey, SectionConfig>
  >({
    sparkline: { enabled: true, height: 200 },
    heatmap: { enabled: true, height: 220 },
    volume: { enabled: true, height: 120 },
    gauges: { enabled: true, height: 40 },
  });
  const [palette, setPalette] = useState<Record<PaletteKey, string>>({
    green: "#00ff00",
    red: "#ff0000",
    cyan: "#00ffff",
    yellow: "#ffff00",
    orange: "#ff8800",
    magenta: "#ff00ff",
    white: "#ffffff",
    dimGray: "#666666",
    muted: "#888888",
  });

  // Collapsible state
  const [showSections, setShowSections] = useState(false);
  const [showPalette, setShowPalette] = useState(false);

  // Sync from server
  useEffect(() => {
    if (!composite) return;
    setSplitY(composite.splitY);
    setJpegQuality(composite.jpegQuality);
    setCacheTtlSec(Math.round(composite.cacheTtlMs / 1000));
    setSections(composite.sections);
    setPalette(composite.palette);
  }, [composite]);

  // ─── Commit helpers ───────────────────────────────

  function commitSplitY(val: number[]) {
    setSplitY(val[0]);
    mutation.mutate({ splitY: val[0] });
  }

  function commitJpegQuality(val: number[]) {
    setJpegQuality(val[0]);
    mutation.mutate({ jpegQuality: val[0] });
  }

  function commitCacheTtl() {
    const clamped = Math.max(1, Math.min(120, cacheTtlSec));
    setCacheTtlSec(clamped);
    mutation.mutate({ cacheTtlMs: clamped * 1000 });
  }

  function commitSectionEnabled(key: SectionKey, enabled: boolean) {
    const updated = { ...sections, [key]: { ...sections[key], enabled } };
    setSections(updated);
    mutation.mutate({ sections: updated });
  }

  function commitSectionHeight(key: SectionKey, val: number[]) {
    const updated = {
      ...sections,
      [key]: { ...sections[key], height: val[0] },
    };
    setSections(updated);
    mutation.mutate({ sections: updated });
  }

  function commitPaletteColor(name: PaletteKey, hex: string) {
    setPalette((prev) => ({ ...prev, [name]: hex }));
    mutation.mutate({ palette: { ...palette, [name]: hex } });
  }

  // ─── Loading state ────────────────────────────────

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  // ─── Render ───────────────────────────────────────

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Settings2 className="h-4 w-4" />
          Composite Renderer
          <Badge variant="outline" className="ml-auto font-mono text-xs">
            split {splitY}px
          </Badge>
          {mutation.isPending && (
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
          )}
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* ── 1. Split Point ─────────────────────────── */}
        <div>
          <div className="mb-1.5 text-xs text-muted-foreground">
            Split Point
          </div>
          <Slider
            min={400}
            max={1000}
            step={10}
            value={[splitY]}
            onValueChange={(v) => setSplitY(v[0])}
            onValueCommit={commitSplitY}
            disabled={mutation.isPending}
            className="mt-1"
          />
          <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
            <span>Text Zone: {splitY}px</span>
            <span>Chart Zone: {1280 - splitY}px</span>
          </div>
        </div>

        {/* ── 2. JPEG Quality ────────────────────────── */}
        <div>
          <div className="mb-1.5 flex items-center gap-2 text-xs text-muted-foreground">
            JPEG Quality
            <Badge variant="secondary" className="font-mono text-[10px]">
              {jpegQuality}%
            </Badge>
          </div>
          <Slider
            min={50}
            max={100}
            step={1}
            value={[jpegQuality]}
            onValueChange={(v) => setJpegQuality(v[0])}
            onValueCommit={commitJpegQuality}
            disabled={mutation.isPending}
            className="mt-1"
          />
          <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
            <span>50 (small)</span>
            <span>100 (sharp)</span>
          </div>
        </div>

        {/* ── 3. Cache TTL ───────────────────────────── */}
        <div>
          <div className="mb-1.5 text-xs text-muted-foreground">
            Cache TTL (seconds)
          </div>
          <div className="flex gap-2">
            <Input
              type="number"
              min={1}
              max={120}
              value={cacheTtlSec}
              onChange={(e) => setCacheTtlSec(Number(e.target.value))}
              onBlur={commitCacheTtl}
              onKeyDown={(e) => e.key === "Enter" && commitCacheTtl()}
              disabled={mutation.isPending}
              className="w-24 font-mono text-xs"
            />
            <span className="self-center text-[10px] text-muted-foreground">
              1 – 120s
            </span>
          </div>
        </div>

        {/* ── 4. Chart Sections ──────────────────────── */}
        <div>
          <Button
            variant="ghost"
            size="sm"
            className="flex w-full items-center gap-1.5 px-0 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setShowSections((s) => !s)}
          >
            {showSections ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
            Chart Sections
          </Button>

          {showSections && (
            <div className="mt-2 space-y-3 pl-1">
              {SECTIONS.map((meta) => {
                const sec = sections[meta.key];
                return (
                  <div
                    key={meta.key}
                    className="space-y-1.5 rounded-md border border-border/50 p-2"
                  >
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={sec.enabled}
                        onCheckedChange={(checked) =>
                          commitSectionEnabled(meta.key, checked)
                        }
                        disabled={mutation.isPending}
                      />
                      <span className="text-xs font-medium">{meta.label}</span>
                      {sec.enabled && (
                        <Badge
                          variant="secondary"
                          className="ml-auto font-mono text-[10px]"
                        >
                          {sec.height}px
                        </Badge>
                      )}
                    </div>

                    {sec.enabled && (
                      <Slider
                        min={meta.min}
                        max={meta.max}
                        step={meta.step}
                        value={[sec.height]}
                        onValueChange={(v) =>
                          setSections((prev) => ({
                            ...prev,
                            [meta.key]: { ...prev[meta.key], height: v[0] },
                          }))
                        }
                        onValueCommit={(v) =>
                          commitSectionHeight(meta.key, v)
                        }
                        disabled={mutation.isPending}
                        className="mt-1"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── 5. Color Palette ───────────────────────── */}
        <div>
          <Button
            variant="ghost"
            size="sm"
            className="flex w-full items-center gap-1.5 px-0 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setShowPalette((s) => !s)}
          >
            {showPalette ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
            <Palette className="h-3.5 w-3.5" />
            Color Palette
          </Button>

          {showPalette && (
            <div className="mt-2 grid grid-cols-3 gap-2 pl-1">
              {PALETTE_KEYS.map((name) => (
                <label
                  key={name}
                  className="flex items-center gap-1.5 rounded-md border border-border/50 px-2 py-1.5"
                >
                  <span
                    className="inline-block h-4 w-4 shrink-0 rounded-sm border border-white/20"
                    style={{ backgroundColor: palette[name] }}
                  />
                  <span className="flex-1 text-[10px] text-muted-foreground">
                    {name}
                  </span>
                  <input
                    type="color"
                    value={palette[name]}
                    onChange={(e) => commitPaletteColor(name, e.target.value)}
                    disabled={mutation.isPending}
                    className="h-5 w-5 shrink-0 cursor-pointer rounded border-0 p-0"
                  />
                </label>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
