/**
 * Widget: Indices — Major index quotes + VIX
 *
 * Dual-mode rendering:
 *
 *   Image mode (chartBaseUrl available):
 *     Server-rendered data table with per-cell color — green for gains,
 *     red for losses, cyan for labels, white for prices. Each symbol row
 *     has precisely aligned columns: ticker | price | change%.
 *     VIX row uses graduated danger colors (green → yellow → orange → red).
 *
 *       ┌─────────────────────────────────────┐
 *       │  ▸ INDICES                           │  ← cyan title
 *       │  SPY    $595.23      ▲+0.84%         │  ← white price, green change
 *       │  QQQ    $521.40      ▲+1.46%         │
 *       │  DIA    $436.80      ▲+0.62%         │
 *       │  IWM    $226.15      ▲+0.47%         │
 *       │  VIX     18          ▼-3.5%          │  ← green VIX (calm)
 *       └─────────────────────────────────────┘
 *
 *     Cost: 0 Text + 1 Image + 0 NetData
 *
 *   Text fallback (no chartBaseUrl):
 *     Compact 3-line multi-line Text panel (original format).
 *     Cost: 1 Text + 0 Image + 0 NetData
 *
 * The Image path saves 1 Text slot vs the fallback — crucial for the
 * Budget Flip strategy (6T → 5T when this moves to Image).
 */

import type { Widget, WidgetContext, WidgetOutput, SlotCost } from "./types.js";
import type { SmartQuoteResult } from "../screens.js";
import type { DataTableRichRow, DataTableCell } from "../charts.js";
import { textEl, imageEl, blockSparkline, PANEL_INDICES_H, SectionBg } from "./helpers.js";
import { C, changeColor, fmtPct, fmtPrice, smartQuote } from "../screens.js";
import { renderDataTable, setCachedChart } from "../charts.js";
import { getHistoricalBars } from "../../providers/yahoo.js";
import { registerWidget } from "./registry.js";

const INDEX_SYMBOLS = ["SPY", "QQQ", "DIA", "IWM"] as const;
const VIX_SYMBOL = "^VIX";

// ─── Image-mode constants ─────────────────────────────────────
// Column widths for the rich data table (768px total content area)
const COL_SYMBOL = 100;   // "SPY", "QQQ" — fixed width
const COL_PRICE = 200;    // "$595.23" — right-aligned
const COL_CHANGE = 180;   // "▲+1.24%" — right-aligned, colored

const TABLE_FONT = 22;
const TABLE_ROW_H = 34;
const TABLE_TITLE_H = 28;
const TABLE_H = TABLE_TITLE_H + 5 * TABLE_ROW_H; // title + 5 rows (4 indices + VIX)

// ─── Text-mode constants (fallback) ───────────────────────────
const TEXT_FONT_SIZE = 36;
const SPARKLINE_WIDTH = 12;

// ─── Shared helpers ───────────────────────────────────────────

function arrow(pct: number | null): string {
  if (pct === null) return "-";
  return pct >= 0 ? "^" : "v";
}

function vixColor(level: number): string {
  if (level > 25) return C.red;
  if (level > 20) return C.orange;
  if (level > 15) return C.yellow;
  return C.green;
}

function vixLabel(level: number, changePct: number | null): string {
  const base = level > 25
    ? `VIX ${Math.round(level)}!!`
    : level > 20
      ? `VIX ${Math.round(level)}!`
      : `VIX ${Math.round(level)}`;

  if (changePct === null) return base;
  const dir = changePct >= 0 ? "^" : "v";
  return `${base} ${dir}${Math.abs(changePct).toFixed(1)}%`;
}

/** Build a rich row for one index (Image mode) */
function indexRow(q: SmartQuoteResult | null, symbol: string): DataTableRichRow {
  if (!q) {
    return {
      cells: [
        { text: symbol, color: C.cyan, width: COL_SYMBOL, fontWeight: "bold" },
        { text: "—", color: C.gray, width: COL_PRICE, align: "right" },
        { text: "—", color: C.gray, width: COL_CHANGE, align: "right" },
      ],
    };
  }

  const chgColor = changeColor(q.changePercent);
  return {
    cells: [
      { text: symbol, color: C.cyan, width: COL_SYMBOL, fontWeight: "bold" },
      { text: `$${fmtPrice(q.last)}`, color: C.white, width: COL_PRICE, align: "right" },
      { text: `${arrow(q.changePercent)}${fmtPct(q.changePercent)}`, color: chgColor, width: COL_CHANGE, align: "right" },
    ],
  };
}

