import {
  Contract,
  EventName,
  ErrorCode,
  HistogramEntry,
  TickType,
  isNonFatalError,
} from "@stoqey/ib";
import { getAccountSummary } from "./account.js";
import { getIB, getNextReqId, isConnected } from "./connection.js";
import { getContractDetails } from "./contracts.js";


function requireConnected(): void {
  if (!isConnected()) {
    throw new Error("IBKR not connected. Start TWS/Gateway and retry.");
  }
}

function toStockContract(symbol: string): Contract {
  return {
    symbol,
    secType: "STK" as any,
    exchange: "SMART",
    currency: "USD",
  };
}

function toOptionContract(params: {
  symbol: string;
  expiry: string;
  strike: number;
  right: "C" | "P";
  exchange?: string;
}): Contract {
  return {
    symbol: params.symbol,
    secType: "OPT" as any,
    exchange: params.exchange ?? "SMART",
    currency: "USD",
    lastTradeDateOrContractMonth: params.expiry,
    strike: params.strike,
    right: params.right as any,
    multiplier: 100,
  };
}

/**
 * Request real-time PnL updates for a single position.
 * @param symbol Stock symbol
 * @returns Promise resolving to PnL data object
 */
export async function reqPnLSingleBySymbol(symbol: string): Promise<{
  symbol: string;
  conId: number;
  position: number;
  dailyPnL: number;
  unrealizedPnL: number | null;
  realizedPnL: number | null;
  value: number;
  timestamp: string;
}> {
  requireConnected();
  const accountSummary = await getAccountSummary();
  if (!accountSummary.account) {
    throw new Error("Unable to determine account for reqPnLSingle");
  }

  const details = await getContractDetails({ symbol });
  const conId = details[0]?.conId;
  if (!conId) {
    throw new Error(`Unable to resolve conId for symbol ${symbol}`);
  }

  const ib = getIB();
  const reqId = getNextReqId();

  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      ib.cancelPnLSingle(reqId);
      reject(new Error("reqPnLSingle timed out after 10 seconds"));
    }, 10000);

    const onPnLSingle = (
      id: number,
      position: number,
      dailyPnL: number,
      unrealizedPnL?: number,
      realizedPnL?: number,
      value?: number
    ) => {
      if (id !== reqId || settled) return;
      settled = true;
      cleanup();
      ib.cancelPnLSingle(reqId);
      resolve({
        symbol: symbol.toUpperCase(),
        conId,
        position,
        dailyPnL,
        unrealizedPnL: unrealizedPnL ?? null,
        realizedPnL: realizedPnL ?? null,
        value: value ?? 0,
        timestamp: new Date().toISOString(),
      });
    };

    const onError = (err: Error, code: ErrorCode, id: number) => {
      if (id !== reqId || settled) return;
      if (isNonFatalError(code, err)) return;
      settled = true;
      cleanup();
      ib.cancelPnLSingle(reqId);
      reject(new Error(`reqPnLSingle error (${code}): ${err.message}`));
    };

    const cleanup = () => {
      clearTimeout(timeout);
      ib.off(EventName.pnlSingle, onPnLSingle);
      ib.off(EventName.error, onError);
    };

    ib.on(EventName.pnlSingle, onPnLSingle);
    ib.on(EventName.error, onError);
    ib.reqPnLSingle(reqId, accountSummary.account, null, conId);
  });
}

/**
 * Search for contracts matching a pattern.
 * @param pattern Search string (e.g. "AAPL")
 * @returns Promise resolving to list of contract descriptions
 */
