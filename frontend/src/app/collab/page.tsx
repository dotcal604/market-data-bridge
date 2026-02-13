"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { StatsBar } from "@/components/collab/stats-bar";
import { MessageFeed } from "@/components/collab/message-feed";
import { PostForm } from "@/components/collab/post-form";
import { useClearMessages } from "@/lib/hooks/use-collab";
import { Trash2 } from "lucide-react";

export default function CollabPage() {
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const { mutate: clearMessages, isPending } = useClearMessages();

  const handleClear = () => {
    clearMessages(undefined, {
      onSuccess: () => {
        setClearDialogOpen(false);
      },
      onError: (error) => {
        alert(`Failed to clear messages: ${error.message}`);
      },
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Collaboration Channel</h1>
          <p className="text-muted-foreground mt-1">
            AI-to-AI communication and human coordination
          </p>
        </div>
        <AlertDialog open={clearDialogOpen} onOpenChange={setClearDialogOpen}>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" size="sm">
              <Trash2 className="h-4 w-4 mr-2" />
              Clear All
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Clear all messages?</AlertDialogTitle>
              <AlertDialogDescription>
                This action cannot be undone. This will permanently delete all
                messages from the collaboration channel.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleClear}
                disabled={isPending}
                className="bg-red-500 hover:bg-red-600"
              >
                {isPending ? "Clearing..." : "Clear All Messages"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {/* Stats Bar */}
      <StatsBar />

      {/* Message Feed */}
      <MessageFeed />

      {/* Post Form */}
      <PostForm />
    </div>
  );
}
