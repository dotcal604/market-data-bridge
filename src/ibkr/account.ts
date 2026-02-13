import { EventName, ErrorCode, Contract, isNonFatalError } from "@stoqey/ib";
import { getIB, getNextReqId } from "./connection.js";

export interface AccountSummaryData {
  account: string;
  netLiquidation: number | null;
  totalCashValue: number | null;
  settledCash: number | null;
  buyingPower: number | null;
  grossPositionValue: number | null;
  maintMarginReq: number | null;
  excessLiquidity: number | null;
  availableFunds: number | null;
  currency: string;
  timestamp: string;
}

const ACCOUNT_TAGS = [
  "NetLiquidation",
  "TotalCashValue",
  "SettledCash",
  "BuyingPower",
  "GrossPositionValue",
  "MaintMarginReq",
  "ExcessLiquidity",
  "AvailableFunds",
].join(",");

export async function getAccountSummary(): Promise<AccountSummaryData> {
  const ib = getIB();
  const reqId = getNextReqId();

  return new Promise((resolve, reject) => {
    let settled = false;
    const data: AccountSummaryData = {
      account: "",
      netLiquidation: null,
      totalCashValue: null,
      settledCash: null,
      buyingPower: null,
      grossPositionValue: null,
      maintMarginReq: null,
      excessLiquidity: null,
      availableFunds: null,
      currency: "USD",
      timestamp: new Date().toISOString(),
    };

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      ib.cancelAccountSummary(reqId);
      reject(new Error("Account summary request timed out"));
    }, 10000);

    const onSummary = (
      id: number,
      account: string,
      tag: string,
      value: string,
      currency: string
    ) => {
      if (id !== reqId) return;
      data.account = account;
      data.currency = currency;
      const num = parseFloat(value);
      switch (tag) {
        case "NetLiquidation":
          data.netLiquidation = num;
          break;
        case "TotalCashValue":
          data.totalCashValue = num;
          break;
        case "SettledCash":
          data.settledCash = num;
          break;
        case "BuyingPower":
          data.buyingPower = num;
          break;
        case "GrossPositionValue":
          data.grossPositionValue = num;
          break;
        case "MaintMarginReq":
          data.maintMarginReq = num;
          break;
        case "ExcessLiquidity":
          data.excessLiquidity = num;
          break;
        case "AvailableFunds":
          data.availableFunds = num;
          break;
      }
    };

    const onEnd = (id: number) => {
      if (id !== reqId) return;
      if (settled) return;
      settled = true;
      cleanup();
      ib.cancelAccountSummary(reqId);
      data.timestamp = new Date().toISOString();
      resolve(data);
    };

    const onError = (err: Error, code: ErrorCode, id: number) => {
      if (id !== reqId) return;
      if (isNonFatalError(code, err)) return;
      if (settled) return;
      settled = true;
      cleanup();
      ib.cancelAccountSummary(reqId);
      reject(new Error(`Account summary error (${code}): ${err.message}`));
    };

    const cleanup = () => {
      clearTimeout(timeout);
      ib.off(EventName.accountSummary, onSummary);
      ib.off(EventName.accountSummaryEnd, onEnd);
      ib.off(EventName.error, onError);
    };

    ib.on(EventName.accountSummary, onSummary);
    ib.on(EventName.accountSummaryEnd, onEnd);
    ib.on(EventName.error, onError);

    ib.reqAccountSummary(reqId, "All", ACCOUNT_TAGS);
  });
}

export interface PositionData {
  account: string;
  symbol: string;
  secType: string;
  exchange: string;
  currency: string;
  position: number;
  avgCost: number;
}

export async function getPositions(): Promise<PositionData[]> {
  const ib = getIB();

  return new Promise((resolve, reject) => {
    let settled = false;
    const positions: PositionData[] = [];

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      ib.cancelPositions();
      resolve(positions);
    }, 10000);

    const onPosition = (
      account: string,
      contract: Contract,
      pos: number,
      avgCost?: number
    ) => {
      positions.push({
        account,
        symbol: contract.symbol ?? "",
        secType: contract.secType ?? "",
        exchange: contract.exchange ?? "",
        currency: contract.currency ?? "",
        position: pos,
        avgCost: avgCost ?? 0,
      });
    };

    const onEnd = () => {
      if (settled) return;
      settled = true;
      cleanup();
      ib.cancelPositions();
      resolve(positions);
    };

    const onError = (err: Error, code: ErrorCode) => {
      if (isNonFatalError(code, err)) return;
      if (settled) return;
      settled = true;
      cleanup();
      ib.cancelPositions();
      reject(new Error(`Positions error (${code}): ${err.message}`));
    };

    const cleanup = () => {
      clearTimeout(timeout);
      ib.off(EventName.position, onPosition);
      ib.off(EventName.positionEnd, onEnd);
      ib.off(EventName.error, onError);
    };

    ib.on(EventName.position, onPosition);
    ib.on(EventName.positionEnd, onEnd);
    ib.on(EventName.error, onError);

    ib.reqPositions();
  });
}

export interface PnLData {
  account: string;
  dailyPnL: number | null;
  unrealizedPnL: number | null;
  realizedPnL: number | null;
  timestamp: string;
}

export async function getPnL(): Promise<PnLData> {
  const ib = getIB();
  const reqId = getNextReqId();

  // Get the account ID from a quick account summary call
  const summary = await getAccountSummary();
  const account = summary.account;

  if (!account) {
    throw new Error("Could not determine account ID for PnL request");
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const data: PnLData = {
      account,
      dailyPnL: null,
      unrealizedPnL: null,
      realizedPnL: null,
      timestamp: new Date().toISOString(),
    };

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      ib.cancelPnL(reqId);
      data.timestamp = new Date().toISOString();
      resolve(data);
    }, 10000);

    const onPnL = (
      id: number,
      dailyPnL: number,
      unrealizedPnL?: number,
      realizedPnL?: number
    ) => {
      if (id !== reqId) return;
      if (settled) return;
      settled = true;
      data.dailyPnL = dailyPnL;
      data.unrealizedPnL = unrealizedPnL ?? null;
      data.realizedPnL = realizedPnL ?? null;
      data.timestamp = new Date().toISOString();
      cleanup();
      ib.cancelPnL(reqId);
      resolve(data);
    };

    const onError = (err: Error, code: ErrorCode, id: number) => {
      if (id !== reqId) return;
      if (isNonFatalError(code, err)) return;
      if (settled) return;
      settled = true;
      cleanup();
      ib.cancelPnL(reqId);
      reject(new Error(`PnL error (${code}): ${err.message}`));
    };

    const cleanup = () => {
      clearTimeout(timeout);
      ib.off(EventName.pnl, onPnL);
      ib.off(EventName.error, onError);
    };

    ib.on(EventName.pnl, onPnL);
    ib.on(EventName.error, onError);

    ib.reqPnL(reqId, account, "");
  });
}
