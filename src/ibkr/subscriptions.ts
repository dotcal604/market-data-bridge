import { Contract, EventName } from "@stoqey/ib";
import { logger } from "../logging.js";
import { getIB, getNextReqId, isConnected } from "./connection.js";

export interface Subscription {
  reqId: number;
  type: "realTimeBars" | "tickByTick" | "mktDepth" | "accountUpdates" | "scanner";
  symbol?: string;
  startedAt: Date;
}

export interface ScannerParameters {
  instrumentList: string[];
  locationCodeList: string[];
  scanTypeList: string[];
  fetchedAt: string;
}

interface RealTimeBarsParams {
  symbol: string;
  secType?: string;
  exchange?: string;
  currency?: string;
  whatToShow?: "TRADES" | "MIDPOINT" | "BID" | "ASK";
}

interface AccountUpdatesParams {
  accountId: string;
}

interface SubscribeParamsByType {
  realTimeBars: RealTimeBarsParams;
  tickByTick: Record<string, never>;
  mktDepth: Record<string, never>;
  accountUpdates: AccountUpdatesParams;
  scanner: Record<string, never>;
}

export const activeSubscriptions = new Map<number, Subscription>();
export const MAX_CONCURRENT = 50;

const log = logger.child({ subsystem: "ibkr-subscriptions" });

let scannerParametersCache: ScannerParameters | null = null;

function requireConnected(): void {
  if (!isConnected()) {
    throw new Error("IBKR not connected. Start TWS/Gateway and retry.");
  }
}

function toContract(params: RealTimeBarsParams): Contract {
  return {
    symbol: params.symbol.toUpperCase(),
    secType: (params.secType ?? "STK") as Contract["secType"],
    exchange: params.exchange ?? "SMART",
    currency: params.currency ?? "USD",
  };
}

export function subscribe<T extends Subscription["type"]>(type: T, params: SubscribeParamsByType[T]): number {
  requireConnected();

  if (activeSubscriptions.size >= MAX_CONCURRENT) {
    throw new Error(`Maximum concurrent subscriptions reached (${MAX_CONCURRENT})`);
  }

  if (type === "accountUpdates") {
    const accountParams = params as AccountUpdatesParams;
    const alreadySubscribed = Array.from(activeSubscriptions.values()).some(
      (subscription) => subscription.type === "accountUpdates" && subscription.symbol === accountParams.accountId
    );
    if (alreadySubscribed) {
      throw new Error(`Account updates already subscribed for account ${accountParams.accountId}`);
    }
  }

  const reqId = getNextReqId();
  const ib = getIB();

  switch (type) {
    case "realTimeBars": {
      const barParams = params as RealTimeBarsParams;
      const contract = toContract(barParams);
      ib.reqRealTimeBars(reqId, contract, 5, barParams.whatToShow ?? "TRADES", true);
      break;
    }
    case "accountUpdates": {
      const accountParams = params as AccountUpdatesParams;
      ib.reqAccountUpdates(true, accountParams.accountId);
      break;
    }
    case "tickByTick":
    case "mktDepth":
    case "scanner":
      throw new Error(`Subscription type \"${type}\" is not implemented yet`);
    default:
      throw new Error(`Unknown subscription type \"${String(type)}\"`);
  }

  const symbol = type === "accountUpdates"
    ? (params as AccountUpdatesParams).accountId
    : type === "realTimeBars"
      ? (params as RealTimeBarsParams).symbol.toUpperCase()
      : undefined;

  activeSubscriptions.set(reqId, {
    reqId,
    type,
    symbol,
    startedAt: new Date(),
  });

  log.info({ reqId, type, symbol }, "Started subscription");
  return reqId;
}

export function unsubscribe(reqId: number): void {
  const subscription = activeSubscriptions.get(reqId);
  if (!subscription) {
    return;
  }

  const ib = getIB();

  switch (subscription.type) {
    case "realTimeBars":
      ib.cancelRealTimeBars(reqId);
      break;
    case "accountUpdates":
      if (subscription.symbol) {
        ib.reqAccountUpdates(false, subscription.symbol);
      }
      break;
    case "tickByTick":
      ib.cancelTickByTickData(reqId);
      break;
    case "mktDepth":
      ib.cancelMktDepth(reqId, false);
      break;
    case "scanner":
      ib.cancelScannerSubscription(reqId);
      break;
    default:
      break;
  }

  activeSubscriptions.delete(reqId);
  log.info({ reqId, type: subscription.type }, "Stopped subscription");
}

export function getActiveSubscriptions(): Subscription[] {
  return Array.from(activeSubscriptions.values()).sort((a, b) => a.reqId - b.reqId);
}

export function unsubscribeAll(): void {
  const reqIds = Array.from(activeSubscriptions.keys());
  for (const reqId of reqIds) {
    try {
      unsubscribe(reqId);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      log.warn({ reqId, err: message }, "Failed to unsubscribe during cleanup");
      activeSubscriptions.delete(reqId);
    }
  }
}

function extractTagValues(xml: string, tagName: string): string[] {
  const regex = new RegExp(`<${tagName}>(.*?)</${tagName}>`, "gsi");
  const values: string[] = [];
  let match: RegExpExecArray | null = regex.exec(xml);

  while (match) {
    const value = match[1]?.trim();
    if (value) {
      values.push(value);
    }
    match = regex.exec(xml);
  }

  return Array.from(new Set(values));
}

export function parseScannerParametersXml(xml: string): ScannerParameters {
  const instrumentList = extractTagValues(xml, "instruments");
  const locationCodeList = extractTagValues(xml, "locationCode");
  const scanTypeList = extractTagValues(xml, "scanCode");

  return {
    instrumentList,
    locationCodeList,
    scanTypeList,
    fetchedAt: new Date().toISOString(),
  };
}

export async function getScannerParameters(forceRefresh = false): Promise<ScannerParameters> {
  requireConnected();

  if (scannerParametersCache && !forceRefresh) {
    return scannerParametersCache;
  }

  const ib = getIB();

  const parsed = await new Promise<ScannerParameters>((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("reqScannerParameters timed out after 10 seconds"));
    }, 10000);

    const onScannerParameters = (xml: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(parseScannerParametersXml(xml));
    };

    const onError = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`reqScannerParameters error: ${err.message}`));
    };

    const cleanup = () => {
      clearTimeout(timeout);
      ib.off(EventName.scannerParameters, onScannerParameters);
      ib.off(EventName.error, onError);
    };

    ib.on(EventName.scannerParameters, onScannerParameters);
    ib.on(EventName.error, onError);
    ib.reqScannerParameters();
  });

  scannerParametersCache = parsed;
  return parsed;
}

export function clearScannerParametersCache(): void {
  scannerParametersCache = null;
}
