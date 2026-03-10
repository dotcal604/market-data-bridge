import { BenzingaResponseSchema, type BenzingaResponse } from "./benzinga-schema.js";

const MASSIVE_BASE_URL = "https://api.polygon.io/v2/reference/news";
const DEFAULT_RATE_LIMIT_RPM = 5;
const DEFAULT_LIMIT = 1000;

export interface BenzingaClientOptions {
  apiKey: string;
  rateLimitRpm?: number;
  maxRetries?: number;
  baseUrl?: string;
}

export interface BenzingaQueryParams {
  tickers?: string[];
  publishedUtcGte?: string;
  publishedUtcLte?: string;
  order?: "asc" | "desc";
  limit?: number;
}

export class BenzingaClient {
  private readonly apiKey: string;
  private readonly rateLimitMs: number;
  private readonly maxRetries: number;
  private readonly baseUrl: string;
  private lastRequestTime = 0;

  constructor(opts: BenzingaClientOptions) {
    this.apiKey = opts.apiKey;
    this.rateLimitMs = 60_000 / (opts.rateLimitRpm ?? DEFAULT_RATE_LIMIT_RPM);
    this.maxRetries = opts.maxRetries ?? 3;
    this.baseUrl = opts.baseUrl ?? MASSIVE_BASE_URL;
  }

  private async throttle(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < this.rateLimitMs) {
      await new Promise((resolve) => setTimeout(resolve, this.rateLimitMs - elapsed));
    }
    this.lastRequestTime = Date.now();
  }

  private buildUrl(params: BenzingaQueryParams): string {
    const url = new URL(this.baseUrl);
    url.searchParams.set("apiKey", this.apiKey);
    url.searchParams.set("limit", String(params.limit ?? DEFAULT_LIMIT));

    if (params.tickers?.length) {
      url.searchParams.set("tickers.any_of", params.tickers.join(","));
    }
    if (params.publishedUtcGte) {
      url.searchParams.set("published_utc.gte", params.publishedUtcGte);
    }
    if (params.publishedUtcLte) {
      url.searchParams.set("published_utc.lte", params.publishedUtcLte);
    }
    if (params.order) {
      url.searchParams.set("order", params.order);
    }

    return url.toString();
  }

  private async fetchWithRetry(url: string): Promise<BenzingaResponse> {
    await this.throttle();

    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const res = await fetch(url);
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }
        const json = await res.json();
        return BenzingaResponseSchema.parse(json);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < this.maxRetries) {
          const backoff = Math.pow(2, attempt + 1) * 1000;
          await new Promise((resolve) => setTimeout(resolve, backoff));
        }
      }
    }
    throw lastError!;
  }

  async fetchNews(params: BenzingaQueryParams): Promise<BenzingaResponse> {
    const url = this.buildUrl(params);
    return this.fetchWithRetry(url);
  }

  async *fetchAllPages(params: BenzingaQueryParams): AsyncGenerator<BenzingaResponse> {
    const firstUrl = this.buildUrl(params);
    let url: string | null = firstUrl;

    while (url) {
      const response = await this.fetchWithRetry(url);
      yield response;

      if (!response.next_url || response.results.length === 0) {
        break;
      }

      // Treat next_url as opaque — only append apiKey if not already present
      const nextUrl = new URL(response.next_url);
      if (!nextUrl.searchParams.has("apiKey")) {
        nextUrl.searchParams.set("apiKey", this.apiKey);
      }
      url = nextUrl.toString();
    }
  }
}
