import Database, { type Database as DatabaseType } from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

// ── Type Definitions ─────────────────────────────────────────────────────────

export type OrderSide = 'BUY' | 'SELL';
export type OrderType = 'MKT' | 'LMT' | 'STP' | 'STP_LMT';
export type OrderStatus = 'PENDING' | 'SUBMITTED' | 'FILLED' | 'CANCELLED' | 'REJECTED';

// Event Payloads
export interface OrderPlacedPayload {
  orderId: string;
  symbol: string;
  side: OrderSide;
  quantity: number;
  orderType: OrderType;
  limitPrice?: number;
  strategyId: string;
  timestamp: number;
}

export interface ExecutionReceivedPayload {
  execId: string;
  orderId: string;
  symbol: string;
  side: OrderSide;
  lastShares: number;
  lastPrice: number;
  timestamp: number;
}

export interface RiskLimitBreachedPayload {
  ruleId: string;
  currentValue: number;
  limitValue: number;
  symbol?: string;
  timestamp: number;
}

export interface RegimeShiftedPayload {
  prevRegime: string;
  newRegime: string;
  confidence: number;
  timestamp: number;
}

// Discriminated Union of All Events
export type TradingEvent =
  | { type: 'OrderPlaced'; payload: OrderPlacedPayload }
  | { type: 'ExecutionReceived'; payload: ExecutionReceivedPayload }
  | { type: 'RiskLimitBreached'; payload: RiskLimitBreachedPayload }
  | { type: 'RegimeShifted'; payload: RegimeShiftedPayload };

export interface StoredEvent {
  id: number;
  type: TradingEvent['type'];
  payload: any;
  timestamp: number;
}

// ── Event Store Implementation ───────────────────────────────────────────────

export class EventStore {
  private db: DatabaseType;
  private listeners: ((event: TradingEvent) => void)[] = [];

  constructor(dbPath?: string) {
    if (!dbPath) {
      const __dirname = path.dirname(fileURLToPath(import.meta.url));
      const dataDir = path.join(__dirname, '../../data');
      if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
      dbPath = path.join(dataDir, 'events.db');
    }

    this.db = new Database(dbPath);
    this.initialize();
  }

  private initialize() {
    // WAL mode for high concurrency and performance
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');

    // Create events table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        payload TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
      CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
    `);
  }

  /**
   * Append a new event to the log.
   * This is an O(1) operation.
   * @param event The event to append
   */
  public publish(event: TradingEvent): void {
    const stmt = this.db.prepare(`
      INSERT INTO events (type, payload, timestamp)
      VALUES (?, ?, ?)
    `);

    const timestamp = event.payload.timestamp || Date.now();

    this.db.transaction(() => {
      stmt.run(event.type, JSON.stringify(event.payload), timestamp);
    })();

    // Notify in-memory listeners (Read Models)
    this.notifyListeners(event);
  }

  /**
   * Subscribe to the event stream for Read Model updates.
   * @param listener Callback function receiving events
   */
  public subscribe(listener: (event: TradingEvent) => void): void {
    this.listeners.push(listener);
  }

  private notifyListeners(event: TradingEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('Error in event listener:', error);
      }
    }
  }

  /**
   * Replay all events from the beginning to rebuild state.
   * Used on system startup.
   */
  public replay(): void {
    const stmt = this.db.prepare('SELECT type, payload, timestamp FROM events ORDER BY id ASC');
    const rows = stmt.all() as { type: string; payload: string; timestamp: number }[];

    for (const row of rows) {
      const event: TradingEvent = {
        type: row.type as TradingEvent['type'],
        payload: JSON.parse(row.payload),
      };
      // Force timestamp from DB to ensure deterministic replay
      if (event.payload) {
        event.payload.timestamp = row.timestamp;
      }
      this.notifyListeners(event);
    }
  }

  /**
   * Get events for a specific order (e.g., for audit trails).
   * @param orderId Order ID to filter by
   * @returns Array of stored events
   */
  public getEventsForOrder(orderId: string): StoredEvent[] {
    // This is a more complex query, typically used for debugging or specific audits
    // We scan for events that contain this orderId in their payload.
    // In a production system with billions of events, we would index specific fields or have a separate lookup.
    // For this bridge, iterating or using JSON extract is acceptable for ad-hoc queries.
    const stmt = this.db.prepare(`
      SELECT id, type, payload, timestamp
      FROM events
      WHERE json_extract(payload, '$.orderId') = ?
      ORDER BY id ASC
    `);
    
    const rows = stmt.all(orderId) as { id: number; type: string; payload: string; timestamp: number }[];
    
    return rows.map(row => ({
      id: row.id,
      type: row.type as TradingEvent['type'],
      payload: JSON.parse(row.payload),
      timestamp: row.timestamp
    }));
  }
}

// Singleton instance
export const eventStore = new EventStore();
