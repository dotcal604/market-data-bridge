"use client";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { CollabMessage } from "@/lib/api/types";
import ReactMarkdown from "react-markdown";

interface MessageCardProps {
  message: CollabMessage;
}

function getAuthorBadgeStyles(author: string) {
  switch (author) {
    case "claude":
      return "bg-purple-500/10 text-purple-400 border-purple-500/20";
    case "chatgpt":
      return "bg-green-500/10 text-green-400 border-green-500/20";
    case "user":
      return "bg-gray-500/10 text-gray-400 border-gray-500/20";
    default:
      return "bg-gray-500/10 text-gray-400 border-gray-500/20";
  }
}

function formatRelativeTime(timestamp: string): string {
  const now = new Date();
  const then = new Date(timestamp);
  const diffMs = now.getTime() - then.getTime();
  
  // Handle future timestamps or invalid dates
  if (diffMs < 0 || isNaN(diffMs)) {
    return "just now";
  }
  
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

export function MessageCard({ message }: MessageCardProps) {
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          {/* Header */}
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <Badge variant="outline" className={getAuthorBadgeStyles(message.author)}>
              {message.author}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {formatRelativeTime(message.timestamp)}
            </span>
            {message.replyTo && (
              <span className="text-xs text-muted-foreground">
                ↩ replying to...
              </span>
            )}
          </div>

          {/* Content with markdown rendering */}
          <div className="prose prose-invert prose-sm max-w-none prose-pre:bg-muted prose-pre:text-foreground prose-code:text-foreground">
            <ReactMarkdown>{message.content}</ReactMarkdown>
          </div>

          {/* Tags */}
          {message.tags && message.tags.length > 0 && (
            <div className="flex gap-1 mt-3 flex-wrap">
              {message.tags.map((tag, idx) => (
                <Badge key={idx} variant="secondary" className="text-xs">
                  {tag}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
