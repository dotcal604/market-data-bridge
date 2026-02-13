import { EventName, ErrorCode, Contract, isNonFatalError } from "@stoqey/ib";
import { getIB, getNextReqId } from "./connection.js";

// TickType is a type-only union — use numeric constants, NOT the enum.
const TICK_BID = 1;
const TICK_ASK = 2;
const TICK_LAST = 4;
const TICK_HIGH = 6;
const TICK_LOW = 7;
const TICK_VOLUME = 8;
const TICK_CLOSE = 9;
const TICK_OPEN = 14;

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
