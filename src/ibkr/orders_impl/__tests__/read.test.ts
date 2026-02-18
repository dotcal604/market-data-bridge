import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => {
  const handlers = new Map<string, Set<(...args: unknown[]) => void>>();
  const EventName = {
    openOrder: "openOrder",
    openOrderEnd: "openOrderEnd",
    completedOrder: "completedOrder",
    completedOrdersEnd: "completedOrdersEnd",
    execDetails: "execDetails",
    execDetailsEnd: "execDetailsEnd",
    commissionReport: "commissionReport",
    error: "error",
  };
  const mockIb = {
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)?.add(cb);
    }),
    off: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      handlers.get(event)?.delete(cb);
    }),
    reqAllOpenOrders: vi.fn(),
    reqCompletedOrders: vi.fn(),
    reqExecutions: vi.fn(),
  };
  const getNextReqId = vi.fn(() => 9001);
  const emit = (event: string, ...args: unknown[]): void => {
    for (const cb of handlers.get(event) ?? []) cb(...args);
  };
  return { handlers, EventName, mockIb, emit, getNextReqId };
});

vi.mock(import("@stoqey/ib"), () => ({ EventName: mockState.EventName, isNonFatalError: vi.fn(() => false) }));
vi.mock("../../connection.js", () => ({
  getIB: vi.fn(() => mockState.mockIb),
  getNextReqId: mockState.getNextReqId,
}));

const { getCompletedOrders, getExecutions, getOpenOrders } = await import("../read.js");

describe("orders_impl/read", () => {
  beforeEach(() => {
    mockState.handlers.clear();
    vi.clearAllMocks();
  });

  it("getOpenOrders returns formatted list", async () => {
    const pending = getOpenOrders();
    mockState.emit(mockState.EventName.openOrder, 101, { symbol: "AAPL", secType: "STK", exchange: "SMART", currency: "USD" }, { action: "BUY", orderType: "LMT", totalQuantity: 50, lmtPrice: 200, auxPrice: 0, tif: "DAY", parentId: 0, ocaGroup: "grp-1", account: "DU123" }, { status: "Submitted" });
    mockState.emit(mockState.EventName.openOrderEnd);
    const result = await pending;
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ orderId: 101, symbol: "AAPL", action: "BUY", orderType: "LMT", totalQuantity: 50, status: "Submitted", ocaGroup: "grp-1" });
    expect(mockState.mockIb.reqAllOpenOrders).toHaveBeenCalledOnce();
  });

  it("getOpenOrders resolves empty list when end is emitted without orders", async () => {
    const pending = getOpenOrders();
    mockState.emit(mockState.EventName.openOrderEnd);
    await expect(pending).resolves.toEqual([]);
  });

  it("getCompletedOrders returns filled/cancelled orders", async () => {
    const pending = getCompletedOrders();
    mockState.emit(mockState.EventName.completedOrder, { symbol: "MSFT", secType: "STK", exchange: "SMART", currency: "USD" }, { orderId: 77, action: "SELL", orderType: "MKT", totalQuantity: 20, tif: "GTC", account: "DU1" }, { status: "Filled", filled: 20, avgFillPrice: 410.55, completedTime: "20260215 10:00:00", completedStatus: "Filled" });
    mockState.emit(mockState.EventName.completedOrdersEnd);
    const result = await pending;
    expect(result[0]).toMatchObject({ orderId: 77, symbol: "MSFT", status: "Filled", filledQuantity: 20, avgFillPrice: 410.55 });
    expect(mockState.mockIb.reqCompletedOrders).toHaveBeenCalledWith(false);
  });

  it("getExecutions passes symbol filter to reqExecutions", async () => {
    const pending = getExecutions({ symbol: "TSLA" });
    mockState.emit(mockState.EventName.execDetails, 9001, { symbol: "TSLA", secType: "STK", currency: "USD" }, { execId: "E1", orderId: 501, exchange: "NASDAQ", side: "BOT", shares: 5, price: 300, cumQty: 5, avgPrice: 300, time: "20260215 09:31:00", acctNumber: "DU1" });
    mockState.emit(mockState.EventName.execDetailsEnd, 9001);
    const result = await pending;
    expect(mockState.mockIb.reqExecutions).toHaveBeenCalledWith(9001, { symbol: "TSLA" });
    expect(result[0]).toMatchObject({ execId: "E1", symbol: "TSLA", side: "BOT" });
  });

  it("getExecutions passes time filter to reqExecutions", async () => {
    const pending = getExecutions({ time: "20260215 09:30:00" });
    mockState.emit(mockState.EventName.execDetailsEnd, 9001);
    await pending;
    expect(mockState.mockIb.reqExecutions).toHaveBeenCalledWith(9001, { time: "20260215 09:30:00" });
  });

  it("getExecutions merges commission report into execution", async () => {
    const pending = getExecutions();
    mockState.emit(mockState.EventName.execDetails, 9001, { symbol: "NVDA", secType: "STK", currency: "USD" }, { execId: "EX-NVDA-1", orderId: 88, exchange: "NASDAQ", side: "SLD", shares: 2, price: 900, cumQty: 2, avgPrice: 900, time: "20260215 11:00:00", acctNumber: "DU1" });
    mockState.emit(mockState.EventName.commissionReport, { execId: "EX-NVDA-1", commission: 1.23, realizedPNL: 12.5 });
    mockState.emit(mockState.EventName.execDetailsEnd, 9001);
    const result = await pending;
    expect(result[0].commission).toBe(1.23);
    expect(result[0].realizedPnL).toBe(12.5);
  });

  it("getExecutions ignores events from other request ids", async () => {
    const pending = getExecutions();
    mockState.emit(mockState.EventName.execDetails, 1, { symbol: "QQQ", secType: "STK", currency: "USD" }, { execId: "wrong", orderId: 1 });
    mockState.emit(mockState.EventName.execDetailsEnd, 1);
    mockState.emit(mockState.EventName.execDetailsEnd, 9001);
    const result = await pending;
    expect(result).toEqual([]);
    expect(mockState.getNextReqId).toHaveBeenCalledOnce();
  });
});
