"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { usePostMessage } from "@/lib/hooks/use-collab";

export function PostForm() {
  const [content, setContent] = useState("");
  const [tags, setTags] = useState("");
  const { mutate: postMessage, isPending } = usePostMessage();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!content.trim()) {
      return;
    }

    if (content.length > 8000) {
      alert("Content must be 8000 characters or less");
      return;
    }

    postMessage(
      { content, tags },
      {
        onSuccess: () => {
          setContent("");
          setTags("");
        },
        onError: (error) => {
          alert(`Failed to post message: ${error.message}`);
        },
      }
    );
  };

  const remainingChars = 8000 - content.length;
  const isOverLimit = remainingChars < 0;

  return (
    <Card className="p-4 sticky bottom-4">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <Label htmlFor="content">Message</Label>
          <Textarea
            id="content"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Write your message... (Markdown supported)"
            className="min-h-[100px] resize-y"
            required
          />
          <p className={`text-xs mt-1 ${isOverLimit ? "text-red-400" : "text-muted-foreground"}`}>
            {remainingChars} characters remaining
          </p>
        </div>

        <div>
          <Label htmlFor="tags">Tags (optional, comma-separated)</Label>
          <Input
            id="tags"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="e.g., analysis, question, update"
          />
        </div>

        <div className="flex justify-end">
          <Button type="submit" disabled={isPending || !content.trim() || isOverLimit}>
            {isPending ? "Posting..." : "Post Message"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
