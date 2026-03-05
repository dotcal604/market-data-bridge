"use client";

import { useState, useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { LayoutGrid, Loader2, RotateCcw, GripVertical, X, Plus } from "lucide-react";
import {
  useDivoomLayout,
  useDivoomSetLayout,
  useDivoomWidgets,
} from "@/lib/hooks/use-divoom";
import type { LayoutSettings, WidgetInfo, WidgetOverride } from "@/lib/api/types";

// dnd-kit
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

// ─── Constants ──────────────────────────────────────

const PANEL_HEIGHT = 1280;
const SCALE_BAR_MAX = 80; // max px height of the scale bar in the UI

interface SessionTab {
  id: string;
  label: string;
}

const SESSIONS: SessionTab[] = [
  { id: "regular", label: "Regular" },
  { id: "pre-market", label: "Pre-Market" },
  { id: "after-hours", label: "After-Hours" },
  { id: "closed", label: "Closed" },
];

// ─── Render mode badge ──────────────────────────────

function renderModeBadge(mode: string) {
  switch (mode) {
    case "image":
      return (
        <Badge variant="secondary" className="bg-blue-500/15 text-blue-400 text-[10px]">
          img
        </Badge>
      );
    case "dual":
      return (
        <Badge variant="secondary" className="bg-purple-500/15 text-purple-400 text-[10px]">
          dual
        </Badge>
      );
    default:
      return (
        <Badge variant="secondary" className="text-[10px]">
          text
        </Badge>
      );
  }
}

// ─── Sortable widget row ────────────────────────────

interface SortableWidgetProps {
  widget: WidgetInfo;
  isEnabled: boolean;
  scaleHeight: number; // 0-SCALE_BAR_MAX proportional height
  isPending: boolean;
  onToggle: (enabled: boolean) => void;
  onRemove: () => void;
}

function SortableWidget({
  widget,
  isEnabled,
  scaleHeight,
  isPending,
  onToggle,
  onRemove,
}: SortableWidgetProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: widget.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 rounded-md border px-2 py-1.5 ${
        isDragging
          ? "border-primary/50 bg-primary/5 shadow-lg"
          : "border-border/50 bg-transparent"
      } ${!isEnabled ? "opacity-50" : ""}`}
    >
      {/* Drag handle */}
      <button
        {...attributes}
        {...listeners}
        className="flex h-6 w-5 cursor-grab items-center justify-center rounded text-muted-foreground/50 hover:text-muted-foreground active:cursor-grabbing"
        tabIndex={-1}
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>

      {/* True-to-scale height bar */}
      <div
        className="w-1 min-h-[2px] rounded-full bg-primary/40 flex-shrink-0"
        style={{ height: `${Math.max(2, scaleHeight)}px` }}
        title={`${widget.name} height`}
      />

      {/* Widget name */}
      <span
        className={`flex-1 text-xs ${
          isEnabled ? "text-foreground" : "text-muted-foreground line-through"
        }`}
      >
        {widget.name}
      </span>

      {/* Render mode badge */}
      {renderModeBadge(widget.renderMode)}

      {/* Enable/Disable switch */}
      <Switch
        checked={isEnabled}
        onCheckedChange={onToggle}
        disabled={isPending}
        className="scale-75"
      />

      {/* Remove from session */}
      <Button
        variant="ghost"
        size="sm"
        className="h-6 w-6 p-0 text-muted-foreground/40 hover:text-destructive"
        onClick={onRemove}
        disabled={isPending}
        title="Remove from layout"
      >
        <X className="h-3 w-3" />
      </Button>
    </div>
  );
}

// ─── Main component ─────────────────────────────────

export function LayoutControl() {
  const { data: layout, isLoading: layoutLoading } = useDivoomLayout();
  const { data: widgets, isLoading: widgetsLoading } = useDivoomWidgets();
  const mutation = useDivoomSetLayout();

  const [selectedSession, setSelectedSession] = useState("regular");

  // Sensors for drag-and-drop
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Derive whether this session has a custom order
  const hasCustomOrder = useMemo(() => {
    if (!layout) return false;
    const order = layout.widgetOrder[selectedSession];
    return Array.isArray(order) && order.length > 0;
  }, [layout, selectedSession]);

  // Build the ordered widget list for the selected session
  const orderedWidgets = useMemo(() => {
    if (!widgets) return [];
    const customOrder = layout?.widgetOrder[selectedSession];
    if (customOrder && customOrder.length > 0) {
      // Only show widgets that are in the custom order
      const orderMap = new Map(customOrder.map((id, idx) => [id, idx]));
      return [...widgets]
        .filter((w) => orderMap.has(w.id))
        .sort((a, b) => {
          const ai = orderMap.get(a.id) ?? Number.MAX_SAFE_INTEGER;
          const bi = orderMap.get(b.id) ?? Number.MAX_SAFE_INTEGER;
          return ai - bi;
        });
    }
    return widgets;
  }, [widgets, layout, selectedSession]);

  // Widgets NOT currently in the session (available to add)
  const availableWidgets = useMemo(() => {
    if (!widgets) return [];
    const customOrder = layout?.widgetOrder[selectedSession];
    if (!customOrder || customOrder.length === 0) return [];
    const inSession = new Set(customOrder);
    return widgets.filter((w) => !inSession.has(w.id));
  }, [widgets, layout, selectedSession]);

  // Scale heights: proportional to minHeight from widget info
  const scaleHeights = useMemo(() => {
    const map: Record<string, number> = {};
    if (!orderedWidgets.length) return map;
    const totalHeight = orderedWidgets.reduce(
      (sum, w) => sum + (w.minHeight ?? 100),
      0
    );
    for (const w of orderedWidgets) {
      const h = w.minHeight ?? 100;
      // Scale to SCALE_BAR_MAX proportionally
      map[w.id] = Math.round((h / Math.max(totalHeight, 1)) * SCALE_BAR_MAX * orderedWidgets.length);
    }
    return map;
  }, [orderedWidgets]);

  // ─── Commit helpers ─────────────────────────────────

  const commitOverride = useCallback(
    (widgetId: string, patch: Partial<WidgetOverride>) => {
      if (!layout) return;
      const current = layout.widgetOverrides[widgetId] ?? {};
      mutation.mutate({
        widgetOverrides: {
          ...layout.widgetOverrides,
          [widgetId]: { ...current, ...patch },
        },
      });
    },
    [layout, mutation]
  );

  const commitOrder = useCallback(
    (ids: string[]) => {
      mutation.mutate({
        widgetOrder: {
          ...(layout?.widgetOrder ?? {}),
          [selectedSession]: ids,
        },
      });
    },
    [layout, mutation, selectedSession]
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const ids = orderedWidgets.map((w) => w.id);
    const oldIndex = ids.indexOf(active.id as string);
    const newIndex = ids.indexOf(over.id as string);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(ids, oldIndex, newIndex);
    commitOrder(reordered);
  }

  function handleRemove(widgetId: string) {
    const ids = orderedWidgets.map((w) => w.id).filter((id) => id !== widgetId);
    commitOrder(ids);
  }

  function handleAdd(widgetId: string) {
    const ids = orderedWidgets.map((w) => w.id);
    ids.push(widgetId);
    commitOrder(ids);
  }

  function commitResetOrder() {
    if (!layout) return;
    const updated = { ...layout.widgetOrder };
    delete updated[selectedSession];
    mutation.mutate({ widgetOrder: updated });
  }

  // ─── Loading state ──────────────────────────────────

  if (layoutLoading || widgetsLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          <span className="ml-2 text-xs text-muted-foreground">Loading widgets...</span>
        </CardContent>
      </Card>
    );
  }

  // ─── Render ───────────────────────────────────────

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <LayoutGrid className="h-4 w-4" />
          Widget Layout
          <Badge variant="outline" className="ml-auto font-mono text-xs">
            {SESSIONS.find((s) => s.id === selectedSession)?.label}
          </Badge>
          {mutation.isPending && (
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
          )}
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* ── 1. Session Tabs ──────────────────────── */}
        <div className="flex gap-1">
          {SESSIONS.map((session) => {
            const isActive = selectedSession === session.id;
            const sessionHasCustom =
              layout?.widgetOrder[session.id] &&
              layout.widgetOrder[session.id].length > 0;

            return (
              <Button
                key={session.id}
                variant="outline"
                size="sm"
                className={`flex-1 text-xs ${
                  isActive
                    ? "border-primary bg-primary/10 text-primary"
                    : ""
                }`}
                onClick={() => setSelectedSession(session.id)}
              >
                {session.label}
                {sessionHasCustom && (
                  <span className="ml-1 text-[9px] opacity-60">(custom)</span>
                )}
              </Button>
            );
          })}
        </div>

        {/* ── Order indicator ──────────────────────── */}
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground">
            {hasCustomOrder ? "Custom order" : "Default order"}
            {orderedWidgets.length > 0 && (
              <span className="ml-1 opacity-60">
                ({orderedWidgets.length} widget{orderedWidgets.length !== 1 ? "s" : ""})
              </span>
            )}
          </span>
          {hasCustomOrder && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-2 text-[10px] text-muted-foreground hover:text-foreground"
              onClick={commitResetOrder}
              disabled={mutation.isPending}
            >
              <RotateCcw className="h-3 w-3" />
              Reset Order
            </Button>
          )}
        </div>

        {/* ── 2. Sortable Widget List ────────────────── */}
        {!orderedWidgets.length ? (
          <div className="py-4 text-center text-xs text-muted-foreground">
            No widgets available
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={orderedWidgets.map((w) => w.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-1">
                {orderedWidgets.map((widget) => {
                  const override = layout?.widgetOverrides[widget.id];
                  const isEnabled = override?.enabled !== false;

                  return (
                    <SortableWidget
                      key={widget.id}
                      widget={widget}
                      isEnabled={isEnabled}
                      scaleHeight={scaleHeights[widget.id] ?? 8}
                      isPending={mutation.isPending}
                      onToggle={(checked) =>
                        commitOverride(widget.id, { enabled: checked })
                      }
                      onRemove={() => handleRemove(widget.id)}
                    />
                  );
                })}
              </div>
            </SortableContext>
          </DndContext>
        )}

        {/* ── 3. Available widgets to add ─────────── */}
        {availableWidgets.length > 0 && (
          <div className="space-y-1.5">
            <span className="text-[10px] text-muted-foreground">Available</span>
            <div className="flex flex-wrap gap-1">
              {availableWidgets.map((widget) => (
                <Button
                  key={widget.id}
                  variant="outline"
                  size="sm"
                  className="h-6 gap-1 px-2 text-[10px]"
                  onClick={() => handleAdd(widget.id)}
                  disabled={mutation.isPending}
                >
                  <Plus className="h-3 w-3" />
                  {widget.name}
                </Button>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
