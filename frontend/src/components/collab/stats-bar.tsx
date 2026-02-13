"use client";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useCollabStats } from "@/lib/hooks/use-collab";

export function StatsBar() {
  const { data: stats, isLoading } = useCollabStats();

  if (isLoading || !stats) {
    return (
      <Card className="p-4">
        <div className="animate-pulse flex items-center gap-4">
          <div className="h-4 bg-muted rounded w-48"></div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <div className="flex items-center gap-4 flex-wrap">
        <span className="text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">{stats.totalMessages}</span> messages
        </span>
        <span className="text-muted-foreground">—</span>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="bg-purple-500/10 text-purple-400 border-purple-500/20">
            Claude: {stats.byAuthor.claude || 0}
          </Badge>
          <Badge variant="outline" className="bg-green-500/10 text-green-400 border-green-500/20">
            ChatGPT: {stats.byAuthor.chatgpt || 0}
          </Badge>
          <Badge variant="outline" className="bg-gray-500/10 text-gray-400 border-gray-500/20">
            User: {stats.byAuthor.user || 0}
          </Badge>
        </div>
      </div>
    </Card>
  );
}
