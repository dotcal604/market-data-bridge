import { beforeEach, describe, expect, it, vi } from "vitest";

async function loadModules() {
  vi.resetModules();
  process.env.DB_PATH = ":memory:";
  const db = await import("../../db/database.js");
  const storage = await import("../benzinga-storage.js");
  const features = await import("../benzinga-features.js");
  return { db, storage, features };
}

describe("benzinga-features", () => {
  it("returns empty features when no news exists", async () => {
    const { features } = await loadModules();

    const result = features.computeNewsFeatures("AAPL", "2024-01-28T15:00:00Z");

    expect(result.has_news).toBe(false);
    expect(result.news_count_24h).toBe(0);
    expect(result.news_recency_min).toBeNull();
    expect(result.has_earnings_news).toBe(false);
    expect(result.has_analyst_news).toBe(false);
    expect(result.news_velocity).toBe(0);
    expect(result.multi_source).toBe(false);
    expect(result.pre_market_news).toBe(false);
  });

  it("computes features when news exists before entry", async () => {
    const { storage, features } = await loadModules();

    storage.ingestArticles([
      {
        id: "feat-001",
        title: "AAPL Earnings Beat",
        published_utc: "2024-01-28T14:00:00Z",
        tickers: ["AAPL"],
        channels: ["News"],
        tags: ["Earnings"],
        keywords: [],
        description: "Test",
        author: null,
        article_url: null,
        image_url: null,
      },
      {
        id: "feat-002",
        title: "AAPL Analyst Upgrade",
        published_utc: "2024-01-28T12:00:00Z",
        tickers: ["AAPL"],
        channels: ["Analyst Ratings"],
        tags: ["Analyst", "Rating"],
        keywords: [],
        description: "Test",
        author: null,
        article_url: null,
        image_url: null,
        publisher: { name: "Other Publisher" },
      },
    ]);

    const result = features.computeNewsFeatures("AAPL", "2024-01-28T15:00:00Z");

    expect(result.has_news).toBe(true);
    expect(result.news_count_24h).toBe(2);
    expect(result.news_recency_min).toBe(60); // 1 hour = 60 min
    expect(result.has_earnings_news).toBe(true);
    expect(result.has_analyst_news).toBe(true);
    expect(result.news_velocity).toBeCloseTo(2 / 24, 2);
  });

  it("enforces anti-leakage: excludes articles published after entry", async () => {
    const { storage, features } = await loadModules();

    storage.ingestArticles([
      {
        id: "leak-001",
        title: "Before Entry",
        published_utc: "2024-01-28T13:00:00Z",
        tickers: ["AAPL"],
        channels: [],
        tags: [],
        keywords: [],
        description: null,
        author: null,
        article_url: null,
        image_url: null,
      },
      {
        id: "leak-002",
        title: "After Entry — SHOULD NOT APPEAR",
        published_utc: "2024-01-28T16:00:00Z",
        tickers: ["AAPL"],
        channels: [],
        tags: [],
        keywords: [],
        description: null,
        author: null,
        article_url: null,
        image_url: null,
      },
    ]);

    const result = features.computeNewsFeatures("AAPL", "2024-01-28T15:00:00Z");

    expect(result.has_news).toBe(true);
    expect(result.news_count_24h).toBe(1);
  });

  it("enforces 24h lookback window", async () => {
    const { storage, features } = await loadModules();

    storage.ingestArticles([
      {
        id: "window-001",
        title: "Within 24h",
        published_utc: "2024-01-27T16:00:00Z",
        tickers: ["AAPL"],
        channels: [],
        tags: [],
        keywords: [],
        description: null,
        author: null,
        article_url: null,
        image_url: null,
      },
      {
        id: "window-002",
        title: "Outside 24h — too old",
        published_utc: "2024-01-26T10:00:00Z",
        tickers: ["AAPL"],
        channels: [],
        tags: [],
        keywords: [],
        description: null,
        author: null,
        article_url: null,
        image_url: null,
      },
    ]);

    const result = features.computeNewsFeatures("AAPL", "2024-01-28T15:00:00Z");

    expect(result.news_count_24h).toBe(1);
  });

  it("detects pre-market news (published 04:00-09:30 ET)", async () => {
    const { storage, features } = await loadModules();

    storage.ingestArticles([
      {
        id: "premarket-001",
        title: "Pre-market Article",
        // 09:00 UTC = 04:00 EST (within pre-market window)
        published_utc: "2024-01-28T09:00:00Z",
        tickers: ["AAPL"],
        channels: [],
        tags: [],
        keywords: [],
        description: null,
        author: null,
        article_url: null,
        image_url: null,
      },
    ]);

    const result = features.computeNewsFeatures("AAPL", "2024-01-28T15:00:00Z");
    expect(result.pre_market_news).toBe(true);
  });

  it("isolates features by symbol", async () => {
    const { storage, features } = await loadModules();

    storage.ingestArticles([
      {
        id: "sym-001",
        title: "TSLA News",
        published_utc: "2024-01-28T14:00:00Z",
        tickers: ["TSLA"],
        channels: [],
        tags: [],
        keywords: [],
        description: null,
        author: null,
        article_url: null,
        image_url: null,
      },
    ]);

    const tsla = features.computeNewsFeatures("TSLA", "2024-01-28T15:00:00Z");
    expect(tsla.has_news).toBe(true);

    const aapl = features.computeNewsFeatures("AAPL", "2024-01-28T15:00:00Z");
    expect(aapl.has_news).toBe(false);
  });

  it("features are stable on repeated computation", async () => {
    const { storage, features } = await loadModules();

    storage.ingestArticles([
      {
        id: "stable-001",
        title: "Stable Article",
        published_utc: "2024-01-28T14:00:00Z",
        tickers: ["AAPL"],
        channels: ["News"],
        tags: ["Earnings"],
        keywords: [],
        description: null,
        author: null,
        article_url: null,
        image_url: null,
      },
    ]);

    const first = features.computeNewsFeatures("AAPL", "2024-01-28T15:00:00Z");
    const second = features.computeNewsFeatures("AAPL", "2024-01-28T15:00:00Z");

    expect(first).toEqual(second);
  });
});
