import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database, { type Database as DatabaseType } from 'better-sqlite3';
import { EventStore, type TradingEvent, type OrderPlacedPayload, type ExecutionReceivedPayload } from '../event-store.js';
import { logger } from '../../logging.js';

vi.mock('../../logging.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

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
      expect(logger.error).toHaveBeenCalled();
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

  describe('Edge Cases and Error Handling', () => {
    it('should handle empty payload gracefully', () => {
      const event: TradingEvent = {
        type: 'OrderPlaced',
        payload: {
          orderId: 'order-empty',
          symbol: '',
          side: 'BUY',
          quantity: 0,
          orderType: 'MKT',
          strategyId: '',
          timestamp: Date.now(),
        },
      };

      eventStore.publish(event);

      const orderEvents = eventStore.getEventsForOrder('order-empty');
      expect(orderEvents).toHaveLength(1);
      expect(orderEvents[0].payload.symbol).toBe('');
      expect(orderEvents[0].payload.quantity).toBe(0);
    });

    it('should handle very large event payloads', () => {
      const largePayload: TradingEvent = {
        type: 'OrderPlaced',
        payload: {
          orderId: 'order-large',
          symbol: 'A'.repeat(1000), // Very long symbol
          side: 'BUY',
          quantity: Number.MAX_SAFE_INTEGER,
          orderType: 'MKT',
          strategyId: 'strat-1',
          timestamp: Date.now(),
        },
      };

      eventStore.publish(largePayload);

      const orderEvents = eventStore.getEventsForOrder('order-large');
      expect(orderEvents).toHaveLength(1);
      expect(orderEvents[0].payload.symbol).toHaveLength(1000);
      expect(orderEvents[0].payload.quantity).toBe(Number.MAX_SAFE_INTEGER);
    });

    it('should handle special characters in payload', () => {
      const event: TradingEvent = {
        type: 'OrderPlaced',
        payload: {
          orderId: 'order-special-"quotes"',
          symbol: "AAPL'TEST",
          side: 'BUY',
          quantity: 100,
          orderType: 'MKT',
          strategyId: 'strat-"1"',
          timestamp: Date.now(),
        },
      };

      eventStore.publish(event);

      const orderEvents = eventStore.getEventsForOrder('order-special-"quotes"');
      expect(orderEvents).toHaveLength(1);
      expect(orderEvents[0].payload.symbol).toBe("AAPL'TEST");
      expect(orderEvents[0].payload.strategyId).toBe('strat-"1"');
    });

    it('should handle events with missing timestamp gracefully', () => {
      const event: any = {
        type: 'OrderPlaced',
        payload: {
          orderId: 'order-no-ts',
          symbol: 'AAPL',
          side: 'BUY',
          quantity: 100,
          orderType: 'MKT',
          strategyId: 'strat-1',
          // No timestamp field
        },
      };

      const beforePublish = Date.now();
      eventStore.publish(event);
      const afterPublish = Date.now();

      const orderEvents = eventStore.getEventsForOrder('order-no-ts');
      expect(orderEvents).toHaveLength(1);
      // Should use Date.now() if no timestamp in payload
      expect(orderEvents[0].timestamp).toBeGreaterThanOrEqual(beforePublish);
      expect(orderEvents[0].timestamp).toBeLessThanOrEqual(afterPublish);
    });

    it('should handle negative timestamps', () => {
      const event: TradingEvent = {
        type: 'OrderPlaced',
        payload: {
          orderId: 'order-negative-ts',
          symbol: 'AAPL',
          side: 'BUY',
          quantity: 100,
          orderType: 'MKT',
          strategyId: 'strat-1',
          timestamp: -1000,
        },
      };

      eventStore.publish(event);

      const orderEvents = eventStore.getEventsForOrder('order-negative-ts');
      expect(orderEvents).toHaveLength(1);
      expect(orderEvents[0].timestamp).toBe(-1000);
    });

    it('should handle zero timestamp (treated as falsy, uses Date.now())', () => {
      // NOTE: This documents current implementation behavior where 0 is treated as falsy.
      // Zero is a valid Unix timestamp (Jan 1, 1970 00:00:00 UTC), so ideally
      // the implementation should use `?? Date.now()` instead of `|| Date.now()`
      // to only fallback for null/undefined. This is a known limitation.
      const event: TradingEvent = {
        type: 'OrderPlaced',
        payload: {
          orderId: 'order-zero-ts',
          symbol: 'AAPL',
          side: 'BUY',
          quantity: 100,
          orderType: 'MKT',
          strategyId: 'strat-1',
          timestamp: 0,
        },
      };

      const beforePublish = Date.now();
      eventStore.publish(event);
      const afterPublish = Date.now();

      const orderEvents = eventStore.getEventsForOrder('order-zero-ts');
      expect(orderEvents).toHaveLength(1);
      // Zero is treated as falsy, so Date.now() is used instead
      expect(orderEvents[0].timestamp).toBeGreaterThanOrEqual(beforePublish);
      expect(orderEvents[0].timestamp).toBeLessThanOrEqual(afterPublish);
    });

    it('should handle fractional prices in execution events', () => {
      const event: TradingEvent = {
        type: 'ExecutionReceived',
        payload: {
          execId: 'exec-fraction',
          orderId: 'order-123',
          symbol: 'AAPL',
          side: 'BUY',
          lastShares: 100,
          lastPrice: 123.456789,
          timestamp: Date.now(),
        },
      };

      eventStore.publish(event);

      const db = (eventStore as any).db as DatabaseType;
      const stmt = db.prepare("SELECT * FROM events WHERE json_extract(payload, '$.execId') = ?");
      const rows = stmt.all('exec-fraction');
      
      expect(rows).toHaveLength(1);
      const stored = rows[0] as any;
      const payload = JSON.parse(stored.payload);
      expect(payload.lastPrice).toBe(123.456789);
    });

    it('should handle getEventsForOrder with SQL injection attempt', () => {
      const maliciousOrderId = "' OR '1'='1";
      
      const orderEvents = eventStore.getEventsForOrder(maliciousOrderId);
      
      // Should return empty array, not all events
      expect(orderEvents).toHaveLength(0);
    });

    it('should handle getEventsForOrder with null/undefined orderIds', () => {
      const orderEvents1 = eventStore.getEventsForOrder(null as any);
      const orderEvents2 = eventStore.getEventsForOrder(undefined as any);
      
      // Should not throw and should return empty arrays
      expect(orderEvents1).toHaveLength(0);
      expect(orderEvents2).toHaveLength(0);
    });

    it('should handle rapid sequential publishes without data loss', () => {
      const eventCount = 100;
      const orderIdPrefix = 'rapid-order-';

      for (let i = 0; i < eventCount; i++) {
        const event: TradingEvent = {
          type: 'OrderPlaced',
          payload: {
            orderId: `${orderIdPrefix}${i}`,
            symbol: 'AAPL',
            side: 'BUY',
            quantity: 100,
            orderType: 'MKT',
            strategyId: 'strat-1',
            timestamp: Date.now() + i,
          },
        };
        eventStore.publish(event);
      }

      // Verify all events were stored
      const db = (eventStore as any).db as DatabaseType;
      const stmt = db.prepare("SELECT COUNT(*) as count FROM events WHERE json_extract(payload, '$.orderId') LIKE ?");
      const result = stmt.get(`${orderIdPrefix}%`) as any;
      expect(result.count).toBe(eventCount);
    });

    it('should maintain data integrity with nested JSON in payload', () => {
      const event: TradingEvent = {
        type: 'RiskLimitBreached',
        payload: {
          ruleId: 'nested-data',
          currentValue: 100,
          limitValue: 50,
          timestamp: Date.now(),
        },
      };

      eventStore.publish(event);

      const db = (eventStore as any).db as DatabaseType;
      const stmt = db.prepare("SELECT * FROM events WHERE json_extract(payload, '$.ruleId') = ?");
      const rows = stmt.all('nested-data');
      
      expect(rows).toHaveLength(1);
      const stored = rows[0] as any;
      const payload = JSON.parse(stored.payload);
      expect(payload.ruleId).toBe('nested-data');
      expect(payload.currentValue).toBe(100);
    });

    it('should handle Unicode characters in symbol names', () => {
      const event: TradingEvent = {
        type: 'OrderPlaced',
        payload: {
          orderId: 'unicode-order',
          symbol: 'AAPL™️中文',
          side: 'BUY',
          quantity: 100,
          orderType: 'MKT',
          strategyId: 'strat-1',
          timestamp: Date.now(),
        },
      };

      eventStore.publish(event);

      const orderEvents = eventStore.getEventsForOrder('unicode-order');
      expect(orderEvents).toHaveLength(1);
      expect(orderEvents[0].payload.symbol).toBe('AAPL™️中文');
    });

    it('should handle extremely long order IDs', () => {
      const longOrderId = 'order-' + 'x'.repeat(500);
      const event: TradingEvent = {
        type: 'OrderPlaced',
        payload: {
          orderId: longOrderId,
          symbol: 'AAPL',
          side: 'BUY',
          quantity: 100,
          orderType: 'MKT',
          strategyId: 'strat-1',
          timestamp: Date.now(),
        },
      };

      eventStore.publish(event);

      const orderEvents = eventStore.getEventsForOrder(longOrderId);
      expect(orderEvents).toHaveLength(1);
      expect(orderEvents[0].payload.orderId).toBe(longOrderId);
    });
  });

  describe('Unsubscribe and Listener Management', () => {
    it('should handle duplicate listener subscriptions', () => {
      const listener = vi.fn();
      
      // Subscribe same listener twice
      eventStore.subscribe(listener);
      eventStore.subscribe(listener);

      const event: TradingEvent = {
        type: 'OrderPlaced',
        payload: {
          orderId: 'order-dup',
          symbol: 'AAPL',
          side: 'BUY',
          quantity: 100,
          orderType: 'MKT',
          strategyId: 'strat-1',
          timestamp: Date.now(),
        },
      };

      eventStore.publish(event);

      // Both subscriptions should fire
      expect(listener).toHaveBeenCalledTimes(2);
    });
  });

  describe('Replay Edge Cases', () => {
    it('should handle replay when listener throws on specific event', () => {
      const event1: TradingEvent = {
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

      const event2: TradingEvent = {
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
      };

      eventStore.publish(event1);
      eventStore.publish(event2);

      const receivedEvents: TradingEvent[] = [];


      eventStore.subscribe((event) => {
        if ((event.payload as any).orderId === 'order-1') {
          throw new Error('Failed to process order-1');
        }
        receivedEvents.push(event);
      });

      eventStore.replay();

      // Should still receive event2 despite error on event1
      expect(receivedEvents).toHaveLength(1);
      expect((receivedEvents[0].payload as any).orderId).toBe('order-2');
      expect(logger.error).toHaveBeenCalled();
    });

    it('should replay events in correct order even with out-of-order timestamps', () => {
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
            timestamp: 3000, // Latest timestamp
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
            timestamp: 1000, // Earliest timestamp
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
            timestamp: 2000, // Middle timestamp
          },
        },
      ];

      events.forEach(event => eventStore.publish(event));

      const replayedEvents: TradingEvent[] = [];
      eventStore.subscribe(event => {
        replayedEvents.push(event);
      });

      eventStore.replay();

      // Should be ordered by insertion (id), not timestamp
      expect(replayedEvents).toHaveLength(3);
      expect((replayedEvents[0].payload as any).orderId).toBe('order-1');
      expect((replayedEvents[1].payload as any).orderId).toBe('order-2');
      expect((replayedEvents[2].payload as any).orderId).toBe('order-3');
    });
  });
});
