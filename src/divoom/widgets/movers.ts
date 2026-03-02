/**
 * Widget: Movers — Top 2 gainers & 2 losers
 *
 * Dual-mode rendering:
 *
 *   Image mode (chartBaseUrl available):
 *     Server-rendered data table with per-cell color — green for gains,
 *     red for losses, magenta for title, cyan for symbols. Each row
 *     has precisely aligned columns: dir | ticker | change% | price.
 *
 *       ┌─────────────────────────────────────┐
 *       │  ▸ TOP MOVERS                       │  ← magenta title
 *       │  ▲  AVGO     +8.2%        $247      │  ← green row
 *       │  ▲  MSFT     +3.1%        $421      │  ← green row
 *       │  ▼  NVDA     -3.1%        $612      │  ← red row
 *       │  ▼  TSLA     -2.4%        $189      │  ← red row
 *       └─────────────────────────────────────┘
 *
 *     Cost: 0 Text + 1 Image + 0 NetData
 *
 *   Text fallback (no chartBaseUrl):
 *     Compact 5-line multi-line Text panel (original format).
 *     Cost: 1 Text + 0 Image + 0 NetData
 *
 * Session-aware header: "TOP MOVERS" (regular), "AFTER HOURS",
 * "PRE-MARKET", "PRIOR SESSION" (closed).
 *
 * The Image path saves 1 Text slot vs the fallback — part of the
 * Budget Flip strategy (5T → 4T → 3T as more widgets move to Image).
 */

import type { Widget, WidgetContext, WidgetOutput, SlotCost } from "./types.js";
import type { DataTableRichRow } from "../charts.js";
import { textEl, imageEl, PANEL_MOVERS_H, SectionBg } from "./helpers.js";
import { C, changeColor, fmtPrice, fmtPct, trim } from "../screens.js";
import { renderDataTable, setCachedChart } from "../charts.js";
import { runScreener } from "../../providers/yahoo.js";
import { registerWidget } from "./registry.js";

// ─── Image-mode constants ─────────────────────────────────────
const COL_DIR = 40;       // "▲" or "▼" — small fixed width
const COL_SYMBOL = 110;   // "AVGO" — bold cyan
const COL_CHANGE = 150;   // "+8.2%" — right-aligned, colored
const COL_PRICE = 180;    // "$247.50" — right-aligned, white

const TABLE_FONT = 22;
const TABLE_ROW_H = 34;
const TABLE_TITLE_H = 28;
const TABLE_H = TABLE_TITLE_H + 4 * TABLE_ROW_H; // title + 4 rows (2 gainers + 2 losers)

// ─── Text-mode constants (fallback) ───────────────────────────
const TEXT_FONT_SIZE = 28;

// ─── Shared types ─────────────────────────────────────────────
interface MoverData {
  symbol: string;
  last: number | null;
  changePercent: number | null;
}

// ─── Session-aware title ──────────────────────────────────────

function imageTitle(session: string): string {
  switch (session) {
    case "pre-market": return "▸ PRE-MARKET MOVERS";
    case "after-hours": return "▸ AFTER HOURS";
    case "closed": return "▸ PRIOR SESSION";
    default: return "▸ TOP MOVERS";
  }
}

function textTitle(session: string): string {
  switch (session) {
    case "pre-market": return "|-- PRE-MARKET -------------";
    case "after-hours": return "|-- AFTER HOURS ------------";
    case "closed": return "|-- PRIOR SESSION -----------";
    default: return "|-- TOP MOVERS --------------";
  }
}

// ─── Image-mode row builders ──────────────────────────────────

function moverRow(m: MoverData | undefined, dir: "▲" | "▼"): DataTableRichRow {
  if (!m || m.last == null) {
    const color = dir === "▲" ? C.green : C.red;
    return {
      cells: [
        { text: dir, color, width: COL_DIR, fontWeight: "bold" },
        { text: "—", color: C.gray, width: COL_SYMBOL },
        { text: "—", color: C.gray, width: COL_CHANGE, align: "right" },
        { text: "", color: C.gray, width: COL_PRICE, align: "right" },
      ],
    };
  }

  const color = changeColor(m.changePercent ?? 0);
  return {
    cells: [
      { text: dir, color, width: COL_DIR, fontWeight: "bold" },
      { text: trim(m.symbol, 6), color: C.cyan, width: COL_SYMBOL, fontWeight: "bold" },
      { text: m.changePercent !== null ? fmtPct(m.changePercent) : "—", color, width: COL_CHANGE, align: "right" },
      { text: m.last !== null ? `$${fmtPrice(m.last)}` : "—", color: C.white, width: COL_PRICE, align: "right" },
    ],
  };
}

