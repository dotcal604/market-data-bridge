import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventName } from "@stoqey/ib";

// Mock state hoisted for use in mocks
const mockState = vi.hoisted(() => {
  const handlers = new Map<string, (...args: any[]) => void>();
  return {
    handlers,
    mockIb: {
      on: vi.fn((event: string, cb: (...args: any[]) => void) => {
        handlers.set(event, cb);
      }),
    },
    emit: (event: string, ...args: any[]) => {
      const handler = handlers.get(event);
      if (handler) handler(...args);
    },
  };
});

// Mock dependencies
vi.mock(import("@stoqey/ib"), () => ({
  EventName: {
    orderStatus: "orderStatus",
    execDetails: "execDetails",
    commissionReport: "commissionReport",
  },
  IBApi: class IBApiMock {
    constructor() {
      return mockState.mockIb as unknown as object;
    }
  },
}));

vi.mock(import("../../connection.js"), () => ({
  getIB: vi.fn(() => mockState.mockIb),
}));

vi.mock(import("../../../db/database.js"), () => ({
  updateOrderStatus: vi.fn(),
  insertExecution: vi.fn(),
  updateExecutionCommission: vi.fn(),
  getOrderByOrderId: vi.fn(),
}));

vi.mock(import("../../../eval/auto-link.js"), () => ({
  tryLinkExecution: vi.fn(),
  schedulePositionCloseCheck: vi.fn(),
}));

vi.mock(import("../../../inbox/store.js"), () => ({
  appendInboxItem: vi.fn(),
}));

vi.mock(import("../../../ws/server.js"), () => ({
  wsBroadcastWithSequence: vi.fn(),
  getNextSequenceId: vi.fn(() => 1001),
}));

vi.mock(import("../../../logging.js"), () => ({
  logOrder: { info: vi.fn(), error: vi.fn() },
  logExec: { info: vi.fn(), error: vi.fn() },
  logger: { 
    info: vi.fn(), 
    warn: vi.fn(), 
    error: vi.fn(), 
    debug: vi.fn(), 
    child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) 
  },
}));

const { attachPersistentOrderListeners, resetPersistentListenerGuard } = await import("../listeners.js");
const { getOrderByOrderId, updateOrderStatus, insertExecution, updateExecutionCommission } = await import("../../../db/database.js");
const { appendInboxItem } = await import("../../../inbox/store.js");
const { wsBroadcastWithSequence } = await import("../../../ws/server.js");
const { tryLinkExecution, schedulePositionCloseCheck } = await import("../../../eval/auto-link.js");

