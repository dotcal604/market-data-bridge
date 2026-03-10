import { afterEach, describe, expect, it, vi } from "vitest";
import { BenzingaClient } from "../benzinga-client.js";
import sampleData from "../fixtures/benzinga-sample.json";

describe("benzinga-client", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockFetch(responses: Array<{ ok: boolean; json: () => unknown; status?: number; statusText?: string }>) {
    let callIndex = 0;
    globalThis.fetch = vi.fn(async () => {
      const res = responses[callIndex] ?? responses[responses.length - 1];
      callIndex++;
      return res as Response;
    });
  }

  it("builds URL with tickers.any_of param", async () => {
    mockFetch([{
      ok: true,
      json: () => ({ ...sampleData, next_url: null }),
    }]);

    const client = new BenzingaClient({ apiKey: "test-key", rateLimitRpm: 60000 });
    await client.fetchNews({
      tickers: ["AAPL", "TSLA"],
      publishedUtcGte: "2024-01-28T00:00:00Z",
      publishedUtcLte: "2024-01-28T23:59:59Z",
      order: "asc",
    });

    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toContain("tickers.any_of=AAPL%2CTSLA");
    expect(calledUrl).toContain("apiKey=test-key");
    expect(calledUrl).toContain("published_utc.gte=");
    expect(calledUrl).toContain("published_utc.lte=");
    expect(calledUrl).toContain("order=asc");
  });

  it("parses and validates API response", async () => {
    mockFetch([{
      ok: true,
      json: () => ({ ...sampleData, next_url: null }),
    }]);

    const client = new BenzingaClient({ apiKey: "test-key", rateLimitRpm: 60000 });
    const result = await client.fetchNews({ tickers: ["AAPL"] });

    expect(result.results).toHaveLength(4);
    expect(result.results[0].title).toContain("Apple");
    expect(result.status).toBe("OK");
  });

  it("follows next_url for pagination", async () => {
    const page1 = {
      ...sampleData,
      results: [sampleData.results[0]],
      next_url: "https://api.massive.io/v2/reference/news?cursor=page2",
    };
    const page2 = {
      ...sampleData,
      results: [sampleData.results[1]],
      next_url: null,
    };

    mockFetch([
      { ok: true, json: () => page1 },
      { ok: true, json: () => page2 },
    ]);

    const client = new BenzingaClient({ apiKey: "test-key", rateLimitRpm: 60000 });
    const pages: typeof sampleData[] = [];

    for await (const page of client.fetchAllPages({ tickers: ["AAPL"] })) {
      pages.push(page);
    }

    expect(pages).toHaveLength(2);
    expect(pages[0].results).toHaveLength(1);
    expect(pages[1].results).toHaveLength(1);

    // Verify next_url had apiKey appended
    const secondCallUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[1][0] as string;
    expect(secondCallUrl).toContain("apiKey=test-key");
  });

  it("retries on transient failures with backoff", async () => {
    mockFetch([
      { ok: false, json: () => ({}), status: 500, statusText: "Internal Server Error" },
      { ok: true, json: () => ({ ...sampleData, next_url: null }) },
    ]);

    const client = new BenzingaClient({
      apiKey: "test-key",
      maxRetries: 3,
      rateLimitRpm: 60000,
    });

    const result = await client.fetchNews({ tickers: ["AAPL"] });
    expect(result.results).toHaveLength(4);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  }, 15000);

  it("throws after max retries exhausted", async () => {
    mockFetch([
      { ok: false, json: () => ({}), status: 500, statusText: "Error" },
      { ok: false, json: () => ({}), status: 500, statusText: "Error" },
    ]);

    const client = new BenzingaClient({
      apiKey: "test-key",
      maxRetries: 0,
      rateLimitRpm: 60000,
    });

    await expect(client.fetchNews({ tickers: ["AAPL"] })).rejects.toThrow("HTTP 500");
  });

  it("stops pagination when results are empty", async () => {
    const page1 = {
      results: [sampleData.results[0]],
      next_url: "https://api.massive.io/v2/reference/news?cursor=page2",
      status: "OK",
    };
    const page2 = {
      results: [],
      next_url: "https://api.massive.io/v2/reference/news?cursor=page3",
      status: "OK",
    };

    mockFetch([
      { ok: true, json: () => page1 },
      { ok: true, json: () => page2 },
    ]);

    const client = new BenzingaClient({ apiKey: "test-key", rateLimitRpm: 60000 });
    const pages = [];

    for await (const page of client.fetchAllPages({ tickers: ["AAPL"] })) {
      pages.push(page);
    }

    expect(pages).toHaveLength(2);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });
});
