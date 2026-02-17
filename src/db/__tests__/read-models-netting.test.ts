import { describe, it, expect, beforeEach } from 'vitest';
import { ReadModelStore } from '../read-models.js';

describe('ReadModelStore - Position Netting', () => {
  let readModelStore: ReadModelStore;

  beforeEach(() => {
    // Create a fresh ReadModelStore for each test
    // We'll directly test the updatePosition method
    readModelStore = Object.create(ReadModelStore.prototype);
    (readModelStore as any).orders = new Map();
    (readModelStore as any).positions = new Map();
    (readModelStore as any).system = {
      currentRegime: 'NEUTRAL',
      regimeConfidence: 0.0,
      riskBreaches: 0,
    };
  });

  // Helper function to directly call updatePosition (it's private, so we cast to any)
  function updatePosition(symbol: string, side: 'BUY' | 'SELL', shares: number, price: number) {
    (readModelStore as any).updatePosition(symbol, side, shares, price);
  }

  describe('Case 1: Close Long Position (SELL reducing long)', () => {
    it('should calculate realizedPnl and update position correctly when partially closing long', () => {
      const symbol = 'AAPL';

      // Build long position: BUY 100 @ $150
      updatePosition(symbol, 'BUY', 100, 150);

      let position = readModelStore.getPosition(symbol);
      expect(position).toBeDefined();
      expect(position!.qty).toBe(100);
      expect(position!.avgPrice).toBe(150);
      expect(position!.realizedPnl).toBe(0);

      // Partially close: SELL 60 @ $155
      updatePosition(symbol, 'SELL', 60, 155);

      position = readModelStore.getPosition(symbol);
      expect(position).toBeDefined();
      expect(position!.qty).toBe(40); // 100 - 60
      expect(position!.avgPrice).toBe(150); // avgPrice should remain the same
      // realizedPnl = 60 * (155 - 150) = 300
      expect(position!.realizedPnl).toBe(300);
    });

    it('should fully close long position and set qty to 0', () => {
      const symbol = 'TSLA';

      // Build long position: BUY 50 @ $200
      updatePosition(symbol, 'BUY', 50, 200);

      // Fully close: SELL 50 @ $210
      updatePosition(symbol, 'SELL', 50, 210);

      const position = readModelStore.getPosition(symbol);
      expect(position).toBeDefined();
      expect(position!.qty).toBe(0);
      expect(position!.avgPrice).toBe(0); // Reset to 0 when flat
      // realizedPnl = 50 * (210 - 200) = 500
      expect(position!.realizedPnl).toBe(500);
    });
  });

  describe('Case 2: Close Short Position (BUY reducing short)', () => {
    it('should calculate realizedPnl and update position correctly when partially closing short', () => {
      const symbol = 'NVDA';

      // Build short position: SELL 100 @ $500
      updatePosition(symbol, 'SELL', 100, 500);

      let position = readModelStore.getPosition(symbol);
      expect(position).toBeDefined();
      expect(position!.qty).toBe(-100);
      expect(position!.avgPrice).toBe(500);
      expect(position!.realizedPnl).toBe(0);

      // Partially cover: BUY 40 @ $490
      updatePosition(symbol, 'BUY', 40, 490);

      position = readModelStore.getPosition(symbol);
      expect(position).toBeDefined();
      expect(position!.qty).toBe(-60); // -100 + 40
      expect(position!.avgPrice).toBe(500); // avgPrice should remain the same
      // realizedPnl for short = 40 * (500 - 490) = 400
      expect(position!.realizedPnl).toBe(400);
    });

    it('should fully close short position and set qty to 0', () => {
      const symbol = 'AMD';

      // Build short position: SELL 80 @ $100
      updatePosition(symbol, 'SELL', 80, 100);

      // Fully cover: BUY 80 @ $95
      updatePosition(symbol, 'BUY', 80, 95);

      const position = readModelStore.getPosition(symbol);
      expect(position).toBeDefined();
      expect(position!.qty).toBe(0);
      expect(position!.avgPrice).toBe(0); // Reset to 0 when flat
      // realizedPnl for short = 80 * (100 - 95) = 400
      expect(position!.realizedPnl).toBe(400);
    });
  });

  describe('Case 3: Flip Long to Short (SELL more than long qty)', () => {
    it('should calculate realizedPnl, flip position, and set new avgPrice', () => {
      const symbol = 'MSFT';

      // Build long position: BUY 50 @ $300
      updatePosition(symbol, 'BUY', 50, 300);

      // Flip to short: SELL 80 @ $310 (closes 50, then shorts 30)
      updatePosition(symbol, 'SELL', 80, 310);

      const position = readModelStore.getPosition(symbol);
      expect(position).toBeDefined();
      expect(position!.qty).toBe(-30); // 50 - 80
      expect(position!.avgPrice).toBe(310); // New short position at 310
      // realizedPnl = 50 * (310 - 300) = 500 (profit from closing long)
      expect(position!.realizedPnl).toBe(500);
    });
  });

  describe('Case 4: Flip Short to Long (BUY more than short qty)', () => {
    it('should calculate realizedPnl, flip position, and set new avgPrice', () => {
      const symbol = 'GOOGL';

      // Build short position: SELL 60 @ $140
      updatePosition(symbol, 'SELL', 60, 140);

      let position = readModelStore.getPosition(symbol);
      expect(position).toBeDefined();
      expect(position!.qty).toBe(-60);
      expect(position!.avgPrice).toBe(140);

      // Flip to long: BUY 100 @ $135 (covers 60, then longs 40)
      updatePosition(symbol, 'BUY', 100, 135);

      position = readModelStore.getPosition(symbol);
      expect(position).toBeDefined();
      expect(position!.qty).toBe(40); // -60 + 100
      expect(position!.avgPrice).toBe(135); // New long position at 135
      // realizedPnl for short = 60 * (140 - 135) = 300 (profit from covering short)
      expect(position!.realizedPnl).toBe(300);
    });
  });

  describe('Edge Cases', () => {
    it('should handle multiple trades accumulating realizedPnl', () => {
      const symbol = 'SPY';

      // Trade 1: BUY 100 @ $400
      updatePosition(symbol, 'BUY', 100, 400);

      // Trade 2: SELL 50 @ $410 (partial close, +500 PnL)
      updatePosition(symbol, 'SELL', 50, 410);

      let position = readModelStore.getPosition(symbol);
      expect(position!.qty).toBe(50);
      expect(position!.realizedPnl).toBe(500); // 50 * (410 - 400)

      // Trade 3: SELL 50 @ $405 (full close, +250 PnL)
      updatePosition(symbol, 'SELL', 50, 405);

      position = readModelStore.getPosition(symbol);
      expect(position!.qty).toBe(0);
      expect(position!.avgPrice).toBe(0);
      expect(position!.realizedPnl).toBe(750); // 500 + 250
    });

    it('should handle loss scenarios correctly', () => {
      const symbol = 'META';

      // BUY 100 @ $300
      updatePosition(symbol, 'BUY', 100, 300);

      // SELL 100 @ $290 (loss)
      updatePosition(symbol, 'SELL', 100, 290);

      const position = readModelStore.getPosition(symbol);
      expect(position!.qty).toBe(0);
      expect(position!.realizedPnl).toBe(-1000); // 100 * (290 - 300)
    });
  });
});
