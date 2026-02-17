import {
  EventName,
  ErrorCode,
  Contract,
  HistoricalTick,
  HistoricalTickBidAsk,
  HistoricalTickLast,
  isNonFatalError,
} from "@stoqey/ib";
import { logger } from "../logging.js";
import { getIB, getNextReqId, isConnected } from "./connection.js";

// TickType is a type-only union — use numeric constants, NOT the enum.
const TICK_BID = 1;
const TICK_ASK = 2;
const TICK_LAST = 4;
const TICK_HIGH = 6;
const TICK_LOW = 7;
const TICK_VOLUME = 8;
const TICK_CLOSE = 9;
const TICK_OPEN = 14;
const HISTORICAL_TICKS_TIMEOUT_MS = 30000;

const log = logger.child({ subsystem: "ibkr-marketdata" });

export type HistoricalTickType = "TRADES" | "BID_ASK" | "MIDPOINT";

export interface IBKRHistoricalMidpointTick {
  type: "MIDPOINT";
  time: number;
  price: number;
  size: number;
}

export interface IBKRHistoricalBidAskTick {
  type: "BID_ASK";
  time: number;
  bidPrice: number;
  askPrice: number;
  bidSize: number;
  askSize: number;
  bidPastLow: boolean;
  askPastHigh: boolean;
}

export interface IBKRHistoricalTradeTick {
  type: "TRADES";
  time: number;
  price: number;
  size: number;
  exchange: string;
  specialConditions: string;
  pastLimit: boolean;
  unreported: boolean;
}

export type IBKRHistoricalTick =
  | IBKRHistoricalMidpointTick
  | IBKRHistoricalBidAskTick
  | IBKRHistoricalTradeTick;

export interface IBKRQuoteData {
  symbol: string;
  bid: number | null;
  ask: number | null;
  last: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
  timestamp: string;
}

export async function getIBKRQuote(params: {
  symbol: string;
  secType?: string;
  exchange?: string;
  currency?: string;
}): Promise<IBKRQuoteData> {
  const ib = getIB();
  const reqId = getNextReqId();

  const contract: Contract = {
    symbol: params.symbol,
    secType: (params.secType ?? "STK") as any,
    exchange: params.exchange ?? "SMART",
    currency: params.currency ?? "USD",
  };

  return new Promise((resolve, reject) => {
    let settled = false;
    const data: IBKRQuoteData = {
      symbol: params.symbol.toUpperCase(),
      bid: null,
      ask: null,
      last: null,
      open: null,
      high: null,
      low: null,
      close: null,
      volume: null,
      timestamp: new Date().toISOString(),
    };

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      ib.cancelMktData(reqId);
      data.timestamp = new Date().toISOString();
      resolve(data);
    }, 15000);

    const onTickPrice = (id: number, field: number, value: number) => {
      if (id !== reqId) return;
      switch (field) {
        case TICK_BID:   data.bid = value;   break;
        case TICK_ASK:   data.ask = value;   break;
        case TICK_LAST:  data.last = value;  break;
        case TICK_HIGH:  data.high = value;  break;
        case TICK_LOW:   data.low = value;   break;
        case TICK_CLOSE: data.close = value; break;
        case TICK_OPEN:  data.open = value;  break;
      }
    };

    const onTickSize = (id: number, field: number | undefined, value: number | undefined) => {
      if (id !== reqId) return;
      if (field === TICK_VOLUME && value !== undefined) {
        data.volume = value;
      }
    };

    const onSnapshotEnd = (id: number) => {
      if (id !== reqId) return;
      if (settled) return;
      settled = true;
      cleanup();
      ib.cancelMktData(reqId);
      data.timestamp = new Date().toISOString();
      resolve(data);
    };

    const onError = (err: Error, code: ErrorCode, id: number) => {
      if (id !== reqId) return;
      if (isNonFatalError(code, err)) return;
      if (settled) return;
      settled = true;
      cleanup();
      ib.cancelMktData(reqId);
      reject(new Error(`Market data error (${code}): ${err.message}`));
    };

    const cleanup = () => {
      clearTimeout(timeout);
      ib.off(EventName.tickPrice, onTickPrice);
      ib.off(EventName.tickSize, onTickSize);
      ib.off(EventName.tickSnapshotEnd, onSnapshotEnd);
      ib.off(EventName.error, onError);
    };

    ib.on(EventName.tickPrice, onTickPrice);
    ib.on(EventName.tickSize, onTickSize);
    ib.on(EventName.tickSnapshotEnd, onSnapshotEnd);
    ib.on(EventName.error, onError);

    // snapshot=true, regulatorySnapshot=false
    ib.reqMktData(reqId, contract, "", true, false);
  });
}