export async function reqMatchingSymbols(pattern: string): Promise<unknown[]> {
  requireConnected();
  const ib = getIB();
  const reqId = getNextReqId();
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("reqMatchingSymbols timed out after 10 seconds"));
    }, 10000);

    const onSamples = (id: number, contractDescriptions: unknown[]) => {
      if (id !== reqId || settled) return;
      settled = true;
      cleanup();
      resolve(contractDescriptions);
    };

    const onError = (err: Error, code: ErrorCode, id: number) => {
      if (id !== reqId || settled) return;
      if (isNonFatalError(code, err)) return;
      settled = true;
      cleanup();
      reject(new Error(`reqMatchingSymbols error (${code}): ${err.message}`));
    };

    const cleanup = () => {
      clearTimeout(timeout);
      ib.off(EventName.symbolSamples, onSamples);
      ib.off(EventName.error, onError);
    };

    ib.on(EventName.symbolSamples, onSamples);
    ib.on(EventName.error, onError);
    ib.reqMatchingSymbols(reqId, pattern);
  });
}

/**
 * Set the market data type (1=Live, 2=Frozen, 3=Delayed, 4=DelayedFrozen).
 * @param marketDataType Type code
 * @returns Promise resolving to confirmation object
 */
export async function reqMarketDataType(marketDataType: number): Promise<{ marketDataType: number; reqId: number }> {
  requireConnected();
  const ib = getIB();
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("reqMarketDataType timed out after 10 seconds"));
    }, 10000);

    const onMarketDataType = (reqId: number, actualType: number) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ marketDataType: actualType, reqId });
    };

    const onError = (err: Error, code: ErrorCode) => {
      if (isNonFatalError(code, err) || settled) return;
      settled = true;
      cleanup();
      reject(new Error(`reqMarketDataType error (${code}): ${err.message}`));
    };

    const cleanup = () => {
      clearTimeout(timeout);
      ib.off(EventName.marketDataType, onMarketDataType);
      ib.off(EventName.error, onError);
    };

    ib.on(EventName.marketDataType, onMarketDataType);
    ib.on(EventName.error, onError);
    ib.reqMarketDataType(marketDataType as 1 | 2 | 3 | 4);
  });
}

/**
 * Request auto-binding of open orders.
 * @param autoBind True to enable
 * @returns Promise resolving to confirmation object
 */
export async function reqAutoOpenOrders(autoBind: boolean): Promise<{ enabled: boolean }> {
  requireConnected();
  const ib = getIB();
  ib.reqAutoOpenOrders(autoBind);
  return { enabled: autoBind };
}

/**
 * Get the earliest available data timestamp for a contract.
 * @param params Search parameters
 * @returns Promise resolving to head timestamp
 */
export async function reqHeadTimestampBySymbol(params: {
  symbol: string;
  whatToShow: "TRADES" | "MIDPOINT" | "BID" | "ASK";
  useRTH: boolean;
  formatDate: 1 | 2;
}): Promise<{ symbol: string; headTimestamp: string }> {
  requireConnected();
  const ib = getIB();
  const reqId = getNextReqId();
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("reqHeadTimestamp timed out after 10 seconds"));
    }, 10000);

    const onHeadTimestamp = (id: number, headTimestamp: string) => {
      if (id !== reqId || settled) return;
      settled = true;
      cleanup();
      resolve({ symbol: params.symbol.toUpperCase(), headTimestamp });
    };

    const onError = (err: Error, code: ErrorCode, id: number) => {
      if (id !== reqId || settled) return;
      if (isNonFatalError(code, err)) return;
      settled = true;
      cleanup();
      reject(new Error(`reqHeadTimestamp error (${code}): ${err.message}`));
    };

    const cleanup = () => {
      clearTimeout(timeout);
      ib.off(EventName.headTimestamp, onHeadTimestamp);
      ib.off(EventName.error, onError);
    };

    ib.on(EventName.headTimestamp, onHeadTimestamp);
    ib.on(EventName.error, onError);
    ib.reqHeadTimestamp(reqId, toStockContract(params.symbol), params.whatToShow, params.useRTH, params.formatDate);
  });
}

/**
 * Request price histogram data.
 * @param params Search parameters
 * @returns Promise resolving to histogram entries
 */