// ─── Text-mode line builder (fallback) ────────────────────────

function moverLine(
  dir: "^" | "v",
  sym: string,
  price: number | null,
  pct: number | null,
): string {
  const s = trim(sym, 6).padEnd(6);
  const p = pct !== null ? fmtPct(pct).padStart(7) : "     --";
  const px = price !== null ? `  $${fmtPrice(price)}` : "";
  return `| ${dir} ${s}${p}${px}`;
}

// ─── Widget ───────────────────────────────────────────────────

export const moversWidget: Widget = {
  id: "movers",
  name: "Top Movers",

  // Dual-mode: Image when charts available, Text fallback otherwise
  renderMode: "text", // base mode for flex engine (text widgets get flex height)

  slotCost(ctx: WidgetContext): SlotCost {
    if (ctx.chartBaseUrl) {
      return { text: 0, image: 1, netdata: 0 }; // Image mode — saves 1 Text slot
    }
    return { text: 1, image: 0, netdata: 0 }; // Text fallback
  },

  getHeight(ctx: WidgetContext): number {
    if (ctx.chartBaseUrl) {
      return TABLE_H; // Fixed: 28 + 4×34 = 164px
    }
    return PANEL_MOVERS_H; // Flex minimum: 160px (engine stretches)
  },

  async render(
    ctx: WidgetContext,
    origin: { y: number; firstId: number; height: number },
  ): Promise<WidgetOutput> {
    // Fetch gainers + losers in parallel (same data either way)
    let gainers: MoverData[] = [];
    let losers: MoverData[] = [];

    try {
      const [g, l] = await Promise.all([
        runScreener("day_gainers", 2).catch(() => []),
        runScreener("day_losers", 2).catch(() => []),
      ]);
      gainers = g;
      losers = l;
    } catch {
      // screeners failed — empty arrays trigger fallback styling
    }

    const [g1, g2] = gainers;
    const [l1, l2] = losers;

    // ── Image mode: server-rendered data table ────────────────
    if (ctx.chartBaseUrl) {
      const rows: DataTableRichRow[] = [
        moverRow(g1, "▲"),
        moverRow(g2, "▲"),
        moverRow(l1, "▼"),
        moverRow(l2, "▼"),
      ];

      const buffer = await renderDataTable(imageTitle(ctx.session), rows, {
        rowHeight: TABLE_ROW_H,
        titleHeight: TABLE_TITLE_H,
        fontSize: TABLE_FONT,
        titleColor: C.magenta,
        bgColor: "#180818", // dark magenta tint (matches SectionBg.movers)
      });
      setCachedChart("movers-table", buffer);

      return {
        elements: [
          imageEl(
            origin.firstId,
            origin.y,
            `${ctx.chartBaseUrl}/api/divoom/charts/movers-table`,
            { height: origin.height },
          ),
        ],
      };
    }

    // ── Text fallback: compact 5-line panel ───────────────────
    const header = textTitle(ctx.session);
    const gLine1 = g1?.last != null
      ? moverLine("^", g1.symbol, g1.last, g1.changePercent ?? null)
      : "| ^ --";
    const gLine2 = g2?.last != null
      ? moverLine("^", g2.symbol, g2.last, g2.changePercent ?? null)
      : "";
    const lLine1 = l1?.last != null
      ? moverLine("v", l1.symbol, l1.last, l1.changePercent ?? null)
      : "| v --";
    const lLine2 = l2?.last != null
      ? moverLine("v", l2.symbol, l2.last, l2.changePercent ?? null)
      : "";

    const text = [header, gLine1, gLine2, lLine1, lLine2]
      .filter(Boolean)
      .join("\n");

    return {
      elements: [
        textEl(origin.firstId, origin.y, text, C.magenta, {
          height: origin.height,
          fontSize: TEXT_FONT_SIZE,
          bgColor: SectionBg.movers,
        }),
      ],
    };
  },
};

registerWidget(moversWidget);
