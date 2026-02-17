import { eventStore, type TradingEvent, type OrderStatus, type OrderSide } from './event-store.js';

// ── Read Model Interfaces ────────────────────────────────────────────────────

export interface OrderState {
  orderId: string;
  symbol: string;
  side: OrderSide;
  originalQty: number;
  filledQty: number;
  avgPrice: number;
  status: OrderStatus;
  lastUpdated: number;
}

export interface PositionState {
  symbol: string;
  qty: number;
  avgPrice: number;
  realizedPnl: number;
  unrealizedPnl: number;
}

export interface SystemState {
  currentRegime: string;
  regimeConfidence: number;
  riskBreaches: number;
}

// ── In-Memory Projections (The "Read" Side) ──────────────────────────────────

export class ReadModelStore {
  // O(1) Lookup Maps
  private orders = new Map<string, OrderState>();
  private positions = new Map<string, PositionState>();
  private system: SystemState = {
    currentRegime: 'NEUTRAL',
    regimeConfidence: 0.0,
    riskBreaches: 0,
  };

  constructor() {
    // Subscribe to the Event Store to keep models updated in real-time
    eventStore.subscribe(this.applyEvent.bind(this));
    
    // Replay events on startup to restore state
    console.log('Hydrating Read Models from Event Store...');
    const start = performance.now();
    eventStore.replay();
    console.log(`Read Models hydrated in ${(performance.now() - start).toFixed(2)}ms`);
  }

  /**
   * The Projection Function: f(State, Event) -> State
   * Mutates in-memory state based on the event type.
   */
  private applyEvent(event: TradingEvent): void {
    switch (event.type) {
      case 'OrderPlaced': {
        const { orderId, symbol, side, quantity, timestamp } = event.payload;
        this.orders.set(orderId, {
          orderId,
          symbol,
          side,
          originalQty: quantity,
          filledQty: 0,
          avgPrice: 0,
          status: 'SUBMITTED', // Assume submitted on placement for this simplified model
          lastUpdated: timestamp,
        });
        break;
      }

      case 'ExecutionReceived': {
        const { orderId, lastShares, lastPrice, timestamp } = event.payload;
        const order = this.orders.get(orderId);
        
        if (order) {
          // Update Order State
          const totalShares = order.filledQty + lastShares;
          const totalValue = (order.avgPrice * order.filledQty) + (lastPrice * lastShares);
          
          order.filledQty = totalShares;
          order.avgPrice = totalShares > 0 ? totalValue / totalShares : 0;
          order.lastUpdated = timestamp;

          if (order.filledQty >= order.originalQty) {
            order.status = 'FILLED';
          }

          // Update Position State
          this.updatePosition(order.symbol, order.side, lastShares, lastPrice);
        }
        break;
      }

      case 'RiskLimitBreached': {
        this.system.riskBreaches++;
        break;
      }

      case 'RegimeShifted': {
        const { newRegime, confidence } = event.payload;
        this.system.currentRegime = newRegime;
        this.system.regimeConfidence = confidence;
        break;
      }
    }
  }

  /**
   * Updates the position for a symbol based on an execution.
   * Handles position netting with realized P&L calculation.
   * Supports four cases:
   * 1. Adding to existing position (same side)
   * 2. Closing existing position (opposite side, partial or full)
   * 3. Flipping from long to short
   * 4. Flipping from short to long
   */
  private updatePosition(symbol: string, side: OrderSide, shares: number, price: number) {
    let position = this.positions.get(symbol);
    if (!position) {
      position = { symbol, qty: 0, avgPrice: 0, realizedPnl: 0, unrealizedPnl: 0 };
      this.positions.set(symbol, position);
    }

    if (side === 'BUY') {
      if (position.qty >= 0) {
        // Case 1: Adding to long position
        const totalValue = (position.qty * position.avgPrice) + (shares * price);
        position.qty += shares;
        position.avgPrice = totalValue / position.qty;
      } else {
        // Case 2 & 4: Closing short position or flipping to long
        const closingQty = Math.min(shares, Math.abs(position.qty));
        const remainingQty = shares - closingQty;
        
        // Calculate realized P&L on closed portion (for shorts: avgPrice - exitPrice)
        const pnl = closingQty * (position.avgPrice - price);
        position.realizedPnl += pnl;
        
        // Update quantity
        position.qty += shares;
        
        // If position crossed zero, set new avgPrice for the new long position
        if (position.qty > 0) {
          // Flipped to long
          position.avgPrice = price;
        } else if (position.qty === 0) {
          // Fully closed, reset avgPrice
          position.avgPrice = 0;
        }
        // else: still short, keep existing avgPrice
      }
    } else { // SELL
      if (position.qty <= 0) {
        // Case 1: Adding to short position
        const totalValue = (Math.abs(position.qty) * position.avgPrice) + (shares * price);
        position.qty -= shares;
        position.avgPrice = totalValue / Math.abs(position.qty);
      } else {
        // Case 2 & 3: Closing long position or flipping to short
        const closingQty = Math.min(shares, position.qty);
        const remainingQty = shares - closingQty;
        
        // Calculate realized P&L on closed portion (for longs: exitPrice - avgPrice)
        const pnl = closingQty * (price - position.avgPrice);
        position.realizedPnl += pnl;
        
        // Update quantity
        position.qty -= shares;
        
        // If position crossed zero, set new avgPrice for the new short position
        if (position.qty < 0) {
          // Flipped to short
          position.avgPrice = price;
        } else if (position.qty === 0) {
          // Fully closed, reset avgPrice
          position.avgPrice = 0;
        }
        // else: still long, keep existing avgPrice
      }
    }
  }

  // ── Public Accessors (The "Read" API) ──────────────────────────────────────

  public getOrder(orderId: string): OrderState | undefined {
    return this.orders.get(orderId);
  }

  public getPosition(symbol: string): PositionState | undefined {
    return this.positions.get(symbol);
  }

  public getAllPositions(): PositionState[] {
    return Array.from(this.positions.values());
  }

  public getSystemState(): SystemState {
    return { ...this.system };
  }
}

// Singleton instance
export const readModelStore = new ReadModelStore();