export async function reqHistogramDataBySymbol(params: {
  symbol: string;
  useRTH: boolean;
  period: number;
  periodUnit: "S" | "D" | "W" | "M" | "Y";
}): Promise<{ symbol: string; items: HistogramEntry[] }> {
  requireConnected();
  const ib = getIB();
  const reqId = getNextReqId();
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("reqHistogramData timed out after 10 seconds"));
    }, 10000);

    const onHistogram = (id: number, data: HistogramEntry[]) => {
      if (id !== reqId || settled) return;
      settled = true;
      cleanup();
      resolve({ symbol: params.symbol.toUpperCase(), items: data });
    };

    const onError = (err: Error, code: ErrorCode, id: number) => {
      if (id !== reqId || settled) return;
      if (isNonFatalError(code, err)) return;
      settled = true;
      cleanup();
      reject(new Error(`reqHistogramData error (${code}): ${err.message}`));
    };

    const cleanup = () => {
      clearTimeout(timeout);
      ib.off(EventName.histogramData, onHistogram);
      ib.off(EventName.error, onError);
    };

    ib.on(EventName.histogramData, onHistogram);
    ib.on(EventName.error, onError);
    ib.reqHistogramData(reqId, toStockContract(params.symbol), params.useRTH, params.period, params.periodUnit as any);
  });
}

/**
 * Calculate implied volatility for an option.
 * @param params Option parameters and pricing
 * @returns Promise resolving to calculation results
 */
export async function calculateImpliedVolatility(params: {
  symbol: string;
  expiry: string;
  strike: number;
  right: "C" | "P";
  optionPrice: number;
  underlyingPrice: number;
}): Promise<{ impliedVolatility: number | null; delta: number | null; optPrice: number | null; undPrice: number | null; tickType: number }> {
  requireConnected();
  const ib = getIB();
  const reqId = getNextReqId();

  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      ib.cancelCalculateImpliedVolatility(reqId);
      reject(new Error("calculateImpliedVolatility timed out after 10 seconds"));
    }, 10000);

    const onTickOptionComputation = (
      id: number,
      tickType: TickType,
      impliedVolatility?: number,
      delta?: number,
      optPrice?: number,
      _pvDividend?: number,
      _gamma?: number,
      _vega?: number,
      _theta?: number,
      undPrice?: number
    ) => {
      if (id !== reqId || settled) return;
      settled = true;
      cleanup();
      ib.cancelCalculateImpliedVolatility(reqId);
      resolve({
        impliedVolatility: impliedVolatility ?? null,
        delta: delta ?? null,
        optPrice: optPrice ?? null,
        undPrice: undPrice ?? null,
        tickType,
      });
    };

    const onError = (err: Error, code: ErrorCode, id: number) => {
      if (id !== reqId || settled) return;
      if (isNonFatalError(code, err)) return;
      settled = true;
      cleanup();
      ib.cancelCalculateImpliedVolatility(reqId);
      reject(new Error(`calculateImpliedVolatility error (${code}): ${err.message}`));
    };

    const cleanup = () => {
      clearTimeout(timeout);
      ib.off(EventName.tickOptionComputation, onTickOptionComputation);
      ib.off(EventName.error, onError);
    };

    ib.on(EventName.tickOptionComputation, onTickOptionComputation);
    ib.on(EventName.error, onError);
    ib.calculateImpliedVolatility(
      reqId,
      toOptionContract({ symbol: params.symbol, expiry: params.expiry, strike: params.strike, right: params.right }),
      params.optionPrice,
      params.underlyingPrice
    );
  });
}

/**
 * Calculate option price based on volatility.
 * @param params Option parameters and volatility
 * @returns Promise resolving to calculation results
 */
