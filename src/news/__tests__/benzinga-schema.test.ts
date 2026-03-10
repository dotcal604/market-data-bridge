import { describe, expect, it } from "vitest";
import { BenzingaResponseSchema, BenzingaArticleSchema } from "../benzinga-schema.js";
import sampleData from "../fixtures/benzinga-sample.json";

describe("benzinga-schema", () => {
  it("validates the sample fixture against BenzingaResponseSchema", () => {
    const result = BenzingaResponseSchema.safeParse(sampleData);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.results).toHaveLength(4);
      expect(result.data.next_url).toBeTruthy();
      expect(result.data.status).toBe("OK");
    }
  });

  it("validates individual articles from fixture", () => {
    for (const article of sampleData.results) {
      const result = BenzingaArticleSchema.safeParse(article);
      expect(result.success).toBe(true);
    }
  });

  it("parses tickers as array of strings (not objects)", () => {
    const result = BenzingaResponseSchema.parse(sampleData);
    const multiTicker = result.results.find((a) => a.tickers.length > 1);
    expect(multiTicker).toBeDefined();
    expect(multiTicker!.tickers).toEqual(["NVDA", "AMD"]);
    // Verify they are plain strings, not {name: string}
    for (const ticker of multiTicker!.tickers) {
      expect(typeof ticker).toBe("string");
    }
  });

  it("parses channels and tags as array of strings", () => {
    const result = BenzingaResponseSchema.parse(sampleData);
    const article = result.results[0];
    expect(article.channels).toEqual(["News", "Markets"]);
    expect(article.tags).toEqual(["Earnings", "Technology"]);
    // Verify they are plain strings
    for (const ch of article.channels!) {
      expect(typeof ch).toBe("string");
    }
  });

  it("handles null author gracefully", () => {
    const article = sampleData.results.find((a) => a.author === null);
    expect(article).toBeDefined();
    const result = BenzingaArticleSchema.safeParse(article);
    expect(result.success).toBe(true);
  });

  it("handles empty tags array", () => {
    const article = sampleData.results.find(
      (a) => Array.isArray(a.tags) && a.tags.length === 0
    );
    expect(article).toBeDefined();
    const result = BenzingaArticleSchema.safeParse(article);
    expect(result.success).toBe(true);
  });

  it("rejects article missing required fields", () => {
    const invalid = { id: "test", title: "Test" }; // missing published_utc, tickers
    const result = BenzingaArticleSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("rejects response with non-array results", () => {
    const invalid = { results: "not-an-array", status: "OK" };
    const result = BenzingaResponseSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});
