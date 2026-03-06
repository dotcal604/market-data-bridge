"""
04_load_bars_to_ddb.py — Load Parquet bar files into DuckDB.

Usage:
    python scripts/04_load_bars_to_ddb.py
"""

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from config.settings import PARQUET_DIR
from engine.data_loader import get_db, ensure_schema


def main():
    parquet_files = list(PARQUET_DIR.glob("*.parquet"))
    if not parquet_files:
        print(f"ERROR: No parquet files found in {PARQUET_DIR}")
        print("  Run 03_fetch_bars.py first.")
        sys.exit(1)

    print(f"Found {len(parquet_files)} parquet files")

    db = get_db()
    ensure_schema(db)

    # Clear existing bars
    db.execute("DELETE FROM bars")

    t0 = time.time()

    # DuckDB reads parquet natively — use glob pattern
    # We need to extract symbol from filename: AAPL_2024-01-15.parquet -> AAPL
    glob_pattern = str(PARQUET_DIR / "*.parquet").replace("\\", "/")

    db.execute(f"""
        INSERT OR REPLACE INTO bars
        SELECT
            regexp_extract(filename, '([A-Z]+)_\\d{{4}}-\\d{{2}}-\\d{{2}}\\.parquet$', 1) AS symbol,
            timestamp AS bar_time,
            open, high, low, close,
            volume, vwap, num_trades
        FROM read_parquet('{glob_pattern}', filename=true)
    """)

    elapsed = time.time() - t0

    # Stats
    stats = db.execute("""
        SELECT
            COUNT(*) as total_bars,
            COUNT(DISTINCT symbol) as unique_symbols,
            MIN(bar_time) as first_bar,
            MAX(bar_time) as last_bar
        FROM bars
    """).fetchone()

    print(f"\nLoaded in {elapsed:.1f}s")
    print(f"  Total bars:      {stats[0]:,}")
    print(f"  Unique symbols:  {stats[1]}")
    print(f"  Date range:      {stats[2]} to {stats[3]}")

    # Verify coverage against trades
    coverage = db.execute("""
        SELECT
            COUNT(DISTINCT t.trade_id) AS trades_with_bars,
            (SELECT COUNT(*) FROM trades) AS total_trades
        FROM trades t
        WHERE EXISTS (
            SELECT 1 FROM bars b
            WHERE b.symbol = t.symbol
            AND CAST(b.bar_time AS DATE) = CAST(t.entry_time AS DATE)
        )
    """).fetchone()

    print(f"  Trades with bar data: {coverage[0]}/{coverage[1]} "
          f"({coverage[0] / max(coverage[1], 1) * 100:.1f}%)")

    db.close()
    print("Done.")


if __name__ == "__main__":
    main()
