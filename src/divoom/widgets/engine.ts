/**
 * Widget System — Layout Engine
 *
 * Orchestrates the full render pipeline:
 *   1. Resolve layout → Widget[]
 *   2. Budget check: sum slotCost() — fallback or refuse if over
 *   3. Sync pass: getHeight() per widget → Y allocation
 *   4. Async pass: render() all widgets in parallel
 *   5. Collect DisplayElement[]
 *   6. Final assertion: element counts ≤ 6T / 10I / 6N
 */

import type { DisplayElement } from "../display.js";
import type {
  WidgetContext,
  LayoutConfig,
  SlotCost,
  Widget,
} from "./types.js";
import { DEVICE_BUDGET, ID_BLOCK_SIZE } from "./types.js";
import { resolveLayout } from "./registry.js";
import { logger } from "../../logging.js";

const log = logger.child({ module: "widget-engine" });

// ─── Budget Helpers ─────────────────────────────────────────

function addCosts(a: SlotCost, b: SlotCost): SlotCost {
  return {
    text: a.text + b.text,
    image: a.image + b.image,
    netdata: a.netdata + b.netdata,
  };
}

function isOverBudget(total: SlotCost): boolean {
  return (
    total.text > DEVICE_BUDGET.text ||
    total.image > DEVICE_BUDGET.image ||
    total.netdata > DEVICE_BUDGET.netdata
  );
}

function fmtBudget(cost: SlotCost): string {
  return `${cost.text}T/${cost.image}I/${cost.netdata}N`;
}

// ─── Element Counting ───────────────────────────────────────

function countElements(elements: DisplayElement[]): SlotCost {
  let text = 0;
  let image = 0;
  let netdata = 0;

  for (const el of elements) {
    switch (el.Type) {
      case "Text":
        text++;
        break;
      case "Image":
        image++;
        break;
      case "NetData":
        netdata++;
        break;
      // Native types (Time, Date, Weather, etc.) don't count against budget
    }
  }

  return { text, image, netdata };
}

// ─── Engine Result ──────────────────────────────────────────

export interface EngineResult {
  elements: DisplayElement[];
  /** Parallel array — elementWidgets[i] is the widget ID that produced elements[i] */
  elementWidgets: string[];
  /** Which widgets rendered successfully */
  rendered: string[];
  /** Which widgets failed or were skipped */
  skipped: string[];
  /** Actual element counts */
  counts: SlotCost;
  /** Whether fallback degradation was applied */
  degraded: boolean;
}

// ─── Main Render Pipeline ───────────────────────────────────

/**
 * Render a full dashboard layout.
 *
 * @param layout - Which widgets to render, in order
 * @param ctx    - Shared context (session, ibkr, canvas, chartBaseUrl)
 * @returns EngineResult with all display elements
 */
