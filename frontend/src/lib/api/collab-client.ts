import type { CollabMessage, CollabStats, PostMessageInput } from "./types";

const API_BASE = "/api/collab";

export async function getMessages(limit = 50): Promise<CollabMessage[]> {
  const response = await fetch(`${API_BASE}/messages?limit=${limit}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch messages: ${response.statusText}`);
  }
  return response.json();
}

export async function getStats(): Promise<CollabStats> {
  const response = await fetch(`${API_BASE}/stats`);
  if (!response.ok) {
    throw new Error(`Failed to fetch stats: ${response.statusText}`);
  }
  return response.json();
}

export async function postMessage(input: PostMessageInput): Promise<CollabMessage> {
  const tags = input.tags ? input.tags.split(",").map((t) => t.trim()).filter(Boolean) : undefined;
  
  const response = await fetch(`${API_BASE}/message`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      author: "user",
      content: input.content,
      tags,
    }),
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error || "Failed to post message");
  }
  
  return response.json();
}

export async function clearMessages(): Promise<void> {
  const response = await fetch(`${API_BASE}/messages`, {
    method: "DELETE",
  });
  
  if (!response.ok) {
    throw new Error(`Failed to clear messages: ${response.statusText}`);
  }
}
