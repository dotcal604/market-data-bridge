import { describe, it, expect, beforeEach } from 'vitest';
import { EventStore } from '../event-store.js';
import { ReadModelStore, type OrderState, type PositionState, type SystemState } from '../read-models.js';
import type { TradingEvent } from '../event-store.js';

describe('ReadModelStore', () => {
  let eventStore: EventStore;
  let readModelStore: ReadModelStore;

  beforeEach(() => {
    // Create fresh EventStore and ReadModelStore for each test
    eventStore = new EventStore(':memory:');
    
    // Create ReadModelStore without singleton - use Object.create for DI testing
    readModelStore = Object.create(ReadModelStore.prototype);
    (readModelStore as any).orders = new Map();
    (readModelStore as any).positions = new Map();
    (readModelStore as any).system = {
      currentRegime: 'NEUTRAL',
      regimeConfidence: 0.0,
      riskBreaches: 0,
    };

    // Subscribe the read model to the event store
    eventStore.subscribe((readModelStore as any).applyEvent.bind(readModelStore));
  });

  describe('Order Book Tracking', () => {
    it('should track order state when OrderPlaced event is published', () => {
      const event: TradingEvent = {
        type: 'OrderPlaced',
        payload: {
          orderId: 'order-1',
          symbol: 'AAPL',
          side: 'BUY',
          quantity: 100,
          orderType: 'MKT',
          strategyId: 'strat-1',
          timestamp: 1000,
        },
      };

      eventStore.publish(event);

      const order = readModelStore.getOrder('order-1');
      expect(order).toBeDefined();
      expect(order!.orderId).toBe('order-1');
      expect(order!.symbol).toBe('AAPL');
      expect(order!.side).toBe('BUY');
      expect(order!.originalQty).toBe(100);
      expect(order!.filledQty).toBe(0);
      expect(order!.avgPrice).toBe(0);
      expect(order!.status).toBe('SUBMITTED');
      expect(order!.lastUpdated).toBe(1000);
    });

    it('should update order state when ExecutionReceived event is published', () => {
      // Place order first
      eventStore.publish({
        type: 'OrderPlaced',
        payload: {
          orderId: 'order-2',
          symbol: 'TSLA',
          side: 'BUY',
          quantity: 100,
          orderType: 'MKT',
          strategyId: 'strat-1',
          timestamp: 1000,
        },
      });

      // Partial execution
      eventStore.publish({
        type: 'ExecutionReceived',
        payload: {
          execId: 'exec-1',
          orderId: 'order-2',
          symbol: 'TSLA',
          side: 'BUY',
          lastShares: 60,
          lastPrice: 250.00,
          timestamp: 2000,
        },
      });

      const order = readModelStore.getOrder('order-2');
      expect(order).toBeDefined();
      expect(order!.filledQty).toBe(60);
      expect(order!.avgPrice).toBe(250.00);
      expect(order!.status).toBe('SUBMITTED'); // Not fully filled yet
      expect(order!.lastUpdated).toBe(2000);
    });

    it('should calculate weighted average fill price across multiple executions', () => {
      // Place order
      eventStore.publish({
        type: 'OrderPlaced',
        payload: {
          orderId: 'order-avg',
          symbol: 'NVDA',
          side: 'BUY',
          quantity: 100,
          orderType: 'MKT',
          strategyId: 'strat-1',
          timestamp: 1000,
        },
      });

      // First execution: 60 shares @ $500
      eventStore.publish({
        type: 'ExecutionReceived',
        payload: {
          execId: 'exec-1',
          orderId: 'order-avg',
          symbol: 'NVDA',
          side: 'BUY',
          lastShares: 60,
          lastPrice: 500.00,
          timestamp: 2000,
        },
      });

      // Second execution: 40 shares @ $510
      eventStore.publish({
        type: 'ExecutionReceived',
        payload: {
          execId: 'exec-2',
          orderId: 'order-avg',
          symbol: 'NVDA',
          side: 'BUY',
          lastShares: 40,
          lastPrice: 510.00,
          timestamp: 3000,
        },
      });

      const order = readModelStore.getOrder('order-avg');
      expect(order).toBeDefined();
      expect(order!.filledQty).toBe(100);
      
      // Weighted avg: (60 * 500 + 40 * 510) / 100 = 504
      expect(order!.avgPrice).toBe(504.00);
      expect(order!.status).toBe('FILLED');
    });

    it('should mark order as FILLED when filledQty reaches originalQty', () => {
      eventStore.publish({
        type: 'OrderPlaced',
        payload: {
          orderId: 'order-filled',
          symbol: 'AMD',
          side: 'SELL',
          quantity: 50,
          orderType: 'MKT',
          strategyId: 'strat-1',
          timestamp: 1000,
        },
      });

      eventStore.publish({
        type: 'ExecutionReceived',
        payload: {
          execId: 'exec-full',
          orderId: 'order-filled',
          symbol: 'AMD',
          side: 'SELL',
          lastShares: 50,
          lastPrice: 100.00,
          timestamp: 2000,
        },
      });

      const order = readModelStore.getOrder('order-filled');
      expect(order).toBeDefined();
      expect(order!.status).toBe('FILLED');
      expect(order!.filledQty).toBe(50);
    });

    it('should handle execution for non-existent order gracefully', () => {
      // This shouldn't crash - just no-op
      eventStore.publish({
        type: 'ExecutionReceived',
        payload: {
          execId: 'exec-orphan',
          orderId: 'non-existent-order',
          symbol: 'AAPL',
          side: 'BUY',
          lastShares: 100,
          lastPrice: 150.00,
          timestamp: 1000,
        },
      });

      const order = readModelStore.getOrder('non-existent-order');
      expect(order).toBeUndefined();
    });
  });

  describe('Position Tracking and Weighted Average Price', () => {
    it('should create new long position when BUY execution received', () => {
      eventStore.publish({
        type: 'OrderPlaced',
        payload: {
          orderId: 'order-long',
          symbol: 'AAPL',
          side: 'BUY',
          quantity: 100,
          orderType: 'MKT',
          strategyId: 'strat-1',
          timestamp: 1000,
        },
      });

      eventStore.publish({
        type: 'ExecutionReceived',
        payload: {
          execId: 'exec-long',
          orderId: 'order-long',
          symbol: 'AAPL',
          side: 'BUY',
          lastShares: 100,
          lastPrice: 150.00,
          timestamp: 2000,
        },
      });

      const position = readModelStore.getPosition('AAPL');
      expect(position).toBeDefined();
      expect(position!.symbol).toBe('AAPL');
      expect(position!.qty).toBe(100);
      expect(position!.avgPrice).toBe(150.00);
      expect(position!.realizedPnl).toBe(0);
    });

    it('should create new short position when SELL execution received', () => {
      eventStore.publish({
        type: 'OrderPlaced',
        payload: {
          orderId: 'order-short',
          symbol: 'TSLA',
          side: 'SELL',
          quantity: 50,
          orderType: 'MKT',
          strategyId: 'strat-1',
          timestamp: 1000,
        },
      });

      eventStore.publish({
        type: 'ExecutionReceived',
        payload: {
          execId: 'exec-short',
          orderId: 'order-short',
          symbol: 'TSLA',
          side: 'SELL',
          lastShares: 50,
          lastPrice: 250.00,
          timestamp: 2000,
        },
      });

      const position = readModelStore.getPosition('TSLA');
      expect(position).toBeDefined();
      expect(position!.qty).toBe(-50);
      expect(position!.avgPrice).toBe(250.00);
      expect(position!.realizedPnl).toBe(0);
    });

    it('should add to existing long position with weighted average', () => {
      // First BUY: 100 @ $150
      eventStore.publish({
        type: 'OrderPlaced',
        payload: {
          orderId: 'order-1',
          symbol: 'AAPL',
          side: 'BUY',
          quantity: 100,
          orderType: 'MKT',
          strategyId: 'strat-1',
          timestamp: 1000,
        },
      });

      eventStore.publish({
        type: 'ExecutionReceived',
        payload: {
          execId: 'exec-1',
          orderId: 'order-1',
          symbol: 'AAPL',
          side: 'BUY',
          lastShares: 100,
          lastPrice: 150.00,
          timestamp: 2000,
        },
      });

      // Second BUY: 50 @ $160
      eventStore.publish({
        type: 'OrderPlaced',
        payload: {
          orderId: 'order-2',
          symbol: 'AAPL',
          side: 'BUY',
          quantity: 50,
          orderType: 'MKT',
          strategyId: 'strat-1',
          timestamp: 3000,
        },
      });

      eventStore.publish({
        type: 'ExecutionReceived',
        payload: {
          execId: 'exec-2',
          orderId: 'order-2',
          symbol: 'AAPL',
          side: 'BUY',
          lastShares: 50,
          lastPrice: 160.00,
          timestamp: 4000,
        },
      });

      const position = readModelStore.getPosition('AAPL');
      expect(position).toBeDefined();
      expect(position!.qty).toBe(150);
      
      // Weighted avg: (100 * 150 + 50 * 160) / 150 = 153.33
      expect(position!.avgPrice).toBeCloseTo(153.33, 2);
      expect(position!.realizedPnl).toBe(0);
    });

    it('should add to existing short position with weighted average', () => {
      // First SELL: 100 @ $500
      eventStore.publish({
        type: 'OrderPlaced',
        payload: {
          orderId: 'order-1',
          symbol: 'NVDA',
          side: 'SELL',
          quantity: 100,
          orderType: 'MKT',
          strategyId: 'strat-1',
          timestamp: 1000,
        },
      });

      eventStore.publish({
        type: 'ExecutionReceived',
        payload: {
          execId: 'exec-1',
          orderId: 'order-1',
          symbol: 'NVDA',
          side: 'SELL',
          lastShares: 100,
          lastPrice: 500.00,
          timestamp: 2000,
        },
      });

      // Second SELL: 50 @ $490
      eventStore.publish({
        type: 'OrderPlaced',
        payload: {
          orderId: 'order-2',
          symbol: 'NVDA',
          side: 'SELL',
          quantity: 50,
          orderType: 'MKT',
          strategyId: 'strat-1',
          timestamp: 3000,
        },
      });

      eventStore.publish({
        type: 'ExecutionReceived',
        payload: {
          execId: 'exec-2',
          orderId: 'order-2',
          symbol: 'NVDA',
          side: 'SELL',
          lastShares: 50,
          lastPrice: 490.00,
          timestamp: 4000,
        },
      });

      const position = readModelStore.getPosition('NVDA');
      expect(position).toBeDefined();
      expect(position!.qty).toBe(-150);
      
      // Weighted avg: (100 * 500 + 50 * 490) / 150 = 496.67
      expect(position!.avgPrice).toBeCloseTo(496.67, 2);
      expect(position!.realizedPnl).toBe(0);
    });
  });

  describe('Position Netting - Partial Close', () => {
    it('should partially close long position and calculate realized PnL', () => {
      // Build long position: BUY 100 @ $150
      eventStore.publish({
        type: 'OrderPlaced',
        payload: {
          orderId: 'order-long',
          symbol: 'AAPL',
          side: 'BUY',
          quantity: 100,
          orderType: 'MKT',
          strategyId: 'strat-1',
          timestamp: 1000,
        },
      });

      eventStore.publish({
        type: 'ExecutionReceived',
        payload: {
          execId: 'exec-long',
          orderId: 'order-long',
          symbol: 'AAPL',
          side: 'BUY',
          lastShares: 100,
          lastPrice: 150.00,
          timestamp: 2000,
        },
      });

      // Partially close: SELL 60 @ $155
      eventStore.publish({
        type: 'OrderPlaced',
        payload: {
          orderId: 'order-close',
          symbol: 'AAPL',
          side: 'SELL',
          quantity: 60,
          orderType: 'MKT',
          strategyId: 'strat-1',
          timestamp: 3000,
        },
      });

      eventStore.publish({
        type: 'ExecutionReceived',
        payload: {
          execId: 'exec-close',
          orderId: 'order-close',
          symbol: 'AAPL',
          side: 'SELL',
          lastShares: 60,
          lastPrice: 155.00,
          timestamp: 4000,
        },
      });

      const position = readModelStore.getPosition('AAPL');
      expect(position).toBeDefined();
      expect(position!.qty).toBe(40); // 100 - 60
      expect(position!.avgPrice).toBe(150.00); // Remains same for remaining shares
      // realizedPnl = 60 * (155 - 150) = 300
      expect(position!.realizedPnl).toBe(300);
    });

    it('should partially close short position and calculate realized PnL', () => {
      // Build short position: SELL 100 @ $500
      eventStore.publish({
        type: 'OrderPlaced',
        payload: {
          orderId: 'order-short',
          symbol: 'NVDA',
          side: 'SELL',
          quantity: 100,
          orderType: 'MKT',
          strategyId: 'strat-1',
          timestamp: 1000,
        },
      });

      eventStore.publish({
        type: 'ExecutionReceived',
        payload: {
          execId: 'exec-short',
          orderId: 'order-short',
          symbol: 'NVDA',
          side: 'SELL',
          lastShares: 100,
          lastPrice: 500.00,
          timestamp: 2000,
        },
      });

      // Partially cover: BUY 40 @ $490
      eventStore.publish({
        type: 'OrderPlaced',
        payload: {
          orderId: 'order-cover',
          symbol: 'NVDA',
          side: 'BUY',
          quantity: 40,
          orderType: 'MKT',
          strategyId: 'strat-1',
          timestamp: 3000,
        },
      });

      eventStore.publish({
        type: 'ExecutionReceived',
        payload: {
          execId: 'exec-cover',
          orderId: 'order-cover',
          symbol: 'NVDA',
          side: 'BUY',
          lastShares: 40,
          lastPrice: 490.00,
          timestamp: 4000,
        },
      });

      const position = readModelStore.getPosition('NVDA');
      expect(position).toBeDefined();
      expect(position!.qty).toBe(-60); // -100 + 40
      expect(position!.avgPrice).toBe(500.00); // Remains same for remaining shares
      // realizedPnl for short = 40 * (500 - 490) = 400
      expect(position!.realizedPnl).toBe(400);
    });
  });

  describe('Position Netting - Full Close', () => {
    it('should fully close long position and reset avgPrice to 0', () => {
      // Build long position: BUY 50 @ $200
      eventStore.publish({
        type: 'OrderPlaced',
        payload: {
          orderId: 'order-long',
          symbol: 'TSLA',
          side: 'BUY',
          quantity: 50,
          orderType: 'MKT',
          strategyId: 'strat-1',
          timestamp: 1000,
        },
      });

      eventStore.publish({
        type: 'ExecutionReceived',
        payload: {
          execId: 'exec-long',
          orderId: 'order-long',
          symbol: 'TSLA',
          side: 'BUY',
          lastShares: 50,
          lastPrice: 200.00,
          timestamp: 2000,
        },
      });

      // Fully close: SELL 50 @ $210
      eventStore.publish({
        type: 'OrderPlaced',
        payload: {
          orderId: 'order-close',
          symbol: 'TSLA',
          side: 'SELL',
          quantity: 50,
          orderType: 'MKT',
          strategyId: 'strat-1',
          timestamp: 3000,
        },
      });

      eventStore.publish({
        type: 'ExecutionReceived',
        payload: {
          execId: 'exec-close',
          orderId: 'order-close',
          symbol: 'TSLA',
          side: 'SELL',
          lastShares: 50,
          lastPrice: 210.00,
          timestamp: 4000,
        },
      });

      const position = readModelStore.getPosition('TSLA');
      expect(position).toBeDefined();
      expect(position!.qty).toBe(0);
      expect(position!.avgPrice).toBe(0); // Reset when flat
      // realizedPnl = 50 * (210 - 200) = 500
      expect(position!.realizedPnl).toBe(500);
    });

    it('should fully close short position and reset avgPrice to 0', () => {
      // Build short position: SELL 80 @ $100
      eventStore.publish({
        type: 'OrderPlaced',
        payload: {
          orderId: 'order-short',
          symbol: 'AMD',
          side: 'SELL',
          quantity: 80,
          orderType: 'MKT',
          strategyId: 'strat-1',
          timestamp: 1000,
        },
      });

      eventStore.publish({
        type: 'ExecutionReceived',
        payload: {
          execId: 'exec-short',
          orderId: 'order-short',
          symbol: 'AMD',
          side: 'SELL',
          lastShares: 80,
          lastPrice: 100.00,
          timestamp: 2000,
        },
      });

      // Fully cover: BUY 80 @ $95
      eventStore.publish({
        type: 'OrderPlaced',
        payload: {
          orderId: 'order-cover',
          symbol: 'AMD',
          side: 'BUY',
          quantity: 80,
          orderType: 'MKT',
          strategyId: 'strat-1',
          timestamp: 3000,
        },
      });

      eventStore.publish({
        type: 'ExecutionReceived',
        payload: {
          execId: 'exec-cover',
          orderId: 'order-cover',
          symbol: 'AMD',
          side: 'BUY',
          lastShares: 80,
          lastPrice: 95.00,
          timestamp: 4000,
        },
      });

      const position = readModelStore.getPosition('AMD');
      expect(position).toBeDefined();
      expect(position!.qty).toBe(0);
      expect(position!.avgPrice).toBe(0); // Reset when flat
      // realizedPnl for short = 80 * (100 - 95) = 400
      expect(position!.realizedPnl).toBe(400);
    });
  });

  describe('Position Netting - Flip Through Zero', () => {
    it('should flip from long to short and set new avgPrice', () => {
      // Build long position: BUY 50 @ $300
      eventStore.publish({
        type: 'OrderPlaced',
        payload: {
          orderId: 'order-long',
          symbol: 'MSFT',
          side: 'BUY',
          quantity: 50,
          orderType: 'MKT',
          strategyId: 'strat-1',
          timestamp: 1000,
        },
      });

      eventStore.publish({
        type: 'ExecutionReceived',
        payload: {
          execId: 'exec-long',
          orderId: 'order-long',
          symbol: 'MSFT',
          side: 'BUY',
          lastShares: 50,
          lastPrice: 300.00,
          timestamp: 2000,
        },
      });

      // Flip to short: SELL 80 @ $310 (closes 50, then shorts 30)
      eventStore.publish({
        type: 'OrderPlaced',
        payload: {
          orderId: 'order-flip',
          symbol: 'MSFT',
          side: 'SELL',
          quantity: 80,
          orderType: 'MKT',
          strategyId: 'strat-1',
          timestamp: 3000,
        },
      });

      eventStore.publish({
        type: 'ExecutionReceived',
        payload: {
          execId: 'exec-flip',
          orderId: 'order-flip',
          symbol: 'MSFT',
          side: 'SELL',
          lastShares: 80,
          lastPrice: 310.00,
          timestamp: 4000,
        },
      });

      const position = readModelStore.getPosition('MSFT');
      expect(position).toBeDefined();
      expect(position!.qty).toBe(-30); // 50 - 80
      expect(position!.avgPrice).toBe(310.00); // New short position at 310
      // realizedPnl = 50 * (310 - 300) = 500
      expect(position!.realizedPnl).toBe(500);
    });

    it('should flip from short to long and set new avgPrice', () => {
      // Build short position: SELL 60 @ $140
      eventStore.publish({
        type: 'OrderPlaced',
        payload: {
          orderId: 'order-short',
          symbol: 'GOOGL',
          side: 'SELL',
          quantity: 60,
          orderType: 'MKT',
          strategyId: 'strat-1',
          timestamp: 1000,
        },
      });

      eventStore.publish({
        type: 'ExecutionReceived',
        payload: {
          execId: 'exec-short',
          orderId: 'order-short',
          symbol: 'GOOGL',
          side: 'SELL',
          lastShares: 60,
          lastPrice: 140.00,
          timestamp: 2000,
        },
      });

      // Flip to long: BUY 100 @ $135 (covers 60, then longs 40)
      eventStore.publish({
        type: 'OrderPlaced',
        payload: {
          orderId: 'order-flip',
          symbol: 'GOOGL',
          side: 'BUY',
          quantity: 100,
          orderType: 'MKT',
          strategyId: 'strat-1',
          timestamp: 3000,
        },
      });

      eventStore.publish({
        type: 'ExecutionReceived',
        payload: {
          execId: 'exec-flip',
          orderId: 'order-flip',
          symbol: 'GOOGL',
          side: 'BUY',
          lastShares: 100,
          lastPrice: 135.00,
          timestamp: 4000,
        },
      });

      const position = readModelStore.getPosition('GOOGL');
      expect(position).toBeDefined();
      expect(position!.qty).toBe(40); // -60 + 100
      expect(position!.avgPrice).toBe(135.00); // New long position at 135
      // realizedPnl for short = 60 * (140 - 135) = 300
      expect(position!.realizedPnl).toBe(300);
    });

    it('should accumulate realized PnL across multiple trades', () => {
      const symbol = 'SPY';

      // Trade 1: BUY 100 @ $400
      eventStore.publish({
        type: 'OrderPlaced',
        payload: {
          orderId: 'order-1',
          symbol,
          side: 'BUY',
          quantity: 100,
          orderType: 'MKT',
          strategyId: 'strat-1',
          timestamp: 1000,
        },
      });

      eventStore.publish({
        type: 'ExecutionReceived',
        payload: {
          execId: 'exec-1',
          orderId: 'order-1',
          symbol,
          side: 'BUY',
          lastShares: 100,
          lastPrice: 400.00,
          timestamp: 2000,
        },
      });

      // Trade 2: SELL 50 @ $410 (partial close, +500 PnL)
      eventStore.publish({
        type: 'OrderPlaced',
        payload: {
          orderId: 'order-2',
          symbol,
          side: 'SELL',
          quantity: 50,
          orderType: 'MKT',
          strategyId: 'strat-1',
          timestamp: 3000,
        },
      });

      eventStore.publish({
        type: 'ExecutionReceived',
        payload: {
          execId: 'exec-2',
          orderId: 'order-2',
          symbol,
          side: 'SELL',
          lastShares: 50,
          lastPrice: 410.00,
          timestamp: 4000,
        },
      });

      let position = readModelStore.getPosition(symbol);
      expect(position!.qty).toBe(50);
      expect(position!.realizedPnl).toBe(500);

      // Trade 3: SELL 50 @ $405 (full close, +250 PnL)
      eventStore.publish({
        type: 'OrderPlaced',
        payload: {
          orderId: 'order-3',
          symbol,
          side: 'SELL',
          quantity: 50,
          orderType: 'MKT',
          strategyId: 'strat-1',
          timestamp: 5000,
        },
      });

      eventStore.publish({
        type: 'ExecutionReceived',
        payload: {
          execId: 'exec-3',
          orderId: 'order-3',
          symbol,
          side: 'SELL',
          lastShares: 50,
          lastPrice: 405.00,
          timestamp: 6000,
        },
      });

      position = readModelStore.getPosition(symbol);
      expect(position!.qty).toBe(0);
      expect(position!.avgPrice).toBe(0);
      expect(position!.realizedPnl).toBe(750); // 500 + 250
    });

    it('should handle loss scenarios correctly', () => {
      // BUY 100 @ $300
      eventStore.publish({
        type: 'OrderPlaced',
        payload: {
          orderId: 'order-loss',
          symbol: 'META',
          side: 'BUY',
          quantity: 100,
          orderType: 'MKT',
          strategyId: 'strat-1',
          timestamp: 1000,
        },
      });

      eventStore.publish({
        type: 'ExecutionReceived',
        payload: {
          execId: 'exec-loss',
          orderId: 'order-loss',
          symbol: 'META',
          side: 'BUY',
          lastShares: 100,
          lastPrice: 300.00,
          timestamp: 2000,
        },
      });

      // SELL 100 @ $290 (loss)
      eventStore.publish({
        type: 'OrderPlaced',
        payload: {
          orderId: 'order-close',
          symbol: 'META',
          side: 'SELL',
          quantity: 100,
          orderType: 'MKT',
          strategyId: 'strat-1',
          timestamp: 3000,
        },
      });

      eventStore.publish({
        type: 'ExecutionReceived',
        payload: {
          execId: 'exec-close',
          orderId: 'order-close',
          symbol: 'META',
          side: 'SELL',
          lastShares: 100,
          lastPrice: 290.00,
          timestamp: 4000,
        },
      });

      const position = readModelStore.getPosition('META');
      expect(position).toBeDefined();
      expect(position!.qty).toBe(0);
      expect(position!.realizedPnl).toBe(-1000); // 100 * (290 - 300)
    });
  });

  describe('System State Updates', () => {
    it('should update system state when RiskLimitBreached event is published', () => {
      eventStore.publish({
        type: 'RiskLimitBreached',
        payload: {
          ruleId: 'max-position',
          currentValue: 150000,
          limitValue: 100000,
          timestamp: Date.now(),
        },
      });

      const systemState = readModelStore.getSystemState();
      expect(systemState.riskBreaches).toBe(1);
    });

    it('should increment risk breaches counter for multiple breaches', () => {
      eventStore.publish({
        type: 'RiskLimitBreached',
        payload: {
          ruleId: 'max-position',
          currentValue: 150000,
          limitValue: 100000,
          timestamp: 1000,
        },
      });

      eventStore.publish({
        type: 'RiskLimitBreached',
        payload: {
          ruleId: 'max-loss',
          currentValue: -5000,
          limitValue: -2000,
          timestamp: 2000,
        },
      });

      eventStore.publish({
        type: 'RiskLimitBreached',
        payload: {
          ruleId: 'concentration',
          currentValue: 0.8,
          limitValue: 0.5,
          timestamp: 3000,
        },
      });

      const systemState = readModelStore.getSystemState();
      expect(systemState.riskBreaches).toBe(3);
    });

    it('should update regime when RegimeShifted event is published', () => {
      eventStore.publish({
        type: 'RegimeShifted',
        payload: {
          prevRegime: 'NEUTRAL',
          newRegime: 'BULLISH',
          confidence: 0.85,
          timestamp: Date.now(),
        },
      });

      const systemState = readModelStore.getSystemState();
      expect(systemState.currentRegime).toBe('BULLISH');
      expect(systemState.regimeConfidence).toBe(0.85);
    });

    it('should update regime multiple times', () => {
      eventStore.publish({
        type: 'RegimeShifted',
        payload: {
          prevRegime: 'NEUTRAL',
          newRegime: 'BULLISH',
          confidence: 0.85,
          timestamp: 1000,
        },
      });

      eventStore.publish({
        type: 'RegimeShifted',
        payload: {
          prevRegime: 'BULLISH',
          newRegime: 'BEARISH',
          confidence: 0.75,
          timestamp: 2000,
        },
      });

      eventStore.publish({
        type: 'RegimeShifted',
        payload: {
          prevRegime: 'BEARISH',
          newRegime: 'NEUTRAL',
          confidence: 0.90,
          timestamp: 3000,
        },
      });

      const systemState = readModelStore.getSystemState();
      expect(systemState.currentRegime).toBe('NEUTRAL');
      expect(systemState.regimeConfidence).toBe(0.90);
      expect(systemState.riskBreaches).toBe(0);
    });

    it('should maintain independent state for system attributes', () => {
      // Breach risk limits
      eventStore.publish({
        type: 'RiskLimitBreached',
        payload: {
          ruleId: 'test-rule',
          currentValue: 100,
          limitValue: 50,
          timestamp: 1000,
        },
      });

      // Shift regime
      eventStore.publish({
        type: 'RegimeShifted',
        payload: {
          prevRegime: 'NEUTRAL',
          newRegime: 'VOLATILE',
          confidence: 0.70,
          timestamp: 2000,
        },
      });

      const systemState = readModelStore.getSystemState();
      expect(systemState.riskBreaches).toBe(1);
      expect(systemState.currentRegime).toBe('VOLATILE');
      expect(systemState.regimeConfidence).toBe(0.70);
    });
  });

  describe('getAllPositions', () => {
    it('should return all positions', () => {
      // Create multiple positions
      const symbols = ['AAPL', 'TSLA', 'NVDA'];
      
      symbols.forEach((symbol, index) => {
        eventStore.publish({
          type: 'OrderPlaced',
          payload: {
            orderId: `order-${symbol}`,
            symbol,
            side: 'BUY',
            quantity: 100,
            orderType: 'MKT',
            strategyId: 'strat-1',
            timestamp: 1000 + index,
          },
        });

        eventStore.publish({
          type: 'ExecutionReceived',
          payload: {
            execId: `exec-${symbol}`,
            orderId: `order-${symbol}`,
            symbol,
            side: 'BUY',
            lastShares: 100,
            lastPrice: 150.00 + (index * 50),
            timestamp: 2000 + index,
          },
        });
      });

      const positions = readModelStore.getAllPositions();
      expect(positions).toHaveLength(3);
      
      const symbolsInPositions = positions.map(p => p.symbol).sort();
      expect(symbolsInPositions).toEqual(['AAPL', 'NVDA', 'TSLA']);
    });

    it('should return empty array when no positions exist', () => {
      const positions = readModelStore.getAllPositions();
      expect(positions).toEqual([]);
    });
  });

  describe('Event Replay and State Reconstruction', () => {
    it('should reconstruct state from replayed events', () => {
      // Publish events to EventStore
      const events: TradingEvent[] = [
        {
          type: 'OrderPlaced',
          payload: {
            orderId: 'order-1',
            symbol: 'AAPL',
            side: 'BUY',
            quantity: 100,
            orderType: 'MKT',
            strategyId: 'strat-1',
            timestamp: 1000,
          },
        },
        {
          type: 'ExecutionReceived',
          payload: {
            execId: 'exec-1',
            orderId: 'order-1',
            symbol: 'AAPL',
            side: 'BUY',
            lastShares: 100,
            lastPrice: 150.00,
            timestamp: 2000,
          },
        },
        {
          type: 'RegimeShifted',
          payload: {
            prevRegime: 'NEUTRAL',
            newRegime: 'BULLISH',
            confidence: 0.85,
            timestamp: 3000,
          },
        },
        {
          type: 'RiskLimitBreached',
          payload: {
            ruleId: 'max-loss',
            currentValue: -5000,
            limitValue: -2000,
            timestamp: 4000,
          },
        },
      ];

      events.forEach(event => eventStore.publish(event));

      // Create new ReadModelStore and replay
      const newReadModelStore = Object.create(ReadModelStore.prototype);
      (newReadModelStore as any).orders = new Map();
      (newReadModelStore as any).positions = new Map();
      (newReadModelStore as any).system = {
        currentRegime: 'NEUTRAL',
        regimeConfidence: 0.0,
        riskBreaches: 0,
      };

      eventStore.subscribe((newReadModelStore as any).applyEvent.bind(newReadModelStore));
      eventStore.replay();

      // Verify reconstructed state
      const order = newReadModelStore.getOrder('order-1');
      expect(order).toBeDefined();
      expect(order!.filledQty).toBe(100);
      expect(order!.status).toBe('FILLED');

      const position = newReadModelStore.getPosition('AAPL');
      expect(position).toBeDefined();
      expect(position!.qty).toBe(100);
      expect(position!.avgPrice).toBe(150.00);

      const systemState = newReadModelStore.getSystemState();
      expect(systemState.currentRegime).toBe('BULLISH');
      expect(systemState.regimeConfidence).toBe(0.85);
      expect(systemState.riskBreaches).toBe(1);
    });

    it('should handle complex trading scenario with replay', () => {
      // Complex scenario: multiple orders, executions, position changes
      const events: TradingEvent[] = [
        // Order 1: BUY 100 AAPL @ 150
        {
          type: 'OrderPlaced',
          payload: {
            orderId: 'order-1',
            symbol: 'AAPL',
            side: 'BUY',
            quantity: 100,
            orderType: 'MKT',
            strategyId: 'strat-1',
            timestamp: 1000,
          },
        },
        {
          type: 'ExecutionReceived',
          payload: {
            execId: 'exec-1',
            orderId: 'order-1',
            symbol: 'AAPL',
            side: 'BUY',
            lastShares: 100,
            lastPrice: 150.00,
            timestamp: 2000,
          },
        },
        // Order 2: SELL 150 AAPL @ 155 (close 100, short 50)
        {
          type: 'OrderPlaced',
          payload: {
            orderId: 'order-2',
            symbol: 'AAPL',
            side: 'SELL',
            quantity: 150,
            orderType: 'MKT',
            strategyId: 'strat-1',
            timestamp: 3000,
          },
        },
        {
          type: 'ExecutionReceived',
          payload: {
            execId: 'exec-2',
            orderId: 'order-2',
            symbol: 'AAPL',
            side: 'SELL',
            lastShares: 150,
            lastPrice: 155.00,
            timestamp: 4000,
          },
        },
        // Risk breach
        {
          type: 'RiskLimitBreached',
          payload: {
            ruleId: 'position-size',
            currentValue: 50,
            limitValue: 40,
            timestamp: 5000,
          },
        },
        // Order 3: BUY 50 AAPL @ 160 (close short)
        {
          type: 'OrderPlaced',
          payload: {
            orderId: 'order-3',
            symbol: 'AAPL',
            side: 'BUY',
            quantity: 50,
            orderType: 'MKT',
            strategyId: 'strat-1',
            timestamp: 6000,
          },
        },
        {
          type: 'ExecutionReceived',
          payload: {
            execId: 'exec-3',
            orderId: 'order-3',
            symbol: 'AAPL',
            side: 'BUY',
            lastShares: 50,
            lastPrice: 160.00,
            timestamp: 7000,
          },
        },
      ];

      events.forEach(event => eventStore.publish(event));

      // Verify final state
      const position = readModelStore.getPosition('AAPL');
      expect(position).toBeDefined();
      expect(position!.qty).toBe(0); // Flat
      expect(position!.avgPrice).toBe(0);
      // realizedPnl = 100 * (155 - 150) + 50 * (155 - 160) = 500 - 250 = 250
      expect(position!.realizedPnl).toBe(250);

      const systemState = readModelStore.getSystemState();
      expect(systemState.riskBreaches).toBe(1);

      const order1 = readModelStore.getOrder('order-1');
      expect(order1!.status).toBe('FILLED');

      const order2 = readModelStore.getOrder('order-2');
      expect(order2!.status).toBe('FILLED');

      const order3 = readModelStore.getOrder('order-3');
      expect(order3!.status).toBe('FILLED');
    });
  });

  describe('Edge Cases and Boundary Conditions', () => {
    it('should handle zero quantity orders', () => {
      const event: TradingEvent = {
        type: 'OrderPlaced',
        payload: {
          orderId: 'order-zero',
          symbol: 'AAPL',
          side: 'BUY',
          quantity: 0,
          orderType: 'MKT',
          strategyId: 'strat-1',
          timestamp: 1000,
        },
      };

      eventStore.publish(event);

      const order = readModelStore.getOrder('order-zero');
      expect(order).toBeDefined();
      expect(order!.originalQty).toBe(0);
      expect(order!.filledQty).toBe(0);
      expect(order!.status).toBe('SUBMITTED');
    });

    it('should handle zero share executions', () => {
      eventStore.publish({
        type: 'OrderPlaced',
        payload: {
          orderId: 'order-1',
          symbol: 'AAPL',
          side: 'BUY',
          quantity: 100,
          orderType: 'MKT',
          strategyId: 'strat-1',
          timestamp: 1000,
        },
      });

      eventStore.publish({
        type: 'ExecutionReceived',
        payload: {
          execId: 'exec-zero',
          orderId: 'order-1',
          symbol: 'AAPL',
          side: 'BUY',
          lastShares: 0,
          lastPrice: 150.00,
          timestamp: 2000,
        },
      });

      const order = readModelStore.getOrder('order-1');
      expect(order!.filledQty).toBe(0);
      expect(order!.avgPrice).toBe(0);
      expect(order!.status).toBe('SUBMITTED');
    });

    it('should handle zero price executions', () => {
      eventStore.publish({
        type: 'OrderPlaced',
        payload: {
          orderId: 'order-zero-price',
          symbol: 'AAPL',
          side: 'BUY',
          quantity: 100,
          orderType: 'MKT',
          strategyId: 'strat-1',
          timestamp: 1000,
        },
      });

      eventStore.publish({
        type: 'ExecutionReceived',
        payload: {
          execId: 'exec-1',
          orderId: 'order-zero-price',
          symbol: 'AAPL',
          side: 'BUY',
          lastShares: 100,
          lastPrice: 0,
          timestamp: 2000,
        },
      });

      const order = readModelStore.getOrder('order-zero-price');
      expect(order!.filledQty).toBe(100);
      expect(order!.avgPrice).toBe(0);
      expect(order!.status).toBe('FILLED');

      const position = readModelStore.getPosition('AAPL');
      expect(position!.qty).toBe(100);
      expect(position!.avgPrice).toBe(0);
    });

    it('should handle negative prices', () => {
      eventStore.publish({
        type: 'OrderPlaced',
        payload: {
          orderId: 'order-neg',
          symbol: 'AAPL',
          side: 'BUY',
          quantity: 100,
          orderType: 'MKT',
          strategyId: 'strat-1',
          timestamp: 1000,
        },
      });

      eventStore.publish({
        type: 'ExecutionReceived',
        payload: {
          execId: 'exec-neg',
          orderId: 'order-neg',
          symbol: 'AAPL',
          side: 'BUY',
          lastShares: 100,
          lastPrice: -10.00,
          timestamp: 2000,
        },
      });

      const order = readModelStore.getOrder('order-neg');
      expect(order!.avgPrice).toBe(-10.00);

      const position = readModelStore.getPosition('AAPL');
      expect(position!.avgPrice).toBe(-10.00);
    });

    it('should handle very large quantities', () => {
      eventStore.publish({
        type: 'OrderPlaced',
        payload: {
          orderId: 'order-large',
          symbol: 'AAPL',
          side: 'BUY',
          quantity: Number.MAX_SAFE_INTEGER,
          orderType: 'MKT',
          strategyId: 'strat-1',
          timestamp: 1000,
        },
      });

      eventStore.publish({
        type: 'ExecutionReceived',
        payload: {
          execId: 'exec-large',
          orderId: 'order-large',
          symbol: 'AAPL',
          side: 'BUY',
          lastShares: Number.MAX_SAFE_INTEGER,
          lastPrice: 150.00,
          timestamp: 2000,
        },
      });

      const order = readModelStore.getOrder('order-large');
      expect(order!.filledQty).toBe(Number.MAX_SAFE_INTEGER);
      expect(order!.status).toBe('FILLED');
    });

    it('should handle very small fractional prices', () => {
      eventStore.publish({
        type: 'OrderPlaced',
        payload: {
          orderId: 'order-fraction',
          symbol: 'PENNY',
          side: 'BUY',
          quantity: 100,
          orderType: 'MKT',
          strategyId: 'strat-1',
          timestamp: 1000,
        },
      });

      eventStore.publish({
        type: 'ExecutionReceived',
        payload: {
          execId: 'exec-fraction',
          orderId: 'order-fraction',
          symbol: 'PENNY',
          side: 'BUY',
          lastShares: 100,
          lastPrice: 0.0001,
          timestamp: 2000,
        },
      });

      const order = readModelStore.getOrder('order-fraction');
      expect(order!.avgPrice).toBe(0.0001);

      const position = readModelStore.getPosition('PENNY');
      expect(position!.avgPrice).toBe(0.0001);
    });

    it('should handle executions exceeding original quantity', () => {
      eventStore.publish({
        type: 'OrderPlaced',
        payload: {
          orderId: 'order-over',
          symbol: 'AAPL',
          side: 'BUY',
          quantity: 100,
          orderType: 'MKT',
          strategyId: 'strat-1',
          timestamp: 1000,
        },
      });

      eventStore.publish({
        type: 'ExecutionReceived',
        payload: {
          execId: 'exec-over',
          orderId: 'order-over',
          symbol: 'AAPL',
          side: 'BUY',
          lastShares: 150, // More than ordered
          lastPrice: 150.00,
          timestamp: 2000,
        },
      });

      const order = readModelStore.getOrder('order-over');
      expect(order!.filledQty).toBe(150);
      expect(order!.status).toBe('FILLED'); // Still filled even though exceeds
    });

    it('should handle multiple symbols in parallel', () => {
      // AAPL long
      eventStore.publish({
        type: 'OrderPlaced',
        payload: {
          orderId: 'order-aapl',
          symbol: 'AAPL',
          side: 'BUY',
          quantity: 100,
          orderType: 'MKT',
          strategyId: 'strat-1',
          timestamp: 1000,
        },
      });

      eventStore.publish({
        type: 'ExecutionReceived',
        payload: {
          execId: 'exec-aapl',
          orderId: 'order-aapl',
          symbol: 'AAPL',
          side: 'BUY',
          lastShares: 100,
          lastPrice: 150.00,
          timestamp: 2000,
        },
      });

      // TSLA short
      eventStore.publish({
        type: 'OrderPlaced',
        payload: {
          orderId: 'order-tsla',
          symbol: 'TSLA',
          side: 'SELL',
          quantity: 50,
          orderType: 'MKT',
          strategyId: 'strat-1',
          timestamp: 3000,
        },
      });

      eventStore.publish({
        type: 'ExecutionReceived',
        payload: {
          execId: 'exec-tsla',
          orderId: 'order-tsla',
          symbol: 'TSLA',
          side: 'SELL',
          lastShares: 50,
          lastPrice: 250.00,
          timestamp: 4000,
        },
      });

      // NVDA long
      eventStore.publish({
        type: 'OrderPlaced',
        payload: {
          orderId: 'order-nvda',
          symbol: 'NVDA',
          side: 'BUY',
          quantity: 75,
          orderType: 'MKT',
          strategyId: 'strat-1',
          timestamp: 5000,
        },
      });

      eventStore.publish({
        type: 'ExecutionReceived',
        payload: {
          execId: 'exec-nvda',
          orderId: 'order-nvda',
          symbol: 'NVDA',
          side: 'BUY',
          lastShares: 75,
          lastPrice: 500.00,
          timestamp: 6000,
        },
      });

      const positions = readModelStore.getAllPositions();
      expect(positions).toHaveLength(3);

      const aaplPosition = readModelStore.getPosition('AAPL');
      expect(aaplPosition!.qty).toBe(100);
      expect(aaplPosition!.avgPrice).toBe(150.00);

      const tslaPosition = readModelStore.getPosition('TSLA');
      expect(tslaPosition!.qty).toBe(-50);
      expect(tslaPosition!.avgPrice).toBe(250.00);

      const nvdaPosition = readModelStore.getPosition('NVDA');
      expect(nvdaPosition!.qty).toBe(75);
      expect(nvdaPosition!.avgPrice).toBe(500.00);
    });

    it('should handle empty string symbols', () => {
      eventStore.publish({
        type: 'OrderPlaced',
        payload: {
          orderId: 'order-empty-sym',
          symbol: '',
          side: 'BUY',
          quantity: 100,
          orderType: 'MKT',
          strategyId: 'strat-1',
          timestamp: 1000,
        },
      });

      const order = readModelStore.getOrder('order-empty-sym');
      expect(order).toBeDefined();
      expect(order!.symbol).toBe('');
    });

    it('should handle special characters in symbols', () => {
      const specialSymbol = 'BRK.A';
      
      eventStore.publish({
        type: 'OrderPlaced',
        payload: {
          orderId: 'order-special',
          symbol: specialSymbol,
          side: 'BUY',
          quantity: 1,
          orderType: 'MKT',
          strategyId: 'strat-1',
          timestamp: 1000,
        },
      });

      eventStore.publish({
        type: 'ExecutionReceived',
        payload: {
          execId: 'exec-special',
          orderId: 'order-special',
          symbol: specialSymbol,
          side: 'BUY',
          lastShares: 1,
          lastPrice: 500000.00,
          timestamp: 2000,
        },
      });

      const position = readModelStore.getPosition(specialSymbol);
      expect(position).toBeDefined();
      expect(position!.symbol).toBe(specialSymbol);
      expect(position!.qty).toBe(1);
    });

    it('should handle getOrder for non-existent order', () => {
      const order = readModelStore.getOrder('non-existent-order');
      expect(order).toBeUndefined();
    });

    it('should handle getPosition for non-existent symbol', () => {
      const position = readModelStore.getPosition('NON_EXISTENT');
      expect(position).toBeUndefined();
    });

    it('should maintain separate state for different order IDs', () => {
      eventStore.publish({
        type: 'OrderPlaced',
        payload: {
          orderId: 'order-1',
          symbol: 'AAPL',
          side: 'BUY',
          quantity: 100,
          orderType: 'MKT',
          strategyId: 'strat-1',
          timestamp: 1000,
        },
      });

      eventStore.publish({
        type: 'OrderPlaced',
        payload: {
          orderId: 'order-2',
          symbol: 'AAPL',
          side: 'BUY',
          quantity: 50,
          orderType: 'MKT',
          strategyId: 'strat-1',
          timestamp: 2000,
        },
      });

      const order1 = readModelStore.getOrder('order-1');
      const order2 = readModelStore.getOrder('order-2');

      expect(order1!.originalQty).toBe(100);
      expect(order2!.originalQty).toBe(50);
    });

    it('should handle regime changes with zero confidence', () => {
      eventStore.publish({
        type: 'RegimeShifted',
        payload: {
          prevRegime: 'NEUTRAL',
          newRegime: 'BULLISH',
          confidence: 0.0,
          timestamp: 1000,
        },
      });

      const systemState = readModelStore.getSystemState();
      expect(systemState.currentRegime).toBe('BULLISH');
      expect(systemState.regimeConfidence).toBe(0.0);
    });

    it('should handle regime changes with confidence > 1', () => {
      eventStore.publish({
        type: 'RegimeShifted',
        payload: {
          prevRegime: 'NEUTRAL',
          newRegime: 'BULLISH',
          confidence: 1.5, // Invalid but not rejected
          timestamp: 1000,
        },
      });

      const systemState = readModelStore.getSystemState();
      expect(systemState.regimeConfidence).toBe(1.5);
    });

    it('should handle multiple risk breaches from different rules', () => {
      eventStore.publish({
        type: 'RiskLimitBreached',
        payload: {
          ruleId: 'max-position-size',
          currentValue: 150000,
          limitValue: 100000,
          timestamp: 1000,
        },
      });

      eventStore.publish({
        type: 'RiskLimitBreached',
        payload: {
          ruleId: 'max-drawdown',
          currentValue: 20,
          limitValue: 10,
          timestamp: 2000,
        },
      });

      eventStore.publish({
        type: 'RiskLimitBreached',
        payload: {
          ruleId: 'concentration-limit',
          currentValue: 0.5,
          limitValue: 0.3,
          timestamp: 3000,
        },
      });

      const systemState = readModelStore.getSystemState();
      expect(systemState.riskBreaches).toBe(3);
    });

    it('should handle position with single share', () => {
      eventStore.publish({
        type: 'OrderPlaced',
        payload: {
          orderId: 'order-single',
          symbol: 'AMZN',
          side: 'BUY',
          quantity: 1,
          orderType: 'MKT',
          strategyId: 'strat-1',
          timestamp: 1000,
        },
      });

      eventStore.publish({
        type: 'ExecutionReceived',
        payload: {
          execId: 'exec-single',
          orderId: 'order-single',
          symbol: 'AMZN',
          side: 'BUY',
          lastShares: 1,
          lastPrice: 3500.00,
          timestamp: 2000,
        },
      });

      const position = readModelStore.getPosition('AMZN');
      expect(position!.qty).toBe(1);
      expect(position!.avgPrice).toBe(3500.00);
    });

    it('should accumulate PnL correctly across multiple trades on same symbol', () => {
      // Trade 1: Buy 100 @ 100, Sell 100 @ 110 -> PnL = 1000
      eventStore.publish({
        type: 'OrderPlaced',
        payload: {
          orderId: 'order-1',
          symbol: 'XYZ',
          side: 'BUY',
          quantity: 100,
          orderType: 'MKT',
          strategyId: 'strat-1',
          timestamp: 1000,
        },
      });

      eventStore.publish({
        type: 'ExecutionReceived',
        payload: {
          execId: 'exec-1',
          orderId: 'order-1',
          symbol: 'XYZ',
          side: 'BUY',
          lastShares: 100,
          lastPrice: 100.00,
          timestamp: 2000,
        },
      });

      eventStore.publish({
        type: 'OrderPlaced',
        payload: {
          orderId: 'order-2',
          symbol: 'XYZ',
          side: 'SELL',
          quantity: 100,
          orderType: 'MKT',
          strategyId: 'strat-1',
          timestamp: 3000,
        },
      });

      eventStore.publish({
        type: 'ExecutionReceived',
        payload: {
          execId: 'exec-2',
          orderId: 'order-2',
          symbol: 'XYZ',
          side: 'SELL',
          lastShares: 100,
          lastPrice: 110.00,
          timestamp: 4000,
        },
      });

      let position = readModelStore.getPosition('XYZ');
      expect(position!.qty).toBe(0);
      expect(position!.realizedPnl).toBe(1000);

      // Trade 2: Buy 50 @ 105, Sell 50 @ 115 -> PnL = 500
      eventStore.publish({
        type: 'OrderPlaced',
        payload: {
          orderId: 'order-3',
          symbol: 'XYZ',
          side: 'BUY',
          quantity: 50,
          orderType: 'MKT',
          strategyId: 'strat-1',
          timestamp: 5000,
        },
      });

      eventStore.publish({
        type: 'ExecutionReceived',
        payload: {
          execId: 'exec-3',
          orderId: 'order-3',
          symbol: 'XYZ',
          side: 'BUY',
          lastShares: 50,
          lastPrice: 105.00,
          timestamp: 6000,
        },
      });

      eventStore.publish({
        type: 'OrderPlaced',
        payload: {
          orderId: 'order-4',
          symbol: 'XYZ',
          side: 'SELL',
          quantity: 50,
          orderType: 'MKT',
          strategyId: 'strat-1',
          timestamp: 7000,
        },
      });

      eventStore.publish({
        type: 'ExecutionReceived',
        payload: {
          execId: 'exec-4',
          orderId: 'order-4',
          symbol: 'XYZ',
          side: 'SELL',
          lastShares: 50,
          lastPrice: 115.00,
          timestamp: 8000,
        },
      });

      position = readModelStore.getPosition('XYZ');
      expect(position!.qty).toBe(0);
      expect(position!.realizedPnl).toBe(1500); // 1000 + 500
    });

    it('should handle getSystemState returning a copy', () => {
      const state1 = readModelStore.getSystemState();
      const state2 = readModelStore.getSystemState();

      // Should be different objects (copies)
      expect(state1).not.toBe(state2);
      expect(state1).toEqual(state2);
    });
  });

  describe('Precision and Rounding', () => {
    it('should maintain precision in weighted average calculations', () => {
      eventStore.publish({
        type: 'OrderPlaced',
        payload: {
          orderId: 'order-precision',
          symbol: 'PREC',
          side: 'BUY',
          quantity: 100,
          orderType: 'MKT',
          strategyId: 'strat-1',
          timestamp: 1000,
        },
      });

      // Multiple executions with fractional prices
      eventStore.publish({
        type: 'ExecutionReceived',
        payload: {
          execId: 'exec-1',
          orderId: 'order-precision',
          symbol: 'PREC',
          side: 'BUY',
          lastShares: 33,
          lastPrice: 100.333,
          timestamp: 2000,
        },
      });

      eventStore.publish({
        type: 'ExecutionReceived',
        payload: {
          execId: 'exec-2',
          orderId: 'order-precision',
          symbol: 'PREC',
          side: 'BUY',
          lastShares: 33,
          lastPrice: 100.667,
          timestamp: 3000,
        },
      });

      eventStore.publish({
        type: 'ExecutionReceived',
        payload: {
          execId: 'exec-3',
          orderId: 'order-precision',
          symbol: 'PREC',
          side: 'BUY',
          lastShares: 34,
          lastPrice: 100.500,
          timestamp: 4000,
        },
      });

      const order = readModelStore.getOrder('order-precision');
      const expectedAvg = (33 * 100.333 + 33 * 100.667 + 34 * 100.500) / 100;
      expect(order!.avgPrice).toBeCloseTo(expectedAvg, 6);
    });

    it('should handle floating point precision in PnL calculations', () => {
      // Long position
      eventStore.publish({
        type: 'OrderPlaced',
        payload: {
          orderId: 'order-float',
          symbol: 'FLOAT',
          side: 'BUY',
          quantity: 100,
          orderType: 'MKT',
          strategyId: 'strat-1',
          timestamp: 1000,
        },
      });

      eventStore.publish({
        type: 'ExecutionReceived',
        payload: {
          execId: 'exec-float-1',
          orderId: 'order-float',
          symbol: 'FLOAT',
          side: 'BUY',
          lastShares: 100,
          lastPrice: 100.123456789,
          timestamp: 2000,
        },
      });

      // Close position
      eventStore.publish({
        type: 'OrderPlaced',
        payload: {
          orderId: 'order-float-2',
          symbol: 'FLOAT',
          side: 'SELL',
          quantity: 100,
          orderType: 'MKT',
          strategyId: 'strat-1',
          timestamp: 3000,
        },
      });

      eventStore.publish({
        type: 'ExecutionReceived',
        payload: {
          execId: 'exec-float-2',
          orderId: 'order-float-2',
          symbol: 'FLOAT',
          side: 'SELL',
          lastShares: 100,
          lastPrice: 110.987654321,
          timestamp: 4000,
        },
      });

      const position = readModelStore.getPosition('FLOAT');
      const expectedPnl = 100 * (110.987654321 - 100.123456789);
      expect(position!.realizedPnl).toBeCloseTo(expectedPnl, 6);
    });
  });
});
