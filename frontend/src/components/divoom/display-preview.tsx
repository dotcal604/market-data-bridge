"use client";

/**
 * Scaled-down replica of the Divoom TimesFrame 800×1280 portrait display.
 *
 * Supports two modes:
 * - "elements" (widget engine) — renders positioned DisplayElements on a canvas
 * - "sections" (legacy monolith) — renders structured sections with colored text
 *
 * Design system (semiotic color + wayfinding):
 * - Left accent rail: 2px colored bar per widget section — enables peripheral scanning
 * - Background tint: subtle rgba wash per section for Gestalt grouping
 * - Typography hierarchy: font size + weight keyed to widget role
 * - Section dividers: 1px line between widget groups for spatial parsing
 */

import { cn } from "@/lib/utils";
import type {
  DivoomPreviewData,
  DivoomPreviewSections,
  DivoomPreviewElements,
  DivoomPreviewElement,
  DivoomSection,
} from "@/lib/api/types";

interface DisplayPreviewProps {
  data: DivoomPreviewData | null;
  loading?: boolean;
}

// ─── Semiotic Style System ──────────────────────────────────

/** Per-widget visual treatment: accent color, background tint, font config */
interface WidgetStyle {
  /** Left accent rail color */
  accent: string;
  /** Subtle background wash (very low opacity) */
  bg: string;
  /** Font size class */
  fontSize: string;
  /** Font weight class */
  fontWeight: string;
  /** Text opacity (1 = primary, 0.7 = secondary, 0.5 = tertiary) */
  opacity: number;
}

const WIDGET_STYLES: Record<string, WidgetStyle> = {
  // Session chrome — cyan = "system status / ambient awareness"
  header: {
    accent: "rgba(0,255,255,0.85)",
    bg: "rgba(0,255,255,0.04)",
    fontSize: "text-[11px]",
    fontWeight: "font-bold",
    opacity: 1,
  },
  // Market structure — blue = "broad market context"
  indices: {
    accent: "rgba(68,136,255,0.85)",
    bg: "rgba(68,136,255,0.04)",
    fontSize: "text-[9px]",
    fontWeight: "font-medium",
    opacity: 1,
  },
  // Momentum — magenta = "actionable movement / energy"
  movers: {
    accent: "rgba(255,0,255,0.75)",
    bg: "rgba(255,0,255,0.03)",
    fontSize: "text-[9px]",
    fontWeight: "font-normal",
    opacity: 0.95,
  },
  // Portfolio — green/emerald = "your money / account health"
  portfolio: {
    accent: "rgba(0,255,100,0.75)",
    bg: "rgba(0,255,100,0.04)",
    fontSize: "text-[9px]",
    fontWeight: "font-medium",
    opacity: 1,
  },
  // News — amber/warm = "external signal / catalyst"
  news: {
    accent: "rgba(255,170,0,0.7)",
    bg: "rgba(255,170,0,0.03)",
    fontSize: "text-[8.5px]",
    fontWeight: "font-normal",
    opacity: 0.8,
  },
  // Footer chrome — dim gray = "attribution / metadata"
  footer: {
    accent: "rgba(160,160,160,0.5)",
    bg: "rgba(128,128,128,0.02)",
    fontSize: "text-[7.5px]",
    fontWeight: "font-normal",
    opacity: 0.5,
  },
};

const DEFAULT_STYLE: WidgetStyle = {
  accent: "rgba(255,255,255,0.2)",
  bg: "rgba(255,255,255,0.01)",
  fontSize: "text-[9px]",
  fontWeight: "font-normal",
  opacity: 0.85,
};

function getWidgetStyle(widget: string): WidgetStyle {
  return WIDGET_STYLES[widget] ?? DEFAULT_STYLE;
}

// ─── Widget Identity Inference ───────────────────────────────

/**
 * Resolve widget ID for an element.  Prefers `el.widget` (set by engine-aware
 * backend) but falls back to `rendered[index]` (1:1 mapping when each widget
 * emits a single element — which is the case for all current text-only layouts).
 */
function resolveWidget(
  el: DivoomPreviewElement,
  index: number,
  rendered: string[],
): string {
  return el.widget ?? rendered[index] ?? "unknown";
}

// ─── Widget Group Detection ─────────────────────────────────

interface WidgetGroup {
  widget: string;
  elements: Array<DivoomPreviewElement & { _widget: string }>;
  topPct: number;
  heightPct: number;
  style: WidgetStyle;
}

/** Cluster consecutive elements by resolved widget ID into visual groups */
function groupByWidget(
  elements: DivoomPreviewElement[],
  rendered: string[],
  canvasH: number,
): WidgetGroup[] {
  if (elements.length === 0) return [];

  // Tag every element with a resolved widget ID
  const tagged = elements.map((el, i) => ({
    ...el,
    _widget: resolveWidget(el, i, rendered),
  }));

  const groups: WidgetGroup[] = [];
  let current = [tagged[0]];
  let currentWidget = tagged[0]._widget;

  for (let i = 1; i < tagged.length; i++) {
    if (tagged[i]._widget === currentWidget) {
      current.push(tagged[i]);
    } else {
      groups.push(buildGroup(current, currentWidget, canvasH));
      current = [tagged[i]];
      currentWidget = tagged[i]._widget;
    }
  }
  groups.push(buildGroup(current, currentWidget, canvasH));

  return groups;
}

