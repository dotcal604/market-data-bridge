import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => {
  const handlers = new Map<string, Set<(...args: unknown[]) => void>>();
  const EventName = { orderStatus: "orderStatus", error: "error" };
  const mockIb = {
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)?.add(cb);
    }),
    off: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      handlers.get(event)?.delete(cb);
    }),
    placeOrder: vi.fn(),
    cancelOrder: vi.fn(),
    reqGlobalCancel: vi.fn(),
    reqIds: vi.fn(),
  };
  const emit = (event: string, ...args: unknown[]): void => {
    for (const cb of handlers.get(event) ?? []) cb(...args);
  };
  return { handlers, EventName, mockIb, emit };
});

vi.mock(import("@stoqey/ib"), () => ({
  EventName: mockState.EventName,
  isNonFatalError: vi.fn(() => false),
  IBApi: class IBApiMock {
    constructor() {
      return mockState.mockIb as unknown as object;
    }
  },
}));

vi.mock(import("../read.js"), () => ({
  getNextValidOrderId: vi.fn(() => Promise.resolve(300)),
  getOpenOrders: vi.fn(() => Promise.resolve([{ orderId: 777, symbol: "AAPL", secType: "STK", exchange: "SMART", currency: "USD", action: "BUY", orderType: "LMT", totalQuantity: 100, lmtPrice: 190, auxPrice: 0, status: "Submitted", remaining: 100, tif: "DAY", parentId: 500, ocaGroup: "bracket-500", account: "DU1" }])),
}));
vi.mock(import("../../../db/database.js"), () => ({
  generateCorrelationId: vi.fn(() => "corr-123"),
  insertOrder: vi.fn(),
  updateOrderStatus: vi.fn(),
  getOrderByOrderId: vi.fn(() => ({ correlation_id: "parent-corr" })),
}));
vi.mock(import("../../../logging.js"), () => ({
  logOrder: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
}));

const { cancelAllOrders, cancelOrder, modifyOrder, placeBracketOrder, placeOrder } = await import("../write.js");

describe("orders_impl/write", () => {
  beforeEach(() => {
    mockState.handlers.clear();
    vi.clearAllMocks();
  });

  it("placeOrder builds correct Contract and Order objects", async () => {
    const pending = placeOrder({ symbol: "AAPL", action: "BUY", orderType: "LMT", totalQuantity: 25, lmtPrice: 200, tif: "DAY" });
    await Promise.resolve();
    const [, contract, order] = mockState.mockIb.placeOrder.mock.calls[0] as [number, Record<string, unknown>, Record<string, unknown>];
    expect(contract).toMatchObject({ symbol: "AAPL", secType: "STK", exchange: "SMART", currency: "USD" });
    expect(order).toMatchObject({ orderId: 300, action: "BUY", orderType: "LMT", totalQuantity: 25, lmtPrice: 200, tif: "DAY", transmit: true });
    mockState.emit(mockState.EventName.orderStatus, 300, "Submitted", 0, 25, 0);
    await expect(pending).resolves.toMatchObject({ orderId: 300, status: "Submitted" });
  });

  it("placeOrder inherits parent correlation id when parentId is provided", async () => {
    const pending = placeOrder({ symbol: "AMD", action: "BUY", orderType: "MKT", totalQuantity: 5, parentId: 11 });
    await Promise.resolve();
    mockState.emit(mockState.EventName.orderStatus, 300, "PreSubmitted", 0, 5, 0);
    await expect(pending).resolves.toMatchObject({ correlation_id: "parent-corr" });
  });

  it("placeBracketOrder creates parent + TP + SL orders", async () => {
    const pending = placeBracketOrder({ symbol: "TSLA", action: "BUY", totalQuantity: 10, entryType: "LMT", entryPrice: 180, takeProfitPrice: 190, stopLossPrice: 175 });
    await Promise.resolve();
    expect(mockState.mockIb.placeOrder).toHaveBeenCalledTimes(3);
    expect(mockState.mockIb.placeOrder.mock.calls[0][2]).toMatchObject({ orderId: 300, action: "BUY", orderType: "LMT", transmit: false });
    expect(mockState.mockIb.placeOrder.mock.calls[1][2]).toMatchObject({ orderId: 301, action: "SELL", orderType: "LMT", parentId: 300, transmit: false });
    expect(mockState.mockIb.placeOrder.mock.calls[2][2]).toMatchObject({ orderId: 302, action: "SELL", orderType: "STP", parentId: 300, transmit: true });
    mockState.emit(mockState.EventName.orderStatus, 300, "Submitted");
    await expect(pending).resolves.toMatchObject({ parentOrderId: 300, takeProfitOrderId: 301, stopLossOrderId: 302 });
  });

  it("modifyOrder preserves ocaGroup on existing bracket leg", async () => {
    const pending = modifyOrder({ orderId: 777, lmtPrice: 191, totalQuantity: 120 });
    await Promise.resolve();
    const [, , order] = mockState.mockIb.placeOrder.mock.calls[0] as [number, Record<string, unknown>, Record<string, unknown>];
    expect(order).toMatchObject({ orderId: 777, ocaGroup: "bracket-500", lmtPrice: 191, totalQuantity: 120 });
    mockState.emit(mockState.EventName.orderStatus, 777, "Submitted");
    await expect(pending).resolves.toMatchObject({ orderId: 777, status: "Submitted" });
  });

  it("modifyOrder throws for missing modifiable fields", async () => {
    await expect(modifyOrder({ orderId: 777 })).rejects.toThrow("No fields to modify");
  });

  it("cancelOrder calls ib.cancelOrder with correct ID", async () => {
    const pending = cancelOrder(444);
    await Promise.resolve();
    expect(mockState.mockIb.cancelOrder).toHaveBeenCalledWith(444);
    mockState.emit(mockState.EventName.orderStatus, 444, "Cancelled");
    await expect(pending).resolves.toEqual({ orderId: 444, status: "Cancelled" });
  });

  it("cancelAllOrders calls reqGlobalCancel", async () => {
    await expect(cancelAllOrders()).resolves.toEqual({ status: "Global cancel requested" });
    expect(mockState.mockIb.reqGlobalCancel).toHaveBeenCalledOnce();
  });

  it("placeOrder rejects on fatal order error", async () => {
    const pending = placeOrder({ symbol: "AAPL", action: "BUY", orderType: "MKT", totalQuantity: 1 });
    await Promise.resolve();
    mockState.emit(mockState.EventName.error, new Error("boom"), 500, 300);
    await expect(pending).rejects.toThrow("Place order error (500): boom");
  });
});
