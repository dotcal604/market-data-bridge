import { EventName, ErrorCode, Contract, isNonFatalError } from "@stoqey/ib";
import { getIB, getNextReqId, isConnected, onReconnect } from "./connection.js";
import { logger } from "../logging.js";
import { randomUUID } from "node:crypto";

const log = logger.child({ subsystem: "subscriptions" });

// ── Interfaces ──────────────────────────────────────────────────────────────

export type SubscriptionType = "realTimeBars" | "accountUpdates";

export interface RealTimeBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  wap: number;
  count: number;
}

export interface PortfolioUpdate {
  symbol: string;
  secType: string;
  exchange: string;
  currency: string;
  position: number;
  marketPrice: number;
  marketValue: number;
  averageCost: number;
  unrealizedPnL: number;
  realizedPnL: number;
  account: string;
}

export interface AccountUpdateSnapshot {
  values: Record<string, { value: string; currency: string }>;
  portfolio: PortfolioUpdate[];
  lastUpdated: string;
}

export interface SubscriptionInfo {
  id: string;
  type: SubscriptionType;
  reqId: number;
  symbol?: string;
  account?: string;
  createdAt: string;
  barCount?: number;
  error?: string;
}

// ── Internal state types ────────────────────────────────────────────────────

interface RtbState {
  id: string;
  symbol: string;
  contract: Contract;
  whatToShow: string;
  useRTH: boolean;
  bars: RealTimeBar[];
  createdAt: string;
  cleanup: () => void;
  error?: string;
}

interface AccountSubState {
  id: string;
  account: string;
  snapshot: AccountUpdateSnapshot;
  cleanup: () => void;
  error?: string;
}

// ── Configuration ───────────────────────────────────────────────────────────

const MAX_REAL_TIME_BARS = 50;   // TWS hard limit ~50 concurrent data lines
const BAR_BUFFER_SIZE = 300;     // 25 min of 5-second bars
const SCANNER_CACHE_TTL_MS = 60 * 60 * 1000; // 60 min

// ── State ───────────────────────────────────────────────────────────────────

/** reqId → subscription state */
const rtbSubs = new Map<number, RtbState>();

/** Reverse lookups */
const idToReqId = new Map<string, number>();
const symbolKeyToReqId = new Map<string, number>();

/** Account updates — only one allowed by IBKR */
let accountSub: AccountSubState | null = null;

/** Scanner parameters cache */
let scannerCache: { xml: string; fetchedAt: number } | null = null;
let scannerFetching: Promise<string> | null = null;

// ── Real-Time Bars ──────────────────────────────────────────────────────────

