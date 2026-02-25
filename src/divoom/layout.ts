/**
 * TimesFrame Dashboard Layout
 *
 * Defines element positions on the 800x1280 portrait canvas.
 * Converts DashboardData → DisplayElement[] for the TimesFrame API.
 *
 * Because UpdateDisplayItems only changes TextMessage (not FontColor),
 * we re-enter custom mode on each refresh to allow dynamic colors.
 *
 * Element ID allocation:
 *   1       = Header (session, time, source)
 *   10-13   = Index rows (SPY, QQQ, DIA, IWM)
 *   14      = VIX
 *   20      = Sectors section header
 *   21-25   = Sector rows
 *   30      = Movers section header
 *   31-34   = Mover rows (2 gainers + 2 losers)
 *   40      = Portfolio section header
 *   41-44   = Portfolio data rows
 *   50      = News section header
 *   51-53   = News headlines
 *   60      = Indicators section header
 *   61-65   = Indicator rows
 */

import type { DisplayElement } from "./display.js";

// ─── Data Contracts ─────────────────────────────────────────

export interface TextRow {
  text: string;
  color: string;
}

export interface DashboardSection {
  header: TextRow;
  rows: TextRow[];
}

export interface DashboardData {
  header: TextRow;
  indices: TextRow[];           // up to 4 (SPY, QQQ, DIA, IWM)
  vix: TextRow | null;
  sectors: DashboardSection;
  movers: DashboardSection;
  portfolio: DashboardSection;
  news: DashboardSection;
  indicators: DashboardSection;
}

// ─── Layout Constants ───────────────────────────────────────

const CANVAS_W = 800;
const PAD_X = 16;
const CONTENT_W = CANVAS_W - PAD_X * 2;
const FONT_ID = 52;
const BG_TRANSPARENT = "#00000000";

// Font sizes
const HEADER_SIZE = 36;
const SECTION_HEADER_SIZE = 24;
const DATA_SIZE = 30;

// Row heights
const HEADER_H = 44;
const SECTION_HEADER_H = 30;
const DATA_H = 34;
const SECTION_GAP = 12;

// ─── Element Position Builder ───────────────────────────────

interface LayoutSlot {
  id: number;
  y: number;
  fontSize: number;
  height: number;
  align: 0 | 1 | 2;
}

function buildSlots(): LayoutSlot[] {
  const slots: LayoutSlot[] = [];
  let y = 20;

  // Header
  slots.push({ id: 1, y, fontSize: HEADER_SIZE, height: HEADER_H, align: 1 });
  y += HEADER_H + SECTION_GAP;

  // Indices (4 rows)
  for (let i = 0; i < 4; i++) {
    slots.push({ id: 10 + i, y, fontSize: DATA_SIZE, height: DATA_H, align: 0 });
    y += DATA_H;
  }

  // VIX
  slots.push({ id: 14, y, fontSize: DATA_SIZE, height: DATA_H, align: 0 });
  y += DATA_H + SECTION_GAP;

  // Sectors
  slots.push({ id: 20, y, fontSize: SECTION_HEADER_SIZE, height: SECTION_HEADER_H, align: 0 });
  y += SECTION_HEADER_H;
  for (let i = 0; i < 5; i++) {
    slots.push({ id: 21 + i, y, fontSize: DATA_SIZE - 2, height: DATA_H - 2, align: 0 });
    y += DATA_H - 2;
  }
  y += SECTION_GAP;

  // Movers
  slots.push({ id: 30, y, fontSize: SECTION_HEADER_SIZE, height: SECTION_HEADER_H, align: 0 });
  y += SECTION_HEADER_H;
  for (let i = 0; i < 4; i++) {
    slots.push({ id: 31 + i, y, fontSize: DATA_SIZE - 2, height: DATA_H - 2, align: 0 });
    y += DATA_H - 2;
  }
  y += SECTION_GAP;

  // Portfolio
  slots.push({ id: 40, y, fontSize: SECTION_HEADER_SIZE, height: SECTION_HEADER_H, align: 0 });
  y += SECTION_HEADER_H;
  for (let i = 0; i < 4; i++) {
    slots.push({ id: 41 + i, y, fontSize: DATA_SIZE - 2, height: DATA_H - 2, align: 0 });
    y += DATA_H - 2;
  }
  y += SECTION_GAP;

  // News
  slots.push({ id: 50, y, fontSize: SECTION_HEADER_SIZE, height: SECTION_HEADER_H, align: 0 });
  y += SECTION_HEADER_H;
  for (let i = 0; i < 3; i++) {
    slots.push({ id: 51 + i, y, fontSize: DATA_SIZE - 4, height: DATA_H - 4, align: 0 });
    y += DATA_H - 4;
  }
  y += SECTION_GAP;

  // Indicators
  slots.push({ id: 60, y, fontSize: SECTION_HEADER_SIZE, height: SECTION_HEADER_H, align: 0 });
  y += SECTION_HEADER_H;
  for (let i = 0; i < 5; i++) {
    slots.push({ id: 61 + i, y, fontSize: DATA_SIZE - 2, height: DATA_H - 2, align: 0 });
    y += DATA_H - 2;
  }

  return slots;
}