export async function getHistoricalTicks(
  symbol: string,
  startTime: string,
  endTime: string,
  type: HistoricalTickType,
  count: number
): Promise<IBKRHistoricalTick[]> {
  if (!isConnected()) {
    throw new Error("IBKR not connected. Start TWS/Gateway for historical tick data.");
  }

  const ib = getIB();
  const reqId = getNextReqId();

  const contract: Contract = {
    symbol,
    secType: "STK" as any,
    exchange: "SMART",
    currency: "USD",
  };

  return new Promise((resolve, reject) => {
    let settled = false;
    const ticks: IBKRHistoricalTick[] = [];

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`Historical ticks request timed out after ${HISTORICAL_TICKS_TIMEOUT_MS / 1000} seconds`));
    }, HISTORICAL_TICKS_TIMEOUT_MS);

    const onHistoricalTicks = (id: number, historicalTicks: HistoricalTick[], done: boolean) => {
      if (id !== reqId || type !== "MIDPOINT") return;

      for (const tick of historicalTicks) {
        ticks.push({
          type: "MIDPOINT",
          time: tick.time,
          price: tick.price,
          size: tick.size,
        });
      }

      if (!done || settled) return;
      settled = true;
      cleanup();
      resolve(ticks);
    };

    const onHistoricalTicksBidAsk = (id: number, historicalTicks: HistoricalTickBidAsk[], done: boolean) => {
      if (id !== reqId || type !== "BID_ASK") return;

      for (const tick of historicalTicks) {
        ticks.push({
          type: "BID_ASK",
          time: tick.time ?? 0,
          bidPrice: tick.priceBid ?? 0,
          askPrice: tick.priceAsk ?? 0,
          bidSize: tick.sizeBid ?? 0,
          askSize: tick.sizeAsk ?? 0,
          bidPastLow: Boolean(tick.tickAttribBidAsk?.bidPastLow),
          askPastHigh: Boolean(tick.tickAttribBidAsk?.askPastHigh),
        });
      }

      if (!done || settled) return;
      settled = true;
      cleanup();
      resolve(ticks);
    };

    const onHistoricalTicksLast = (id: number, historicalTicks: HistoricalTickLast[], done: boolean) => {
      if (id !== reqId || type !== "TRADES") return;

      for (const tick of historicalTicks) {
        ticks.push({
          type: "TRADES",
          time: tick.time ?? 0,
          price: tick.price ?? 0,
          size: tick.size ?? 0,
          exchange: tick.exchange ?? "",
          specialConditions: tick.specialConditions ?? "",
          pastLimit: Boolean(tick.tickAttribLast?.pastLimit),
          unreported: Boolean(tick.tickAttribLast?.unreported),
        });
      }

      if (!done || settled) return;
      settled = true;
      cleanup();
      resolve(ticks);
    };

    const onError = (err: Error, code: ErrorCode, id: number) => {
      if (id !== reqId) return;
      if (isNonFatalError(code, err)) return;
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`Historical ticks error (${code}): ${err.message}`));
    };

    const cleanup = () => {
      clearTimeout(timeout);
      ib.off(EventName.historicalTicks, onHistoricalTicks);
      ib.off(EventName.historicalTicksBidAsk, onHistoricalTicksBidAsk);
      ib.off(EventName.historicalTicksLast, onHistoricalTicksLast);
      ib.off(EventName.error, onError);
    };

    ib.on(EventName.historicalTicks, onHistoricalTicks);
    ib.on(EventName.historicalTicksBidAsk, onHistoricalTicksBidAsk);
    ib.on(EventName.historicalTicksLast, onHistoricalTicksLast);
    ib.on(EventName.error, onError);

    log.info({ reqId, symbol, type, count }, "Requesting IBKR historical ticks");
    ib.reqHistoricalTicks(reqId, contract, startTime, endTime, count, type, 1, false);
  });
}

