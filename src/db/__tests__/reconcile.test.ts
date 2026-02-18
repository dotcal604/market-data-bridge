import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  isConnectedMock,
  getOpenOrdersMock,
  getPositionsMock,
  getLiveOrdersMock,
  getLatestPositionSnapshotMock,
  getLiveBracketCorrelationsMock,
  getOrdersByCorrelationMock,
  updateOrderStatusMock,
  insertPositionSnapshotMock,
  reconcileClosedPositionMock,
  reconcileLogger,
} = vi.hoisted(() => ({
  isConnectedMock: vi.fn<() => boolean>(),
  getOpenOrdersMock: vi.fn<() => Promise<Array<{ orderId: number; status: string; symbol: string }>>>(),
  getPositionsMock: vi.fn<() => Promise<Array<{ symbol: string; position: number; avgCost: number }>>>(),
  getLiveOrdersMock: vi.fn<() => Array<{ order_id: number; symbol: string; status: string }>>(),
  getLatestPositionSnapshotMock: vi.fn<() => Array<{ symbol: string; position: number }> | null>(),
  getLiveBracketCorrelationsMock: vi.fn<() => Array<{ correlation_id: string }>>(),
  getOrdersByCorrelationMock: vi.fn<() => Array<Record<string, unknown>>>(),
  updateOrderStatusMock: vi.fn<(orderId: number, status: string) => void>(),
  insertPositionSnapshotMock: vi.fn<(rows: unknown[], source: string) => void>(),
  reconcileClosedPositionMock: vi.fn<(symbol: string) => void>(),
  reconcileLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../ibkr/connection.js", () => ({
  isConnected: isConnectedMock,
}));

vi.mock("../../ibkr/orders.js", () => ({
  getOpenOrders: getOpenOrdersMock,
  getExecutions: vi.fn(),
}));

vi.mock("../../ibkr/account.js", () => ({
  getPositions: getPositionsMock,
}));

vi.mock("../database.js", () => ({
  getLiveOrders: getLiveOrdersMock,
  getLiveBracketCorrelations: getLiveBracketCorrelationsMock,
  getOrdersByCorrelation: getOrdersByCorrelationMock,
  insertPositionSnapshot: insertPositionSnapshotMock,
  getLatestPositionSnapshot: getLatestPositionSnapshotMock,
  updateOrderStatus: updateOrderStatusMock,
}));

vi.mock("../../eval/auto-link.js", () => ({
  reconcileClosedPosition: reconcileClosedPositionMock,
}));

vi.mock("../../logging.js", () => ({
  logReconcile: reconcileLogger,
}));

import { runReconciliation } from "../reconcile.js";

describe("db/reconcile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    isConnectedMock.mockReturnValue(true);
    getLiveOrdersMock.mockReturnValue([]);
    getOpenOrdersMock.mockResolvedValue([]);
    getPositionsMock.mockResolvedValue([]);
    getLatestPositionSnapshotMock.mockReturnValue(null);
    getLiveBracketCorrelationsMock.mockReturnValue([]);
    getOrdersByCorrelationMock.mockReturnValue([]);
  });

  it("skips reconciliation when IBKR is disconnected", async () => {
    isConnectedMock.mockReturnValue(false);

    await runReconciliation();

    expect(reconcileLogger.warn).toHaveBeenCalledWith("Skipping reconciliation — IBKR not connected");
    expect(getOpenOrdersMock).not.toHaveBeenCalled();
  });

  it("marks live DB orders missing from IBKR as Inactive", async () => {
    getLiveOrdersMock.mockReturnValue([{ order_id: 101, symbol: "AAPL", status: "RECONCILING" }]);
    getOpenOrdersMock.mockResolvedValue([]);

    const promise = runReconciliation();
    await vi.advanceTimersByTimeAsync(3000);
    await promise;

    expect(updateOrderStatusMock).toHaveBeenCalledWith(101, "RECONCILING");
    expect(updateOrderStatusMock).toHaveBeenCalledWith(101, "Inactive");
  });

  it("keeps orders present in IBKR and updates status to IBKR state", async () => {
    getLiveOrdersMock.mockReturnValue([{ order_id: 202, symbol: "MSFT", status: "Submitted" }]);
    getOpenOrdersMock.mockResolvedValue([{ orderId: 202, status: "PreSubmitted", symbol: "MSFT" }]);

    const promise = runReconciliation();
    await vi.advanceTimersByTimeAsync(3000);
    await promise;

    expect(updateOrderStatusMock).toHaveBeenCalledWith(202, "RECONCILING");
    expect(updateOrderStatusMock).toHaveBeenCalledWith(202, "PreSubmitted");
    expect(updateOrderStatusMock).not.toHaveBeenCalledWith(202, "Inactive");
  });

  it("handles empty DB live orders gracefully", async () => {
    getLiveOrdersMock.mockReturnValue([]);

    const promise = runReconciliation();
    await vi.advanceTimersByTimeAsync(3000);
    await promise;

    expect(updateOrderStatusMock).not.toHaveBeenCalled();
    expect(insertPositionSnapshotMock).toHaveBeenCalledWith([], "reconcile");
  });

  it("reverts RECONCILING status if IBKR fetch fails", async () => {
    getLiveOrdersMock.mockReturnValue([{ order_id: 303, symbol: "TSLA", status: "Submitted" }]);
    getOpenOrdersMock.mockRejectedValue(new Error("network"));

    const promise = runReconciliation();
    await vi.advanceTimersByTimeAsync(3000);
    await promise;

    expect(updateOrderStatusMock).toHaveBeenNthCalledWith(1, 303, "RECONCILING");
    expect(updateOrderStatusMock).toHaveBeenNthCalledWith(2, 303, "Submitted");
    expect(reconcileLogger.error).toHaveBeenCalled();
  });

  it("logs reconciliation summary when complete", async () => {
    getLiveOrdersMock.mockReturnValue([{ order_id: 401, symbol: "NVDA", status: "Submitted" }]);
    getOpenOrdersMock.mockResolvedValue([{ orderId: 401, status: "Submitted", symbol: "NVDA" }]);
    getPositionsMock.mockResolvedValue([{ symbol: "NVDA", position: 10, avgCost: 900 }]);

    const promise = runReconciliation();
    await vi.advanceTimersByTimeAsync(3000);
    await promise;

    expect(reconcileLogger.info).toHaveBeenCalledWith(
      { openOrders: 1, positions: 1 },
      "Reconciliation complete",
    );
  });
});
