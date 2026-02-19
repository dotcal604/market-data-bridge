import { EventName, ErrorCode, Contract, ContractDetails, isNonFatalError } from "@stoqey/ib";
import { getIB, getNextReqId } from "./connection.js";

export interface ContractDetailsData {
  conId: number;
  symbol: string;
  secType: string;
  exchange: string;
  currency: string;
  localSymbol: string;
  tradingClass: string;
  marketName: string;
  minTick: number | null;
  multiplier: number | null;
  orderTypes: string;
  validExchanges: string;
  longName: string;
  industry: string | null;
  category: string | null;
  subcategory: string | null;
  contractMonth: string;
  timeZoneId: string;
  tradingHours: string;
  liquidHours: string;
}

/**
 * Fetch full contract details from IBKR.
 * @param params Search parameters (symbol, secType, exchange, currency)
 * @returns Promise resolving to array of ContractDetailsData
 */
export async function getContractDetails(params: {
  symbol: string;
  secType?: string;
  exchange?: string;
  currency?: string;
}): Promise<ContractDetailsData[]> {
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
    const results: ContractDetailsData[] = [];

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(results);
    }, 10000);

    const onDetails = (id: number, details: ContractDetails) => {
      if (id !== reqId) return;
      const c = details.contract;
      results.push({
        conId: c?.conId ?? 0,
        symbol: c?.symbol ?? "",
        secType: c?.secType ?? "",
        exchange: c?.exchange ?? "",
        currency: c?.currency ?? "",
        localSymbol: c?.localSymbol ?? "",
        tradingClass: c?.tradingClass ?? "",
        marketName: details.marketName ?? "",
        minTick: details.minTick ?? null,
        multiplier: c?.multiplier ?? null,
        orderTypes: details.orderTypes ?? "",
        validExchanges: details.validExchanges ?? "",
        longName: details.longName ?? "",
        industry: details.industry ?? null,
        category: details.category ?? null,
        subcategory: details.subcategory ?? null,
        contractMonth: details.contractMonth ?? "",
        timeZoneId: details.timeZoneId ?? "",
        tradingHours: details.tradingHours ?? "",
        liquidHours: details.liquidHours ?? "",
      });
    };

    const onEnd = (id: number) => {
      if (id !== reqId) return;
      if (settled) return;
      settled = true;
      cleanup();
      resolve(results);
    };

    const onError = (err: Error, code: ErrorCode, id: number) => {
      if (id !== reqId) return;
      if (isNonFatalError(code, err)) return;
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`Contract details error (${code}): ${err.message}`));
    };

    const cleanup = () => {
      clearTimeout(timeout);
      ib.off(EventName.contractDetails, onDetails);
      ib.off(EventName.contractDetailsEnd, onEnd);
      ib.off(EventName.error, onError);
    };

    ib.on(EventName.contractDetails, onDetails);
    ib.on(EventName.contractDetailsEnd, onEnd);
    ib.on(EventName.error, onError);

    ib.reqContractDetails(reqId, contract);
  });
}