export async function calculateOptionPrice(params: {
  symbol: string;
  expiry: string;
  strike: number;
  right: "C" | "P";
  volatility: number;
  underlyingPrice: number;
}): Promise<{ impliedVolatility: number | null; delta: number | null; optPrice: number | null; undPrice: number | null; tickType: number }> {
  requireConnected();
  const ib = getIB();
  const reqId = getNextReqId();

  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      ib.cancelCalculateOptionPrice(reqId);
      reject(new Error("calculateOptionPrice timed out after 10 seconds"));
    }, 10000);

    const onTickOptionComputation = (
      id: number,
      tickType: TickType,
      impliedVolatility?: number,
      delta?: number,
      optPrice?: number,
      _pvDividend?: number,
      _gamma?: number,
      _vega?: number,
      _theta?: number,
      undPrice?: number
    ) => {
      if (id !== reqId || settled) return;
      settled = true;
      cleanup();
      ib.cancelCalculateOptionPrice(reqId);
      resolve({
        impliedVolatility: impliedVolatility ?? null,
        delta: delta ?? null,
        optPrice: optPrice ?? null,
        undPrice: undPrice ?? null,
        tickType,
      });
    };

    const onError = (err: Error, code: ErrorCode, id: number) => {
      if (id !== reqId || settled) return;
      if (isNonFatalError(code, err)) return;
      settled = true;
      cleanup();
      ib.cancelCalculateOptionPrice(reqId);
      reject(new Error(`calculateOptionPrice error (${code}): ${err.message}`));
    };

    const cleanup = () => {
      clearTimeout(timeout);
      ib.off(EventName.tickOptionComputation, onTickOptionComputation);
      ib.off(EventName.error, onError);
    };

    ib.on(EventName.tickOptionComputation, onTickOptionComputation);
    ib.on(EventName.error, onError);
    ib.calculateOptionPrice(
      reqId,
      toOptionContract({ symbol: params.symbol, expiry: params.expiry, strike: params.strike, right: params.right }),
      params.volatility,
      params.underlyingPrice
    );
  });
}

/**
 * Get current server time from IBKR.
 * @returns Promise resolving to current time
 */
export async function reqCurrentTime(): Promise<{ epochSeconds: number; isoTime: string }> {
  requireConnected();
  const ib = getIB();
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("reqCurrentTime timed out after 10 seconds"));
    }, 10000);

    const onCurrentTime = (time: number) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ epochSeconds: time, isoTime: new Date(time * 1000).toISOString() });
    };

    const onError = (err: Error, code: ErrorCode) => {
      if (isNonFatalError(code, err) || settled) return;
      settled = true;
      cleanup();
      reject(new Error(`reqCurrentTime error (${code}): ${err.message}`));
    };

    const cleanup = () => {
      clearTimeout(timeout);
      ib.off(EventName.currentTime, onCurrentTime);
      ib.off(EventName.error, onError);
    };

    ib.on(EventName.currentTime, onCurrentTime);
    ib.on(EventName.error, onError);
    ib.reqCurrentTime();
  });
}

/**
 * Fetch market rule details (price increments, etc).
 * @param ruleId Rule ID from contract details
 * @returns Promise resolving to market rule info
 */
export async function reqMarketRule(ruleId: number): Promise<{ ruleId: number; increments: unknown[] }> {
  requireConnected();
  const ib = getIB();
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("reqMarketRule timed out after 10 seconds"));
    }, 10000);

    const onMarketRule = (marketRuleId: number, priceIncrements: unknown[]) => {
      if (marketRuleId !== ruleId || settled) return;
      settled = true;
      cleanup();
      resolve({ ruleId: marketRuleId, increments: priceIncrements });
    };

    const onError = (err: Error, code: ErrorCode) => {
      if (isNonFatalError(code, err) || settled) return;
      settled = true;
      cleanup();
      reject(new Error(`reqMarketRule error (${code}): ${err.message}`));
    };

    const cleanup = () => {
      clearTimeout(timeout);
      ib.off(EventName.marketRule, onMarketRule);
      ib.off(EventName.error, onError);
    };

    ib.on(EventName.marketRule, onMarketRule);
    ib.on(EventName.error, onError);
    ib.reqMarketRule(ruleId);
  });
}

/**
 * Fetch smart components for an exchange.
 * @param exchange Exchange code (e.g. "SMART")
 * @returns Promise resolving to component map
 */
