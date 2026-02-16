export interface QuoteState {
  bid?: number;
  ask?: number;
  last?: number;
  bidSize?: number;
  askSize?: number;
  volume?: number;
  timestamp: number;
}

const quoteCache = new Map<string, QuoteState>();

function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

export function updateQuote(symbol: string, patch: Partial<QuoteState>): QuoteState {
  const normalized = normalizeSymbol(symbol);
  const current = quoteCache.get(normalized);
  const next: QuoteState = {
    ...(current ?? { timestamp: Date.now() }),
    ...patch,
    timestamp: patch.timestamp ?? Date.now(),
  };
  quoteCache.set(normalized, next);
  return next;
}

export function getQuote(symbol: string): QuoteState | null {
  const quote = quoteCache.get(normalizeSymbol(symbol));
  return quote ? { ...quote } : null;
}

export function isStale(symbol: string, maxAgeMs: number): boolean {
  const quote = quoteCache.get(normalizeSymbol(symbol));
  if (!quote) return true;
  return Date.now() - quote.timestamp > maxAgeMs;
}

export function getQuoteCacheSize(): number {
  return quoteCache.size;
}

export function clearQuoteCache(): void {
  quoteCache.clear();
}
