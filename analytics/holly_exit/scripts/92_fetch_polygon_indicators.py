"""
Script 92 -- Load Polygon Technical Indicators into DuckDB
==========================================================
Loads pre-fetched technical indicator parquets (RSI, MACD, EMA, SMA)
into DuckDB and builds trade-level prior-day indicator features.

Source parquets (already downloaded via Polygon.io API):
  data/indicators/rsi_14.parquet   -- ~10M rows, 5812 symbols
  data/indicators/macd.parquet     -- ~10M rows, 5811 symbols (value/signal/histogram)
  data/indicators/ema_9.parquet    -- ~10M rows, 5813 symbols
  data/indicators/ema_21.parquet   -- ~10M rows, 5811 symbols
  data/indicators/sma_20.parquet   -- ~10M rows, 5811 symbols
  data/indicators/sma_50.parquet   -- ~10M rows, 5808 symbols

Tables created:
  1. polygon_indicators   -- Unified indicator table (~60M rows)
  2. trade_indicator_features -- Per-trade prior-day values:
     - rsi_14:       RSI(14) on day before trade entry
     - macd_value:   MACD line
     - macd_signal:  MACD signal line
     - macd_hist:    MACD histogram
     - ema_9:        EMA(9) price
     - ema_21:       EMA(21) price
     - sma_20:       SMA(20) price
     - sma_50:       SMA(50) price
     - price_vs_ema9:  (close - EMA9) / EMA9
     - price_vs_ema21: (close - EMA21) / EMA21
     - price_vs_sma50: (close - SMA50) / SMA50
     - ema_spread:   (EMA9 - EMA21) / EMA21  (momentum)
     - rsi_zone:     oversold (<30) / neutral / overbought (>70)
     - macd_cross:   bullish (hist>0) / bearish (hist<0)
     - ma_trend:     uptrend (EMA9>SMA50) / downtrend

Usage:
    python scripts/92_fetch_polygon_indicators.py
"""

import sys
import time
from pathlib import Path

import duckdb
import pandas as pd

sys.path.insert(0, str(Path(__file__).parent.parent))
from config.settings import DATA_DIR, DUCKDB_PATH

INDICATORS_DIR = DATA_DIR / "indicators"

# Map filename -> indicator name
INDICATOR_FILES = {
    "rsi_14.parquet": "rsi_14",
    "macd.parquet": "macd",
    "ema_9.parquet": "ema_9",
    "ema_21.parquet": "ema_21",
    "sma_20.parquet": "sma_20",
    "sma_50.parquet": "sma_50",
}


def load_indicators(con: duckdb.DuckDBPyConnection):
    """Load all indicator parquets into a unified DuckDB table."""
    print("\nLoading indicator parquets...")

    all_dfs = []
    for filename, name in INDICATOR_FILES.items():
        filepath = INDICATORS_DIR / filename
        if not filepath.exists():
            print(f"  SKIP: {filename} not found")
            continue

        df = pd.read_parquet(filepath)
        # Standardize columns: ticker -> symbol
        df = df.rename(columns={"ticker": "symbol"})
        # Keep indicator name from filename (more specific than parquet column)
        df["indicator"] = name
        print(
            f"  {name}: {len(df):,} rows, "
            f"{df['symbol'].nunique()} symbols, "
            f"{df['date'].min()} to {df['date'].max()}"
        )
        all_dfs.append(df)

    if not all_dfs:
        print("  No indicator data found!")
        return

    full = pd.concat(all_dfs, ignore_index=True)
    full["date"] = pd.to_datetime(full["date"])
    print(f"\n  Combined: {len(full):,} rows")

    # Load into DuckDB
    con.execute("DROP TABLE IF EXISTS polygon_indicators")
    con.register("ind_df", full)
    con.execute("""
        CREATE TABLE polygon_indicators AS
        SELECT
            symbol,
            CAST(date AS DATE) AS date,
            indicator,
            CAST(value AS DOUBLE) AS value,
            CAST(signal AS DOUBLE) AS signal_value,
            CAST(histogram AS DOUBLE) AS histogram
        FROM ind_df
    """)
    cnt = con.execute("SELECT COUNT(*) FROM polygon_indicators").fetchone()[0]
    print(f"  polygon_indicators: {cnt:,} rows")

    # Verify data
    stats = con.execute("""
        SELECT indicator, COUNT(*) AS cnt, COUNT(DISTINCT symbol) AS syms
        FROM polygon_indicators
        GROUP BY indicator
        ORDER BY indicator
    """).fetchall()
    for row in stats:
        print(f"    {row[0]}: {row[1]:,} rows, {row[2]} symbols")


