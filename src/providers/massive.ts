/**
 * Massive.com API provider for Benzinga analyst ratings and corporate guidance.
 *
 * Uses the same POLYGON_API_KEY that works on api.massive.com.
 * Implements a 5-minute TTL cache per symbol to avoid redundant calls.
 */

import { logger } from "../logging.js";

const MASSIVE_BASE = "https://api.massive.com";
const API_KEY = process.env.POLYGON_API_KEY || "";
const TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ─── Types ──────────────────────────────────────────────────────

export interface AnalystRating {
  id: string;
  ticker: string;
  date: string;
  analyst_name?: string;
  firm?: string;
  action_type: string; // upgrade, downgrade, initiate, maintain, reiterate
  rating_current?: string;
  rating_prior?: string;
  pt_current?: number;
  pt_prior?: number;
}

export interface AnalystSummary {
  rating_count: number;
  upgrades: number;
  downgrades: number;
  momentum: number; // upgrades - downgrades
  avg_pt: number | null;
  pt_upside_pct: number | null;
  consensus: "bullish" | "neutral" | "bearish" | "none";
  latest_action: string | null;
}

export interface GuidanceChange {
  id: string;
  ticker: string;
  date: string;
  guidance_type?: string;
  direction?: string; // raised, lowered, maintained
  current_value?: number;
  prior_value?: number;
  change_pct?: number;
}

export interface GuidanceSummary {
  changes_count: number;
  net_direction: number; // raised - lowered
  latest_direction: string | null;
}

// ─── Cache ──────────────────────────────────────────────────────

interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
}

const analystCache = new Map<string, CacheEntry<AnalystSummary>>();
const guidanceCache = new Map<string, CacheEntry<GuidanceSummary>>();

function getCached<T>(cache: Map<string, CacheEntry<T>>, key: string): T | null {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.fetchedAt < CACHE_TTL_MS) {
    return entry.data;
  }
  return null;
}

function setCache<T>(cache: Map<string, CacheEntry<T>>, key: string, data: T): void {
  cache.set(key, { data, fetchedAt: Date.now() });
  // Prune if cache gets large
  if (cache.size > 500) {
    const cutoff = Date.now() - CACHE_TTL_MS;
    for (const [k, v] of cache) {
      if (v.fetchedAt < cutoff) cache.delete(k);
    }
  }
}

// ─── HTTP Helpers ───────────────────────────────────────────────

async function massiveFetch(url: string): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const resp = await fetch(url, { signal: controller.signal });

    if (!resp.ok) {
      if (resp.status === 429) {
        logger.warn(`[Massive] Rate limited on ${url}`);
      }
      throw new Error(`Massive API HTTP ${resp.status}`);
    }

    return await resp.json();
  } finally {
    clearTimeout(timer);
  }
}

// ─── Public API ─────────────────────────────────────────────────

/**
 * Get analyst rating summary for a symbol over the last N days.
 * Returns aggregated metrics: count, momentum, PT upside, consensus direction.
 */
export async function getAnalystRatings(
  symbol: string,
  lookbackDays: number = 30,
  currentPrice?: number,
): Promise<AnalystSummary> {
  const cached = getCached(analystCache, symbol);
  if (cached) return cached;

  if (!API_KEY) {
    return emptyAnalystSummary();
  }

  try {
    const now = new Date();
    const since = new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
    const dateGte = since.toISOString().split("T")[0];

    const url = `${MASSIVE_BASE}/benzinga/v2/analyst-ratings?tickers=${symbol}&date.gte=${dateGte}&sort=date.asc&limit=1000&apiKey=${API_KEY}`;
    const data = await massiveFetch(url);
    const results: AnalystRating[] = data.results || [];

    const upgrades = results.filter((r) =>
      ["upgrade", "initiate", "Upgrade", "Initiate"].includes(r.action_type || ""),
    ).length;
    const downgrades = results.filter((r) =>
      ["downgrade", "Downgrade"].includes(r.action_type || ""),
    ).length;
    const momentum = upgrades - downgrades;

    const ptsWithValue = results.filter((r) => r.pt_current && r.pt_current > 0);
    const avgPt = ptsWithValue.length > 0
      ? ptsWithValue.reduce((s, r) => s + r.pt_current!, 0) / ptsWithValue.length
      : null;

    const ptUpsidePct = avgPt && currentPrice && currentPrice > 0
      ? Math.round(((avgPt - currentPrice) / currentPrice) * 10000) / 100
      : null;

    let consensus: AnalystSummary["consensus"] = "none";
    if (momentum >= 2) consensus = "bullish";
    else if (momentum <= -2) consensus = "bearish";
    else if (results.length > 0) consensus = "neutral";

    const latest = results.length > 0 ? results[results.length - 1] : null;

    const summary: AnalystSummary = {
      rating_count: results.length,
      upgrades,
      downgrades,
      momentum,
      avg_pt: avgPt ? Math.round(avgPt * 100) / 100 : null,
      pt_upside_pct: ptUpsidePct,
      consensus,
      latest_action: latest?.action_type || null,
    };

    setCache(analystCache, symbol, summary);
    logger.info(`[Massive] Analyst ratings for ${symbol}: ${results.length} ratings, momentum=${momentum}`);
    return summary;
  } catch (e: any) {
    logger.warn(`[Massive] Failed to fetch analyst ratings for ${symbol}: ${e.message}`);
    return emptyAnalystSummary();
  }
}

/**
 * Get corporate guidance summary for a symbol over the last N days.
 * Returns count, net direction (raised - lowered), latest direction.
 */
export async function getGuidanceChanges(
  symbol: string,
  lookbackDays: number = 60,
): Promise<GuidanceSummary> {
  const cached = getCached(guidanceCache, symbol);
  if (cached) return cached;

  if (!API_KEY) {
    return emptyGuidanceSummary();
  }

  try {
    const now = new Date();
    const since = new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
    const dateGte = since.toISOString().split("T")[0];

    const url = `${MASSIVE_BASE}/benzinga/v2/corporate-guidance?tickers=${symbol}&date.gte=${dateGte}&sort=date.asc&limit=1000&apiKey=${API_KEY}`;
    const data = await massiveFetch(url);
    const results: GuidanceChange[] = data.results || [];

    const raised = results.filter((r) => r.direction === "raised").length;
    const lowered = results.filter((r) => r.direction === "lowered").length;
    const latest = results.length > 0 ? results[results.length - 1] : null;

    const summary: GuidanceSummary = {
      changes_count: results.length,
      net_direction: raised - lowered,
      latest_direction: latest?.direction || null,
    };

    setCache(guidanceCache, symbol, summary);
    logger.info(`[Massive] Guidance for ${symbol}: ${results.length} changes, net=${summary.net_direction}`);
    return summary;
  } catch (e: any) {
    logger.warn(`[Massive] Failed to fetch guidance for ${symbol}: ${e.message}`);
    return emptyGuidanceSummary();
  }
}

// ─── Helpers ────────────────────────────────────────────────────

function emptyAnalystSummary(): AnalystSummary {
  return {
    rating_count: 0,
    upgrades: 0,
    downgrades: 0,
    momentum: 0,
    avg_pt: null,
    pt_upside_pct: null,
    consensus: "none",
    latest_action: null,
  };
}

function emptyGuidanceSummary(): GuidanceSummary {
  return {
    changes_count: 0,
    net_direction: 0,
    latest_direction: null,
  };
}
