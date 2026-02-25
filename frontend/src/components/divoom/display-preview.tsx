"use client";

/**
 * Scaled-down replica of the Divoom TimesFrame 800×1280 portrait display.
 * Renders DashboardData sections as colored text on a dark canvas.
 */

import { cn } from "@/lib/utils";
import type { DivoomPreviewData, DivoomSection } from "@/lib/api/types";

interface DisplayPreviewProps {
  data: DivoomPreviewData | null;
  loading?: boolean;
}

function Section({ section, maxRows }: { section: DivoomSection; maxRows: number }) {
  return (
    <div className="mb-2">
      <div
        className="text-[10px] font-bold tracking-wider"
        style={{ color: section.header.color }}
      >
        {section.header.text}
      </div>
      {section.rows.slice(0, maxRows).map((row, i) => (
        <div
          key={i}
          className="font-mono text-[9px] leading-tight"
          style={{ color: row.color }}
        >
          {row.text}
        </div>
      ))}
    </div>
  );
}

export function DisplayPreview({ data, loading }: DisplayPreviewProps) {
  if (loading || !data) {
    return (
      <div className="flex aspect-[800/1280] w-full max-w-[320px] items-center justify-center rounded-xl border border-border bg-[#0A0A0A]">
        <div className="text-xs text-muted-foreground animate-pulse">
          {loading ? "Connecting to display…" : "No display data"}
        </div>
      </div>
    );
  }

  return (
    <div className="relative aspect-[800/1280] w-full max-w-[320px] overflow-hidden rounded-xl border border-border bg-[#0A0A0A] p-3 shadow-lg shadow-cyan-900/10">
      {/* Subtle scanline overlay */}
      <div className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(0deg,transparent,transparent_2px,rgba(255,255,255,0.01)_2px,rgba(255,255,255,0.01)_4px)]" />

      {/* Header */}
      <div
        className="mb-3 text-center text-[11px] font-bold tracking-wide"
        style={{ color: data.header.color }}
      >
        {data.header.text}
      </div>

      {/* Indices */}
      <div className="mb-2 space-y-0.5">
        {data.indices.map((idx, i) => (
          <div
            key={i}
            className="font-mono text-[10px] leading-tight"
            style={{ color: idx.color }}
          >
            {idx.text}
          </div>
        ))}
        {data.vix && (
          <div
            className="font-mono text-[10px] leading-tight"
            style={{ color: data.vix.color }}
          >
            {data.vix.text}
          </div>
        )}
      </div>

      {/* Sparkline placeholder */}
      <div className="mb-2 h-6 rounded bg-cyan-500/5 border border-cyan-500/10" />

      {/* Sections */}
      <Section section={data.sectors} maxRows={5} />

      {/* Heatmap placeholder */}
      <div className="mb-2 grid grid-cols-5 gap-0.5">
        {["Tech", "Fin", "Engy", "Hlth", "Cons"].map((label) => (
          <div key={label} className="rounded-sm bg-emerald-600/20 py-1 text-center text-[7px] font-bold text-white/70">
            {label}
          </div>
        ))}
      </div>

      <Section section={data.movers} maxRows={4} />
      <Section section={data.portfolio} maxRows={4} />

      {/* PnL curve placeholder */}
      <div className="mb-2 h-5 rounded bg-emerald-500/5 border border-emerald-500/10" />

      <Section section={data.news} maxRows={3} />
      <Section section={data.indicators} maxRows={5} />

      {/* Gauge placeholders */}
      <div className="mb-2 flex gap-2">
        <div className="flex-1 h-6 rounded bg-yellow-500/5 border border-yellow-500/10 flex items-center justify-center text-[7px] text-muted-foreground">RSI</div>
        <div className="flex-1 h-6 rounded bg-orange-500/5 border border-orange-500/10 flex items-center justify-center text-[7px] text-muted-foreground">VIX</div>
      </div>

      {/* Volume placeholder */}
      <div className="h-5 rounded bg-green-500/5 border border-green-500/10" />
    </div>
  );
}
