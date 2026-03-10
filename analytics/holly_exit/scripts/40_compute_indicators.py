"""
40_compute_indicators.py
-------------------------
Compute technical indicators (SMA, EMA, RSI, MACD) from daily bars.
Outputs to the same parquet format as Polygon indicator files so
build_silver.py picks them up seamlessly.

Covers ALL dates where daily bars exist — not limited by Polygon API range.

Usage:
    python scripts/40_compute_indicators.py                # Compute for all symbols
    python scripts/40_compute_indicators.py --symbol AAPL  # Single symbol
    python scripts/40_compute_indicators.py --dry-run      # Preview only
"""

import argparse
import sys
import time
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd

# ── project paths ──
SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR.parent))
from config.settings import DUCKDB_PATH

INDICATOR_DIR = SCRIPT_DIR.parent / "data" / "indicators"


def compute_sma(close: pd.Series, window: int) -> pd.Series:
    """Simple Moving Average."""
    return close.rolling(window=window, min_periods=window).mean()


def compute_ema(close: pd.Series, span: int) -> pd.Series:
    """Exponential Moving Average."""
    return close.ewm(span=span, adjust=False, min_periods=span).mean()


def compute_rsi(close: pd.Series, period: int = 14) -> pd.Series:
    """Relative Strength Index."""
    delta = close.diff()
    gain = delta.where(delta > 0, 0.0)
    loss = (-delta).where(delta < 0, 0.0)
    avg_gain = gain.ewm(alpha=1/period, min_periods=period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1/period, min_periods=period, adjust=False).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    return 100 - (100 / (1 + rs))


def compute_macd(close: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9):
    """MACD (value, signal, histogram)."""
    ema_fast = close.ewm(span=fast, adjust=False, min_periods=fast).mean()
    ema_slow = close.ewm(span=slow, adjust=False, min_periods=slow).mean()
    macd_line = ema_fast - ema_slow
    signal_line = macd_line.ewm(span=signal, adjust=False, min_periods=signal).mean()
    histogram = macd_line - signal_line
    return macd_line, signal_line, histogram


def process_symbol(symbol_df: pd.DataFrame) -> pd.DataFrame:
    """Compute all indicators for one symbol's daily bars."""
    df = symbol_df.sort_values("bar_date").copy()
    close = df["close"]

    df["sma_20"] = compute_sma(close, 20)
    df["sma_50"] = compute_sma(close, 50)
    df["ema_9"] = compute_ema(close, 9)
    df["ema_21"] = compute_ema(close, 21)
    df["rsi_14"] = compute_rsi(close, 14)
    macd_val, macd_sig, macd_hist = compute_macd(close)
    df["macd_value"] = macd_val
    df["macd_signal"] = macd_sig
    df["macd_histogram"] = macd_hist

    # Drop rows where all indicators are NaN (warmup period)
    indicator_cols = ["sma_20", "sma_50", "ema_9", "ema_21", "rsi_14",
                      "macd_value", "macd_signal", "macd_histogram"]
    df = df.dropna(subset=indicator_cols, how="all")
    return df


