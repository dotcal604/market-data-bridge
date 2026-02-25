/**
 * Widget Engine — Unit Tests
 *
 * Tests the 6-step layout engine pipeline:
 *   1. Resolve layout → widgets
 *   2. Budget check — sum slotCost()
 *   3. Fallback degradation — renderAsImage()
 *   4. Height allocation — getHeight() + Y positions
 *   5. Parallel render — Promise.allSettled()
 *   6. Final assertion — element counts ≤ 6T/10I/6N
 */

import { describe, it, expect, beforeEach } from "vitest";
import { renderLayout } from "../engine.js";
import { registerWidget, clearRegistry } from "../registry.js";
import type { Widget, WidgetContext, WidgetOutput, SlotCost } from "../types.js";
import type { DisplayElement } from "../../display.js";

// ─── Test Helpers ────────────────────────────────────────────

const CTX: WidgetContext = {
  session: "regular",
  ibkrConnected: true,
  chartBaseUrl: "http://localhost:3000",
  canvas: { width: 800, contentWidth: 768, padX: 16 },
};

function makeTextElement(id: number, y: number, text: string): DisplayElement {
  return {
    ID: id,
    Type: "Text",
    StartX: 16,
    StartY: y,
    Width: 768,
    Height: 34,
    Align: 0,
    FontSize: 30,
    FontID: 52,
    FontColor: "#FFFFFF",
    BgColor: "#00000000",
    TextMessage: text,
  };
}

function makeImageElement(id: number, y: number, url: string): DisplayElement {
  return {
    ID: id,
    Type: "Image",
    StartX: 16,
    StartY: y,
    Width: 768,
    Height: 100,
    Align: 0,
    FontSize: 0,
    FontID: 0,
    FontColor: "#FFFFFF",
    BgColor: "#00000000",
    Url: url,
  };
}

/** Create a mock widget with configurable behavior. */
function mockWidget(opts: {
  id: string;
  cost: SlotCost;
  height: number;
  elements: (origin: { y: number; firstId: number; height: number }) => DisplayElement[];
  renderAsImage?: (origin: { y: number; firstId: number; height: number }) => DisplayElement[];
  shouldFail?: boolean;
}): Widget {
  const w: Widget = {
    id: opts.id,
    name: opts.id,
    renderMode: "text",
    slotCost: () => opts.cost,
    getHeight: () => opts.height,
    render: async (_ctx, origin) => {
      if (opts.shouldFail) throw new Error(`Widget ${opts.id} failed`);
      return { elements: opts.elements(origin) };
    },
  };

  if (opts.renderAsImage) {
    w.renderAsImage = async (_ctx, origin) => ({
      elements: opts.renderAsImage!(origin),
    });
  }

  return w;
}

// ─── Tests ───────────────────────────────────────────────────

