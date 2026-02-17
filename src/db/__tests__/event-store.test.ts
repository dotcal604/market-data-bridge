import { describe, it, expect, beforeEach, vi } from "vitest";
import Database, { type Database as DatabaseType } from "better-sqlite3";
import {
  EventStore,
  type TradingEvent,
  type OrderPlacedPayload,
  type ExecutionReceivedPayload,
  type RiskLimitBreachedPayload,
  type RegimeShiftedPayload,
} from "../event-store.js";

/**
 * Test suite for EventStore
 * Tests: publish/subscribe round-trip, replay from DB, getEventsForOrder, listener error isolation
 * Uses better-sqlite3 in-memory mode
 */

describe("EventStore", () => {
  let db: DatabaseType;
  let eventStore: EventStore;

  beforeEach(() => {
    // Create in-memory database for each test
    db = new Database(":memory:");

    // Pass the db instance to EventStore constructor
    eventStore = new EventStore(db);
  });

  describe("publish/subscribe round-trip", () => {
    it("should publish OrderPlaced event and notify subscribers", () => {
      const receivedEvents: TradingEvent[] = [];
      
      // Subscribe to events
      eventStore.subscribe((event) => {
        receivedEvents.push(event);
      });

      // Create and publish event
      const orderPlacedPayload: OrderPlacedPayload = {
        orderId: "order-123",
        symbol: "AAPL",
        side: "BUY",
        quantity: 100,
        orderType: "MKT",
        strategyId: "strat-1",
        timestamp: Date.now(),
      };

      const event: TradingEvent = {
        type: "OrderPlaced",
        payload: orderPlacedPayload,
      };

      eventStore.publish(event);

      // Verify subscriber received the event
      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0].type).toBe("OrderPlaced");
      expect(receivedEvents[0].payload.orderId).toBe("order-123");
      expect(receivedEvents[0].payload.symbol).toBe("AAPL");
    });

    it("should publish ExecutionReceived event and notify subscribers", () => {
      const receivedEvents: TradingEvent[] = [];
      
      eventStore.subscribe((event) => {
        receivedEvents.push(event);
      });

      const executionPayload: ExecutionReceivedPayload = {
        execId: "exec-456",
        orderId: "order-123",
        symbol: "AAPL",
        side: "BUY",
        lastShares: 50,
        lastPrice: 150.25,
        timestamp: Date.now(),
      };

      const event: TradingEvent = {
        type: "ExecutionReceived",
        payload: executionPayload,
      };

      eventStore.publish(event);

      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0].type).toBe("ExecutionReceived");
      expect(receivedEvents[0].payload.orderId).toBe("order-123");
      expect(receivedEvents[0].payload.lastShares).toBe(50);
    });

    it("should handle multiple subscribers", () => {
      const subscriber1Events: TradingEvent[] = [];
      const subscriber2Events: TradingEvent[] = [];
      
      eventStore.subscribe((event) => subscriber1Events.push(event));
      eventStore.subscribe((event) => subscriber2Events.push(event));

      const event: TradingEvent = {
        type: "OrderPlaced",
        payload: {
          orderId: "order-999",
          symbol: "TSLA",
          side: "SELL",
          quantity: 200,
          orderType: "LMT",
          limitPrice: 250.0,
          strategyId: "strat-2",
          timestamp: Date.now(),
        },
      };

      eventStore.publish(event);

      // Both subscribers should receive the event
      expect(subscriber1Events).toHaveLength(1);
      expect(subscriber2Events).toHaveLength(1);
      expect(subscriber1Events[0].payload.orderId).toBe("order-999");
      expect(subscriber2Events[0].payload.orderId).toBe("order-999");
    });
  });

  describe("replay from database", () => {
    it("should replay all events in order", () => {
      const receivedEvents: TradingEvent[] = [];

      // Publish multiple events
      const event1: TradingEvent = {
        type: "OrderPlaced",
        payload: {
          orderId: "order-1",
          symbol: "AAPL",
          side: "BUY",
          quantity: 100,
          orderType: "MKT",
          strategyId: "strat-1",
          timestamp: 1000,
        },
      };

      const event2: TradingEvent = {
        type: "ExecutionReceived",
        payload: {
          execId: "exec-1",
          orderId: "order-1",
          symbol: "AAPL",
          side: "BUY",
          lastShares: 50,
          lastPrice: 150.0,
          timestamp: 2000,
        },
      };

      const event3: TradingEvent = {
        type: "ExecutionReceived",
        payload: {
          execId: "exec-2",
          orderId: "order-1",
          symbol: "AAPL",
          side: "BUY",
          lastShares: 50,
          lastPrice: 151.0,
          timestamp: 3000,
        },
      };

      eventStore.publish(event1);
      eventStore.publish(event2);
      eventStore.publish(event3);

      // Subscribe after publishing
      eventStore.subscribe((event) => {
        receivedEvents.push(event);
      });

      // Replay should notify subscriber of all past events
      eventStore.replay();

      expect(receivedEvents).toHaveLength(3);
      expect(receivedEvents[0].type).toBe("OrderPlaced");
      expect(receivedEvents[1].type).toBe("ExecutionReceived");
      expect(receivedEvents[2].type).toBe("ExecutionReceived");
      expect(receivedEvents[1].payload.lastPrice).toBe(150.0);
      expect(receivedEvents[2].payload.lastPrice).toBe(151.0);
    });

    it("should preserve event order during replay", () => {
      const timestamps: number[] = [];

      // Publish events with specific timestamps
      for (let i = 0; i < 5; i++) {
        const event: TradingEvent = {
          type: "OrderPlaced",
          payload: {
            orderId: `order-${i}`,
            symbol: "AAPL",
            side: "BUY",
            quantity: 100,
            orderType: "MKT",
            strategyId: "strat-1",
            timestamp: 1000 + i * 1000,
          },
        };
        eventStore.publish(event);
      }

      eventStore.subscribe((event) => {
        timestamps.push(event.payload.timestamp);
      });

      eventStore.replay();

      // Verify events are in ascending timestamp order
      expect(timestamps).toEqual([1000, 2000, 3000, 4000, 5000]);
    });
  });

  describe("getEventsForOrder", () => {
    it("should return all events for a specific order", () => {
      // Publish events for multiple orders
      const order1Event: TradingEvent = {
        type: "OrderPlaced",
        payload: {
          orderId: "order-123",
          symbol: "AAPL",
          side: "BUY",
          quantity: 100,
          orderType: "MKT",
          strategyId: "strat-1",
          timestamp: 1000,
        },
      };

      const order2Event: TradingEvent = {
        type: "OrderPlaced",
        payload: {
          orderId: "order-456",
          symbol: "TSLA",
          side: "SELL",
          quantity: 50,
          orderType: "LMT",
          limitPrice: 250.0,
          strategyId: "strat-2",
          timestamp: 2000,
        },
      };

      const exec1Event: TradingEvent = {
        type: "ExecutionReceived",
        payload: {
          execId: "exec-1",
          orderId: "order-123",
          symbol: "AAPL",
          side: "BUY",
          lastShares: 50,
          lastPrice: 150.0,
          timestamp: 3000,
        },
      };

      const exec2Event: TradingEvent = {
        type: "ExecutionReceived",
        payload: {
          execId: "exec-2",
          orderId: "order-123",
          symbol: "AAPL",
          side: "BUY",
          lastShares: 50,
          lastPrice: 151.0,
          timestamp: 4000,
        },
      };

      eventStore.publish(order1Event);
      eventStore.publish(order2Event);
      eventStore.publish(exec1Event);
      eventStore.publish(exec2Event);

      // Get events for order-123
      const events = eventStore.getEventsForOrder("order-123");

      expect(events).toHaveLength(3);
      expect(events[0].type).toBe("OrderPlaced");
      expect(events[0].payload.orderId).toBe("order-123");
      expect(events[1].type).toBe("ExecutionReceived");
      expect(events[1].payload.orderId).toBe("order-123");
      expect(events[2].type).toBe("ExecutionReceived");
      expect(events[2].payload.orderId).toBe("order-123");
    });

    it("should return empty array for non-existent order", () => {
      const event: TradingEvent = {
        type: "OrderPlaced",
        payload: {
          orderId: "order-123",
          symbol: "AAPL",
          side: "BUY",
          quantity: 100,
          orderType: "MKT",
          strategyId: "strat-1",
          timestamp: 1000,
        },
      };

      eventStore.publish(event);

      const events = eventStore.getEventsForOrder("order-999");
      expect(events).toHaveLength(0);
    });

    it("should not return events without orderId field", () => {
      // Publish RiskLimitBreached event (doesn't have orderId)
      const riskEvent: TradingEvent = {
        type: "RiskLimitBreached",
        payload: {
          ruleId: "rule-1",
          currentValue: 10000,
          limitValue: 5000,
          timestamp: 1000,
        },
      };

      eventStore.publish(riskEvent);

      const events = eventStore.getEventsForOrder("order-123");
      expect(events).toHaveLength(0);
    });
  });

  describe("listener error isolation", () => {
    it("should continue notifying other listeners if one throws error", () => {
      const successfulListener1Events: TradingEvent[] = [];
      const successfulListener2Events: TradingEvent[] = [];
      
      // Add first successful listener
      eventStore.subscribe((event) => {
        successfulListener1Events.push(event);
      });

      // Add failing listener
      eventStore.subscribe((event) => {
        throw new Error("Listener error");
      });

      // Add second successful listener
      eventStore.subscribe((event) => {
        successfulListener2Events.push(event);
      });

      // Spy on console.error to suppress error output
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const event: TradingEvent = {
        type: "OrderPlaced",
        payload: {
          orderId: "order-123",
          symbol: "AAPL",
          side: "BUY",
          quantity: 100,
          orderType: "MKT",
          strategyId: "strat-1",
          timestamp: Date.now(),
        },
      };

      eventStore.publish(event);

      // Both successful listeners should receive the event
      expect(successfulListener1Events).toHaveLength(1);
      expect(successfulListener2Events).toHaveLength(1);
      
      // Error should have been logged
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Error in event listener:",
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });

    it("should handle multiple failing listeners gracefully", () => {
      const successfulListenerEvents: TradingEvent[] = [];
      
      // Add multiple failing listeners
      eventStore.subscribe(() => {
        throw new Error("Error 1");
      });
      
      eventStore.subscribe(() => {
        throw new Error("Error 2");
      });

      // Add successful listener at the end
      eventStore.subscribe((event) => {
        successfulListenerEvents.push(event);
      });

      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const event: TradingEvent = {
        type: "RegimeShifted",
        payload: {
          prevRegime: "NEUTRAL",
          newRegime: "BULLISH",
          confidence: 0.85,
          timestamp: Date.now(),
        },
      };

      eventStore.publish(event);

      // Successful listener should still receive the event
      expect(successfulListenerEvents).toHaveLength(1);
      expect(successfulListenerEvents[0].type).toBe("RegimeShifted");
      
      // Both errors should have been logged
      expect(consoleErrorSpy).toHaveBeenCalledTimes(2);

      consoleErrorSpy.mockRestore();
    });
  });

  describe("multiple event types", () => {
    it("should handle RiskLimitBreached events", () => {
      const receivedEvents: TradingEvent[] = [];
      
      eventStore.subscribe((event) => {
        receivedEvents.push(event);
      });

      const riskPayload: RiskLimitBreachedPayload = {
        ruleId: "max-position-size",
        currentValue: 10000,
        limitValue: 5000,
        symbol: "AAPL",
        timestamp: Date.now(),
      };

      const event: TradingEvent = {
        type: "RiskLimitBreached",
        payload: riskPayload,
      };

      eventStore.publish(event);

      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0].type).toBe("RiskLimitBreached");
      expect(receivedEvents[0].payload.ruleId).toBe("max-position-size");
      expect(receivedEvents[0].payload.currentValue).toBe(10000);
    });

    it("should handle RegimeShifted events", () => {
      const receivedEvents: TradingEvent[] = [];
      
      eventStore.subscribe((event) => {
        receivedEvents.push(event);
      });

      const regimePayload: RegimeShiftedPayload = {
        prevRegime: "NEUTRAL",
        newRegime: "BULLISH",
        confidence: 0.85,
        timestamp: Date.now(),
      };

      const event: TradingEvent = {
        type: "RegimeShifted",
        payload: regimePayload,
      };

      eventStore.publish(event);

      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0].type).toBe("RegimeShifted");
      expect(receivedEvents[0].payload.prevRegime).toBe("NEUTRAL");
      expect(receivedEvents[0].payload.newRegime).toBe("BULLISH");
      expect(receivedEvents[0].payload.confidence).toBe(0.85);
    });

    it("should handle mixed event types in sequence", () => {
      const receivedEvents: TradingEvent[] = [];
      
      eventStore.subscribe((event) => {
        receivedEvents.push(event);
      });

      const events: TradingEvent[] = [
        {
          type: "OrderPlaced",
          payload: {
            orderId: "order-1",
            symbol: "AAPL",
            side: "BUY",
            quantity: 100,
            orderType: "MKT",
            strategyId: "strat-1",
            timestamp: 1000,
          },
        },
        {
          type: "RegimeShifted",
          payload: {
            prevRegime: "NEUTRAL",
            newRegime: "BULLISH",
            confidence: 0.85,
            timestamp: 2000,
          },
        },
        {
          type: "ExecutionReceived",
          payload: {
            execId: "exec-1",
            orderId: "order-1",
            symbol: "AAPL",
            side: "BUY",
            lastShares: 100,
            lastPrice: 150.0,
            timestamp: 3000,
          },
        },
        {
          type: "RiskLimitBreached",
          payload: {
            ruleId: "max-drawdown",
            currentValue: -5000,
            limitValue: -2000,
            timestamp: 4000,
          },
        },
      ];

      events.forEach((event) => eventStore.publish(event));

      expect(receivedEvents).toHaveLength(4);
      expect(receivedEvents[0].type).toBe("OrderPlaced");
      expect(receivedEvents[1].type).toBe("RegimeShifted");
      expect(receivedEvents[2].type).toBe("ExecutionReceived");
      expect(receivedEvents[3].type).toBe("RiskLimitBreached");
    });
  });
});
