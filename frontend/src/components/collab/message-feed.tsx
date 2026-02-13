"use client";

import { useEffect, useRef } from "react";
import { MessageCard } from "./message-card";
import { useCollabMessages } from "@/lib/hooks/use-collab";
import { Skeleton } from "@/components/ui/skeleton";

export function MessageFeed() {
  const { data: messages, isLoading } = useCollabMessages(50);
  const previousCountRef = useRef<number>(0);

  useEffect(() => {
    if (messages && messages.length > previousCountRef.current && previousCountRef.current > 0) {
      // Show toast notification for new messages
      // Note: This would require a toast system, which we'll implement simply with a console log for now
      console.log("New messages available");
    }
    if (messages) {
      previousCountRef.current = messages.length;
    }
  }, [messages]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="p-4 border rounded-lg bg-card">
            <Skeleton className="h-6 w-24 mb-2" />
            <Skeleton className="h-20 w-full" />
          </div>
        ))}
      </div>
    );
  }

  if (!messages || messages.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p>No messages yet. Start a conversation below!</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {messages.map((message) => (
        <MessageCard key={message.id} message={message} />
      ))}
    </div>
  );
}
