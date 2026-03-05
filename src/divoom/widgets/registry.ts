/**
 * Widget System — Registry
 *
 * Central registry for all available widgets.
 * Widgets self-register on import via registerWidget().
 */

import type { Widget, LayoutConfig } from "./types.js";

const widgets = new Map<string, Widget>();

/** Register a widget. Throws if ID is already registered. */
export function registerWidget(widget: Widget): void {
  if (widgets.has(widget.id)) {
    throw new Error(`Widget "${widget.id}" is already registered`);
  }
  widgets.set(widget.id, widget);
}

/** Get a widget by ID. Returns undefined if not found. */
export function getWidget(id: string): Widget | undefined {
  return widgets.get(id);
}

/** List all registered widget IDs. */
export function listWidgets(): string[] {
  return [...widgets.keys()];
}

/**
 * Resolve a LayoutConfig into an ordered array of Widget instances.
 * Skips unknown widget IDs with a warning.
 */
export function resolveLayout(layout: LayoutConfig): Widget[] {
  const resolved: Widget[] = [];

  for (const id of layout.widgets) {
    const w = widgets.get(id);
    if (w) {
      resolved.push(w);
    }
    // Unknown widgets are silently skipped — engine logs the warning
  }

  return resolved;
}

/** Get the full registry map (read-only snapshot for admin endpoints). */
export function getRegistry(): ReadonlyMap<string, Widget> {
  return widgets;
}

/** Clear all registrations (for testing). */
export function clearRegistry(): void {
  widgets.clear();
}
