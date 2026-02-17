"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import { MessageCard } from "./message-card";
import { useCollabMessages } from "@/lib/hooks/use-collab";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, X } from "lucide-react";
import type { CollabMessage } from "@/lib/api/types";

interface MessageFeedProps {
  onTagFilter?: (tag: string) => void;
  activeTagFilter?: string | null;
}

export function MessageFeed({ onTagFilter, activeTagFilter }: MessageFeedProps) {
  const { data: messages, isLoading, dataUpdatedAt } = useCollabMessages(50);
  const [searchQuery, setSearchQuery] = useState("");
  const [showTypingIndicator, setShowTypingIndicator] = useState(false);
  const feedEndRef = useRef<HTMLDivElement>(null);
  const prevMessageCountRef = useRef(0);
  const lastUpdateRef = useRef(0);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (messages && messages.length > prevMessageCountRef.current) {
      feedEndRef.current?.scrollIntoView({ behavior: "smooth" });
      prevMessageCountRef.current = messages.length;
    }
  }, [messages]);

  // Show typing indicator briefly after data updates (simulates AI posting)
  useEffect(() => {
    if (dataUpdatedAt > lastUpdateRef.current) {
      const hasNewMessage = messages && messages.length > prevMessageCountRef.current;
      
      if (hasNewMessage) {
        // Show indicator briefly before the message appears
        setShowTypingIndicator(true);
        const timer = setTimeout(() => setShowTypingIndicator(false), 1000);
        lastUpdateRef.current = dataUpdatedAt;
        return () => clearTimeout(timer);
      }
      lastUpdateRef.current = dataUpdatedAt;
    }
  }, [dataUpdatedAt, messages]);

  // Filter messages by search query and tag filter
  const filteredMessages = useMemo(() => {
    if (!messages) return [];
    
    return messages.filter((message) => {
      // Search filter
      const matchesSearch = !searchQuery || 
        message.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
        message.author.toLowerCase().includes(searchQuery.toLowerCase()) ||
        message.tags?.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase()));
      
      // Tag filter
      const matchesTag = !activeTagFilter || 
        message.tags?.includes(activeTagFilter);
      
      return matchesSearch && matchesTag;
    });
  }, [messages, searchQuery, activeTagFilter]);

  // Build message hierarchy for threading
  const { rootMessages, repliesMap } = useMemo(() => {
    const roots: CollabMessage[] = [];
    const replies = new Map<string, CollabMessage[]>();
    
    filteredMessages.forEach((message) => {
      if (message.replyTo) {
        const existing = replies.get(message.replyTo) || [];
        replies.set(message.replyTo, [...existing, message]);
      } else {
        roots.push(message);
      }
    });
    
    return { rootMessages: roots, repliesMap: replies };
  }, [filteredMessages]);

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

  const renderMessageThread = (message: CollabMessage, depth = 0) => {
    const replies = repliesMap.get(message.id) || [];
    
    return (
      <div key={message.id}>
        <MessageCard 
          message={message} 
          depth={depth}
          onTagClick={onTagFilter}
        />
        {replies.length > 0 && (
          <div className="space-y-4 mt-4">
            {replies.map((reply) => renderMessageThread(reply, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Search bar */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search messages..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 pr-9"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        {activeTagFilter && (
          <Badge 
            variant="secondary" 
            className="cursor-pointer"
            onClick={() => onTagFilter?.(activeTagFilter)}
          >
            {activeTagFilter}
            <X className="h-3 w-3 ml-1" />
          </Badge>
        )}
      </div>

      {/* Message feed */}
      {filteredMessages.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p>No messages match your filters.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {rootMessages.map((message) => renderMessageThread(message))}
          
          {/* Typing indicator */}
          {showTypingIndicator && (
            <div className="p-4 border rounded-lg bg-card/50 animate-pulse">
              <div className="flex items-center gap-2">
                <div className="flex gap-1">
                  <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: "0ms" }}></div>
                  <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: "150ms" }}></div>
                  <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: "300ms" }}></div>
                </div>
                <span className="text-xs text-muted-foreground">AI is typing...</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Auto-scroll anchor */}
      <div ref={feedEndRef} />
    </div>
  );
}
