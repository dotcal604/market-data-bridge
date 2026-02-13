"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { journalClient } from "@/lib/api/journal-client";
import { useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";

interface Props {
  entryId: number;
  existingOutcomeTags: string[] | null;
  existingNotes: string | null;
  onSuccess?: () => void;
}

const OUTCOME_TAG_OPTIONS = [
  "win",
  "loss",
  "breakeven",
  "stopped_out",
  "target_hit",
  "early_exit",
] as const;

export function OutcomeUpdateForm({
  entryId,
  existingOutcomeTags,
  existingNotes,
  onSuccess,
}: Props) {
  const queryClient = useQueryClient();
  const [selectedTags, setSelectedTags] = useState<string[]>(existingOutcomeTags ?? []);
  const [notes, setNotes] = useState(existingNotes ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setShowSuccess(false);

    try {
      await journalClient.update(entryId, {
        outcome_tags: selectedTags,
        notes: notes.trim() || undefined,
      });

      // Invalidate queries to refetch
      await queryClient.invalidateQueries({ queryKey: ["journal-entry", entryId] });
      await queryClient.invalidateQueries({ queryKey: ["journal-entries"] });

      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 3000);
      
      if (onSuccess) onSuccess();
    } catch (error) {
      console.error("Failed to update outcome:", error);
      alert(error instanceof Error ? error.message : "Failed to update outcome");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Outcome Tags */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">Outcome Tags</Label>
        <div className="flex flex-wrap gap-2">
          {OUTCOME_TAG_OPTIONS.map((tag) => {
            const isSelected = selectedTags.includes(tag);
            return (
              <Badge
                key={tag}
                variant={isSelected ? "default" : "outline"}
                className="cursor-pointer text-xs transition-colors hover:bg-accent"
                onClick={() => toggleTag(tag)}
              >
                {tag.replace("_", " ")}
              </Badge>
            );
          })}
        </div>
      </div>

      {/* Notes */}
      <div className="space-y-2">
        <Label htmlFor="notes" className="text-sm font-medium">
          Post-Trade Notes
        </Label>
        <Textarea
          id="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Reflection on trade execution, lessons learned, etc..."
          rows={4}
          className="resize-none"
        />
      </div>

      {/* Submit Button */}
      <div className="flex items-center gap-3">
        <Button
          type="submit"
          disabled={isSubmitting}
          className="bg-emerald-600 hover:bg-emerald-700"
        >
          {isSubmitting ? "Saving..." : "Save Outcome"}
        </Button>
        {showSuccess && (
          <div className="flex items-center gap-2 text-sm text-emerald-400">
            <Check className="h-4 w-4" />
            <span>Saved successfully</span>
          </div>
        )}
      </div>
    </form>
  );
}
