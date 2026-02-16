import type { Contract } from "@stoqey/ib";
import { config } from "../config.js";
import { getIB, getNextReqId } from "./connection.js";

export type SubscriptionPriority = "open_positions" | "pending_orders" | "watchlist" | "scanner";

interface PriorityRank {
  readonly [key: string]: number;
}

const PRIORITY_RANK: PriorityRank = {
  open_positions: 0,
  pending_orders: 1,
  watchlist: 2,
  scanner: 3,
};

export interface SubscriptionState {
  tickerId: number;
  priority: SubscriptionPriority;
  lastAccess: number;
}

interface SubscribeResult {
  symbol: string;
  tickerId: number;
  activeCount: number;
  budget: number;
  evictedSymbol?: string;
}

const activeSubscriptions = new Map<string, SubscriptionState>();
const tickerToSymbol = new Map<number, string>();

function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

function buildDefaultContract(symbol: string): Contract {
  return {
    symbol,
    secType: "STK" as never,
    exchange: "SMART",
    currency: "USD",
  };
}

function evictCandidate(incomingPriority: SubscriptionPriority): string | null {
  let candidate: { symbol: string; state: SubscriptionState } | null = null;
  for (const [symbol, state] of activeSubscriptions.entries()) {
    if (PRIORITY_RANK[state.priority] < PRIORITY_RANK[incomingPriority]) {
      continue;
    }
    if (!candidate) {
      candidate = { symbol, state };
      continue;
    }
    const currentRank = PRIORITY_RANK[state.priority];
    const candidateRank = PRIORITY_RANK[candidate.state.priority];
    if (currentRank > candidateRank) {
      candidate = { symbol, state };
      continue;
    }
    if (currentRank === candidateRank && state.lastAccess < candidate.state.lastAccess) {
      candidate = { symbol, state };
    }
  }
  return candidate?.symbol ?? null;
}

function getBudget(): number {
  return config.ibkr.maxDataLines;
}

function issueSubscription(symbol: string, tickerId: number): void {
  const ib = getIB();
  ib.reqMktData(tickerId, buildDefaultContract(symbol), "", false, false);
}

export function subscribe(symbol: string, priority: SubscriptionPriority): SubscribeResult {
  const normalized = normalizeSymbol(symbol);
  const now = Date.now();
  const budget = getBudget();

  const existing = activeSubscriptions.get(normalized);
  if (existing) {
    existing.priority = priority;
    existing.lastAccess = now;
    return {
      symbol: normalized,
      tickerId: existing.tickerId,
      activeCount: activeSubscriptions.size,
      budget,
    };
  }

  let evictedSymbol: string | undefined;
  if (activeSubscriptions.size >= budget) {
    const victim = evictCandidate(priority);
    if (!victim) {
      throw new Error("No available market data line for this priority tier");
    }
    unsubscribe(victim);
    evictedSymbol = victim;
  }

  const tickerId = getNextReqId();
  issueSubscription(normalized, tickerId);
  activeSubscriptions.set(normalized, { tickerId, priority, lastAccess: now });
  tickerToSymbol.set(tickerId, normalized);

  return {
    symbol: normalized,
    tickerId,
    activeCount: activeSubscriptions.size,
    budget,
    evictedSymbol,
  };
}

export function unsubscribe(symbol: string): boolean {
  const normalized = normalizeSymbol(symbol);
  const existing = activeSubscriptions.get(normalized);
  if (!existing) return false;

  const ib = getIB();
  ib.cancelMktData(existing.tickerId);

  activeSubscriptions.delete(normalized);
  tickerToSymbol.delete(existing.tickerId);
  return true;
}

export function getActiveCount(): number {
  return activeSubscriptions.size;
}

export function getLineBudget(): number {
  return getBudget();
}

export function getSubscriptionStatus(): {
  activeCount: number;
  lineBudget: number;
  usagePercent: number;
  subscriptions: Array<{ symbol: string; tickerId: number; priority: SubscriptionPriority; lastAccess: number }>;
} {
  const lineBudget = getBudget();
  const subscriptions = [...activeSubscriptions.entries()]
    .map(([symbol, state]) => ({ symbol, ...state }))
    .sort((a, b) => b.lastAccess - a.lastAccess);

  return {
    activeCount: activeSubscriptions.size,
    lineBudget,
    usagePercent: lineBudget > 0 ? Math.round((activeSubscriptions.size / lineBudget) * 10000) / 100 : 0,
    subscriptions,
  };
}

export function getSymbolByTickerId(tickerId: number): string | null {
  return tickerToSymbol.get(tickerId) ?? null;
}

export function touchSubscription(symbol: string): void {
  const normalized = normalizeSymbol(symbol);
  const existing = activeSubscriptions.get(normalized);
  if (!existing) return;
  existing.lastAccess = Date.now();
}

export function resubscribeAllActiveSymbols(): number {
  const entries = [...activeSubscriptions.entries()];
  tickerToSymbol.clear();

  for (const [symbol, state] of entries) {
    const tickerId = getNextReqId();
    issueSubscription(symbol, tickerId);
    state.tickerId = tickerId;
    state.lastAccess = Date.now();
    tickerToSymbol.set(tickerId, symbol);
  }

  return entries.length;
}

export function clearSubscriptionsForTests(): void {
  activeSubscriptions.clear();
  tickerToSymbol.clear();
}
