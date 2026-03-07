import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";
import { EventName } from "@stoqey/ib";

class MockIB extends EventEmitter {
  reqNewsProviders = vi.fn();
  reqNewsArticle = vi.fn();
  reqHistoricalNews = vi.fn();
  reqNewsBulletins = vi.fn();
  cancelNewsBulletins = vi.fn();
}

const mockIBInstance = new MockIB();
let reqIdCounter = 1;

vi.mock("../connection.js", () => ({
  getIBKRClient: vi.fn(() => mockIBInstance),
  getNextReqId: vi.fn(() => reqIdCounter++),
  isConnected: vi.fn(() => true),
}));

import {
  reqNewsProviders,
  reqNewsArticle,
  reqHistoricalNews,
  reqNewsBulletins,
  detectBenzingaProvider,
  buildNewsDateRange,
} from "../news.js";

describe("news.ts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIBInstance.removeAllListeners();
    reqIdCounter = 1;
    // reset module cache if needed, but simple clearAllMocks is ok
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("reqNewsProviders", () => {
    it("fetches successfully", async () => {
      const promise = reqNewsProviders();
      expect(mockIBInstance.reqNewsProviders).toHaveBeenCalled();

      mockIBInstance.emit(EventName.newsProviders, [{ providerCode: "BZ", providerName: "Benzinga" }]);
      
      const res = await promise;
      expect(res).toHaveLength(1);
      expect(res[0].code).toBe("BZ");
    });

    it("handles timeout", async () => {
      vi.useFakeTimers();
      const promise = reqNewsProviders();
      
      vi.advanceTimersByTime(10000);
      await expect(promise).rejects.toThrow("News providers request timed out");
    });
  });

  describe("reqNewsArticle", () => {
    it("fetches successfully", async () => {
      const promise = reqNewsArticle("BZ", "12345");
      expect(mockIBInstance.reqNewsArticle).toHaveBeenCalledWith(1, "BZ", "12345");

      mockIBInstance.emit(EventName.newsArticle, 1, 0, "Article content");
      
      const res = await promise;
      expect(res).toMatchObject({ providerCode: "BZ", articleId: "12345", articleText: "Article content" });
    });
  });

  describe("reqHistoricalNews", () => {
    it("fetches successfully", async () => {
      const promise = reqHistoricalNews(123, "BZ", "start", "end");
      expect(mockIBInstance.reqHistoricalNews).toHaveBeenCalledWith(1, 123, "BZ", "start", "end", 50);

      mockIBInstance.emit(EventName.historicalNews, 1, "2024", "BZ", "111", "Headline");
      mockIBInstance.emit(EventName.historicalNewsEnd, 1);
      
      const res = await promise;
      expect(res).toHaveLength(1);
      expect(res[0]).toMatchObject({ headline: "Headline" });
    });
  });

  describe("reqNewsBulletins", () => {
    it("fetches successfully with timeout collection", async () => {
      vi.useFakeTimers();
      const promise = reqNewsBulletins();
      expect(mockIBInstance.reqNewsBulletins).toHaveBeenCalledWith(true);

      mockIBInstance.emit(EventName.updateNewsBulletin, 1, 0, "Bulletin message", "SMART");
      
      // Fast forward the collection window
      vi.advanceTimersByTime(3000);

      const res = await promise;
      expect(res).toHaveLength(1);
      expect(res[0]).toMatchObject({ message: "Bulletin message" });
      expect(mockIBInstance.cancelNewsBulletins).toHaveBeenCalled();
    });

    it("handles API error", async () => {
      const promise = reqNewsBulletins();
      mockIBInstance.emit(EventName.error, new Error("API error"), 502);

      await expect(promise).rejects.toThrow("News bulletins error (502): API error");
    });
  });

  describe("detectBenzingaProvider", () => {
    it("detects BZ", async () => {
      // It calls reqNewsProviders
      const promise = detectBenzingaProvider();
      
      // Delay so internal promises settle
      await vi.waitFor(() => {
        expect(mockIBInstance.reqNewsProviders).toHaveBeenCalled();
      });

      mockIBInstance.emit(EventName.newsProviders, [{ providerCode: "BZ" }]);
      
      const res = await promise;
      expect(res).toBe("BZ");
    });
  });

  describe("buildNewsDateRange", () => {
    it("builds correct format", () => {
      const res = buildNewsDateRange(24);
      expect(res.startDateTime).toMatch(/^\d{8}-\d{2}:\d{2}:\d{2}$/);
      expect(res.endDateTime).toMatch(/^\d{8}-\d{2}:\d{2}:\d{2}$/);
    });
  });
});