export function subscribeRealTimeBars(params: {
  symbol: string;
  secType?: string;
  exchange?: string;
  currency?: string;
  whatToShow?: string;
  useRTH?: boolean;
}): SubscriptionInfo {
  if (!isConnected()) throw new Error("IBKR not connected");

  const exchange = params.exchange ?? "SMART";
  const symKey = `${params.symbol.toUpperCase()}:${exchange}`;

  // Deduplicate — return existing sub if same symbol+exchange
  const existingReqId = symbolKeyToReqId.get(symKey);
  if (existingReqId !== undefined) {
    const existing = rtbSubs.get(existingReqId);
    if (existing) return toInfo(existingReqId, existing);
  }

  if (rtbSubs.size >= MAX_REAL_TIME_BARS) {
    throw new Error(`Max ${MAX_REAL_TIME_BARS} concurrent real-time bar subscriptions reached`);
  }

  const ib = getIB();
  const reqId = getNextReqId();
  const id = randomUUID();
  const whatToShow = params.whatToShow ?? "TRADES";
  const useRTH = params.useRTH ?? true;

  const contract: Contract = {
    symbol: params.symbol.toUpperCase(),
    secType: (params.secType ?? "STK") as any,
    exchange,
    currency: params.currency ?? "USD",
  };

  const state: RtbState = {
    id,
    symbol: params.symbol.toUpperCase(),
    contract,
    whatToShow,
    useRTH,
    bars: [],
    createdAt: new Date().toISOString(),
    cleanup: () => {}, // set below
  };

  const onBar = (
    rId: number, date: number, open: number, high: number,
    low: number, close: number, volume: number, WAP: number, count: number,
  ) => {
    if (rId !== reqId) return;
    const bar: RealTimeBar = { time: date, open, high, low, close, volume, wap: WAP, count };
    state.bars.push(bar);
    if (state.bars.length > BAR_BUFFER_SIZE) {
      state.bars.splice(0, state.bars.length - BAR_BUFFER_SIZE);
    }
  };

  const onError = (err: Error, code: ErrorCode, rId: number) => {
    if (rId !== reqId) return;
    if (isNonFatalError(code, err)) return;
    state.error = `Error ${code}: ${err.message}`;
    log.error({ reqId, symbol: state.symbol, code }, `RTB subscription error: ${err.message}`);
  };

  state.cleanup = () => {
    ib.off(EventName.realtimeBar, onBar);
    ib.off(EventName.error, onError);
    try { ib.cancelRealTimeBars(reqId); } catch { /* already disconnected */ }
  };

  ib.on(EventName.realtimeBar, onBar);
  ib.on(EventName.error, onError);
  ib.reqRealTimeBars(reqId, contract, 5, whatToShow as any, useRTH);

  rtbSubs.set(reqId, state);
  idToReqId.set(id, reqId);
  symbolKeyToReqId.set(symKey, reqId);

  log.info({ reqId, id, symbol: state.symbol, exchange, whatToShow }, "Subscribed to real-time bars");
  return toInfo(reqId, state);
}

export function unsubscribeRealTimeBars(id: string): boolean {
  const reqId = idToReqId.get(id);
  if (reqId === undefined) return false;

  const state = rtbSubs.get(reqId);
  if (!state) return false;

  state.cleanup();
  const symKey = `${state.symbol}:${state.contract.exchange ?? "SMART"}`;
  symbolKeyToReqId.delete(symKey);
  idToReqId.delete(id);
  rtbSubs.delete(reqId);

  log.info({ reqId, id, symbol: state.symbol }, "Unsubscribed from real-time bars");
  return true;
}

export function getRealTimeBars(id: string, limit?: number): RealTimeBar[] {
  const reqId = idToReqId.get(id);
  if (reqId === undefined) throw new Error(`Subscription ${id} not found`);
  const state = rtbSubs.get(reqId);
  if (!state) throw new Error(`Subscription ${id} not found`);
  const n = limit ?? 60;
  return state.bars.slice(-n);
}

// ── Account Updates ─────────────────────────────────────────────────────────