def main():
    parser = argparse.ArgumentParser(description="Compute indicators from daily bars")
    parser.add_argument("--symbol", help="Compute for single symbol only")
    parser.add_argument("--dry-run", action="store_true", help="Preview only")
    args = parser.parse_args()

    INDICATOR_DIR.mkdir(parents=True, exist_ok=True)

    con = duckdb.connect(str(DUCKDB_PATH), read_only=True)
    print(f"Connected to {DUCKDB_PATH}")

    # Get list of symbols that have trades (only compute for traded symbols)
    trade_symbols = con.execute("SELECT DISTINCT symbol FROM trades").fetchdf()["symbol"].tolist()
    print(f"Trade symbols: {len(trade_symbols):,}")

    # Load daily bars — combine daily_bars_flat (Polygon, 2021+) and daily_bars (yfinance, 2015+)
    # Use UNION to get the widest coverage
    symbol_filter = ""
    if args.symbol:
        symbol_filter = f"AND symbol = '{args.symbol}'"

    daily_sql = f"""
        SELECT symbol, bar_date, open, high, low, close, volume FROM (
            -- Source 1: daily_bars (yfinance, covers 2015-2026)
            SELECT symbol, bar_date, open, high, low, close, volume
            FROM daily_bars
            WHERE symbol IN (SELECT UNNEST(?::VARCHAR[]))
            {symbol_filter}

            UNION ALL

            -- Source 2: daily_bars_flat (Polygon flat files + computed from minute bars)
            SELECT ticker AS symbol, CAST(bar_time AS DATE) AS bar_date,
                   open, high, low, close, volume
            FROM daily_bars_flat
            WHERE ticker IN (SELECT UNNEST(?::VARCHAR[]))
            {symbol_filter.replace('symbol', 'ticker') if symbol_filter else ''}
        )
        -- Deduplicate: prefer daily_bars_flat (Polygon) when both exist
        QUALIFY ROW_NUMBER() OVER (PARTITION BY symbol, bar_date ORDER BY volume DESC) = 1
        ORDER BY symbol, bar_date
    """

    print("Loading daily bars (combining yfinance + Polygon + computed)...")
    t0 = time.time()
    daily_df = con.execute(daily_sql, [trade_symbols, trade_symbols]).fetchdf()
    print(f"  Loaded {len(daily_df):,} daily bars for {daily_df['symbol'].nunique():,} symbols in {time.time()-t0:.1f}s")

    if args.dry_run:
        print(f"\nDry run: would compute indicators for {daily_df['symbol'].nunique():,} symbols")
        print(f"Date range: {daily_df['bar_date'].min()} to {daily_df['bar_date'].max()}")
        con.close()
        return

    con.close()

    # Process each symbol
    print("\nComputing indicators...")
    t0 = time.time()
    results = []
    symbols = daily_df["symbol"].unique()
    for i, sym in enumerate(symbols):
        sym_df = daily_df[daily_df["symbol"] == sym].copy()
        if len(sym_df) < 5:  # Need minimum data
            continue
        result = process_symbol(sym_df)
        results.append(result)
        if (i + 1) % 500 == 0:
            print(f"  Processed {i+1:,}/{len(symbols):,} symbols...")

    all_indicators = pd.concat(results, ignore_index=True)
    elapsed = time.time() - t0
    print(f"  Computed indicators for {len(symbols):,} symbols in {elapsed:.1f}s")
    print(f"  Total indicator rows: {len(all_indicators):,}")

    # Write to parquet files matching Polygon format: ticker, date, value
    print("\nWriting indicator parquets...")

    # Back up existing files
    for f in INDICATOR_DIR.glob("*.parquet"):
        backup = f.with_suffix(".parquet.bak")
        if not backup.exists():
            f.rename(backup)
            print(f"  Backed up {f.name} → {backup.name}")

    # SMA-20
    sma20 = all_indicators[["symbol", "bar_date", "sma_20"]].dropna(subset=["sma_20"])
    sma20 = sma20.rename(columns={"symbol": "ticker", "bar_date": "date", "sma_20": "value"})
    sma20.to_parquet(INDICATOR_DIR / "sma_20.parquet", index=False)
    print(f"  sma_20.parquet: {len(sma20):,} rows")

    # SMA-50
    sma50 = all_indicators[["symbol", "bar_date", "sma_50"]].dropna(subset=["sma_50"])
    sma50 = sma50.rename(columns={"symbol": "ticker", "bar_date": "date", "sma_50": "value"})
    sma50.to_parquet(INDICATOR_DIR / "sma_50.parquet", index=False)
    print(f"  sma_50.parquet: {len(sma50):,} rows")

    # EMA-9
    ema9 = all_indicators[["symbol", "bar_date", "ema_9"]].dropna(subset=["ema_9"])
    ema9 = ema9.rename(columns={"symbol": "ticker", "bar_date": "date", "ema_9": "value"})
    ema9.to_parquet(INDICATOR_DIR / "ema_9.parquet", index=False)
    print(f"  ema_9.parquet: {len(ema9):,} rows")

    # EMA-21
    ema21 = all_indicators[["symbol", "bar_date", "ema_21"]].dropna(subset=["ema_21"])
    ema21 = ema21.rename(columns={"symbol": "ticker", "bar_date": "date", "ema_21": "value"})
    ema21.to_parquet(INDICATOR_DIR / "ema_21.parquet", index=False)
    print(f"  ema_21.parquet: {len(ema21):,} rows")

    # RSI-14
    rsi14 = all_indicators[["symbol", "bar_date", "rsi_14"]].dropna(subset=["rsi_14"])
    rsi14 = rsi14.rename(columns={"symbol": "ticker", "bar_date": "date", "rsi_14": "value"})
    rsi14.to_parquet(INDICATOR_DIR / "rsi_14.parquet", index=False)
    print(f"  rsi_14.parquet: {len(rsi14):,} rows")

    # MACD (3 columns)
    macd = all_indicators[["symbol", "bar_date", "macd_value", "macd_signal", "macd_histogram"]].dropna(subset=["macd_value"])
    macd = macd.rename(columns={
        "symbol": "ticker",
        "bar_date": "date",
        "macd_value": "value",
        "macd_signal": "signal",
        "macd_histogram": "histogram"
    })
    macd.to_parquet(INDICATOR_DIR / "macd.parquet", index=False)
    print(f"  macd.parquet: {len(macd):,} rows")

    print(f"\nDone! All indicator parquets written to {INDICATOR_DIR}")


if __name__ == "__main__":
    main()