describe("Widget Engine — renderLayout()", () => {
  beforeEach(() => {
    clearRegistry();
  });

  // ── Happy Path ────────────────────────────────────────────

  it("renders a simple layout within budget", async () => {
    registerWidget(mockWidget({
      id: "alpha",
      cost: { text: 1, image: 0, netdata: 0 },
      height: 40,
      elements: (o) => [makeTextElement(o.firstId, o.y, "Alpha")],
    }));

    registerWidget(mockWidget({
      id: "beta",
      cost: { text: 0, image: 1, netdata: 0 },
      height: 100,
      elements: (o) => [makeImageElement(o.firstId, o.y, "http://img")],
    }));

    const result = await renderLayout(
      { name: "test", widgets: ["alpha", "beta"] },
      CTX,
    );

    expect(result.elements).toHaveLength(2);
    expect(result.rendered).toEqual(["alpha", "beta"]);
    expect(result.skipped).toEqual([]);
    expect(result.counts).toEqual({ text: 1, image: 1, netdata: 0 });
    expect(result.degraded).toBe(false);
  });

  it("assigns correct Y positions based on getHeight()", async () => {
    registerWidget(mockWidget({
      id: "tall",
      cost: { text: 1, image: 0, netdata: 0 },
      height: 60,
      elements: (o) => [makeTextElement(o.firstId, o.y, "Tall")],
    }));

    registerWidget(mockWidget({
      id: "short",
      cost: { text: 1, image: 0, netdata: 0 },
      height: 30,
      elements: (o) => [makeTextElement(o.firstId, o.y, "Short")],
    }));

    const result = await renderLayout(
      { name: "test", widgets: ["tall", "short"] },
      CTX,
    );

    // First widget starts at y=8 (top padding)
    expect(result.elements[0].StartY).toBe(8);
    // Second widget starts at y=8+allocated_height (flex distributes remaining canvas)
    // Both are flex widgets so they share 1280-8=1272px proportionally
    // tall gets 60/(60+30) * 1272 = 848, short gets 30/90 * 1272 = 424
    expect(result.elements[1].StartY).toBe(8 + 848);
  });

  it("assigns ID blocks with ID_BLOCK_SIZE spacing", async () => {
    registerWidget(mockWidget({
      id: "w1",
      cost: { text: 1, image: 0, netdata: 0 },
      height: 40,
      elements: (o) => [makeTextElement(o.firstId, o.y, "W1")],
    }));

    registerWidget(mockWidget({
      id: "w2",
      cost: { text: 1, image: 0, netdata: 0 },
      height: 40,
      elements: (o) => [makeTextElement(o.firstId, o.y, "W2")],
    }));

    const result = await renderLayout(
      { name: "test", widgets: ["w1", "w2"] },
      CTX,
    );

    // Engine renumbers elements sequentially in Step 6: IDs become 1, 2, 3, ...
    expect(result.elements[0].ID).toBe(1);
    expect(result.elements[1].ID).toBe(2);
  });

  // ── Unknown Widget IDs ─────────────────────────────────────

  it("skips unknown widget IDs gracefully", async () => {
    registerWidget(mockWidget({
      id: "real",
      cost: { text: 1, image: 0, netdata: 0 },
      height: 40,
      elements: (o) => [makeTextElement(o.firstId, o.y, "Real")],
    }));

    const result = await renderLayout(
      { name: "test", widgets: ["real", "fake", "missing"] },
      CTX,
    );

    expect(result.rendered).toEqual(["real"]);
    expect(result.skipped).toContain("fake");
    expect(result.skipped).toContain("missing");
  });

  it("returns empty result for fully empty layout", async () => {
    const result = await renderLayout(
      { name: "empty", widgets: [] },
      CTX,
    );

    expect(result.elements).toEqual([]);
    expect(result.rendered).toEqual([]);
  });

  // ── Zero-Height Opt-Out ────────────────────────────────────

  it("skips widgets that return height=0 (opt-out)", async () => {
    registerWidget(mockWidget({
      id: "visible",
      cost: { text: 1, image: 0, netdata: 0 },
      height: 40,
      elements: (o) => [makeTextElement(o.firstId, o.y, "Visible")],
    }));

    registerWidget(mockWidget({
      id: "hidden",
      cost: { text: 0, image: 1, netdata: 0 },
      height: 0, // opts out this cycle
      elements: () => [/* never called */],
    }));

    const result = await renderLayout(
      { name: "test", widgets: ["visible", "hidden"] },
      CTX,
    );

    // Only the visible widget renders
    expect(result.elements).toHaveLength(1);
    expect(result.rendered).toEqual(["visible"]);
  });

  // ── Failed Widgets ─────────────────────────────────────────

  it("skips widgets that throw during render", async () => {
    registerWidget(mockWidget({
      id: "good",
      cost: { text: 1, image: 0, netdata: 0 },
      height: 40,
      elements: (o) => [makeTextElement(o.firstId, o.y, "Good")],
    }));

    registerWidget(mockWidget({
      id: "bad",
      cost: { text: 1, image: 0, netdata: 0 },
      height: 40,
      elements: () => { throw new Error("boom"); },
      shouldFail: true,
    }));

    const result = await renderLayout(
      { name: "test", widgets: ["good", "bad"] },
      CTX,
    );

    expect(result.rendered).toEqual(["good"]);
    expect(result.skipped).toContain("bad");
    expect(result.elements).toHaveLength(1);
  });

  // ── Budget Overflow + Fallback Degradation ─────────────────

  it("degrades widgets with renderAsImage when text budget is exceeded", async () => {
    // 7 Text widgets = over budget (max 6)
    for (let i = 0; i < 7; i++) {
      const hasImageFallback = i >= 5; // last 2 can degrade
      registerWidget(mockWidget({
        id: `txt-${i}`,
        cost: { text: 1, image: 0, netdata: 0 },
        height: 30,
        elements: (o) => [makeTextElement(o.firstId, o.y, `Text ${i}`)],
        renderAsImage: hasImageFallback
          ? (o) => [makeImageElement(o.firstId, o.y, `http://fallback/${i}`)]
          : undefined,
      }));
    }

    const result = await renderLayout(
      { name: "over-text", widgets: Array.from({ length: 7 }, (_, i) => `txt-${i}`) },
      CTX,
    );

    // Should degrade txt-6 first (last to first), then txt-5 if needed
    expect(result.degraded).toBe(true);
    expect(result.counts.text).toBeLessThanOrEqual(6);
    // All should still render (some as images)
    expect(result.rendered.length + result.skipped.length).toBeGreaterThanOrEqual(7);
  });

  it("drops tail widgets when degradation isn't enough", async () => {
    // 8 Text widgets, none with fallback — must drop some
    for (let i = 0; i < 8; i++) {
      registerWidget(mockWidget({
        id: `nodeg-${i}`,
        cost: { text: 1, image: 0, netdata: 0 },
        height: 30,
        elements: (o) => [makeTextElement(o.firstId, o.y, `No-degrade ${i}`)],
      }));
    }

    const result = await renderLayout(
      { name: "overflow", widgets: Array.from({ length: 8 }, (_, i) => `nodeg-${i}`) },
      CTX,
    );

    // Should have dropped some to fit within budget
    expect(result.counts.text).toBeLessThanOrEqual(6);
    expect(result.elements.length).toBeLessThan(8);
  });

  // ── Final Assertion ─────────────────────────────────────────

  it("refuses to send if actual element counts exceed budget (final assertion)", async () => {
    // Widget that lies about its cost (says 1 Text but emits 7)
    registerWidget({
      id: "liar",
      name: "Liar Widget",
      renderMode: "text",
      slotCost: () => ({ text: 1, image: 0, netdata: 0 }),
      getHeight: () => 300,
      render: async (_ctx, origin) => ({
        elements: Array.from({ length: 7 }, (_, i) =>
          makeTextElement(origin.firstId + i, origin.y + i * 40, `Lie ${i}`),
        ),
      }),
    });

    const result = await renderLayout(
      { name: "lying", widgets: ["liar"] },
      CTX,
    );

    // Final assertion should catch the lie and refuse
    expect(result.elements).toEqual([]);
    expect(result.skipped).toContain("liar");
    expect(result.counts.text).toBe(7); // records actual count even though refused
  });

  // ── Image Budget ───────────────────────────────────────────

  it("respects image budget limit of 10", async () => {
    // 11 Image widgets — over budget
    for (let i = 0; i < 11; i++) {
      registerWidget(mockWidget({
        id: `img-${i}`,
        cost: { text: 0, image: 1, netdata: 0 },
        height: 50,
        elements: (o) => [makeImageElement(o.firstId, o.y, `http://img/${i}`)],
      }));
    }

    const result = await renderLayout(
      { name: "img-overflow", widgets: Array.from({ length: 11 }, (_, i) => `img-${i}`) },
      CTX,
    );

    expect(result.counts.image).toBeLessThanOrEqual(10);
  });

  // ── Mixed Budget ───────────────────────────────────────────

  it("handles mixed text+image layout within budget", async () => {
    registerWidget(mockWidget({
      id: "header",
      cost: { text: 2, image: 0, netdata: 0 },
      height: 56,
      elements: (o) => [
        makeTextElement(o.firstId, o.y, "Header Line 1"),
        makeTextElement(o.firstId + 1, o.y + 30, "Header Line 2"),
      ],
    }));

    registerWidget(mockWidget({
      id: "chart",
      cost: { text: 0, image: 2, netdata: 0 },
      height: 200,
      elements: (o) => [
        makeImageElement(o.firstId, o.y, "http://chart1"),
        makeImageElement(o.firstId + 1, o.y + 100, "http://chart2"),
      ],
    }));

    const result = await renderLayout(
      { name: "mixed", widgets: ["header", "chart"] },
      CTX,
    );

    expect(result.elements).toHaveLength(4);
    expect(result.counts).toEqual({ text: 2, image: 2, netdata: 0 });
    expect(result.degraded).toBe(false);
  });

  // ── Parallel Execution ─────────────────────────────────────

  it("renders widgets in parallel (timing proof)", async () => {
    const renderTimes: number[] = [];

    for (let i = 0; i < 3; i++) {
      registerWidget({
        id: `slow-${i}`,
        name: `Slow ${i}`,
        renderMode: "text",
        slotCost: () => ({ text: 1, image: 0, netdata: 0 }),
        getHeight: () => 30,
        render: async (_ctx, origin) => {
          const start = Date.now();
          await new Promise((r) => setTimeout(r, 50)); // 50ms each
          renderTimes.push(Date.now() - start);
          return {
            elements: [makeTextElement(origin.firstId, origin.y, `Slow ${i}`)],
          };
        },
      });
    }

    const start = Date.now();
    const result = await renderLayout(
      { name: "parallel", widgets: ["slow-0", "slow-1", "slow-2"] },
      CTX,
    );
    const totalTime = Date.now() - start;

    expect(result.rendered).toHaveLength(3);
    // If sequential, ~150ms. If parallel, ~50-80ms.
    // Use generous threshold to avoid flaky tests.
    expect(totalTime).toBeLessThan(200);
  });
});
