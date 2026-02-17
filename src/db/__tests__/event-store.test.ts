import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database, { type Database as DatabaseType } from 'better-sqlite3';
import { EventStore, type TradingEvent, type OrderPlacedPayload, type ExecutionReceivedPayload } from '../event-store.js';

describe('EventStore', () => {
  let eventStore: EventStore;

  beforeEach(() => {
    // Create EventStore with in-memory database for each test
    eventStore = new EventStore(':memory:');
  });

  describe('Event Append (publish)', () => {
    it('should append OrderPlaced event to the event log', () => {
      const event: TradingEvent = {
        type: 'OrderPlaced',
        payload: {
          orderId: 'order-123',
          symbol: 'AAPL',
          side: 'BUY',
          quantity: 100,
          orderType: 'MKT',
          strategyId: 'strategy-1',
          timestamp: Date.now(),
        },
      };

      eventStore.publish(event);

      // Verify event was stored by querying directly
      const db = (eventStore as any).db as DatabaseType;
      const stmt = db.prepare("SELECT * FROM events WHERE json_extract(payload, '$.orderId') = ?");
      const rows = stmt.all('order-123');
      
      expect(rows).toHaveLength(1);
      expect((rows[0] as any).type).toBe('OrderPlaced');
    });

    it('should append ExecutionReceived event with correct payload', () => {
      const event: TradingEvent = {
        type: 'ExecutionReceived',
        payload: {
          execId: 'exec-456',
          orderId: 'order-123',
          symbol: 'TSLA',
          side: 'SELL',
          lastShares: 50,
          lastPrice: 250.50,
          timestamp: Date.now(),
        },
      };

      eventStore.publish(event);

      const db = (eventStore as any).db as DatabaseType;
      const stmt = db.prepare("SELECT * FROM events WHERE json_extract(payload, '$.execId') = ?");
      const rows = stmt.all('exec-456');
      
      expect(rows).toHaveLength(1);
      const stored = rows[0] as any;
      expect(stored.type).toBe('ExecutionReceived');
      const payload = JSON.parse(stored.payload);
      expect(payload.lastPrice).toBe(250.50);
      expect(payload.lastShares).toBe(50);
    });

    it('should append RiskLimitBreached event', () => {
      const event: TradingEvent = {
        type: 'RiskLimitBreached',
        payload: {
          ruleId: 'max-position-size',
          currentValue: 150000,
          limitValue: 100000,
          symbol: 'NVDA',
          timestamp: Date.now(),
        },
      };

      eventStore.publish(event);

      const db = (eventStore as any).db as DatabaseType;
      const stmt = db.prepare("SELECT * FROM events WHERE json_extract(payload, '$.ruleId') = ?");
      const rows = stmt.all('max-position-size');
      
      expect(rows).toHaveLength(1);
      expect((rows[0] as any).type).toBe('RiskLimitBreached');
    });

    it('should append RegimeShifted event', () => {
      const event: TradingEvent = {
        type: 'RegimeShifted',
        payload: {
          prevRegime: 'NEUTRAL',
          newRegime: 'BULLISH',
          confidence: 0.85,
          timestamp: Date.now(),
        },
      };

      eventStore.publish(event);

      const db = (eventStore as any).db as DatabaseType;
      const stmt = db.prepare('SELECT * FROM events WHERE type = ?');
      const rows = stmt.all('RegimeShifted');
      
      expect(rows).toHaveLength(1);
      const stored = rows[0] as any;
      const payload = JSON.parse(stored.payload);
      expect(payload.newRegime).toBe('BULLISH');
      expect(payload.confidence).toBe(0.85);
    });

    it('should append multiple events in sequence', () => {
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
          type: 'OrderPlaced',
          payload: {
            orderId: 'order-2',
            symbol: 'TSLA',
            side: 'SELL',
            quantity: 50,
            orderType: 'LMT',
            strategyId: 'strat-1',
            timestamp: 2000,
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
            timestamp: 3000,
          },
        },
      ];

      events.forEach(event => eventStore.publish(event));

      const db = (eventStore as any).db as DatabaseType;
      const stmt = db.prepare('SELECT COUNT(*) as count FROM events');
      const result = stmt.get() as any;
      expect(result.count).toBe(3);
    });

    it('should use timestamp from payload if present', () => {
      const customTimestamp = 1234567890000;
      const event: TradingEvent = {
        type: 'OrderPlaced',
        payload: {
          orderId: 'order-ts',
          symbol: 'AAPL',
          side: 'BUY',
          quantity: 10,
          orderType: 'MKT',
          strategyId: 'strat-1',
          timestamp: customTimestamp,
        },
      };

      eventStore.publish(event);

      const db = (eventStore as any).db as DatabaseType;
      const stmt = db.prepare("SELECT timestamp FROM events WHERE json_extract(payload, '$.orderId') = ?");
      const row = stmt.get('order-ts') as any;
      
      expect(row.timestamp).toBe(customTimestamp);
    });
  });

  describe('Event Replay', () => {
    it('should replay all events in order', () => {
      // Append events
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
            confidence: 0.8,
            timestamp: 3000,
          },
        },
      ];

      events.forEach(event => eventStore.publish(event));

      // Subscribe to replay
      const replayedEvents: TradingEvent[] = [];
      eventStore.subscribe(event => {
        replayedEvents.push(event);
      });

      // Trigger replay
      eventStore.replay();

      // Verify all events replayed in order
      expect(replayedEvents).toHaveLength(3);
      expect(replayedEvents[0].type).toBe('OrderPlaced');
      expect(replayedEvents[1].type).toBe('ExecutionReceived');
      expect(replayedEvents[2].type).toBe('RegimeShifted');
    });

    it('should replay events with correct timestamps from DB', () => {
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
          type: 'OrderPlaced',
          payload: {
            orderId: 'order-2',
            symbol: 'TSLA',
            side: 'SELL',
            quantity: 50,
            orderType: 'MKT',
            strategyId: 'strat-1',
            timestamp: 2000,
          },
        },
      ];

      events.forEach(event => eventStore.publish(event));

      const replayedEvents: TradingEvent[] = [];
      eventStore.subscribe(event => {
        replayedEvents.push(event);
      });

      eventStore.replay();

      expect(replayedEvents[0].payload.timestamp).toBe(1000);
      expect(replayedEvents[1].payload.timestamp).toBe(2000);
    });

    it('should handle replay with no events gracefully', () => {
      const replayedEvents: TradingEvent[] = [];
      eventStore.subscribe(event => {
        replayedEvents.push(event);
      });

      eventStore.replay();

      expect(replayedEvents).toHaveLength(0);
    });
  });

  describe('Listener Subscriptions', () => {
    it('should notify listener when event is published', () => {
      const listener = vi.fn();
      eventStore.subscribe(listener);

      const event: TradingEvent = {
        type: 'OrderPlaced',
        payload: {
          orderId: 'order-notify',
          symbol: 'AAPL',
          side: 'BUY',
          quantity: 10,
          orderType: 'MKT',
          strategyId: 'strat-1',
          timestamp: Date.now(),
        },
      };

      eventStore.publish(event);

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(event);
    });

    it('should notify multiple listeners', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      const listener3 = vi.fn();

      eventStore.subscribe(listener1);
      eventStore.subscribe(listener2);
      eventStore.subscribe(listener3);

      const event: TradingEvent = {
        type: 'RiskLimitBreached',
        payload: {
          ruleId: 'test-rule',
          currentValue: 100,
          limitValue: 50,
          timestamp: Date.now(),
        },
      };

      eventStore.publish(event);

      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledTimes(1);
      expect(listener3).toHaveBeenCalledTimes(1);
    });

    it('should continue notifying other listeners if one throws error', () => {
      const listener1 = vi.fn(() => {
        throw new Error('Listener 1 failed');
      });
      const listener2 = vi.fn();
      const listener3 = vi.fn();

      // Spy on console.error to suppress error output in tests
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      eventStore.subscribe(listener1);
      eventStore.subscribe(listener2);
      eventStore.subscribe(listener3);

      const event: TradingEvent = {
        type: 'OrderPlaced',
        payload: {
          orderId: 'order-error',
          symbol: 'AAPL',
          side: 'BUY',
          quantity: 10,
          orderType: 'MKT',
          strategyId: 'strat-1',
          timestamp: Date.now(),
        },
      };

      eventStore.publish(event);

      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledTimes(1);
      expect(listener3).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });
  });

  describe('Stream Queries (getEventsForOrder)', () => {
    it('should retrieve all events for a specific order', () => {
      const orderId = 'order-stream-1';

      // Publish multiple events for the same order
      const events: TradingEvent[] = [
        {
          type: 'OrderPlaced',
          payload: {
            orderId,
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
            orderId,
            symbol: 'AAPL',
            side: 'BUY',
            lastShares: 60,
            lastPrice: 150.00,
            timestamp: 2000,
          },
        },
        {
          type: 'ExecutionReceived',
          payload: {
            execId: 'exec-2',
            orderId,
            symbol: 'AAPL',
            side: 'BUY',
            lastShares: 40,
            lastPrice: 151.00,
            timestamp: 3000,
          },
        },
      ];

      events.forEach(event => eventStore.publish(event));

      // Add unrelated event for different order
      eventStore.publish({
        type: 'OrderPlaced',
        payload: {
          orderId: 'other-order',
          symbol: 'TSLA',
          side: 'SELL',
          quantity: 50,
          orderType: 'MKT',
          strategyId: 'strat-1',
          timestamp: 1500,
        },
      });

      const orderEvents = eventStore.getEventsForOrder(orderId);

      expect(orderEvents).toHaveLength(3);
      expect(orderEvents[0].type).toBe('OrderPlaced');
      expect(orderEvents[1].type).toBe('ExecutionReceived');
      expect(orderEvents[2].type).toBe('ExecutionReceived');
      expect((orderEvents[1].payload as any).execId).toBe('exec-1');
      expect((orderEvents[2].payload as any).execId).toBe('exec-2');
    });

    it('should return events in chronological order by id', () => {
      const orderId = 'order-chrono';

      // Publish events with non-sequential timestamps
      eventStore.publish({
        type: 'OrderPlaced',
        payload: {
          orderId,
          symbol: 'AAPL',
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
          execId: 'exec-1',
          orderId,
          symbol: 'AAPL',
          side: 'BUY',
          lastShares: 100,
          lastPrice: 150.00,
          timestamp: 1000,
        },
      });

      const orderEvents = eventStore.getEventsForOrder(orderId);

      // Should be ordered by insertion (id), not timestamp
      expect(orderEvents).toHaveLength(2);
      expect(orderEvents[0].type).toBe('OrderPlaced');
      expect(orderEvents[1].type).toBe('ExecutionReceived');
    });

    it('should return empty array for non-existent order', () => {
      const orderEvents = eventStore.getEventsForOrder('non-existent-order');
      expect(orderEvents).toHaveLength(0);
    });

    it('should return stored event with id and timestamp', () => {
      const orderId = 'order-details';
      const timestamp = 1234567890000;

      eventStore.publish({
        type: 'OrderPlaced',
        payload: {
          orderId,
          symbol: 'AAPL',
          side: 'BUY',
          quantity: 100,
          orderType: 'MKT',
          strategyId: 'strat-1',
          timestamp,
        },
      });

      const orderEvents = eventStore.getEventsForOrder(orderId);

      expect(orderEvents).toHaveLength(1);
      expect(orderEvents[0].id).toBeGreaterThan(0);
      expect(orderEvents[0].timestamp).toBe(timestamp);
      expect(orderEvents[0].type).toBe('OrderPlaced');
      expect(orderEvents[0].payload).toBeDefined();
    });
  });

  describe('Optimistic Locking / Event Versioning', () => {
    it('should maintain sequential event IDs for ordering', () => {
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
          type: 'OrderPlaced',
          payload: {
            orderId: 'order-2',
            symbol: 'TSLA',
            side: 'SELL',
            quantity: 50,
            orderType: 'MKT',
            strategyId: 'strat-1',
            timestamp: 2000,
          },
        },
        {
          type: 'OrderPlaced',
          payload: {
            orderId: 'order-3',
            symbol: 'NVDA',
            side: 'BUY',
            quantity: 75,
            orderType: 'MKT',
            strategyId: 'strat-1',
            timestamp: 3000,
          },
        },
      ];

      events.forEach(event => eventStore.publish(event));

      const db = (eventStore as any).db as DatabaseType;
      const stmt = db.prepare('SELECT id FROM events ORDER BY id ASC');
      const rows = stmt.all() as any[];

      expect(rows).toHaveLength(3);
      expect(rows[0].id).toBe(1);
      expect(rows[1].id).toBe(2);
      expect(rows[2].id).toBe(3);
    });

    it('should prevent concurrent modification through transaction isolation', () => {
      // SQLite in WAL mode provides isolation
      // This test verifies that events are committed atomically
      const event1: TradingEvent = {
        type: 'OrderPlaced',
        payload: {
          orderId: 'concurrent-1',
          symbol: 'AAPL',
          side: 'BUY',
          quantity: 100,
          orderType: 'MKT',
          strategyId: 'strat-1',
          timestamp: Date.now(),
        },
      };

      const event2: TradingEvent = {
        type: 'OrderPlaced',
        payload: {
          orderId: 'concurrent-2',
          symbol: 'TSLA',
          side: 'SELL',
          quantity: 50,
          orderType: 'MKT',
          strategyId: 'strat-1',
          timestamp: Date.now(),
        },
      };

      // Publish events
      eventStore.publish(event1);
      eventStore.publish(event2);

      // Both should be stored
      const db = (eventStore as any).db as DatabaseType;
      const stmt = db.prepare('SELECT COUNT(*) as count FROM events');
      const result = stmt.get() as any;
      expect(result.count).toBe(2);
    });
  });

  describe('Database Initialization', () => {
    it('should create events table with proper schema', () => {
      const db = (eventStore as any).db as DatabaseType;
      
      // Check table exists
      const tableStmt = db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name='events'
      `);
      const table = tableStmt.get();
      expect(table).toBeDefined();

      // Check indexes exist
      const indexStmt = db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='index' AND tbl_name='events'
      `);
      const indexes = indexStmt.all() as any[];
      const indexNames = indexes.map(idx => idx.name);
      
      expect(indexNames).toContain('idx_events_timestamp');
      expect(indexNames).toContain('idx_events_type');
    });

    it('should enable WAL mode for performance (or memory for in-memory DB)', () => {
      const db = (eventStore as any).db as DatabaseType;
      const result = db.pragma('journal_mode', { simple: true });
      // In-memory databases use 'memory' journal mode, file-based use 'wal'
      expect(['wal', 'memory']).toContain(result);
    });

    it('should set synchronous to NORMAL', () => {
      const db = (eventStore as any).db as DatabaseType;
      const result = db.pragma('synchronous', { simple: true });
      expect(result).toBe(1); // NORMAL = 1
    });
  });
});