/** Build the VIX row (Image mode) — uses danger-graduated color */
function vixRow(q: SmartQuoteResult | null): DataTableRichRow {
  if (!q) {
    return {
      cells: [
        { text: "VIX", color: C.yellow, width: COL_SYMBOL, fontWeight: "bold" },
        { text: "—", color: C.gray, width: COL_PRICE, align: "right" },
        { text: "—", color: C.gray, width: COL_CHANGE, align: "right" },
      ],
    };
  }

  const color = vixColor(q.last);
  const chgText = q.changePercent !== null
    ? `${arrow(q.changePercent)}${fmtPct(q.changePercent)}`
    : "";
  return {
    cells: [
      { text: "VIX", color, width: COL_SYMBOL, fontWeight: "bold" },
      { text: `${Math.round(q.last)}`, color, width: COL_PRICE, align: "right" },
      { text: chgText, color, width: COL_CHANGE, align: "right" },
    ],
  };
}

// ─── Widget ───────────────────────────────────────────────────

export const indicesWidget: Widget = {
  id: "indices",
  name: "Major Indices",

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
      return TABLE_H; // Fixed: 28 + 5×34 = 198px
    }
    return PANEL_INDICES_H; // Flex minimum: 160px (engine stretches)
  },

  async render(
    ctx: WidgetContext,
    origin: { y: number; firstId: number; height: number },
  ): Promise<WidgetOutput> {
    // Fetch all quotes in parallel (same data either way)
    const [spyQ, qqqQ, diaQ, iwmQ, vixQ, spyBars] = await Promise.all([
      smartQuote(INDEX_SYMBOLS[0]).catch(() => null),
      smartQuote(INDEX_SYMBOLS[1]).catch(() => null),
      smartQuote(INDEX_SYMBOLS[2]).catch(() => null),
      smartQuote(INDEX_SYMBOLS[3]).catch(() => null),
      smartQuote(VIX_SYMBOL).catch(() => null),
      getHistoricalBars("SPY", "1mo", "1d").catch(() => []),
    ]);

    // ── Image mode: server-rendered data table ────────────────
    if (ctx.chartBaseUrl) {
      const rows: DataTableRichRow[] = [
        indexRow(spyQ, "SPY"),
        indexRow(qqqQ, "QQQ"),
        indexRow(diaQ, "DIA"),
        indexRow(iwmQ, "IWM"),
        vixRow(vixQ),
      ];

      // Render to PNG and populate chart cache
      const buffer = await renderDataTable("▸ INDICES", rows, {
        rowHeight: TABLE_ROW_H,
        titleHeight: TABLE_TITLE_H,
        fontSize: TABLE_FONT,
        bgColor: "#080818", // dark blue tint (matches SectionBg.indices)
      });
      setCachedChart("indices-table", buffer);

      return {
        elements: [
          imageEl(
            origin.firstId,
            origin.y,
            `${ctx.chartBaseUrl}/api/divoom/charts/indices-table`,
            { height: origin.height },
          ),
        ],
      };
    }

    // ── Text fallback: compact 3-line panel ───────────────────
    const spyArrow = arrow(spyQ?.changePercent ?? null);
    const qqqArrow = arrow(qqqQ?.changePercent ?? null);
    const line1 = spyQ && qqqQ
      ? `| SPY ${spyArrow}${fmtPct(spyQ.changePercent)}  QQQ ${qqqArrow}${fmtPct(qqqQ.changePercent)}`
      : `| SPY --  QQQ --`;

    const diaArrow = arrow(diaQ?.changePercent ?? null);
    const iwmArrow = arrow(iwmQ?.changePercent ?? null);
    const line2 = diaQ && iwmQ
      ? `| DIA ${diaArrow}${fmtPct(diaQ.changePercent)}  IWM ${iwmArrow}${fmtPct(iwmQ.changePercent)}`
      : `| DIA --  IWM --`;

    const vixPart = vixQ ? vixLabel(vixQ.last, vixQ.changePercent) : "VIX --";
    const sparkline = spyBars.length > 2
      ? "  " + blockSparkline(spyBars.map((b) => b.close), SPARKLINE_WIDTH)
      : "";
    const line3 = `| ${vixPart}${sparkline}`;

    const mainColor = vixQ && vixQ.last > 25
      ? vixColor(vixQ.last)
      : C.blue;

    const text = `${line1}\n${line2}\n${line3}`;

    return {
      elements: [
        textEl(origin.firstId, origin.y, text, mainColor, {
          height: origin.height,
          fontSize: TEXT_FONT_SIZE,
          bgColor: SectionBg.indices,
        }),
      ],
    };
  },
};

registerWidget(indicesWidget);