export interface MarketDepthLevel {
  price: number;
  size: number;
  marketMaker?: string;
}

export interface MarketDepthSnapshot {
  symbol: string;
  bids: MarketDepthLevel[];
  asks: MarketDepthLevel[];
  timestamp: string;
}

export interface MarketDepthOptions {
  symbol: string;
  secType?: string;
  exchange?: string;
  currency?: string;
  numRows?: number;
  isSmartDepth?: boolean;
}

/**
 * Subscribes to Level 2 (Market Depth) data for a symbol.
 * Returns a promise that resolves with initial snapshot and a cleanup function.
 * IBKR sends incremental updates via mktDepthL2 event after initial snapshot.
 * 
 * @param options - Market depth subscription options
 * @returns Promise with snapshot and unsubscribe function
 */
export async function subscribeMarketDepth(
  options: MarketDepthOptions
): Promise<{ snapshot: MarketDepthSnapshot; unsubscribe: () => void }> {
  if (!isConnected()) {
    throw new Error("IBKR not connected. Start TWS/Gateway for Level 2 data.");
  }

  const ib = getIB();
  const reqId = getNextReqId();

  const contract: Contract = {
    symbol: options.symbol,
    secType: (options.secType ?? "STK") as any,
    exchange: options.exchange ?? "SMART",
    currency: options.currency ?? "USD",
  };

  const numRows = options.numRows ?? 10;
  const isSmartDepth = options.isSmartDepth ?? false;

  return new Promise((resolve, reject) => {
    let settled = false;
    const bids = new Map<number, MarketDepthLevel>();
    const asks = new Map<number, MarketDepthLevel>();

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      
      const snapshot: MarketDepthSnapshot = {
        symbol: options.symbol.toUpperCase(),
        bids: Array.from(bids.values()).sort((a, b) => b.price - a.price),
        asks: Array.from(asks.values()).sort((a, b) => a.price - b.price),
        timestamp: new Date().toISOString(),
      };
      
      resolve({ snapshot, unsubscribe });
    }, 5000);

    const onMktDepth = (
      id: number,
      position: number,
      operation: number,
      side: number,
      price: number,
      size: number
    ) => {
      if (id !== reqId) return;

      const level: MarketDepthLevel = { price, size };
      const map = side === 0 ? asks : bids;

      // operation: 0=insert, 1=update, 2=delete
      if (operation === 2) {
        map.delete(price);
      } else {
        map.set(price, level);
      }
    };

    const onMktDepthL2 = (
      id: number,
      position: number,
      marketMaker: string,
      operation: number,
      side: number,
      price: number,
      size: number,
      isSmartDepth: boolean
    ) => {
      if (id !== reqId) return;

      const level: MarketDepthLevel = { price, size, marketMaker };
      const map = side === 0 ? asks : bids;

      // operation: 0=insert, 1=update, 2=delete
      if (operation === 2) {
        map.delete(price);
      } else {
        map.set(price, level);
      }
    };

    const onError = (err: Error, code: ErrorCode, id: number) => {
      if (id !== reqId) return;
      if (isNonFatalError(code, err)) return;
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`Market depth error (${code}): ${err.message}`));
    };

    const cleanup = () => {
      clearTimeout(timeout);
      ib.off(EventName.updateMktDepth, onMktDepth);
      ib.off(EventName.updateMktDepthL2, onMktDepthL2);
      ib.off(EventName.error, onError);
    };

    const unsubscribe = () => {
      cleanup();
      ib.cancelMktDepth(reqId, isSmartDepth);
      log.info({ reqId, symbol: options.symbol }, "Unsubscribed from market depth");
    };

    ib.on(EventName.updateMktDepth, onMktDepth);
    ib.on(EventName.updateMktDepthL2, onMktDepthL2);
    ib.on(EventName.error, onError);

    log.info({ reqId, symbol: options.symbol, numRows, isSmartDepth }, "Requesting IBKR market depth");
    ib.reqMktDepth(reqId, contract, numRows, isSmartDepth, []);
  });
}