export async function renderLayout(
  layout: LayoutConfig,
  ctx: WidgetContext,
): Promise<EngineResult> {
  // Step 1: Resolve widget IDs to instances
  const widgets = resolveLayout(layout);

  if (widgets.length === 0) {
    log.warn({ layout: layout.name }, "No widgets resolved — empty layout");
    return { elements: [], elementWidgets: [], rendered: [], skipped: [], counts: { text: 0, image: 0, netdata: 0 }, degraded: false };
  }

  const missing = layout.widgets.filter((id) => !widgets.find((w) => w.id === id));
  if (missing.length > 0) {
    log.warn({ missing }, "Unknown widget IDs in layout — skipped");
  }

  // Step 2: Budget check — sum slotCost() across all widgets
  let degraded = false;
  let widgetCosts = widgets.map((w) => ({ widget: w, cost: w.slotCost(ctx), useImage: false }));
  let totalCost = widgetCosts.reduce((acc, wc) => addCosts(acc, wc.cost), { text: 0, image: 0, netdata: 0 });

  if (isOverBudget(totalCost)) {
    log.warn(
      { total: fmtBudget(totalCost), budget: fmtBudget(DEVICE_BUDGET), layout: layout.name },
      "Layout over budget — attempting fallback degradation",
    );

    // Try degrading widgets that have renderAsImage fallback
    // Degrade from last to first (lower-priority widgets first)
    for (let i = widgetCosts.length - 1; i >= 0 && isOverBudget(totalCost); i--) {
      const wc = widgetCosts[i];
      if (wc.widget.renderAsImage && !wc.useImage) {
        // Swap: remove text/netdata cost, add 1 image
        const savedText = wc.cost.text;
        const savedNetdata = wc.cost.netdata;
        totalCost.text -= savedText;
        totalCost.netdata -= savedNetdata;
        totalCost.image -= wc.cost.image;

        wc.cost = { text: 0, image: 1, netdata: 0 };
        wc.useImage = true;
        totalCost = addCosts(totalCost, wc.cost);
        degraded = true;

        log.info(
          { widget: wc.widget.id, saved: `${savedText}T/${savedNetdata}N` },
          "Degraded widget to image mode",
        );
      }
    }

    if (isOverBudget(totalCost)) {
      log.error(
        { total: fmtBudget(totalCost), budget: fmtBudget(DEVICE_BUDGET) },
        "Layout STILL over budget after fallback — dropping tail widgets",
      );

      // Drop from end until we fit
      while (widgetCosts.length > 0 && isOverBudget(totalCost)) {
        const dropped = widgetCosts.pop()!;
        totalCost.text -= dropped.cost.text;
        totalCost.image -= dropped.cost.image;
        totalCost.netdata -= dropped.cost.netdata;
      }
    }
  }

  // Step 3: Sync pass — getHeight() per widget → Y allocation
  // Two sub-passes:
  //   a) Collect minimum heights and identify flex (expandable) widgets
  //   b) Distribute remaining canvas space among flex widgets so they fill 1280px
  const CANVAS_H = 1280;
  const TOP_PAD = 8;
  const activeWidgets = widgetCosts;

  // Fixed-size widgets that should NOT stretch (chrome, not content)
  const FIXED_WIDGETS = new Set(["header", "footer"]);

  // Sub-pass (a): collect minimum heights
  const heightEntries: Array<{
    widget: Widget;
    minHeight: number;
    flex: boolean;
    useImage: boolean;
    index: number;
  }> = [];

  for (let i = 0; i < activeWidgets.length; i++) {
    const { widget, useImage } = activeWidgets[i];
    const minH = widget.getHeight(ctx);
    if (minH <= 0) continue; // opts out

    heightEntries.push({
      widget,
      minHeight: minH,
      flex: !FIXED_WIDGETS.has(widget.id),
      useImage,
      index: i,
    });
  }

  // Sub-pass (b): distribute remaining space proportionally among flex widgets
  const totalMin = heightEntries.reduce((s, e) => s + e.minHeight, 0);
  const slack = Math.max(0, CANVAS_H - TOP_PAD - totalMin);
  const flexEntries = heightEntries.filter((e) => e.flex);
  const flexTotal = flexEntries.reduce((s, e) => s + e.minHeight, 0);

  // Each flex widget gets extra px proportional to its share of flex height
  const allocatedHeights = new Map<Widget, number>();
  let distributed = 0;
  for (let i = 0; i < flexEntries.length; i++) {
    const entry = flexEntries[i];
    const share = flexTotal > 0 ? entry.minHeight / flexTotal : 1 / flexEntries.length;
    const extra = i === flexEntries.length - 1
      ? slack - distributed                     // last flex widget gets remainder (avoid rounding drift)
      : Math.floor(slack * share);
    allocatedHeights.set(entry.widget, entry.minHeight + extra);
    distributed += extra;
  }

  // Build origins with final heights
  const origins: Array<{ widget: Widget; y: number; height: number; firstId: number; useImage: boolean }> = [];
  let currentY = TOP_PAD;

  for (const entry of heightEntries) {
    const height = allocatedHeights.get(entry.widget) ?? entry.minHeight;
    origins.push({
      widget: entry.widget,
      y: currentY,
      height,
      firstId: (entry.index + 1) * ID_BLOCK_SIZE,
      useImage: entry.useImage,
    });
    currentY += height;
  }

  // Step 4: Async pass — render all widgets in parallel
  const renderPromises = origins.map(async ({ widget, y, height, firstId, useImage }) => {
    try {
      const origin = { y, firstId, height };
      const output = useImage && widget.renderAsImage
        ? await widget.renderAsImage(ctx, origin)
        : await widget.render(ctx, origin);
      return { id: widget.id, elements: output.elements };
    } catch (err) {
      log.error({ err, widget: widget.id }, "Widget render failed — skipping");
      return { id: widget.id, elements: null };
    }
  });

  const results = await Promise.allSettled(renderPromises);

  // Step 5: Collect elements + track which widget produced each
  const allElements: DisplayElement[] = [];
  const elementWidgets: string[] = [];
  const rendered: string[] = [];
  const skipped: string[] = [...missing];

  for (const result of results) {
    if (result.status === "fulfilled" && result.value.elements) {
      for (const el of result.value.elements) {
        allElements.push(el);
        elementWidgets.push(result.value.id);
      }
      rendered.push(result.value.id);
    } else if (result.status === "fulfilled") {
      skipped.push(result.value.id);
    } else {
      // Promise rejected (shouldn't happen with our try/catch, but be safe)
      skipped.push("unknown");
    }
  }

  // Step 6: Renumber elements sequentially (1, 2, 3, ...)
  // The device may require sequential IDs — the block-based IDs (20, 40, 60)
  // are internal to the engine for collision avoidance during parallel render.
  for (let i = 0; i < allElements.length; i++) {
    allElements[i].ID = i + 1;
  }

  // Step 7: Final assertion — count actual elements
  const counts = countElements(allElements);

  if (isOverBudget(counts)) {
    log.error(
      { actual: fmtBudget(counts), budget: fmtBudget(DEVICE_BUDGET), rendered },
      "FINAL ASSERTION FAILED — element counts exceed device budget. Refusing to send.",
    );
    return {
      elements: [],
      elementWidgets: [],
      rendered: [],
      skipped: layout.widgets,
      counts,
      degraded,
    };
  }

  log.info(
    {
      layout: layout.name,
      counts: fmtBudget(counts),
      totalElements: allElements.length,
      rendered: rendered.join(","),
      skipped: skipped.length > 0 ? skipped.join(",") : "none",
    },
    "Layout rendered",
  );

  return { elements: allElements, elementWidgets, rendered, skipped, counts, degraded };
}
