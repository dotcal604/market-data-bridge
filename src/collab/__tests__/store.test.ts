import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  postMessage,
  readMessages,
  clearMessages,
  getStats,
  initCollabFromDb,
  type CollabMessage,
  type PostInput,
  type ReadOptions,
} from "../store.js";

// Mock the database module
vi.mock("../../db/database.js", () => ({
  insertCollabMessage: vi.fn(),
  loadRecentCollab: vi.fn(() => []),
  clearCollabDb: vi.fn(),
}));

// Mock the logger module
vi.mock("../../logging.js", () => ({
  logCollab: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

// Import mocked functions to spy on them
import { insertCollabMessage, loadRecentCollab, clearCollabDb } from "../../db/database.js";
import { logCollab } from "../../logging.js";

describe("Collaboration Store", () => {
  beforeEach(() => {
    // Clear messages before each test by re-initializing from an empty DB
    vi.clearAllMocks();
    (loadRecentCollab as any).mockReturnValue([]);
    initCollabFromDb();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("postMessage + readMessages round trip", () => {
    it("should post a message and read it back", () => {
      const input: PostInput = {
        author: "claude",
        content: "Hello from Claude",
      };

      const posted = postMessage(input);

      expect(posted).toMatchObject({
        author: "claude",
        content: "Hello from Claude",
      });
      expect(posted.id).toBeDefined();
      expect(posted.timestamp).toBeDefined();

      // Verify DB was called
      expect(insertCollabMessage).toHaveBeenCalledWith({
        id: posted.id,
        author: posted.author,
        content: posted.content,
        reply_to: undefined,
        tags: undefined,
        created_at: posted.timestamp,
      });

      // Read back
      const messages = readMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual(posted);
    });

    it("should post multiple messages and read them all", () => {
      const msg1 = postMessage({ author: "claude", content: "Message 1" });
      const msg2 = postMessage({ author: "chatgpt", content: "Message 2" });
      const msg3 = postMessage({ author: "user", content: "Message 3" });

      const messages = readMessages();
      expect(messages).toHaveLength(3);
      expect(messages.map((m) => m.content)).toEqual(["Message 1", "Message 2", "Message 3"]);
    });

    it("should post a message with tags and replyTo", () => {
      const msg1 = postMessage({ author: "claude", content: "First message" });
      const msg2 = postMessage({
        author: "chatgpt",
        content: "Reply to first",
        replyTo: msg1.id,
        tags: ["important", "follow-up"],
      });

      expect(msg2.replyTo).toBe(msg1.id);
      expect(msg2.tags).toEqual(["important", "follow-up"]);

      // Verify DB was called with correct parameters
      expect(insertCollabMessage).toHaveBeenLastCalledWith({
        id: msg2.id,
        author: msg2.author,
        content: msg2.content,
        reply_to: msg1.id,
        tags: ["important", "follow-up"],
        created_at: msg2.timestamp,
      });
    });

    it("should trim whitespace from content", () => {
      const posted = postMessage({ author: "user", content: "  Hello World  " });
      expect(posted.content).toBe("Hello World");
    });
  });

  describe("filtering by author", () => {
    beforeEach(() => {
      postMessage({ author: "claude", content: "Claude message 1" });
      postMessage({ author: "chatgpt", content: "ChatGPT message 1" });
      postMessage({ author: "user", content: "User message 1" });
      postMessage({ author: "claude", content: "Claude message 2" });
    });

    it("should filter by claude author", () => {
      const messages = readMessages({ author: "claude" });
      expect(messages).toHaveLength(2);
      expect(messages.every((m) => m.author === "claude")).toBe(true);
    });

    it("should filter by chatgpt author", () => {
      const messages = readMessages({ author: "chatgpt" });
      expect(messages).toHaveLength(1);
      expect(messages[0].author).toBe("chatgpt");
    });

    it("should filter by user author", () => {
      const messages = readMessages({ author: "user" });
      expect(messages).toHaveLength(1);
      expect(messages[0].author).toBe("user");
    });
  });

  describe("filtering by tag", () => {
    beforeEach(() => {
      postMessage({ author: "claude", content: "Message 1", tags: ["urgent", "bug"] });
      postMessage({ author: "chatgpt", content: "Message 2", tags: ["feature"] });
      postMessage({ author: "user", content: "Message 3", tags: ["urgent", "feature"] });
      postMessage({ author: "claude", content: "Message 4" }); // no tags
    });

    it("should filter by tag 'urgent'", () => {
      const messages = readMessages({ tag: "urgent" });
      expect(messages).toHaveLength(2);
      expect(messages.every((m) => m.tags?.includes("urgent"))).toBe(true);
    });

    it("should filter by tag 'feature'", () => {
      const messages = readMessages({ tag: "feature" });
      expect(messages).toHaveLength(2);
      expect(messages.every((m) => m.tags?.includes("feature"))).toBe(true);
    });

    it("should filter by tag 'bug'", () => {
      const messages = readMessages({ tag: "bug" });
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe("Message 1");
    });

    it("should return empty array for non-existent tag", () => {
      const messages = readMessages({ tag: "nonexistent" });
      expect(messages).toHaveLength(0);
    });
  });

  describe("filtering by since (timestamp)", () => {
    it("should filter messages after a specific timestamp", async () => {
      const msg1 = postMessage({ author: "claude", content: "Old message" });
      
      // Wait a bit to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 10));
      
      const cutoffTime = new Date().toISOString();
      
      await new Promise((resolve) => setTimeout(resolve, 10));
      
      const msg2 = postMessage({ author: "chatgpt", content: "New message 1" });
      const msg3 = postMessage({ author: "user", content: "New message 2" });

      const messages = readMessages({ since: cutoffTime });
      expect(messages).toHaveLength(2);
      expect(messages.map((m) => m.content)).toEqual(["New message 1", "New message 2"]);
    });

    it("should return empty array if all messages are before since", () => {
      postMessage({ author: "claude", content: "Message 1" });
      postMessage({ author: "chatgpt", content: "Message 2" });

      const futureTime = new Date(Date.now() + 10000).toISOString();
      const messages = readMessages({ since: futureTime });
      expect(messages).toHaveLength(0);
    });

    it("should return all messages if since is before all messages", () => {
      postMessage({ author: "claude", content: "Message 1" });
      postMessage({ author: "chatgpt", content: "Message 2" });

      const pastTime = new Date(Date.now() - 10000).toISOString();
      const messages = readMessages({ since: pastTime });
      expect(messages).toHaveLength(2);
    });
  });

  describe("limit parameter", () => {
    beforeEach(() => {
      // Create 10 messages
      for (let i = 1; i <= 10; i++) {
        postMessage({ author: "claude", content: `Message ${i}` });
      }
    });

    it("should respect default limit of 50", () => {
      const messages = readMessages();
      expect(messages).toHaveLength(10); // All messages since we have fewer than 50
    });

    it("should limit to specified number", () => {
      const messages = readMessages({ limit: 5 });
      expect(messages).toHaveLength(5);
      // Should return last 5 messages
      expect(messages[0].content).toBe("Message 6");
      expect(messages[4].content).toBe("Message 10");
    });

    it("should cap limit at 100", () => {
      const messages = readMessages({ limit: 200 });
      expect(messages).toHaveLength(10); // All messages since we have fewer than 100
    });

    it("should return last N messages when limit < total", () => {
      const messages = readMessages({ limit: 3 });
      expect(messages).toHaveLength(3);
      expect(messages[0].content).toBe("Message 8");
      expect(messages[1].content).toBe("Message 9");
      expect(messages[2].content).toBe("Message 10");
    });
  });

  describe("combined filters", () => {
    beforeEach(() => {
      postMessage({ author: "claude", content: "Old claude urgent", tags: ["urgent"] });
      postMessage({ author: "chatgpt", content: "Old chatgpt feature", tags: ["feature"] });
    });

    it("should combine author and tag filters", async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      const cutoff = new Date().toISOString();
      await new Promise((resolve) => setTimeout(resolve, 10));

      postMessage({ author: "claude", content: "New claude urgent", tags: ["urgent"] });
      postMessage({ author: "claude", content: "New claude feature", tags: ["feature"] });
      postMessage({ author: "chatgpt", content: "New chatgpt urgent", tags: ["urgent"] });

      const messages = readMessages({ author: "claude", tag: "urgent", since: cutoff });
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe("New claude urgent");
    });

    it("should combine all filters including limit", async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      const cutoff = new Date().toISOString();
      await new Promise((resolve) => setTimeout(resolve, 10));

      postMessage({ author: "claude", content: "New 1", tags: ["urgent"] });
      postMessage({ author: "claude", content: "New 2", tags: ["urgent"] });
      postMessage({ author: "claude", content: "New 3", tags: ["urgent"] });

      const messages = readMessages({ author: "claude", tag: "urgent", since: cutoff, limit: 2 });
      expect(messages).toHaveLength(2);
      expect(messages[0].content).toBe("New 2");
      expect(messages[1].content).toBe("New 3");
    });
  });

  describe("clearMessages", () => {
    it("should clear all messages and return count", () => {
      postMessage({ author: "claude", content: "Message 1" });
      postMessage({ author: "chatgpt", content: "Message 2" });
      postMessage({ author: "user", content: "Message 3" });

      const result = clearMessages();
      expect(result.cleared).toBe(3);
      expect(clearCollabDb).toHaveBeenCalled();

      const messages = readMessages();
      expect(messages).toHaveLength(0);
    });

    it("should return 0 when clearing empty store", () => {
      const result = clearMessages();
      expect(result.cleared).toBe(0);
      expect(clearCollabDb).toHaveBeenCalled();
    });

    it("should handle DB errors gracefully", () => {
      postMessage({ author: "claude", content: "Message 1" });
      (clearCollabDb as any).mockImplementation(() => {
        throw new Error("DB error");
      });

      const result = clearMessages();
      expect(result.cleared).toBe(1);
      expect(logCollab.error).toHaveBeenCalled();

      // In-memory messages should still be cleared
      const messages = readMessages();
      expect(messages).toHaveLength(0);
    });
  });

  describe("getStats", () => {
    it("should return correct stats for empty store", () => {
      const stats = getStats();
      expect(stats.totalMessages).toBe(0);
      expect(stats.byAuthor).toEqual({});
    });

    it("should return correct stats with single author", () => {
      postMessage({ author: "claude", content: "Message 1" });
      postMessage({ author: "claude", content: "Message 2" });

      const stats = getStats();
      expect(stats.totalMessages).toBe(2);
      expect(stats.byAuthor).toEqual({ claude: 2 });
    });

    it("should return correct stats with multiple authors", () => {
      postMessage({ author: "claude", content: "Message 1" });
      postMessage({ author: "chatgpt", content: "Message 2" });
      postMessage({ author: "user", content: "Message 3" });
      postMessage({ author: "claude", content: "Message 4" });
      postMessage({ author: "chatgpt", content: "Message 5" });

      const stats = getStats();
      expect(stats.totalMessages).toBe(5);
      expect(stats.byAuthor).toEqual({
        claude: 2,
        chatgpt: 2,
        user: 1,
      });
    });

    it("should update stats after clearing messages", () => {
      postMessage({ author: "claude", content: "Message 1" });
      postMessage({ author: "chatgpt", content: "Message 2" });

      clearMessages();

      const stats = getStats();
      expect(stats.totalMessages).toBe(0);
      expect(stats.byAuthor).toEqual({});
    });
  });

  describe("replyTo functionality", () => {
    it("should allow replying to an existing message", () => {
      const msg1 = postMessage({ author: "claude", content: "Original message" });
      const msg2 = postMessage({
        author: "chatgpt",
        content: "Reply to original",
        replyTo: msg1.id,
      });

      expect(msg2.replyTo).toBe(msg1.id);

      const messages = readMessages();
      expect(messages).toHaveLength(2);
      expect(messages[1].replyTo).toBe(msg1.id);
    });

    it("should throw error when replying to non-existent message", () => {
      expect(() => {
        postMessage({
          author: "claude",
          content: "Reply to nothing",
          replyTo: "non-existent-id",
        });
      }).toThrow('replyTo message id "non-existent-id" not found');
    });

    it("should allow chaining replies", () => {
      const msg1 = postMessage({ author: "claude", content: "Message 1" });
      const msg2 = postMessage({
        author: "chatgpt",
        content: "Reply to 1",
        replyTo: msg1.id,
      });
      const msg3 = postMessage({
        author: "user",
        content: "Reply to reply",
        replyTo: msg2.id,
      });

      expect(msg3.replyTo).toBe(msg2.id);
      expect(msg2.replyTo).toBe(msg1.id);
    });
  });

  describe("empty store behavior", () => {
    it("should return empty array for readMessages on empty store", () => {
      const messages = readMessages();
      expect(messages).toHaveLength(0);
      expect(Array.isArray(messages)).toBe(true);
    });

    it("should return zero stats on empty store", () => {
      const stats = getStats();
      expect(stats.totalMessages).toBe(0);
      expect(stats.byAuthor).toEqual({});
    });

    it("should return cleared: 0 for clearMessages on empty store", () => {
      const result = clearMessages();
      expect(result.cleared).toBe(0);
    });

    it("should allow posting to empty store", () => {
      const msg = postMessage({ author: "claude", content: "First message" });
      expect(msg).toBeDefined();
      expect(msg.content).toBe("First message");

      const messages = readMessages();
      expect(messages).toHaveLength(1);
    });
  });

  describe("edge cases and validation", () => {
    beforeEach(() => {
      // Ensure clean state for this describe block
      vi.clearAllMocks();
      (loadRecentCollab as any).mockReturnValue([]);
      initCollabFromDb();
    });

    it("should throw error for empty content", () => {
      expect(() => {
        postMessage({ author: "claude", content: "" });
      }).toThrow("Message content cannot be empty");
    });

    it("should throw error for whitespace-only content", () => {
      expect(() => {
        postMessage({ author: "claude", content: "   " });
      }).toThrow("Message content cannot be empty");
    });

    it("should throw error for content exceeding max length", () => {
      const longContent = "x".repeat(8001);
      expect(() => {
        postMessage({ author: "claude", content: longContent });
      }).toThrow("Message content exceeds 8000 character limit");
    });

    it("should accept content at exact max length", () => {
      const maxContent = "x".repeat(8000);
      const msg = postMessage({ author: "claude", content: maxContent });
      expect(msg.content.length).toBe(8000);
    });

    it("should handle DB insertion failure gracefully", () => {
      (insertCollabMessage as any).mockImplementation(() => {
        throw new Error("DB error");
      });

      const msg = postMessage({ author: "claude", content: "Test message" });
      expect(msg).toBeDefined();
      expect(logCollab.error).toHaveBeenCalled();

      // Message should still be in memory
      const messages = readMessages();
      expect(messages).toHaveLength(1);
    });

    it("should enforce max messages limit (200)", () => {
      // Completely reinitialize from empty DB to ensure clean state
      vi.clearAllMocks();
      (loadRecentCollab as any).mockReturnValue([]);
      initCollabFromDb();

      // Post 210 messages
      for (let i = 1; i <= 210; i++) {
        postMessage({ author: "claude", content: `MaxTest-${i}` });
      }

      // readMessages() with limit caps at 100, but the store should have 200
      const messagesLimit100 = readMessages({ limit: 300 });
      expect(messagesLimit100.length).toBe(100); // Capped at 100
      
      // Check stats to verify the store has 200 messages total
      const stats = getStats();
      expect(stats.totalMessages).toBe(200);
      
      // The last message returned should be our last posted message
      expect(messagesLimit100[messagesLimit100.length - 1].content).toBe("MaxTest-210");
      
      // First message should be "MaxTest-111" (since we keep last 200, and return last 100 of those)
      expect(messagesLimit100[0].content).toBe("MaxTest-111");
    });
  });

  describe("initCollabFromDb", () => {
    it("should load messages from DB on init", () => {
      const mockDbRows = [
        {
          id: "msg-1",
          author: "claude",
          content: "Loaded message 1",
          reply_to: null,
          tags: null,
          created_at: "2024-01-01T10:00:00.000Z",
        },
        {
          id: "msg-2",
          author: "chatgpt",
          content: "Loaded message 2",
          reply_to: "msg-1",
          tags: JSON.stringify(["important"]),
          created_at: "2024-01-01T10:01:00.000Z",
        },
      ];

      (loadRecentCollab as any).mockReturnValue(mockDbRows);
      initCollabFromDb();

      const messages = readMessages();
      expect(messages).toHaveLength(2);
      expect(messages[0]).toMatchObject({
        id: "msg-1",
        author: "claude",
        content: "Loaded message 1",
        timestamp: "2024-01-01T10:00:00.000Z",
      });
      expect(messages[1]).toMatchObject({
        id: "msg-2",
        author: "chatgpt",
        content: "Loaded message 2",
        replyTo: "msg-1",
        tags: ["important"],
        timestamp: "2024-01-01T10:01:00.000Z",
      });
      expect(logCollab.info).toHaveBeenCalledWith(
        { count: 2 },
        "Loaded collab messages from DB"
      );
    });

    it("should handle DB load failure gracefully", () => {
      (loadRecentCollab as any).mockImplementation(() => {
        throw new Error("DB error");
      });

      initCollabFromDb();

      const messages = readMessages();
      expect(messages).toHaveLength(0);
      expect(logCollab.error).toHaveBeenCalled();
    });

    it("should handle messages without optional fields", () => {
      const mockDbRows = [
        {
          id: "msg-1",
          author: "user",
          content: "Simple message",
          reply_to: null,
          tags: null,
          created_at: "2024-01-01T10:00:00.000Z",
        },
      ];

      (loadRecentCollab as any).mockReturnValue(mockDbRows);
      initCollabFromDb();

      const messages = readMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({
        id: "msg-1",
        author: "user",
        content: "Simple message",
        timestamp: "2024-01-01T10:00:00.000Z",
      });
      expect(messages[0].replyTo).toBeUndefined();
      expect(messages[0].tags).toBeUndefined();
    });

    it("should handle malformed JSON tags gracefully", () => {
      const mockDbRows = [
        {
          id: "msg-1",
          author: "claude",
          content: "Message with bad tags",
          reply_to: null,
          tags: "not-valid-json",
          created_at: "2024-01-01T10:00:00.000Z",
        },
      ];

      (loadRecentCollab as any).mockReturnValue(mockDbRows);
      initCollabFromDb();

      const messages = readMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0].tags).toEqual([]);
    });

    it("should handle non-array JSON tags gracefully", () => {
      const mockDbRows = [
        {
          id: "msg-1",
          author: "claude",
          content: "Message with invalid tags structure",
          reply_to: null,
          tags: JSON.stringify({ not: "an array" }),
          created_at: "2024-01-01T10:00:00.000Z",
        },
      ];

      (loadRecentCollab as any).mockReturnValue(mockDbRows);
      initCollabFromDb();

      const messages = readMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0].tags).toEqual([]);
    });
  });
});
