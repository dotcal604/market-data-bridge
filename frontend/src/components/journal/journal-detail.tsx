"use client";

import type { JournalEntry } from "@/lib/api/types";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatTimestamp, formatPrice } from "@/lib/utils/formatters";
import { OutcomeUpdateForm } from "./outcome-update-form";

interface Props {
  entry: JournalEntry;
}

export function JournalDetail({ entry }: Props) {
  const tags = entry.tags ? (JSON.parse(entry.tags) as string[]) : [];
  const outcomeTags = entry.outcome_tags ? (JSON.parse(entry.outcome_tags) as string[]) : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card className="bg-card p-6">
        <div className="space-y-4">
          <div className="flex items-start justify-between">
            <div className="space-y-2">
              {entry.symbol && (
                <Badge variant="outline" className="text-base font-mono">
                  {entry.symbol}
                </Badge>
              )}
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                {entry.strategy_version && (
                  <span>Strategy: {entry.strategy_version}</span>
                )}
                <span>•</span>
                <span>{formatTimestamp(entry.created_at)}</span>
              </div>
            </div>
          </div>

          {tags.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {tags.map((tag, i) => (
                <Badge key={i} variant="secondary" className="text-xs">
                  {tag}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </Card>

      {/* Reasoning Card */}
      <Card className="bg-card p-6">
        <h3 className="mb-4 text-sm font-semibold text-foreground">
          Pre-Trade Reasoning
        </h3>
        <div className="whitespace-pre-wrap rounded-md bg-black/20 p-4 font-mono text-sm text-muted-foreground">
          {entry.reasoning}
        </div>
      </Card>

      {/* Market Context Card */}
      <Card className="bg-card p-6">
        <h3 className="mb-4 text-sm font-semibold text-foreground">
          Market Context at Entry
        </h3>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div>
            <div className="text-xs text-muted-foreground">SPY Price</div>
            <div className="font-mono text-sm">
              {entry.spy_price ? formatPrice(entry.spy_price) : "-"}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">VIX</div>
            <div className="font-mono text-sm">
              {entry.vix_level ? entry.vix_level.toFixed(1) : "-"}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Gap %</div>
            <div className="font-mono text-sm">
              {entry.gap_pct !== null ? `${entry.gap_pct.toFixed(2)}%` : "-"}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Time of Day</div>
            <div className="text-sm">
              {entry.time_of_day || "-"}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Relative Volume</div>
            <div className="font-mono text-sm">
              {entry.relative_volume ? `${entry.relative_volume.toFixed(1)}x` : "-"}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Spread %</div>
            <div className="font-mono text-sm">
              {entry.spread_pct !== null ? `${entry.spread_pct.toFixed(3)}%` : "-"}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Session Type</div>
            <div className="text-sm">
              {entry.session_type || "-"}
            </div>
          </div>
        </div>
      </Card>

      {/* Linked Orders Card (if AI recommendations exist) */}
      {entry.ai_recommendations && (
        <Card className="bg-card p-6">
          <h3 className="mb-4 text-sm font-semibold text-foreground">
            AI Recommendations
          </h3>
          <div className="whitespace-pre-wrap rounded-md bg-black/20 p-4 text-sm text-muted-foreground">
            {entry.ai_recommendations}
          </div>
        </Card>
      )}

      {/* Outcome Update Form */}
      <Card className="bg-card p-6">
        <h3 className="mb-4 text-sm font-semibold text-foreground">
          Post-Trade Outcome
        </h3>
        <OutcomeUpdateForm
          entryId={entry.id}
          existingOutcomeTags={outcomeTags}
          existingNotes={entry.notes}
        />
      </Card>
    </div>
  );
}
