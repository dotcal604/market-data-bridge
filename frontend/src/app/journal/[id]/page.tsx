"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import { useJournalEntry } from "@/lib/hooks/use-journal";
import { JournalDetail } from "@/components/journal/journal-detail";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft } from "lucide-react";

export default function JournalDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const entryId = parseInt(id, 10);

  const { data: entry, isLoading, error } = useJournalEntry(
    isNaN(entryId) ? null : entryId
  );

  if (isNaN(entryId)) {
    return (
      <div className="space-y-6">
        <Button
          variant="outline"
          size="sm"
          onClick={() => router.push("/journal")}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Journal
        </Button>
        <div className="rounded-lg border border-border bg-card p-8 text-center">
          <p className="text-sm text-destructive">Invalid journal entry ID</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Back Button */}
      <Button
        variant="outline"
        size="sm"
        onClick={() => router.push("/journal")}
      >
        <ArrowLeft className="mr-2 h-4 w-4" />
        Back to Journal
      </Button>

      {/* Content */}
      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : error ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center">
          <p className="text-sm text-destructive">
            Error loading entry: {error.message}
          </p>
        </div>
      ) : entry ? (
        <JournalDetail entry={entry} />
      ) : (
        <div className="rounded-lg border border-border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">Entry not found</p>
        </div>
      )}
    </div>
  );
}