/** Pre-computed slot positions */
export const SLOTS = buildSlots();

// ─── Build DisplayElement[] from DashboardData ──────────────

function textElement(slot: LayoutSlot, text: string, color: string): DisplayElement {
  return {
    ID: slot.id,
    Type: "Text",
    StartX: slot.align === 1 ? 0 : PAD_X,
    StartY: slot.y,
    Width: slot.align === 1 ? CANVAS_W : CONTENT_W,
    Height: slot.height,
    Align: slot.align,
    FontSize: slot.fontSize,
    FontID: FONT_ID,
    FontColor: color,
    BgColor: BG_TRANSPARENT,
    TextMessage: text,
  };
}

function slotById(id: number): LayoutSlot {
  return SLOTS.find((s) => s.id === id)!;
}

function fillSection(
  headerId: number,
  firstRowId: number,
  maxRows: number,
  section: DashboardSection,
): DisplayElement[] {
  const elements: DisplayElement[] = [];
  elements.push(textElement(slotById(headerId), section.header.text, section.header.color));

  for (let i = 0; i < maxRows; i++) {
    const row = section.rows[i];
    elements.push(
      textElement(
        slotById(firstRowId + i),
        row?.text ?? "",
        row?.color ?? "#808080",
      ),
    );
  }

  return elements;
}

/**
 * Convert DashboardData into a full array of DisplayElements
 * ready for enterCustomMode.
 */
export function buildElements(data: DashboardData): DisplayElement[] {
  const elements: DisplayElement[] = [];

  // Header
  elements.push(textElement(slotById(1), data.header.text, data.header.color));

  // Indices (up to 4)
  for (let i = 0; i < 4; i++) {
    const row = data.indices[i];
    elements.push(
      textElement(slotById(10 + i), row?.text ?? "", row?.color ?? "#808080"),
    );
  }

  // VIX
  elements.push(
    textElement(slotById(14), data.vix?.text ?? "", data.vix?.color ?? "#808080"),
  );

  // Sections
  elements.push(...fillSection(20, 21, 5, data.sectors));
  elements.push(...fillSection(30, 31, 4, data.movers));
  elements.push(...fillSection(40, 41, 4, data.portfolio));
  elements.push(...fillSection(50, 51, 3, data.news));
  elements.push(...fillSection(60, 61, 5, data.indicators));

  return elements;
}

/**
 * Get the total canvas height used by the layout.
 * Useful for diagnostics.
 */
export function getLayoutHeight(): number {
  const last = SLOTS[SLOTS.length - 1];
  return last.y + last.height;
}
