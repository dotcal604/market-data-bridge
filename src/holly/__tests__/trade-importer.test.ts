import { describe, it, expect, beforeEach } from 'vitest';
import Database, { type Database as DatabaseType } from 'better-sqlite3';
import { 
  parseRow, 
  importHollyTrades, 
  queryTrades, 
  getTradeStats,
  type HollyTradeRow,
  type ImportResult 
} from '../trade-importer.js';

// ── Test Database Setup ───────────────────────────────────────────────────

function createTestDb(): DatabaseType {
  const db = new Database(':memory:');
  
  // Create holly_trades table matching the expected schema
  db.exec(`
    CREATE TABLE holly_trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      entry_time TEXT NOT NULL,
      exit_time TEXT NOT NULL,
      entry_price REAL NOT NULL,
      exit_price REAL NOT NULL,
      size INTEGER NOT NULL,
      side TEXT NOT NULL,
      stop_price REAL,
      target_price REAL,
      max_price REAL,
      min_price REAL,
      strategy TEXT,
      notes TEXT,
      hold_minutes INTEGER NOT NULL,
      mfe REAL NOT NULL,
      mae REAL NOT NULL,
      r_multiple REAL,
      pnl REAL NOT NULL,
      pnl_pct REAL NOT NULL,
      giveback REAL,
      giveback_ratio REAL,
      time_to_mfe_min INTEGER,
      import_batch TEXT NOT NULL,
      imported_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(symbol, entry_time, exit_time)
    );
    
    CREATE INDEX idx_holly_trades_symbol ON holly_trades(symbol);
    CREATE INDEX idx_holly_trades_entry ON holly_trades(entry_time);
    CREATE INDEX idx_holly_trades_batch ON holly_trades(import_batch);
  `);
  
  return db;
}

