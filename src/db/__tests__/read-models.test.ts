import { describe, it, expect, beforeEach } from "vitest";
import Database, { type Database as DatabaseType } from "better-sqlite3";
import { EventStore, type TradingEvent } from "../event-store.js";
import { ReadModelStore } from "../read-models.js";

/**
 * Test suite for ReadModelStore
 * Tests: order state transitions, average cost after partial fills, position netting
 * Uses better-sqlite3 in-memory mode with EventStore
 */

describe("ReadModelStore", () => {
  let db: DatabaseType;
  let eventStore: EventStore;
  let readModelStore: ReadModelStore;

  beforeEach(() => {
    // Create in-memory database for each test
    db = new Database(":memory:");

    // Create EventStore with the database
    eventStore = new EventStore(db);

    // Create ReadModelStore (it will subscribe to eventStore)
    readModelStore = new ReadModelStore(eventStore);
  });

  describe("order state transitions", () => {
    it("should create order in SUBMITTED state on OrderPlaced", () => {
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

      const order = readModelStore.getOrder("order-123");
      expect(order).toBeDefined();
      expect(order?.orderId).toBe("order-123");
      expect(order?.symbol).toBe("AAPL");
      expect(order?.side).toBe("BUY");
      expect(order?.originalQty).toBe(100);
      expect(order?.filledQty).toBe(0);
      expect(order?.avgPrice).toBe(0);
      expect(order?.status).toBe("SUBMITTED");
    });

    it("should transition to FILLED when execution completes full quantity", () => {
      // Place order
      const orderEvent: TradingEvent = {
        type: "OrderPlaced",
        payload: {
          orderId: "order-456",
          symbol: "TSLA",
          side: "BUY",
          quantity: 100,
          orderType: "MKT",
          strategyId: "strat-1",
          timestamp: 1000,
        },
      };

      eventStore.publish(orderEvent);

      // Execute full quantity
      const execEvent: TradingEvent = {
        type: "ExecutionReceived",
        payload: {
          execId: "exec-1",
          orderId: "order-456",
          symbol: "TSLA",
          side: "BUY",
          lastShares: 100,
          lastPrice: 250.0,
          timestamp: 2000,
        },
      };

      eventStore.publish(execEvent);

      const order = readModelStore.getOrder("order-456");
      expect(order?.status).toBe("FILLED");
      expect(order?.filledQty).toBe(100);
      expect(order?.avgPrice).toBe(250.0);
    });

    it("should remain in SUBMITTED state with partial fill", () => {
      // Place order for 100 shares
      const orderEvent: TradingEvent = {
        type: "OrderPlaced",
        payload: {
          orderId: "order-789",
          symbol: "NVDA",
          side: "BUY",
          quantity: 100,
          orderType: "LMT",
          limitPrice: 500.0,
          strategyId: "strat-1",
          timestamp: 1000,
        },
      };

      eventStore.publish(orderEvent);

      // Execute only 50 shares
      const execEvent: TradingEvent = {
        type: "ExecutionReceived",
        payload: {
          execId: "exec-1",
          orderId: "order-789",
          symbol: "NVDA",
          side: "BUY",
          lastShares: 50,
          lastPrice: 500.0,
          timestamp: 2000,
        },
      };

      eventStore.publish(execEvent);

      const order = readModelStore.getOrder("order-789");
      expect(order?.status).toBe("SUBMITTED");
      expect(order?.filledQty).toBe(50);
      expect(order?.originalQty).toBe(100);
    });
  });

  describe("average cost after partial fills", () => {
    it("should calculate correct average price after single execution", () => {
      const orderEvent: TradingEvent = {
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

      eventStore.publish(orderEvent);

      const execEvent: TradingEvent = {
        type: "ExecutionReceived",
        payload: {
          execId: "exec-1",
          orderId: "order-1",
          symbol: "AAPL",
          side: "BUY",
          lastShares: 100,
          lastPrice: 150.0,
          timestamp: 2000,
        },
      };

      eventStore.publish(execEvent);

      const order = readModelStore.getOrder("order-1");
      expect(order?.avgPrice).toBe(150.0);
      expect(order?.filledQty).toBe(100);
    });

    it("should calculate weighted average price after multiple partial fills", () => {
      const orderEvent: TradingEvent = {
        type: "OrderPlaced",
        payload: {
          orderId: "order-2",
          symbol: "AAPL",
          side: "BUY",
          quantity: 100,
          orderType: "MKT",
          strategyId: "strat-1",
          timestamp: 1000,
        },
      };

      eventStore.publish(orderEvent);

      // First partial fill: 50 shares at $150
      const exec1Event: TradingEvent = {
        type: "ExecutionReceived",
        payload: {
          execId: "exec-1",
          orderId: "order-2",
          symbol: "AAPL",
          side: "BUY",
          lastShares: 50,
          lastPrice: 150.0,
          timestamp: 2000,
        },
      };

      eventStore.publish(exec1Event);

      let order = readModelStore.getOrder("order-2");
      expect(order?.filledQty).toBe(50);
      expect(order?.avgPrice).toBe(150.0);

      // Second partial fill: 30 shares at $152
      const exec2Event: TradingEvent = {
        type: "ExecutionReceived",
        payload: {
          execId: "exec-2",
          orderId: "order-2",
          symbol: "AAPL",
          side: "BUY",
          lastShares: 30,
          lastPrice: 152.0,
          timestamp: 3000,
        },
      };

      eventStore.publish(exec2Event);

      order = readModelStore.getOrder("order-2");
      expect(order?.filledQty).toBe(80);
      // (50 * 150 + 30 * 152) / 80 = (7500 + 4560) / 80 = 150.75
      expect(order?.avgPrice).toBeCloseTo(150.75, 2);

      // Third partial fill: 20 shares at $148
      const exec3Event: TradingEvent = {
        type: "ExecutionReceived",
        payload: {
          execId: "exec-3",
          orderId: "order-2",
          symbol: "AAPL",
          side: "BUY",
          lastShares: 20,
          lastPrice: 148.0,
          timestamp: 4000,
        },
      };

      eventStore.publish(exec3Event);

      order = readModelStore.getOrder("order-2");
      expect(order?.filledQty).toBe(100);
      expect(order?.status).toBe("FILLED");
      // (50 * 150 + 30 * 152 + 20 * 148) / 100 = (7500 + 4560 + 2960) / 100 = 150.20
      expect(order?.avgPrice).toBeCloseTo(150.20, 2);
    });

    it("should handle different price levels in partial fills", () => {
      const orderEvent: TradingEvent = {
        type: "OrderPlaced",
        payload: {
          orderId: "order-3",
          symbol: "TSLA",
          side: "BUY",
          quantity: 200,
          orderType: "MKT",
          strategyId: "strat-1",
          timestamp: 1000,
        },
      };

      eventStore.publish(orderEvent);

      // Execute 100 shares at $250
      const exec1: TradingEvent = {
        type: "ExecutionReceived",
        payload: {
          execId: "exec-1",
          orderId: "order-3",
          symbol: "TSLA",
          side: "BUY",
          lastShares: 100,
          lastPrice: 250.0,
          timestamp: 2000,
        },
      };

      eventStore.publish(exec1);

      // Execute 100 shares at $260
      const exec2: TradingEvent = {
        type: "ExecutionReceived",
        payload: {
          execId: "exec-2",
          orderId: "order-3",
          symbol: "TSLA",
          side: "BUY",
          lastShares: 100,
          lastPrice: 260.0,
          timestamp: 3000,
        },
      };

      eventStore.publish(exec2);

      const order = readModelStore.getOrder("order-3");
      expect(order?.filledQty).toBe(200);
      expect(order?.status).toBe("FILLED");
      // (100 * 250 + 100 * 260) / 200 = 255
      expect(order?.avgPrice).toBe(255.0);
    });
  });

  describe("position netting on BUY-then-SELL", () => {
    it("should build long position on BUY", () => {
      const orderEvent: TradingEvent = {
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

      eventStore.publish(orderEvent);

      const execEvent: TradingEvent = {
        type: "ExecutionReceived",
        payload: {
          execId: "exec-1",
          orderId: "order-1",
          symbol: "AAPL",
          side: "BUY",
          lastShares: 100,
          lastPrice: 150.0,
          timestamp: 2000,
        },
      };

      eventStore.publish(execEvent);

      const position = readModelStore.getPosition("AAPL");
      expect(position).toBeDefined();
      expect(position?.qty).toBe(100);
      expect(position?.avgPrice).toBe(150.0);
    });

    it("should reduce long position on SELL", () => {
      // BUY 100 shares
      const buyOrderEvent: TradingEvent = {
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

      eventStore.publish(buyOrderEvent);

      const buyExecEvent: TradingEvent = {
        type: "ExecutionReceived",
        payload: {
          execId: "exec-1",
          orderId: "order-1",
          symbol: "AAPL",
          side: "BUY",
          lastShares: 100,
          lastPrice: 150.0,
          timestamp: 2000,
        },
      };

      eventStore.publish(buyExecEvent);

      let position = readModelStore.getPosition("AAPL");
      expect(position?.qty).toBe(100);

      // SELL 50 shares
      const sellOrderEvent: TradingEvent = {
        type: "OrderPlaced",
        payload: {
          orderId: "order-2",
          symbol: "AAPL",
          side: "SELL",
          quantity: 50,
          orderType: "MKT",
          strategyId: "strat-1",
          timestamp: 3000,
        },
      };

      eventStore.publish(sellOrderEvent);

      const sellExecEvent: TradingEvent = {
        type: "ExecutionReceived",
        payload: {
          execId: "exec-2",
          orderId: "order-2",
          symbol: "AAPL",
          side: "SELL",
          lastShares: 50,
          lastPrice: 155.0,
          timestamp: 4000,
        },
      };

      eventStore.publish(sellExecEvent);

      position = readModelStore.getPosition("AAPL");
      expect(position?.qty).toBe(50);
      // Average price should remain $150 (original cost basis)
      expect(position?.avgPrice).toBe(150.0);
    });

    it("should flatten position on equal BUY and SELL", () => {
      // BUY 100 shares
      const buyOrderEvent: TradingEvent = {
        type: "OrderPlaced",
        payload: {
          orderId: "order-1",
          symbol: "TSLA",
          side: "BUY",
          quantity: 100,
          orderType: "MKT",
          strategyId: "strat-1",
          timestamp: 1000,
        },
      };

      eventStore.publish(buyOrderEvent);

      const buyExecEvent: TradingEvent = {
        type: "ExecutionReceived",
        payload: {
          execId: "exec-1",
          orderId: "order-1",
          symbol: "TSLA",
          side: "BUY",
          lastShares: 100,
          lastPrice: 250.0,
          timestamp: 2000,
        },
      };

      eventStore.publish(buyExecEvent);

      // SELL 100 shares (flatten)
      const sellOrderEvent: TradingEvent = {
        type: "OrderPlaced",
        payload: {
          orderId: "order-2",
          symbol: "TSLA",
          side: "SELL",
          quantity: 100,
          orderType: "MKT",
          strategyId: "strat-1",
          timestamp: 3000,
        },
      };

      eventStore.publish(sellOrderEvent);

      const sellExecEvent: TradingEvent = {
        type: "ExecutionReceived",
        payload: {
          execId: "exec-2",
          orderId: "order-2",
          symbol: "TSLA",
          side: "SELL",
          lastShares: 100,
          lastPrice: 260.0,
          timestamp: 4000,
        },
      };

      eventStore.publish(sellExecEvent);

      const position = readModelStore.getPosition("TSLA");
      expect(position?.qty).toBe(0);
    });

    it("should create short position when SELL exceeds long position", () => {
      // BUY 50 shares
      const buyOrderEvent: TradingEvent = {
        type: "OrderPlaced",
        payload: {
          orderId: "order-1",
          symbol: "NVDA",
          side: "BUY",
          quantity: 50,
          orderType: "MKT",
          strategyId: "strat-1",
          timestamp: 1000,
        },
      };

      eventStore.publish(buyOrderEvent);

      const buyExecEvent: TradingEvent = {
        type: "ExecutionReceived",
        payload: {
          execId: "exec-1",
          orderId: "order-1",
          symbol: "NVDA",
          side: "BUY",
          lastShares: 50,
          lastPrice: 500.0,
          timestamp: 2000,
        },
      };

      eventStore.publish(buyExecEvent);

      let position = readModelStore.getPosition("NVDA");
      expect(position?.qty).toBe(50);

      // SELL 100 shares (close long and open short)
      const sellOrderEvent: TradingEvent = {
        type: "OrderPlaced",
        payload: {
          orderId: "order-2",
          symbol: "NVDA",
          side: "SELL",
          quantity: 100,
          orderType: "MKT",
          strategyId: "strat-1",
          timestamp: 3000,
        },
      };

      eventStore.publish(sellOrderEvent);

      const sellExecEvent: TradingEvent = {
        type: "ExecutionReceived",
        payload: {
          execId: "exec-2",
          orderId: "order-2",
          symbol: "NVDA",
          side: "SELL",
          lastShares: 100,
          lastPrice: 510.0,
          timestamp: 4000,
        },
      };

      eventStore.publish(sellExecEvent);

      position = readModelStore.getPosition("NVDA");
      expect(position?.qty).toBe(-50); // Short 50 shares
    });
  });

  describe("position netting on SELL-then-BUY", () => {
    it("should build short position on SELL from zero", () => {
      const sellOrderEvent: TradingEvent = {
        type: "OrderPlaced",
        payload: {
          orderId: "order-1",
          symbol: "SPY",
          side: "SELL",
          quantity: 100,
          orderType: "MKT",
          strategyId: "strat-1",
          timestamp: 1000,
        },
      };

      eventStore.publish(sellOrderEvent);

      const sellExecEvent: TradingEvent = {
        type: "ExecutionReceived",
        payload: {
          execId: "exec-1",
          orderId: "order-1",
          symbol: "SPY",
          side: "SELL",
          lastShares: 100,
          lastPrice: 450.0,
          timestamp: 2000,
        },
      };

      eventStore.publish(sellExecEvent);

      const position = readModelStore.getPosition("SPY");
      expect(position).toBeDefined();
      expect(position?.qty).toBe(-100);
      expect(position?.avgPrice).toBe(450.0);
    });

    it("should reduce short position on BUY", () => {
      // SELL 100 shares (open short)
      const sellOrderEvent: TradingEvent = {
        type: "OrderPlaced",
        payload: {
          orderId: "order-1",
          symbol: "QQQ",
          side: "SELL",
          quantity: 100,
          orderType: "MKT",
          strategyId: "strat-1",
          timestamp: 1000,
        },
      };

      eventStore.publish(sellOrderEvent);

      const sellExecEvent: TradingEvent = {
        type: "ExecutionReceived",
        payload: {
          execId: "exec-1",
          orderId: "order-1",
          symbol: "QQQ",
          side: "SELL",
          lastShares: 100,
          lastPrice: 400.0,
          timestamp: 2000,
        },
      };

      eventStore.publish(sellExecEvent);

      let position = readModelStore.getPosition("QQQ");
      expect(position?.qty).toBe(-100);

      // BUY 50 shares (cover part of short)
      const buyOrderEvent: TradingEvent = {
        type: "OrderPlaced",
        payload: {
          orderId: "order-2",
          symbol: "QQQ",
          side: "BUY",
          quantity: 50,
          orderType: "MKT",
          strategyId: "strat-1",
          timestamp: 3000,
        },
      };

      eventStore.publish(buyOrderEvent);

      const buyExecEvent: TradingEvent = {
        type: "ExecutionReceived",
        payload: {
          execId: "exec-2",
          orderId: "order-2",
          symbol: "QQQ",
          side: "BUY",
          lastShares: 50,
          lastPrice: 395.0,
          timestamp: 4000,
        },
      };

      eventStore.publish(buyExecEvent);

      position = readModelStore.getPosition("QQQ");
      expect(position?.qty).toBe(-50);
    });

    it("should flatten short position on equal SELL and BUY", () => {
      // SELL 100 shares
      const sellOrderEvent: TradingEvent = {
        type: "OrderPlaced",
        payload: {
          orderId: "order-1",
          symbol: "IWM",
          side: "SELL",
          quantity: 100,
          orderType: "MKT",
          strategyId: "strat-1",
          timestamp: 1000,
        },
      };

      eventStore.publish(sellOrderEvent);

      const sellExecEvent: TradingEvent = {
        type: "ExecutionReceived",
        payload: {
          execId: "exec-1",
          orderId: "order-1",
          symbol: "IWM",
          side: "SELL",
          lastShares: 100,
          lastPrice: 200.0,
          timestamp: 2000,
        },
      };

      eventStore.publish(sellExecEvent);

      // BUY 100 shares (cover short)
      const buyOrderEvent: TradingEvent = {
        type: "OrderPlaced",
        payload: {
          orderId: "order-2",
          symbol: "IWM",
          side: "BUY",
          quantity: 100,
          orderType: "MKT",
          strategyId: "strat-1",
          timestamp: 3000,
        },
      };

      eventStore.publish(buyOrderEvent);

      const buyExecEvent: TradingEvent = {
        type: "ExecutionReceived",
        payload: {
          execId: "exec-2",
          orderId: "order-2",
          symbol: "IWM",
          side: "BUY",
          lastShares: 100,
          lastPrice: 195.0,
          timestamp: 4000,
        },
      };

      eventStore.publish(buyExecEvent);

      const position = readModelStore.getPosition("IWM");
      expect(position?.qty).toBe(0);
    });
  });

  describe("regime shift updates", () => {
    it("should update system state on RegimeShifted event", () => {
      const regimeEvent: TradingEvent = {
        type: "RegimeShifted",
        payload: {
          prevRegime: "NEUTRAL",
          newRegime: "BULLISH",
          confidence: 0.85,
          timestamp: Date.now(),
        },
      };

      eventStore.publish(regimeEvent);

      const systemState = readModelStore.getSystemState();
      expect(systemState.currentRegime).toBe("BULLISH");
      expect(systemState.regimeConfidence).toBe(0.85);
    });

    it("should handle multiple regime shifts", () => {
      const regime1: TradingEvent = {
        type: "RegimeShifted",
        payload: {
          prevRegime: "NEUTRAL",
          newRegime: "BULLISH",
          confidence: 0.80,
          timestamp: 1000,
        },
      };

      eventStore.publish(regime1);

      let systemState = readModelStore.getSystemState();
      expect(systemState.currentRegime).toBe("BULLISH");
      expect(systemState.regimeConfidence).toBe(0.80);

      const regime2: TradingEvent = {
        type: "RegimeShifted",
        payload: {
          prevRegime: "BULLISH",
          newRegime: "BEARISH",
          confidence: 0.75,
          timestamp: 2000,
        },
      };

      eventStore.publish(regime2);

      systemState = readModelStore.getSystemState();
      expect(systemState.currentRegime).toBe("BEARISH");
      expect(systemState.regimeConfidence).toBe(0.75);
    });
  });

  describe("risk breach counter", () => {
    it("should increment risk breach counter on RiskLimitBreached event", () => {
      const initialState = readModelStore.getSystemState();
      expect(initialState.riskBreaches).toBe(0);

      const riskEvent: TradingEvent = {
        type: "RiskLimitBreached",
        payload: {
          ruleId: "max-position-size",
          currentValue: 10000,
          limitValue: 5000,
          symbol: "AAPL",
          timestamp: Date.now(),
        },
      };

      eventStore.publish(riskEvent);

      const updatedState = readModelStore.getSystemState();
      expect(updatedState.riskBreaches).toBe(1);
    });

    it("should count multiple risk breaches", () => {
      const breach1: TradingEvent = {
        type: "RiskLimitBreached",
        payload: {
          ruleId: "max-position-size",
          currentValue: 10000,
          limitValue: 5000,
          timestamp: 1000,
        },
      };

      const breach2: TradingEvent = {
        type: "RiskLimitBreached",
        payload: {
          ruleId: "max-drawdown",
          currentValue: -5000,
          limitValue: -2000,
          timestamp: 2000,
        },
      };

      const breach3: TradingEvent = {
        type: "RiskLimitBreached",
        payload: {
          ruleId: "max-leverage",
          currentValue: 3.5,
          limitValue: 2.0,
          timestamp: 3000,
        },
      };

      eventStore.publish(breach1);
      eventStore.publish(breach2);
      eventStore.publish(breach3);

      const systemState = readModelStore.getSystemState();
      expect(systemState.riskBreaches).toBe(3);
    });
  });

  describe("replay on startup", () => {
    it("should hydrate state from events on construction", () => {
      // Publish events before creating ReadModelStore
      const orderEvent: TradingEvent = {
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

      eventStore.publish(orderEvent);

      const execEvent: TradingEvent = {
        type: "ExecutionReceived",
        payload: {
          execId: "exec-1",
          orderId: "order-1",
          symbol: "AAPL",
          side: "BUY",
          lastShares: 100,
          lastPrice: 150.0,
          timestamp: 2000,
        },
      };

      eventStore.publish(execEvent);

      // Create new ReadModelStore (should replay events)
      const newReadModelStore = new ReadModelStore(eventStore);

      const order = newReadModelStore.getOrder("order-1");
      expect(order).toBeDefined();
      expect(order?.status).toBe("FILLED");
      expect(order?.filledQty).toBe(100);
      expect(order?.avgPrice).toBe(150.0);

      const position = newReadModelStore.getPosition("AAPL");
      expect(position).toBeDefined();
      expect(position?.qty).toBe(100);
      expect(position?.avgPrice).toBe(150.0);
    });

    it("should handle complex state reconstruction on replay", () => {
      // Publish multiple orders and executions
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
          type: "ExecutionReceived",
          payload: {
            execId: "exec-1",
            orderId: "order-1",
            symbol: "AAPL",
            side: "BUY",
            lastShares: 100,
            lastPrice: 150.0,
            timestamp: 2000,
          },
        },
        {
          type: "OrderPlaced",
          payload: {
            orderId: "order-2",
            symbol: "TSLA",
            side: "BUY",
            quantity: 50,
            orderType: "MKT",
            strategyId: "strat-1",
            timestamp: 3000,
          },
        },
        {
          type: "ExecutionReceived",
          payload: {
            execId: "exec-2",
            orderId: "order-2",
            symbol: "TSLA",
            side: "BUY",
            lastShares: 25,
            lastPrice: 250.0,
            timestamp: 4000,
          },
        },
        {
          type: "RegimeShifted",
          payload: {
            prevRegime: "NEUTRAL",
            newRegime: "BULLISH",
            confidence: 0.85,
            timestamp: 5000,
          },
        },
        {
          type: "RiskLimitBreached",
          payload: {
            ruleId: "max-exposure",
            currentValue: 50000,
            limitValue: 40000,
            timestamp: 6000,
          },
        },
      ];

      events.forEach((event) => eventStore.publish(event));

      // Create new ReadModelStore (should replay all events)
      const newReadModelStore = new ReadModelStore(eventStore);

      const order1 = newReadModelStore.getOrder("order-1");
      expect(order1?.status).toBe("FILLED");

      const order2 = newReadModelStore.getOrder("order-2");
      expect(order2?.status).toBe("SUBMITTED");
      expect(order2?.filledQty).toBe(25);

      const aaplPosition = newReadModelStore.getPosition("AAPL");
      expect(aaplPosition?.qty).toBe(100);

      const tslaPosition = newReadModelStore.getPosition("TSLA");
      expect(tslaPosition?.qty).toBe(25);

      const systemState = newReadModelStore.getSystemState();
      expect(systemState.currentRegime).toBe("BULLISH");
      expect(systemState.riskBreaches).toBe(1);
    });
  });
});
