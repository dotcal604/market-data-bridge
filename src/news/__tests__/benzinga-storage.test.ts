import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BenzingaArticle } from "../benzinga-schema.js";

// Dynamic import with in-memory DB for isolation
async function loadModules() {
  vi.resetModules();
  process.env.DB_PATH = ":memory:";
  const db = await import("../../db/database.js");
  const storage = await import("../benzinga-storage.js");
  return { db, storage };
}

function makeSampleArticle(overrides: Partial<BenzingaArticle> = {}): BenzingaArticle {
  return {
    id: "bz-test-001",
    title: "Test Article",
    published_utc: "2024-01-28T14:30:00Z",
    author: "Test Author",
    article_url: "https://test.com/article",
    tickers: ["AAPL"],
    channels: ["News"],
    tags: ["Technology"],
    keywords: ["test"],
    description: "Test description",
    image_url: null,
    ...overrides,
  };
}

describe("benzinga-storage", () => {
  it("ingests articles and creates ticker links", async () => {
    const { storage } = await loadModules();

    const articles = [
      makeSampleArticle({ id: "bz-001", tickers: ["AAPL", "MSFT"] }),
      makeSampleArticle({ id: "bz-002", tickers: ["TSLA"] }),
    ];

    const result = storage.ingestArticles(articles, "test-batch");

    expect(result.articlesProcessed).toBe(2);
    expect(result.newArticles).toBe(2);
    expect(result.tickerLinks).toBe(3);
  });

  it("is idempotent — ingesting same articles twice creates no duplicates", async () => {
    const { storage } = await loadModules();

    const articles = [
      makeSampleArticle({ id: "bz-idem-001", tickers: ["AAPL"] }),
      makeSampleArticle({ id: "bz-idem-002", tickers: ["TSLA"] }),
    ];

    const first = storage.ingestArticles(articles, "batch-1");
    expect(first.newArticles).toBe(2);

    const second = storage.ingestArticles(articles, "batch-2");
    expect(second.newArticles).toBe(0);

    expect(storage.countBenzingaNews()).toBe(2);
  });

  it("upserts articles — updates existing on conflict", async () => {
    const { storage } = await loadModules();

    const original = makeSampleArticle({
      id: "bz-upsert-001",
      title: "Original Title",
      tickers: ["AAPL"],
    });
    storage.ingestArticles([original], "batch-1");

    const updated = makeSampleArticle({
      id: "bz-upsert-001",
      title: "Updated Title",
      tickers: ["AAPL"],
    });
    storage.ingestArticles([updated], "batch-2");

    const row = storage.getBenzingaNewsById("bz-upsert-001");
    expect(row).toBeDefined();
    expect(row!.title).toBe("Updated Title");
    expect(row!.import_batch).toBe("batch-2");
  });

  it("queries news by ticker", async () => {
    const { storage } = await loadModules();

    const articles = [
      makeSampleArticle({ id: "bz-q-001", tickers: ["AAPL", "MSFT"] }),
      makeSampleArticle({ id: "bz-q-002", tickers: ["TSLA"] }),
      makeSampleArticle({ id: "bz-q-003", tickers: ["AAPL"] }),
    ];
    storage.ingestArticles(articles);

    const aaplNews = storage.queryBenzingaNewsByTicker("AAPL");
    expect(aaplNews).toHaveLength(2);

    const tslaNews = storage.queryBenzingaNewsByTicker("TSLA");
    expect(tslaNews).toHaveLength(1);

    const msftNews = storage.queryBenzingaNewsByTicker("MSFT");
    expect(msftNews).toHaveLength(1);
  });

  it("queries news by date range", async () => {
    const { storage } = await loadModules();

    const articles = [
      makeSampleArticle({
        id: "bz-dr-001",
        published_utc: "2024-01-27T10:00:00Z",
        tickers: ["AAPL"],
      }),
      makeSampleArticle({
        id: "bz-dr-002",
        published_utc: "2024-01-28T14:00:00Z",
        tickers: ["AAPL"],
      }),
      makeSampleArticle({
        id: "bz-dr-003",
        published_utc: "2024-01-29T08:00:00Z",
        tickers: ["AAPL"],
      }),
    ];
    storage.ingestArticles(articles);

    const inRange = storage.queryBenzingaNewsByDateRange(
      "AAPL",
      "2024-01-28T00:00:00Z",
      "2024-01-28T23:59:59Z"
    );
    expect(inRange).toHaveLength(1);
    expect(inRange[0].benzinga_id).toBe("bz-dr-002");
  });

  it("handles multi-ticker articles in junction table", async () => {
    const { storage } = await loadModules();

    const article = makeSampleArticle({
      id: "bz-mt-001",
      tickers: ["AAPL", "MSFT", "GOOG"],
    });
    storage.ingestArticles([article]);

    // Each ticker should find the same article
    for (const ticker of ["AAPL", "MSFT", "GOOG"]) {
      const news = storage.queryBenzingaNewsByTicker(ticker);
      expect(news).toHaveLength(1);
      expect(news[0].benzinga_id).toBe("bz-mt-001");
    }
  });
});