function bulkInsertHollyTrades(db: DatabaseType) {
  return (rows: Array<Record<string, unknown>>): { inserted: number; skipped: number } => {
    let inserted = 0;
    let skipped = 0;
    
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO holly_trades (
        symbol, entry_time, exit_time, entry_price, exit_price, size, side,
        stop_price, target_price, max_price, min_price, strategy, notes,
        hold_minutes, mfe, mae, r_multiple, pnl, pnl_pct, giveback, 
        giveback_ratio, time_to_mfe_min, import_batch
      ) VALUES (
        @symbol, @entry_time, @exit_time, @entry_price, @exit_price, @size, @side,
        @stop_price, @target_price, @max_price, @min_price, @strategy, @notes,
        @hold_minutes, @mfe, @mae, @r_multiple, @pnl, @pnl_pct, @giveback,
        @giveback_ratio, @time_to_mfe_min, @import_batch
      )
    `);
    
    const insertTx = db.transaction((trades: Array<Record<string, unknown>>) => {
      for (const row of trades) {
        const result = stmt.run(row);
        if (result.changes > 0) {
          inserted++;
        } else {
          skipped++;
        }
      }
    });
    
    insertTx(rows);
    return { inserted, skipped };
  };
}

// ── Test Helpers ──────────────────────────────────────────────────────────

const HEADER = [
  "Symbol", "Entry Time", "Exit Time", "Entry Price", "Exit Price", "Size", "Side",
  "Stop Price", "Target Price", "Max Price", "Min Price", "Strategy", "Notes"
].join(",");

function makeRow(overrides: Partial<Record<string, string>> = {}): string {
  const defaults: Record<string, string> = {
    "Symbol": "AAPL",
    "Entry Time": "Feb 12, 2026 10:30:00",
    "Exit Time": "Feb 12, 2026 11:45:00",
    "Entry Price": "$150.00",
    "Exit Price": "$152.50",
    "Size": "100",
    "Side": "LONG",
    "Stop Price": "$149.00",
    "Target Price": "$155.00",
    "Max Price": "$153.00",
    "Min Price": "$149.50",
    "Strategy": "Holly Grail",
    "Notes": "",
  };
  
  const merged = { ...defaults, ...overrides };
  
  // Quote fields that contain commas
  const quoteIfNeeded = (val: string) => {
    if (val.includes(",")) {
      return `"${val}"`;
    }
    return val;
  };
  
  return [
    "Symbol", "Entry Time", "Exit Time", "Entry Price", "Exit Price", "Size", "Side",
    "Stop Price", "Target Price", "Max Price", "Min Price", "Strategy", "Notes"
  ].map((key) => quoteIfNeeded(merged[key] || "")).join(",");
}

// ── parseRow Tests ────────────────────────────────────────────────────────

describe("Holly Trade Importer - parseRow", () => {
  describe("Date Parsing with Commas", () => {
    it("parses dates with commas (Feb 12, 2026 10:30:00)", () => {
      const record = {
        "Symbol": "AAPL",
        "Entry Time": "Feb 12, 2026 10:30:00",
        "Exit Time": "Feb 12, 2026 11:45:00",
        "Entry Price": "150.00",
        "Exit Price": "152.50",
        "Size": "100",
        "Side": "LONG",
        "Stop Price": "149.00",
        "Target Price": "155.00",
        "Max Price": "153.00",
        "Min Price": "149.50",
        "Strategy": "Holly Grail",
        "Notes": "",
      };
      
      const result = parseRow(record);
      
      expect(result.symbol).toBe("AAPL");
      expect(result.entry_time).toMatch(/2026-02-12/);
      expect(result.exit_time).toMatch(/2026-02-12/);
    });
    
    it("handles ISO format dates (2026-02-12 10:30:00)", () => {
      const record = {
        "Symbol": "TSLA",
        "Entry Time": "2026-02-12 10:30:00",
        "Exit Time": "2026-02-12 11:45:00",
        "Entry Price": "200.00",
        "Exit Price": "205.00",
        "Size": "50",
        "Side": "LONG",
        "Stop Price": "",
        "Target Price": "",
        "Max Price": "",
        "Min Price": "",
        "Strategy": "",
        "Notes": "",
      };
      
      const result = parseRow(record);
      
      expect(result.symbol).toBe("TSLA");
      expect(result.entry_time).toMatch(/2026-02-12/);
    });
    
    it("handles malformed dates gracefully", () => {
      const record = {
        "Symbol": "NVDA",
        "Entry Time": "invalid date",
        "Exit Time": "also invalid",
        "Entry Price": "500.00",
        "Exit Price": "510.00",
        "Size": "10",
        "Side": "LONG",
        "Stop Price": "",
        "Target Price": "",
        "Max Price": "",
        "Min Price": "",
        "Strategy": "",
        "Notes": "",
      };
      
      const result = parseRow(record);
      
      expect(result.symbol).toBe("NVDA");
      expect(result.entry_time).toBe("invalid date");
      expect(result.exit_time).toBe("also invalid");
    });
  });
  
  describe("Numeric Parsing", () => {
    it("strips dollar signs and commas from prices", () => {
      const record = {
        "Symbol": "AAPL",
        "Entry Time": "2026-02-12 10:30:00",
        "Exit Time": "2026-02-12 11:45:00",
        "Entry Price": "$1,150.25",
        "Exit Price": "$1,200.75",
        "Size": "100",
        "Side": "LONG",
        "Stop Price": "$1,145.00",
        "Target Price": "$1,250.00",
        "Max Price": "$1,210.00",
        "Min Price": "$1,148.00",
        "Strategy": "",
        "Notes": "",
      };
      
      const result = parseRow(record);
      
      expect(result.entry_price).toBe(1150.25);
      expect(result.exit_price).toBe(1200.75);
      expect(result.stop_price).toBe(1145);
      expect(result.target_price).toBe(1250);
    });
    
    it("handles empty optional numeric fields", () => {
      const record = {
        "Symbol": "MSFT",
        "Entry Time": "2026-02-12 10:30:00",
        "Exit Time": "2026-02-12 11:45:00",
        "Entry Price": "300.00",
        "Exit Price": "305.00",
        "Size": "50",
        "Side": "LONG",
        "Stop Price": "",
        "Target Price": "",
        "Max Price": "",
        "Min Price": "",
        "Strategy": "",
        "Notes": "",
      };
      
      const result = parseRow(record);
      
      expect(result.stop_price).toBeNull();
      expect(result.target_price).toBeNull();
      expect(result.max_price).toBeNull();
      expect(result.min_price).toBeNull();
    });
  });
  
  describe("Derived Field Computation", () => {
    describe("hold_minutes", () => {
      it("calculates hold time correctly", () => {
        const record = {
          "Symbol": "AAPL",
          "Entry Time": "2026-02-12 10:00:00",
          "Exit Time": "2026-02-12 12:30:00",  // 2.5 hours = 150 minutes
          "Entry Price": "150.00",
          "Exit Price": "152.00",
          "Size": "100",
          "Side": "LONG",
          "Stop Price": "",
          "Target Price": "",
          "Max Price": "",
          "Min Price": "",
          "Strategy": "",
          "Notes": "",
        };
        
        const result = parseRow(record);
        
        expect(result.hold_minutes).toBe(150);
      });
      
      it("handles same entry and exit time", () => {
        const record = {
          "Symbol": "TSLA",
          "Entry Time": "2026-02-12 10:00:00",
          "Exit Time": "2026-02-12 10:00:00",
          "Entry Price": "200.00",
          "Exit Price": "201.00",
          "Size": "50",
          "Side": "LONG",
          "Stop Price": "",
          "Target Price": "",
          "Max Price": "",
          "Min Price": "",
          "Strategy": "",
          "Notes": "",
        };
        
        const result = parseRow(record);
        
        expect(result.hold_minutes).toBe(0);
      });
    });
    
    describe("MFE (Max Favorable Excursion)", () => {
      it("calculates MFE for LONG trades", () => {
        const record = {
          "Symbol": "AAPL",
          "Entry Time": "2026-02-12 10:00:00",
          "Exit Time": "2026-02-12 11:00:00",
          "Entry Price": "100.00",
          "Exit Price": "102.00",
          "Size": "100",
          "Side": "LONG",
          "Stop Price": "",
          "Target Price": "",
          "Max Price": "103.00",  // Peak was $3 above entry
          "Min Price": "99.50",
          "Strategy": "",
          "Notes": "",
        };
        
        const result = parseRow(record);
        
        // MFE = (103 - 100) * 100 = $300
        expect(result.mfe).toBe(300);
      });
      
      it("calculates MFE for SHORT trades", () => {
        const record = {
          "Symbol": "TSLA",
          "Entry Time": "2026-02-12 10:00:00",
          "Exit Time": "2026-02-12 11:00:00",
          "Entry Price": "200.00",
          "Exit Price": "198.00",
          "Size": "50",
          "Side": "SHORT",
          "Stop Price": "",
          "Target Price": "",
          "Max Price": "201.00",
          "Min Price": "197.00",  // Trough was $3 below entry
          "Strategy": "",
          "Notes": "",
        };
        
        const result = parseRow(record);
        
        // MFE for short = (200 - 197) * 50 = $150
        expect(result.mfe).toBe(150);
      });
      
      it("handles missing max/min price (uses entry as peak)", () => {
        const record = {
          "Symbol": "NVDA",
          "Entry Time": "2026-02-12 10:00:00",
          "Exit Time": "2026-02-12 11:00:00",
          "Entry Price": "500.00",
          "Exit Price": "505.00",
          "Size": "10",
          "Side": "LONG",
          "Stop Price": "",
          "Target Price": "",
          "Max Price": "",
          "Min Price": "",
          "Strategy": "",
          "Notes": "",
        };
        
        const result = parseRow(record);
        
        // Without max_price, MFE = 0 (entry price used)
        expect(result.mfe).toBe(0);
      });
    });
    
    describe("MAE (Max Adverse Excursion)", () => {
      it("calculates MAE for LONG trades", () => {
        const record = {
          "Symbol": "AAPL",
          "Entry Time": "2026-02-12 10:00:00",
          "Exit Time": "2026-02-12 11:00:00",
          "Entry Price": "100.00",
          "Exit Price": "102.00",
          "Size": "100",
          "Side": "LONG",
          "Stop Price": "",
          "Target Price": "",
          "Max Price": "103.00",
          "Min Price": "98.00",  // Dropped $2 below entry
          "Strategy": "",
          "Notes": "",
        };
        
        const result = parseRow(record);
        
        // MAE = abs(min(0, (98 - 100) * 100)) = abs(-200) = $200
        expect(result.mae).toBe(200);
      });
      
      it("calculates MAE for SHORT trades", () => {
        const record = {
          "Symbol": "TSLA",
          "Entry Time": "2026-02-12 10:00:00",
          "Exit Time": "2026-02-12 11:00:00",
          "Entry Price": "200.00",
          "Exit Price": "198.00",
          "Size": "50",
          "Side": "SHORT",
          "Stop Price": "",
          "Target Price": "",
          "Max Price": "202.50",  // Rose $2.50 above entry
          "Min Price": "197.00",
          "Strategy": "",
          "Notes": "",
        };
        
        const result = parseRow(record);
        
        // MAE for short = abs(min(0, (200 - 202.5) * 50)) = abs(-125) = $125
        expect(result.mae).toBe(125);
      });
    });
    
    describe("r_multiple", () => {
      it("calculates R-multiple for winning trade", () => {
        const record = {
          "Symbol": "AAPL",
          "Entry Time": "2026-02-12 10:00:00",
          "Exit Time": "2026-02-12 11:00:00",
          "Entry Price": "100.00",
          "Exit Price": "103.00",  // +$3 profit
          "Size": "100",
          "Side": "LONG",
          "Stop Price": "99.00",  // $1 risk per share
          "Target Price": "",
          "Max Price": "",
          "Min Price": "",
          "Strategy": "",
          "Notes": "",
        };
        
        const result = parseRow(record);
        
        // PnL = (103 - 100) * 100 = $300
        // Risk = (100 - 99) * 100 = $100
        // R = 300 / 100 = 3R
        expect(result.r_multiple).toBe(3);
      });
      
      it("calculates R-multiple for losing trade", () => {
        const record = {
          "Symbol": "TSLA",
          "Entry Time": "2026-02-12 10:00:00",
          "Exit Time": "2026-02-12 11:00:00",
          "Entry Price": "200.00",
          "Exit Price": "199.50",  // -$0.50 loss per share
          "Size": "100",
          "Side": "LONG",
          "Stop Price": "199.00",  // $1 risk per share
          "Target Price": "",
          "Max Price": "",
          "Min Price": "",
          "Strategy": "",
          "Notes": "",
        };
        
        const result = parseRow(record);
        
        // PnL = (199.5 - 200) * 100 = -$50
        // Risk = (200 - 199) * 100 = $100
        // R = -50 / 100 = -0.5R
        expect(result.r_multiple).toBe(-0.5);
      });
      
      it("returns null when stop price is missing", () => {
        const record = {
          "Symbol": "NVDA",
          "Entry Time": "2026-02-12 10:00:00",
          "Exit Time": "2026-02-12 11:00:00",
          "Entry Price": "500.00",
          "Exit Price": "510.00",
          "Size": "10",
          "Side": "LONG",
          "Stop Price": "",  // No stop
          "Target Price": "",
          "Max Price": "",
          "Min Price": "",
          "Strategy": "",
          "Notes": "",
        };
        
        const result = parseRow(record);
        
        expect(result.r_multiple).toBeNull();
      });
      
      it("returns null when risk is zero", () => {
        const record = {
          "Symbol": "MSFT",
          "Entry Time": "2026-02-12 10:00:00",
          "Exit Time": "2026-02-12 11:00:00",
          "Entry Price": "300.00",
          "Exit Price": "305.00",
          "Size": "50",
          "Side": "LONG",
          "Stop Price": "300.00",  // Stop at entry (zero risk)
          "Target Price": "",
          "Max Price": "",
          "Min Price": "",
          "Strategy": "",
          "Notes": "",
        };
        
        const result = parseRow(record);
        
        expect(result.r_multiple).toBeNull();
      });
    });
    
    describe("giveback and giveback_ratio", () => {
      it("calculates giveback when exit is below MFE peak", () => {
        const record = {
          "Symbol": "AAPL",
          "Entry Time": "2026-02-12 10:00:00",
          "Exit Time": "2026-02-12 11:00:00",
          "Entry Price": "100.00",
          "Exit Price": "102.00",
          "Size": "100",
          "Side": "LONG",
          "Stop Price": "",
          "Target Price": "",
          "Max Price": "104.00",  // Peak was $4 above entry
          "Min Price": "",
          "Strategy": "",
          "Notes": "",
        };
        
        const result = parseRow(record);
        
        // MFE = (104 - 100) * 100 = $400
        // PnL = (102 - 100) * 100 = $200
        // Giveback = 400 - 200 = $200
        // Giveback ratio = 200 / 400 = 0.5
        expect(result.mfe).toBe(400);
        expect(result.pnl).toBe(200);
        expect(result.giveback).toBe(200);
        expect(result.giveback_ratio).toBe(0.5);
      });
      
      it("returns 0 giveback when exit is at MFE peak", () => {
        const record = {
          "Symbol": "TSLA",
          "Entry Time": "2026-02-12 10:00:00",
          "Exit Time": "2026-02-12 11:00:00",
          "Entry Price": "200.00",
          "Exit Price": "205.00",
          "Size": "100",
          "Side": "LONG",
          "Stop Price": "",
          "Target Price": "",
          "Max Price": "205.00",  // Exit at peak
          "Min Price": "",
          "Strategy": "",
          "Notes": "",
        };
        
        const result = parseRow(record);
        
        // MFE = PnL = $500, so giveback = 0
        expect(result.giveback).toBe(0);
        expect(result.giveback_ratio).toBe(0);
      });
      
      it("returns null when MFE is zero", () => {
        const record = {
          "Symbol": "NVDA",
          "Entry Time": "2026-02-12 10:00:00",
          "Exit Time": "2026-02-12 11:00:00",
          "Entry Price": "500.00",
          "Exit Price": "495.00",
          "Size": "10",
          "Side": "LONG",
          "Stop Price": "",
          "Target Price": "",
          "Max Price": "",  // No max_price, so MFE = 0
          "Min Price": "",
          "Strategy": "",
          "Notes": "",
        };
        
        const result = parseRow(record);
        
        expect(result.mfe).toBe(0);
        expect(result.giveback).toBeNull();
        expect(result.giveback_ratio).toBeNull();
      });
    });
    
    describe("time_to_mfe_min", () => {
      it("parses time to MFE from notes field", () => {
        const record = {
          "Symbol": "AAPL",
          "Entry Time": "2026-02-12 10:00:00",
          "Exit Time": "2026-02-12 11:00:00",
          "Entry Price": "100.00",
          "Exit Price": "102.00",
          "Size": "100",
          "Side": "LONG",
          "Stop Price": "",
          "Target Price": "",
          "Max Price": "104.00",
          "Min Price": "",
          "Strategy": "",
          "Notes": "mfe_time:15",  // Peak reached at 15 minutes
        };
        
        const result = parseRow(record);
        
        expect(result.time_to_mfe_min).toBe(15);
      });
      
      it("returns null when mfe_time not in notes", () => {
        const record = {
          "Symbol": "TSLA",
          "Entry Time": "2026-02-12 10:00:00",
          "Exit Time": "2026-02-12 11:00:00",
          "Entry Price": "200.00",
          "Exit Price": "205.00",
          "Size": "100",
          "Side": "LONG",
          "Stop Price": "",
          "Target Price": "",
          "Max Price": "210.00",
          "Min Price": "",
          "Strategy": "",
          "Notes": "some other note",
        };
        
        const result = parseRow(record);
        
        expect(result.time_to_mfe_min).toBeNull();
      });
      
      it("returns null when notes is empty", () => {
        const record = {
          "Symbol": "NVDA",
          "Entry Time": "2026-02-12 10:00:00",
          "Exit Time": "2026-02-12 11:00:00",
          "Entry Price": "500.00",
          "Exit Price": "510.00",
          "Size": "10",
          "Side": "LONG",
          "Stop Price": "",
          "Target Price": "",
          "Max Price": "",
          "Min Price": "",
          "Strategy": "",
          "Notes": "",
        };
        
        const result = parseRow(record);
        
        expect(result.time_to_mfe_min).toBeNull();
      });
    });
    
    describe("PnL and PnL%", () => {
      it("calculates PnL for LONG trades", () => {
        const record = {
          "Symbol": "AAPL",
          "Entry Time": "2026-02-12 10:00:00",
          "Exit Time": "2026-02-12 11:00:00",
          "Entry Price": "100.00",
          "Exit Price": "105.00",
          "Size": "100",
          "Side": "LONG",
          "Stop Price": "",
          "Target Price": "",
          "Max Price": "",
          "Min Price": "",
          "Strategy": "",
          "Notes": "",
        };
        
        const result = parseRow(record);
        
        expect(result.pnl).toBe(500);  // (105 - 100) * 100
        expect(result.pnl_pct).toBe(5);  // 500 / (100 * 100) * 100
      });
      
      it("calculates PnL for SHORT trades", () => {
        const record = {
          "Symbol": "TSLA",
          "Entry Time": "2026-02-12 10:00:00",
          "Exit Time": "2026-02-12 11:00:00",
          "Entry Price": "200.00",
          "Exit Price": "195.00",
          "Size": "50",
          "Side": "SHORT",
          "Stop Price": "",
          "Target Price": "",
          "Max Price": "",
          "Min Price": "",
          "Strategy": "",
          "Notes": "",
        };
        
        const result = parseRow(record);
        
        expect(result.pnl).toBe(250);  // (200 - 195) * 50
        expect(result.pnl_pct).toBe(2.5);  // 250 / (200 * 50) * 100
      });
    });
  });
  
  describe("Edge Cases", () => {
    it("handles zero size", () => {
      const record = {
        "Symbol": "AAPL",
        "Entry Time": "2026-02-12 10:00:00",
        "Exit Time": "2026-02-12 11:00:00",
        "Entry Price": "100.00",
        "Exit Price": "105.00",
        "Size": "0",
        "Side": "LONG",
        "Stop Price": "",
        "Target Price": "",
        "Max Price": "",
        "Min Price": "",
        "Strategy": "",
        "Notes": "",
      };
      
      const result = parseRow(record);
      
      expect(result.size).toBe(0);
      expect(result.pnl).toBe(0);
      expect(result.mfe).toBe(0);
      expect(result.mae).toBe(0);
    });
    
    it("normalizes symbols to uppercase", () => {
      const record = {
        "Symbol": "aapl",
        "Entry Time": "2026-02-12 10:00:00",
        "Exit Time": "2026-02-12 11:00:00",
        "Entry Price": "100.00",
        "Exit Price": "105.00",
        "Size": "100",
        "Side": "LONG",
        "Stop Price": "",
        "Target Price": "",
        "Max Price": "",
        "Min Price": "",
        "Strategy": "",
        "Notes": "",
      };
      
      const result = parseRow(record);
      
      expect(result.symbol).toBe("AAPL");
    });
    
    it("defaults side to LONG", () => {
      const record = {
        "Symbol": "MSFT",
        "Entry Time": "2026-02-12 10:00:00",
        "Exit Time": "2026-02-12 11:00:00",
        "Entry Price": "300.00",
        "Exit Price": "305.00",
        "Size": "50",
        "Side": "",
        "Stop Price": "",
        "Target Price": "",
        "Max Price": "",
        "Min Price": "",
        "Strategy": "",
        "Notes": "",
      };
      
      const result = parseRow(record);
      
      expect(result.side).toBe("LONG");
    });
  });
});

// ── importHollyTrades Tests ───────────────────────────────────────────────

describe("Holly Trade Importer - importHollyTrades", () => {
  let db: DatabaseType;
  let insertFn: (rows: Array<Record<string, unknown>>) => { inserted: number; skipped: number };
  
  beforeEach(() => {
    db = createTestDb();
    insertFn = bulkInsertHollyTrades(db);
  });
  
  describe("Basic Import", () => {
    it("imports a basic CSV and returns correct counts", () => {
      const csv = [
        HEADER,
        makeRow({ "Symbol": "AAPL" }),
        makeRow({ "Symbol": "MSFT" }),
      ].join("\n");
      
      const result = importHollyTrades(csv, insertFn);
      
      expect(result.total_parsed).toBe(2);
      expect(result.inserted).toBe(2);
      expect(result.skipped).toBe(0);
      expect(result.errors).toHaveLength(0);
      expect(result.batch_id).toMatch(/^[0-9a-f]{8}$/);
    });
    
    it("stores all parsed data correctly in database", () => {
      const csv = [
        HEADER,
        makeRow({ 
          "Symbol": "TSLA",
          "Entry Price": "$200.00",
          "Exit Price": "$205.00",
          "Size": "100",
        }),
      ].join("\n");
      
      importHollyTrades(csv, insertFn);
      
      const rows = db.prepare("SELECT * FROM holly_trades WHERE symbol = ?").all("TSLA");
      expect(rows).toHaveLength(1);
      
      const row = rows[0] as any;
      expect(row.symbol).toBe("TSLA");
      expect(row.entry_price).toBe(200);
      expect(row.exit_price).toBe(205);
      expect(row.size).toBe(100);
      expect(row.pnl).toBe(500);
    });
  });
  
  describe("Deduplication", () => {
    it("deduplicates by (symbol, entry_time, exit_time)", () => {
      const csv = [
        HEADER,
        makeRow({ "Symbol": "AAPL", "Entry Time": "Feb 12, 2026 10:00:00", "Exit Time": "Feb 12, 2026 11:00:00" }),
      ].join("\n");
      
      const result1 = importHollyTrades(csv, insertFn);
      expect(result1.inserted).toBe(1);
      expect(result1.skipped).toBe(0);
      
      const result2 = importHollyTrades(csv, insertFn);
      expect(result2.inserted).toBe(0);
      expect(result2.skipped).toBe(1);
    });
    
    it("allows same symbol with different times", () => {
      const csv = [
        HEADER,
        makeRow({ "Symbol": "AAPL", "Entry Time": "Feb 12, 2026 10:00:00" }),
        makeRow({ "Symbol": "AAPL", "Entry Time": "Feb 12, 2026 14:00:00" }),
      ].join("\n");
      
      const result = importHollyTrades(csv, insertFn);
      
      expect(result.inserted).toBe(2);
      expect(result.skipped).toBe(0);
    });
  });
  
  describe("BOM Stripping", () => {
    it("strips UTF-8 BOM from CSV content", () => {
      const bomChar = String.fromCharCode(0xFEFF);
      const csv = bomChar + [
        HEADER,
        makeRow({ "Symbol": "AAPL" }),
      ].join("\n");
      
      const result = importHollyTrades(csv, insertFn);
      
      expect(result.inserted).toBe(1);
      expect(result.errors).toHaveLength(0);
      
      const rows = db.prepare("SELECT * FROM holly_trades").all();
      expect(rows).toHaveLength(1);
    });
    
    it("handles CSV without BOM normally", () => {
      const csv = [
        HEADER,
        makeRow({ "Symbol": "MSFT" }),
      ].join("\n");
      
      const result = importHollyTrades(csv, insertFn);
      
      expect(result.inserted).toBe(1);
      expect(result.errors).toHaveLength(0);
    });
  });
  
  describe("Error Handling", () => {
    it("skips rows without symbols", () => {
      const csv = [
        HEADER,
        makeRow({ "Symbol": "" }),
        makeRow({ "Symbol": "AAPL" }),
      ].join("\n");
      
      const result = importHollyTrades(csv, insertFn);
      
      expect(result.total_parsed).toBe(2);
      expect(result.inserted).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatch(/row 2.*missing symbol/i);
    });
    
    it("handles empty CSV", () => {
      const result = importHollyTrades("", insertFn);
      
      expect(result.total_parsed).toBe(0);
      expect(result.inserted).toBe(0);
      expect(result.errors).toHaveLength(0);
    });
    
    it("handles header-only CSV", () => {
      const result = importHollyTrades(HEADER, insertFn);
      
      expect(result.total_parsed).toBe(0);
      expect(result.inserted).toBe(0);
      expect(result.errors).toHaveLength(0);
    });
    
    it("returns parse error for malformed CSV", () => {
      const malformedCSV = 'Symbol,"Unclosed quote\nAPPL,100';
      
      const result = importHollyTrades(malformedCSV, insertFn);
      
      expect(result.inserted).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatch(/CSV parse error/i);
    });
  });
  
  describe("Batch Tracking", () => {
    it("assigns unique batch_id to each import", () => {
      const csv = [HEADER, makeRow({ "Symbol": "AAPL" })].join("\n");
      
      const result1 = importHollyTrades(csv, insertFn);
      const result2 = importHollyTrades(csv, insertFn);
      
      expect(result1.batch_id).not.toBe(result2.batch_id);
    });
    
    it("stores batch_id in database", () => {
      const csv = [HEADER, makeRow({ "Symbol": "NVDA" })].join("\n");
      
      const result = importHollyTrades(csv, insertFn);
      
      const rows = db.prepare("SELECT * FROM holly_trades WHERE symbol = ?").all("NVDA");
      expect(rows).toHaveLength(1);
      expect((rows[0] as any).import_batch).toBe(result.batch_id);
    });
  });
});

// ── Query Helper Tests ────────────────────────────────────────────────────

describe("Holly Trade Importer - Query Helpers", () => {
  let db: DatabaseType;
  let insertFn: (rows: Array<Record<string, unknown>>) => { inserted: number; skipped: number };
  
  beforeEach(() => {
    db = createTestDb();
    insertFn = bulkInsertHollyTrades(db);
    
    // Insert test data
    const csv = [
      HEADER,
      makeRow({ "Symbol": "AAPL", "Side": "LONG", "Strategy": "Holly Grail", "Entry Time": "Feb 12, 2026 10:00:00" }),
      makeRow({ "Symbol": "TSLA", "Side": "SHORT", "Strategy": "Holly Neo", "Entry Time": "Feb 13, 2026 10:00:00" }),
      makeRow({ "Symbol": "AAPL", "Side": "LONG", "Strategy": "Holly Grail", "Entry Time": "Feb 14, 2026 10:00:00" }),
      makeRow({ "Symbol": "NVDA", "Side": "LONG", "Strategy": "Holly Grail", "Entry Time": "Feb 15, 2026 10:00:00" }),
    ].join("\n");
    
    importHollyTrades(csv, insertFn);
  });
  
  describe("queryTrades", () => {
    it("returns all trades when no filters provided", () => {
      const trades = queryTrades(db);
      
      expect(trades).toHaveLength(4);
    });
    
    it("filters by symbol", () => {
      const trades = queryTrades(db, { symbol: "AAPL" });
      
      expect(trades).toHaveLength(2);
      expect(trades.every((t: any) => t.symbol === "AAPL")).toBe(true);
    });
    
    it("filters by side", () => {
      const trades = queryTrades(db, { side: "SHORT" });
      
      expect(trades).toHaveLength(1);
      expect((trades[0] as any).symbol).toBe("TSLA");
    });
    
    it("filters by strategy", () => {
      const trades = queryTrades(db, { strategy: "Holly Neo" });
      
      expect(trades).toHaveLength(1);
      expect((trades[0] as any).symbol).toBe("TSLA");
    });
    
    it("respects limit parameter", () => {
      const trades = queryTrades(db, { limit: 2 });
      
      expect(trades).toHaveLength(2);
    });
    
    it("returns trades ordered by entry_time DESC", () => {
      const trades = queryTrades(db);
      
      const times = trades.map((t: any) => new Date(t.entry_time).getTime());
      const sortedTimes = [...times].sort((a, b) => b - a);
      expect(times).toEqual(sortedTimes);
    });
    
    it("combines multiple filters", () => {
      const trades = queryTrades(db, { symbol: "AAPL", side: "LONG" });
      
      expect(trades).toHaveLength(2);
      expect(trades.every((t: any) => t.symbol === "AAPL" && t.side === "LONG")).toBe(true);
    });
  });
  
  describe("getTradeStats", () => {
    it("returns aggregate statistics", () => {
      const stats = getTradeStats(db);
      
      expect(stats.total_trades).toBe(4);
      expect(stats.unique_symbols).toBe(3);
      expect(typeof stats.avg_pnl).toBe("number");
      expect(typeof stats.total_pnl).toBe("number");
      expect(typeof stats.avg_hold_minutes).toBe("number");
    });
    
    it("includes derived field averages", () => {
      const stats = getTradeStats(db);
      
      expect(stats).toHaveProperty("avg_mfe");
      expect(stats).toHaveProperty("avg_mae");
      expect(stats).toHaveProperty("avg_giveback_ratio");
      expect(stats).toHaveProperty("avg_time_to_mfe_min");
    });
    
    it("includes batch tracking", () => {
      const stats = getTradeStats(db);
      
      expect(stats.import_batches).toBe(1);  // All inserted in one batch
    });
    
    it("handles empty table", () => {
      db.exec("DELETE FROM holly_trades");
      
      const stats = getTradeStats(db);
      
      expect(stats.total_trades).toBe(0);
      expect(stats.unique_symbols).toBe(0);
    });
  });
});