export async function reqSmartComponents(exchange: string): Promise<{ exchange: string; components: Array<{ bitNumber: number; exchange: string; exchangeLetter: string }> }> {
  requireConnected();
  const ib = getIB();
  const reqId = getNextReqId();
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("reqSmartComponents timed out after 10 seconds"));
    }, 10000);

    const onSmartComponents = (id: number, theMap: Map<number, [string, string]>) => {
      if (id !== reqId || settled) return;
      settled = true;
      cleanup();
      const components = Array.from(theMap.entries()).map(([bitNumber, [exchangeName, exchangeLetter]]) => ({
        bitNumber,
        exchange: exchangeName,
        exchangeLetter,
      }));
      resolve({ exchange, components });
    };

    const onError = (err: Error, code: ErrorCode, id: number) => {
      if (id !== reqId || settled) return;
      if (isNonFatalError(code, err)) return;
      settled = true;
      cleanup();
      reject(new Error(`reqSmartComponents error (${code}): ${err.message}`));
    };

    const cleanup = () => {
      clearTimeout(timeout);
      ib.off(EventName.smartComponents, onSmartComponents);
      ib.off(EventName.error, onError);
    };

    ib.on(EventName.smartComponents, onSmartComponents);
    ib.on(EventName.error, onError);
    ib.reqSmartComponents(reqId, exchange);
  });
}

/**
 * Get list of exchanges that support market depth.
 * @returns Promise resolving to list of exchanges
 */
export async function reqMktDepthExchanges(): Promise<{ exchanges: unknown[] }> {
  requireConnected();
  const ib = getIB();

  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("reqMktDepthExchanges timed out after 10 seconds"));
    }, 10000);

    const onExchanges = (depthMktDataDescriptions: unknown[]) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ exchanges: depthMktDataDescriptions });
    };

    const onError = (err: Error, code: ErrorCode) => {
      if (isNonFatalError(code, err) || settled) return;
      settled = true;
      cleanup();
      reject(new Error(`reqMktDepthExchanges error (${code}): ${err.message}`));
    };

    const cleanup = () => {
      clearTimeout(timeout);
      ib.off(EventName.mktDepthExchanges, onExchanges);
      ib.off(EventName.error, onError);
    };

    ib.on(EventName.mktDepthExchanges, onExchanges);
    ib.on(EventName.error, onError);
    ib.reqMktDepthExchanges();
  });
}

/**
 * Request fundamental data (financial reports, etc).
 * @param params Search parameters (symbol, reportType)
 * @returns Promise resolving to XML report data
 */
export async function reqFundamentalDataBySymbol(params: {
  symbol: string;
  reportType: string;
}): Promise<{ symbol: string; reportType: string; data: string }> {
  requireConnected();
  const ib = getIB();
  const reqId = getNextReqId();

  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      ib.cancelFundamentalData(reqId);
      reject(new Error("reqFundamentalData timed out after 10 seconds"));
    }, 10000);

    const onFundamentalData = (id: number, data: string) => {
      if (id !== reqId || settled) return;
      settled = true;
      cleanup();
      ib.cancelFundamentalData(reqId);
      resolve({ symbol: params.symbol.toUpperCase(), reportType: params.reportType, data });
    };

    const onError = (err: Error, code: ErrorCode, id: number) => {
      if (id !== reqId || settled) return;
      if (isNonFatalError(code, err)) return;
      settled = true;
      cleanup();
      ib.cancelFundamentalData(reqId);
      reject(new Error(`reqFundamentalData error (${code}): ${err.message}`));
    };

    const cleanup = () => {
      clearTimeout(timeout);
      ib.off(EventName.fundamentalData, onFundamentalData);
      ib.off(EventName.error, onError);
    };

    ib.on(EventName.fundamentalData, onFundamentalData);
    ib.on(EventName.error, onError);
    ib.reqFundamentalData(reqId, toStockContract(params.symbol), params.reportType);
  });
}