export function subscribeAccountUpdates(account: string): SubscriptionInfo {
  if (!isConnected()) throw new Error("IBKR not connected");
  if (!account) throw new Error("account is required");

  // Only one account subscription at a time
  if (accountSub) {
    if (accountSub.account === account) {
      return {
        id: accountSub.id,
        type: "accountUpdates",
        reqId: -1,
        account: accountSub.account,
        createdAt: (accountSub as AccountSubState).snapshot.lastUpdated || new Date().toISOString(),
      };
    }
    throw new Error(`Already subscribed to account ${accountSub.account}. Unsubscribe first.`);
  }

  const ib = getIB();
  const id = `acct-${account}`;

  const snapshot: AccountUpdateSnapshot = {
    values: {},
    portfolio: [],
    lastUpdated: new Date().toISOString(),
  };

  const onAccountValue = (acct: string, key: string, value: string, currency: string) => {
    if (acct !== account) return;
    snapshot.values[key] = { value, currency };
  };

  const onPortfolio = (
    acct: string, contract: Contract, pos: number,
    marketPrice: number, marketValue: number, averageCost: number,
    unrealizedPnL: number, realizedPnL: number,
  ) => {
    if (acct !== account) return;
    const sym = contract.symbol ?? "?";
    const idx = snapshot.portfolio.findIndex(
      (p) => p.symbol === sym && p.secType === (contract.secType ?? "STK"),
    );
    const entry: PortfolioUpdate = {
      symbol: sym,
      secType: contract.secType ?? "STK",
      exchange: contract.exchange ?? "SMART",
      currency: contract.currency ?? "USD",
      position: pos,
      marketPrice,
      marketValue,
      averageCost,
      unrealizedPnL,
      realizedPnL,
      account: acct,
    };
    if (idx >= 0) snapshot.portfolio[idx] = entry;
    else snapshot.portfolio.push(entry);
  };

  const onDownloadEnd = (acct: string) => {
    if (acct !== account) return;
    snapshot.lastUpdated = new Date().toISOString();
  };

  const onError = (err: Error, code: ErrorCode) => {
    if (isNonFatalError(code, err)) return;
    if (accountSub) accountSub.error = `Error ${code}: ${err.message}`;
    log.error({ account, code }, `Account updates error: ${err.message}`);
  };

  const cleanup = () => {
    ib.off(EventName.updateAccountValue, onAccountValue);
    (ib as any).off(EventName.updatePortfolio, onPortfolio);
    ib.off(EventName.accountDownloadEnd, onDownloadEnd);
    ib.off(EventName.error, onError);
    try { ib.reqAccountUpdates(false, account); } catch { /* disconnected */ }
  };

  accountSub = { id, account, snapshot, cleanup };

  ib.on(EventName.updateAccountValue, onAccountValue);
  (ib as any).on(EventName.updatePortfolio, onPortfolio);
  ib.on(EventName.accountDownloadEnd, onDownloadEnd);
  ib.on(EventName.error, onError);
  ib.reqAccountUpdates(true, account);

  log.info({ account, id }, "Subscribed to account updates");
  return { id, type: "accountUpdates", reqId: -1, account, createdAt: snapshot.lastUpdated };
}

export function unsubscribeAccountUpdates(): boolean {
  if (!accountSub) return false;
  accountSub.cleanup();
  log.info({ account: accountSub.account }, "Unsubscribed from account updates");
  accountSub = null;
  return true;
}

export function getAccountSnapshot(): AccountUpdateSnapshot | null {
  return accountSub?.snapshot ?? null;
}

// ── Scanner Parameters (cached one-shot) ────────────────────────────────────

export async function getScannerParameters(): Promise<string> {
  if (!isConnected()) throw new Error("IBKR not connected");

  // Return cached if fresh
  if (scannerCache && Date.now() - scannerCache.fetchedAt < SCANNER_CACHE_TTL_MS) {
    return scannerCache.xml;
  }

  // Deduplicate concurrent fetches
  if (scannerFetching) return scannerFetching;

  scannerFetching = new Promise<string>((resolve, reject) => {
    const ib = getIB();
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("Scanner parameters request timed out (30s)"));
    }, 30000);

    const onParams = (xml: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      scannerCache = { xml, fetchedAt: Date.now() };
      resolve(xml);
    };

    const onError = (err: Error, code: ErrorCode) => {
      if (isNonFatalError(code, err)) return;
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`Scanner parameters error ${code}: ${err.message}`));
    };

    const cleanup = () => {
      clearTimeout(timeout);
      ib.off(EventName.scannerParameters, onParams);
      ib.off(EventName.error, onError);
      scannerFetching = null;
    };

    ib.on(EventName.scannerParameters, onParams);
    ib.on(EventName.error, onError);
    ib.reqScannerParameters();
  });

  return scannerFetching;
}

// ── Lifecycle ───────────────────────────────────────────────────────────────

export function listSubscriptions(): SubscriptionInfo[] {
  const result: SubscriptionInfo[] = [];

  for (const [reqId, state] of rtbSubs) {
    result.push(toInfo(reqId, state));
  }

  if (accountSub) {
    result.push({
      id: accountSub.id,
      type: "accountUpdates",
      reqId: -1,
      account: accountSub.account,
      createdAt: accountSub.snapshot.lastUpdated,
      error: accountSub.error,
    });
  }

  return result;
}

export function getSubscription(id: string): SubscriptionInfo | null {
  const reqId = idToReqId.get(id);
  if (reqId !== undefined) {
    const state = rtbSubs.get(reqId);
    if (state) return toInfo(reqId, state);
  }
  if (accountSub?.id === id) {
    return {
      id: accountSub.id, type: "accountUpdates", reqId: -1,
      account: accountSub.account, createdAt: accountSub.snapshot.lastUpdated,
    };
  }
  return null;
}