function buildGroup(
  elements: Array<DivoomPreviewElement & { _widget: string }>,
  widget: string,
  canvasH: number,
): WidgetGroup {
  const firstEl = elements[0];
  const lastEl = elements[elements.length - 1];
  const topPx = firstEl.y;
  const bottomPx = lastEl.y + lastEl.height;

  return {
    widget,
    elements,
    topPct: (topPx / canvasH) * 100,
    heightPct: ((bottomPx - topPx) / canvasH) * 100,
    style: getWidgetStyle(widget),
  };
}

// ─── Element-based preview (widget engine) ──────────────────

function ElementPreview({ data }: { data: DivoomPreviewElements }) {
  const canvasH = data.canvasHeight;
  const groups = groupByWidget(data.elements, data.rendered, canvasH);

  return (
    <div className="relative aspect-[800/1280] w-full max-w-[320px] overflow-hidden rounded-xl border border-white/[0.06] bg-black/95 backdrop-blur-md shadow-lg shadow-cyan-900/10">
      {/* Scanline overlay */}
      <div className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(0deg,transparent,transparent_2px,rgba(255,255,255,0.008)_2px,rgba(255,255,255,0.008)_4px)]" />

      {/* Widget group backgrounds + accent rails */}
      {groups.map((group, gi) => (
        <div
          key={`bg-${group.widget}-${gi}`}
          className="absolute left-0 right-0 pointer-events-none"
          style={{
            top: `${group.topPct}%`,
            height: `${group.heightPct}%`,
          }}
        >
          {/* Background tint */}
          <div
            className="absolute inset-0"
            style={{ background: group.style.bg }}
          />

          {/* Left accent rail — 4px wayfinding strip */}
          <div
            className="absolute left-0 top-0 bottom-0 w-[4px]"
            style={{ background: group.style.accent }}
          />

          {/* Section divider (bottom edge, skip last group) */}
          {gi < groups.length - 1 && (
            <div
              className="absolute bottom-0 left-3 right-3 h-px"
              style={{ background: "rgba(255,255,255,0.04)" }}
            />
          )}
        </div>
      ))}

      {/* Text elements — styled per resolved widget identity */}
      {data.elements.map((el, i) => {
        const topPct = (el.y / canvasH) * 100;
        const heightPct = (el.height / canvasH) * 100;
        const widget = resolveWidget(el, i, data.rendered);
        const style = getWidgetStyle(widget);

        return (
          <div
            key={el.id}
            className="absolute left-0 right-0 overflow-hidden"
            style={{
              top: `${topPct}%`,
              height: `${heightPct}%`,
              // Left padding: 8px (past accent rail) + 4px gap
              paddingLeft: "12px",
              paddingRight: "8px",
            }}
          >
            <div
              className={cn(
                "font-mono leading-tight whitespace-pre-wrap break-words",
                style.fontSize,
                style.fontWeight,
              )}
              style={{
                color: el.color,
                opacity: style.opacity,
              }}
            >
              {el.text}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Section-based preview (legacy monolith) ────────────────

function Section({
  section,
  maxRows,
}: {
  section: DivoomSection;
  maxRows: number;
}) {
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

function SectionPreview({ data }: { data: DivoomPreviewSections }) {
  return (
    <div className="relative aspect-[800/1280] w-full max-w-[320px] overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.03] backdrop-blur-md p-3 shadow-lg shadow-cyan-900/10">
      <div className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(0deg,transparent,transparent_2px,rgba(255,255,255,0.01)_2px,rgba(255,255,255,0.01)_4px)]" />

      <div
        className="mb-3 text-center text-[11px] font-bold tracking-wide"
        style={{ color: data.header.color }}
      >
        {data.header.text}
      </div>

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

      <div className="mb-2 h-6 rounded bg-cyan-500/5 border border-cyan-500/10" />

      <Section section={data.sectors} maxRows={5} />

      <div className="mb-2 grid grid-cols-5 gap-0.5">
        {["Tech", "Fin", "Engy", "Hlth", "Cons"].map((label) => (
          <div
            key={label}
            className="rounded-sm bg-emerald-600/20 py-1 text-center text-[7px] font-bold text-white/70"
          >
            {label}
          </div>
        ))}
      </div>

      <Section section={data.movers} maxRows={4} />
      <Section section={data.portfolio} maxRows={4} />

      <div className="mb-2 h-5 rounded bg-emerald-500/5 border border-emerald-500/10" />

      <Section section={data.news} maxRows={3} />
      <Section section={data.indicators} maxRows={5} />

      <div className="mb-2 flex gap-2">
        <div className="flex-1 h-6 rounded bg-yellow-500/5 border border-yellow-500/10 flex items-center justify-center text-[7px] text-muted-foreground">
          RSI
        </div>
        <div className="flex-1 h-6 rounded bg-orange-500/5 border border-orange-500/10 flex items-center justify-center text-[7px] text-muted-foreground">
          VIX
        </div>
      </div>

      <div className="h-5 rounded bg-green-500/5 border border-green-500/10" />
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────

export function DisplayPreview({ data, loading }: DisplayPreviewProps) {
  if (loading || !data) {
    return (
      <div className="flex aspect-[800/1280] w-full max-w-[320px] items-center justify-center rounded-xl border border-white/[0.06] bg-white/[0.03] backdrop-blur-md">
        <div className="text-xs text-muted-foreground animate-pulse">
          {loading ? "Connecting to display..." : "No display data"}
        </div>
      </div>
    );
  }

  if (data.type === "elements") {
    return <ElementPreview data={data} />;
  }

  return <SectionPreview data={data} />;
}
