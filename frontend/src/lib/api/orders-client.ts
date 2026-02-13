import type {
  OrdersResponse,
  CompletedOrdersResponse,
  CancelOrderResponse,
  CancelAllOrdersResponse,
} from "./types";

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const ordersClient = {
  getOpenOrders() {
    return fetchJson<OrdersResponse>("/api/account/orders");
  },

  getCompletedOrders() {
    return fetchJson<CompletedOrdersResponse>("/api/account/orders/completed");
  },

  cancelOrder(orderId: number) {
    return fetchJson<CancelOrderResponse>(`/api/order/${orderId}`, {
      method: "DELETE",
    });
  },

  cancelAllOrders() {
    return fetchJson<CancelAllOrdersResponse>("/api/orders/all", {
      method: "DELETE",
    });
  },
};