describe("orders_impl/listeners", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.handlers.clear();
    resetPersistentListenerGuard();
  });

  it("attaches listeners and guards against double-attachment", () => {
    attachPersistentOrderListeners();
    expect(mockState.mockIb.on).toHaveBeenCalledWith(EventName.orderStatus, expect.any(Function));
    expect(mockState.mockIb.on).toHaveBeenCalledWith(EventName.execDetails, expect.any(Function));
    expect(mockState.mockIb.on).toHaveBeenCalledWith(EventName.commissionReport, expect.any(Function));

    // Second call should not re-attach
    attachPersistentOrderListeners();
    expect(mockState.mockIb.on).toHaveBeenCalledTimes(3);

    // After reset, it should allow re-attachment
    resetPersistentListenerGuard();
    attachPersistentOrderListeners();
    expect(mockState.mockIb.on).toHaveBeenCalledTimes(6);
  });

  describe("orderStatus handler", () => {
    it("updates DB when order exists", () => {
      attachPersistentOrderListeners();
      vi.mocked(getOrderByOrderId).mockReturnValue({ orderId: 123, symbol: "AAPL", action: "BUY" } as any);

      mockState.emit(EventName.orderStatus, 123, "Submitted", 10, 90, 150.5);

      expect(getOrderByOrderId).toHaveBeenCalledWith(123);
      expect(updateOrderStatus).toHaveBeenCalledWith(123, "Submitted", 10, 150.5);
    });

    it("ignores orders not in DB", () => {
      attachPersistentOrderListeners();
      vi.mocked(getOrderByOrderId).mockReturnValue(undefined);

      mockState.emit(EventName.orderStatus, 999, "Submitted", 0, 100, 0);

      expect(updateOrderStatus).not.toHaveBeenCalled();
    });

    it("notifies inbox on terminal status (Filled)", () => {
      attachPersistentOrderListeners();
      vi.mocked(getOrderByOrderId).mockReturnValue({ orderId: 123, symbol: "AAPL", action: "BUY" } as any);

      mockState.emit(EventName.orderStatus, 123, "Filled", 100, 0, 155.2);

      expect(appendInboxItem).toHaveBeenCalledWith(expect.objectContaining({
        type: "order_status",
        title: "BUY AAPL Filled @ 155.2",
      }));
    });

    it("notifies inbox on terminal status (Cancelled)", () => {
      attachPersistentOrderListeners();
      vi.mocked(getOrderByOrderId).mockReturnValue({ orderId: 124, symbol: "TSLA", action: "SELL" } as any);

      mockState.emit(EventName.orderStatus, 124, "Cancelled", 0, 50, 0);

      expect(appendInboxItem).toHaveBeenCalledWith(expect.objectContaining({
        type: "order_status",
        title: "SELL TSLA Cancelled",
      }));
    });

    it("handles errors gracefully", () => {
      attachPersistentOrderListeners();
      vi.mocked(getOrderByOrderId).mockImplementation(() => { throw new Error("DB Error"); });

      // Should not throw
      expect(() => mockState.emit(EventName.orderStatus, 123, "Submitted", 0, 0, 0)).not.toThrow();
    });
  });

  describe("execDetails handler", () => {
    const mockContract = { symbol: "MSFT" };
    const mockExecution = {
      orderId: 456,
      execId: "exec-001",
      side: "BOT",
      shares: 10,
      price: 400.1,
      cumQty: 10,
      avgPrice: 400.1,
      time: "2024-03-07T12:00:00Z",
    };

    it("inserts execution into DB and broadcasts via WS", () => {
      attachPersistentOrderListeners();
      vi.mocked(getOrderByOrderId).mockReturnValue({ correlation_id: "corr-123", eval_id: "eval-456" } as any);

      mockState.emit(EventName.execDetails, 1, mockContract, mockExecution);

      expect(insertExecution).toHaveBeenCalledWith(expect.objectContaining({
        exec_id: "exec-001",
        order_id: 456,
        symbol: "MSFT",
        shares: 10,
        price: 400.1,
      }));

      expect(wsBroadcastWithSequence).toHaveBeenCalledWith("order_filled", expect.objectContaining({
        orderId: 456,
        symbol: "MSFT",
        price: 400.1,
        qty: 10,
      }), 1001);

      expect(tryLinkExecution).toHaveBeenCalledWith(expect.objectContaining({
        exec_id: "exec-001",
        eval_id: "eval-456",
      }));
    });

    it("handles partial fills (quantity tracking)", () => {
      attachPersistentOrderListeners();
      vi.mocked(getOrderByOrderId).mockReturnValue({ correlation_id: "corr-123" } as any);

      mockState.emit(EventName.execDetails, 1, mockContract, { ...mockExecution, shares: 5, cumQty: 5 });

      expect(insertExecution).toHaveBeenCalledWith(expect.objectContaining({
        shares: 5,
        cum_qty: 5,
      }));
    });
  });

  describe("commissionReport handler", () => {
    it("updates commission and schedules close check on realized PNL", () => {
      attachPersistentOrderListeners();

      const mockReport = {
        execId: "exec-001",
        commission: 1.25,
        realizedPNL: 50.5,
      };

      mockState.emit(EventName.commissionReport, mockReport);

      expect(updateExecutionCommission).toHaveBeenCalledWith("exec-001", 1.25, 50.5);
      expect(schedulePositionCloseCheck).toHaveBeenCalledWith("exec-001", 50.5);
      expect(appendInboxItem).toHaveBeenCalledWith(expect.objectContaining({
        type: "fill",
        title: expect.stringContaining("PNL $50.50"),
      }));
    });

    it("does not schedule close check if realized PNL is missing or invalid", () => {
      attachPersistentOrderListeners();

      mockState.emit(EventName.commissionReport, {
        execId: "exec-002",
        commission: 0.5,
        realizedPNL: undefined,
      });

      expect(updateExecutionCommission).toHaveBeenCalledWith("exec-002", 0.5, null);
      expect(schedulePositionCloseCheck).not.toHaveBeenCalled();
    });
  });
});
