import type {
  OrdersResponse,
  CompletedOrdersResponse,
  CancelOrderResponse,
  CancelAllOrdersResponse,
} from "./types";
import { fetchJson } from "./fetch-json";

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