def build_trade_features(con: duckdb.DuckDBPyConnection):
    """Build trade-level indicator features using prior-day values."""
    print("\n  Building trade-level indicator features...")

    con.execute("DROP TABLE IF EXISTS trade_indicator_features")
    con.execute("""
        CREATE TABLE trade_indicator_features AS
        WITH trade_dates AS (
            SELECT
                trade_id,
                symbol,
                CAST(entry_time AS DATE) AS trade_date
            FROM trades
        ),
        -- Prior-day RSI(14)
        rsi_prior AS (
            SELECT DISTINCT ON (td.trade_id)
                td.trade_id,
                i.value AS rsi_14
            FROM trade_dates td
            JOIN polygon_indicators i
                ON i.symbol = td.symbol
                AND i.indicator = 'rsi_14'
                AND i.date < td.trade_date
            ORDER BY td.trade_id, i.date DESC
        ),
        -- Prior-day MACD
        macd_prior AS (
            SELECT DISTINCT ON (td.trade_id)
                td.trade_id,
                i.value AS macd_value,
                i.signal_value AS macd_signal,
                i.histogram AS macd_hist
            FROM trade_dates td
            JOIN polygon_indicators i
                ON i.symbol = td.symbol
                AND i.indicator = 'macd'
                AND i.date < td.trade_date
            ORDER BY td.trade_id, i.date DESC
        ),
        -- Prior-day EMA(9)
        ema9_prior AS (
            SELECT DISTINCT ON (td.trade_id)
                td.trade_id,
                i.value AS ema_9
            FROM trade_dates td
            JOIN polygon_indicators i
                ON i.symbol = td.symbol
                AND i.indicator = 'ema_9'
                AND i.date < td.trade_date
            ORDER BY td.trade_id, i.date DESC
        ),
        -- Prior-day EMA(21)
        ema21_prior AS (
            SELECT DISTINCT ON (td.trade_id)
                td.trade_id,
                i.value AS ema_21
            FROM trade_dates td
            JOIN polygon_indicators i
                ON i.symbol = td.symbol
                AND i.indicator = 'ema_21'
                AND i.date < td.trade_date
            ORDER BY td.trade_id, i.date DESC
        ),
        -- Prior-day SMA(20)
        sma20_prior AS (
            SELECT DISTINCT ON (td.trade_id)
                td.trade_id,
                i.value AS sma_20
            FROM trade_dates td
            JOIN polygon_indicators i
                ON i.symbol = td.symbol
                AND i.indicator = 'sma_20'
                AND i.date < td.trade_date
            ORDER BY td.trade_id, i.date DESC
        ),
        -- Prior-day SMA(50)
        sma50_prior AS (
            SELECT DISTINCT ON (td.trade_id)
                td.trade_id,
                i.value AS sma_50
            FROM trade_dates td
            JOIN polygon_indicators i
                ON i.symbol = td.symbol
                AND i.indicator = 'sma_50'
                AND i.date < td.trade_date
            ORDER BY td.trade_id, i.date DESC
        ),
        -- Prior close from bars for price-vs-MA calculations
        prior_close AS (
            SELECT DISTINCT ON (td.trade_id)
                td.trade_id,
                b.close AS prior_close
            FROM trade_dates td
            JOIN bars b
                ON b.symbol = td.symbol
                AND CAST(b.bar_time AS DATE) < td.trade_date
            ORDER BY td.trade_id, CAST(b.bar_time AS DATE) DESC
        )
        SELECT
            td.trade_id,
            td.symbol,
            td.trade_date,
            -- Raw indicator values
            r.rsi_14,
            m.macd_value,
            m.macd_signal,
            m.macd_hist,
            e9.ema_9,
            e21.ema_21,
            s20.sma_20,
            s50.sma_50,
            -- Price vs moving averages (trend proximity %)
            CASE WHEN e9.ema_9 > 0 AND pc.prior_close > 0
                THEN (pc.prior_close - e9.ema_9) / e9.ema_9
                ELSE NULL
            END AS price_vs_ema9,
            CASE WHEN e21.ema_21 > 0 AND pc.prior_close > 0
                THEN (pc.prior_close - e21.ema_21) / e21.ema_21
                ELSE NULL
            END AS price_vs_ema21,
            CASE WHEN s50.sma_50 > 0 AND pc.prior_close > 0
                THEN (pc.prior_close - s50.sma_50) / s50.sma_50
                ELSE NULL
            END AS price_vs_sma50,
            -- EMA spread (short-term momentum)
            CASE WHEN e21.ema_21 > 0 AND e9.ema_9 > 0
                THEN (e9.ema_9 - e21.ema_21) / e21.ema_21
                ELSE NULL
            END AS ema_spread,
            -- RSI zone classification
            CASE
                WHEN r.rsi_14 < 30 THEN 'oversold'
                WHEN r.rsi_14 > 70 THEN 'overbought'
                ELSE 'neutral'
            END AS rsi_zone,
            -- MACD cross state
            CASE
                WHEN m.macd_hist > 0 THEN 'bullish'
                WHEN m.macd_hist < 0 THEN 'bearish'
                ELSE 'flat'
            END AS macd_cross,
            -- EMA/SMA trend alignment
            CASE
                WHEN e9.ema_9 > s50.sma_50 THEN 'uptrend'
                WHEN e9.ema_9 < s50.sma_50 THEN 'downtrend'
                ELSE 'flat'
            END AS ma_trend,
            -- Above/below key MAs (binary)
            CASE WHEN pc.prior_close > e9.ema_9 THEN 1 ELSE 0
            END AS above_ema9,
            CASE WHEN pc.prior_close > e21.ema_21 THEN 1 ELSE 0
            END AS above_ema21,
            CASE WHEN pc.prior_close > s50.sma_50 THEN 1 ELSE 0
            END AS above_sma50
        FROM trade_dates td
        LEFT JOIN rsi_prior r ON r.trade_id = td.trade_id
        LEFT JOIN macd_prior m ON m.trade_id = td.trade_id
        LEFT JOIN ema9_prior e9 ON e9.trade_id = td.trade_id
        LEFT JOIN ema21_prior e21 ON e21.trade_id = td.trade_id
        LEFT JOIN sma20_prior s20 ON s20.trade_id = td.trade_id
        LEFT JOIN sma50_prior s50 ON s50.trade_id = td.trade_id
        LEFT JOIN prior_close pc ON pc.trade_id = td.trade_id
    """)

    cnt = con.execute(
        "SELECT COUNT(*) FROM trade_indicator_features"
    ).fetchone()[0]
    stats = con.execute("""
        SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN rsi_14 IS NOT NULL THEN 1 ELSE 0 END) AS has_rsi,
            SUM(CASE WHEN macd_value IS NOT NULL THEN 1 ELSE 0 END) AS has_macd,
            SUM(CASE WHEN ema_9 IS NOT NULL THEN 1 ELSE 0 END) AS has_ema9,
            SUM(CASE WHEN ema_21 IS NOT NULL THEN 1 ELSE 0 END) AS has_ema21,
            SUM(CASE WHEN sma_20 IS NOT NULL THEN 1 ELSE 0 END) AS has_sma20,
            SUM(CASE WHEN sma_50 IS NOT NULL THEN 1 ELSE 0 END) AS has_sma50,
            AVG(rsi_14) AS avg_rsi,
            AVG(price_vs_ema9) AS avg_pvs_ema9,
            AVG(ema_spread) AS avg_ema_spread
        FROM trade_indicator_features
    """).fetchone()

    print(f"  trade_indicator_features: {cnt:,} rows")
    print(f"    RSI coverage:   {stats[1]:,}/{stats[0]:,} "
          f"({100*stats[1]/stats[0]:.1f}%)")
    print(f"    MACD coverage:  {stats[2]:,}/{stats[0]:,} "
          f"({100*stats[2]/stats[0]:.1f}%)")
    print(f"    EMA(9) coverage: {stats[3]:,}/{stats[0]:,} "
          f"({100*stats[3]/stats[0]:.1f}%)")
    print(f"    EMA(21) coverage: {stats[4]:,}/{stats[0]:,} "
          f"({100*stats[4]/stats[0]:.1f}%)")
    print(f"    SMA(20) coverage: {stats[5]:,}/{stats[0]:,} "
          f"({100*stats[5]/stats[0]:.1f}%)")
    print(f"    SMA(50) coverage: {stats[6]:,}/{stats[0]:,} "
          f"({100*stats[6]/stats[0]:.1f}%)")
    print(f"    Avg RSI: {stats[7]:.1f}")
    print(f"    Avg price vs EMA9: {stats[8]:.4f}")
    print(f"    Avg EMA spread: {stats[9]:.4f}")

    # RSI zone distribution
    zones = con.execute("""
        SELECT rsi_zone, COUNT(*) AS cnt
        FROM trade_indicator_features
        WHERE rsi_zone IS NOT NULL
        GROUP BY rsi_zone
        ORDER BY cnt DESC
    """).fetchall()
    print(f"    RSI zones: {dict(zones)}")

    # MACD cross distribution
    crosses = con.execute("""
        SELECT macd_cross, COUNT(*) AS cnt
        FROM trade_indicator_features
        WHERE macd_cross IS NOT NULL
        GROUP BY macd_cross
        ORDER BY cnt DESC
    """).fetchall()
    print(f"    MACD cross: {dict(crosses)}")

    # MA trend distribution
    trends = con.execute("""
        SELECT ma_trend, COUNT(*) AS cnt
        FROM trade_indicator_features
        WHERE ma_trend IS NOT NULL
        GROUP BY ma_trend
        ORDER BY cnt DESC
    """).fetchall()
    print(f"    MA trend: {dict(trends)}")


def main():
    print("=" * 60)
    print("Load Polygon Technical Indicators into DuckDB")
    print("=" * 60)

    t0 = time.time()

    con = duckdb.connect(str(DUCKDB_PATH))
    load_indicators(con)
    build_trade_features(con)
    con.close()

    elapsed = time.time() - t0
    print(f"\nIndicator load complete in {elapsed:.1f}s")


if __name__ == "__main__":
    main()