export function unsubscribeAll(): void {
  for (const [, state] of rtbSubs) {
    state.cleanup();
  }
  rtbSubs.clear();
  idToReqId.clear();
  symbolKeyToReqId.clear();

  if (accountSub) {
    accountSub.cleanup();
    accountSub = null;
  }

  log.info("All subscriptions cancelled");
}

/**
 * Re-establish all active subscriptions after a reconnect.
 * Called from connection.ts when EventName.connected fires.
 */
export function resubscribeAll(): void {
  if (rtbSubs.size === 0 && !accountSub) return;

  const ib = getIB();
  log.info({ rtbCount: rtbSubs.size, hasAccountSub: !!accountSub }, "Re-establishing subscriptions after reconnect");

  // Re-issue real-time bars with new reqIds
  const oldEntries = [...rtbSubs.entries()];
  for (const [oldReqId, state] of oldEntries) {
    // Remove old listeners (they reference the old reqId)
    state.cleanup();
    rtbSubs.delete(oldReqId);
    idToReqId.delete(state.id);
    const symKey = `${state.symbol}:${state.contract.exchange ?? "SMART"}`;
    symbolKeyToReqId.delete(symKey);

    // Re-subscribe with new reqId (reuse same UUID so clients don't break)
    const newReqId = getNextReqId();
    const onBar = (
      rId: number, date: number, open: number, high: number,
      low: number, close: number, volume: number, WAP: number, count: number,
    ) => {
      if (rId !== newReqId) return;
      const bar: RealTimeBar = { time: date, open, high, low, close, volume, wap: WAP, count };
      state.bars.push(bar);
      if (state.bars.length > BAR_BUFFER_SIZE) {
        state.bars.splice(0, state.bars.length - BAR_BUFFER_SIZE);
      }
    };
    const onError = (err: Error, code: ErrorCode, rId: number) => {
      if (rId !== newReqId) return;
      if (isNonFatalError(code, err)) return;
      state.error = `Error ${code}: ${err.message}`;
    };
    state.cleanup = () => {
      ib.off(EventName.realtimeBar, onBar);
      ib.off(EventName.error, onError);
      try { ib.cancelRealTimeBars(newReqId); } catch { /* */ }
    };

    ib.on(EventName.realtimeBar, onBar);
    ib.on(EventName.error, onError);
    ib.reqRealTimeBars(newReqId, state.contract, 5, state.whatToShow as any, state.useRTH);

    rtbSubs.set(newReqId, state);
    idToReqId.set(state.id, newReqId);
    symbolKeyToReqId.set(symKey, newReqId);
    log.info({ oldReqId, newReqId, symbol: state.symbol }, "Re-subscribed real-time bars");
  }

  // Re-issue account updates
  if (accountSub) {
    const acct = accountSub.account;
    accountSub.cleanup();
    accountSub = null;
    try {
      subscribeAccountUpdates(acct);
    } catch (e: any) {
      log.error({ account: acct }, `Failed to re-subscribe account updates: ${e.message}`);
    }
  }
}

// ── Auto-register reconnect callback ────────────────────────────────────────

onReconnect(resubscribeAll);

// ── Testing helpers ─────────────────────────────────────────────────────────

/** Reset all internal state — only for tests */
export function _resetForTesting(): void {
  for (const [, state] of rtbSubs) {
    try { state.cleanup(); } catch { /* */ }
  }
  rtbSubs.clear();
  idToReqId.clear();
  symbolKeyToReqId.clear();
  if (accountSub) {
    try { accountSub.cleanup(); } catch { /* */ }
    accountSub = null;
  }
  scannerCache = null;
  scannerFetching = null;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function toInfo(reqId: number, state: RtbState): SubscriptionInfo {
  return {
    id: state.id,
    type: "realTimeBars",
    reqId,
    symbol: state.symbol,
    createdAt: state.createdAt,
    barCount: state.bars.length,
    error: state.error,
  };
}
