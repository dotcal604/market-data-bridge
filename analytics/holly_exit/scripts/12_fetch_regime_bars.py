"""
12_fetch_regime_bars.py — Fetch 20-day daily bar lookback from Yahoo for regime tagging.

Downloads daily OHLCV for every ticker in the trades table, caches to DuckDB,
then computes per-trade regime features (trend, volatility, momentum).

Usage:
    python scripts/12_fetch_regime_bars.py
"""

import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd
import yfinance as yf

sys.path.insert(0, str(Path(__file__).parent.parent))

from config.settings import DUCKDB_PATH
from engine.data_loader import get_db

# How many trading days of lookback we need before each trade
LOOKBACK_DAYS = 30  # fetch 30 calendar days extra to guarantee 20 trading days
BATCH_SIZE = 50     # tickers per yfinance batch call


def ensure_daily_schema(db):
    """Create daily_bars and trade_regime tables if they don't exist."""
    db.execute("""
        CREATE TABLE IF NOT EXISTS daily_bars (
            symbol     VARCHAR NOT NULL,
            bar_date   DATE NOT NULL,
            open       DOUBLE,
            high       DOUBLE,
            low        DOUBLE,
            close      DOUBLE,
            volume     BIGINT,
            PRIMARY KEY (symbol, bar_date)
        )
    """)
    db.execute("""
        CREATE TABLE IF NOT EXISTS trade_regime (
            trade_id        INTEGER PRIMARY KEY,
            symbol          VARCHAR NOT NULL,
            trade_date      DATE NOT NULL,
            -- Trend features
            sma20           DOUBLE,
            sma5            DOUBLE,
            trend_slope     DOUBLE,   -- linear regression slope of 20d closes
            above_sma20     BOOLEAN,  -- close > sma20 on day before trade
            -- Volatility features
            atr14           DOUBLE,
            atr_pct         DOUBLE,   -- atr14 / close (normalized)
            daily_range_pct DOUBLE,   -- avg (high-low)/close over 14d
            -- Momentum features
            rsi14           DOUBLE,
            roc5            DOUBLE,   -- 5-day rate of change %
            roc20           DOUBLE,   -- 20-day rate of change %
            -- Regime classification
            trend_regime    VARCHAR,  -- 'uptrend', 'downtrend', 'sideways'
            vol_regime      VARCHAR,  -- 'low_vol', 'normal_vol', 'high_vol'
            momentum_regime VARCHAR   -- 'oversold', 'neutral', 'overbought'
        )
    """)


def fetch_daily_bars_batch(symbols, start_date, end_date):
    """Fetch daily bars for a batch of symbols from Yahoo."""
    try:
        data = yf.download(
            tickers=symbols,
            start=start_date,
            end=end_date,
            interval="1d",
            group_by="ticker",
            auto_adjust=True,
            progress=False,
            threads=True,
        )
    except Exception as e:
        print(f"  [regime] Yahoo download error: {e}")
        return pd.DataFrame()

    if data.empty:
        return pd.DataFrame()

    rows = []
    # Single ticker returns flat columns, multi-ticker returns multi-level
    if len(symbols) == 1:
        sym = symbols[0]
        for dt, row in data.iterrows():
            if pd.notna(row.get("Close")):
                rows.append({
                    "symbol": sym,
                    "bar_date": dt.date(),
                    "open": row["Open"],
                    "high": row["High"],
                    "low": row["Low"],
                    "close": row["Close"],
                    "volume": int(row["Volume"]) if pd.notna(row["Volume"]) else 0,
                })
    else:
        for sym in symbols:
            try:
                sym_data = data[sym] if sym in data.columns.get_level_values(0) else None
            except (KeyError, TypeError):
                continue
            if sym_data is None or sym_data.empty:
                continue
            for dt, row in sym_data.iterrows():
                if pd.notna(row.get("Close")):
                    rows.append({
                        "symbol": sym,
                        "bar_date": dt.date(),
                        "open": row["Open"],
                        "high": row["High"],
                        "low": row["Low"],
                        "close": row["Close"],
                        "volume": int(row["Volume"]) if pd.notna(row["Volume"]) else 0,
                    })

    return pd.DataFrame(rows) if rows else pd.DataFrame()


def compute_regime_features(db):
    """Compute regime features for each trade from daily_bars lookback."""
    trades = db.execute("""
        SELECT trade_id, symbol, CAST(entry_time AS DATE) AS trade_date
        FROM trades
        ORDER BY entry_time
    """).fetchdf()

    print(f"  [regime] Computing features for {len(trades)} trades...")
    regime_rows = []

    for _, trade in trades.iterrows():
        sym = trade["symbol"]
        tdate = trade["trade_date"]

        # Get 25 trading days before trade date
        bars = db.execute("""
            SELECT bar_date, open, high, low, close, volume
            FROM daily_bars
            WHERE symbol = ? AND bar_date < ?
            ORDER BY bar_date DESC
            LIMIT 25
        """, [sym, str(tdate)]).fetchdf()

        if len(bars) < 14:
            continue  # not enough data for meaningful features

        bars = bars.sort_values("bar_date").reset_index(drop=True)
        closes = bars["close"].values
        highs = bars["high"].values
        lows = bars["low"].values

        n = len(closes)
        last_close = closes[-1]

        # ── Trend ──
        sma20 = np.mean(closes[-20:]) if n >= 20 else np.mean(closes)
        sma5 = np.mean(closes[-5:]) if n >= 5 else np.mean(closes)
        above_sma20 = bool(last_close > sma20)

        # Linear regression slope over available closes (normalized by price)
        x = np.arange(min(n, 20))
        y = closes[-len(x):]
        slope = np.polyfit(x, y, 1)[0] / last_close * 100 if len(x) >= 5 else 0.0

        # ── Volatility ──
        tr = np.maximum(
            highs[1:] - lows[1:],
            np.maximum(
                np.abs(highs[1:] - closes[:-1]),
                np.abs(lows[1:] - closes[:-1])
            )
        )
        atr14 = np.mean(tr[-14:]) if len(tr) >= 14 else np.mean(tr)
        atr_pct = atr14 / last_close if last_close > 0 else 0.0
        daily_range = (highs - lows) / np.where(closes > 0, closes, 1.0)
        daily_range_pct = np.mean(daily_range[-14:]) if n >= 14 else np.mean(daily_range)

        # ── Momentum ──
        # RSI-14
        deltas = np.diff(closes)
        if len(deltas) >= 14:
            gains = np.where(deltas > 0, deltas, 0)[-14:]
            losses = np.where(deltas < 0, -deltas, 0)[-14:]
            avg_gain = np.mean(gains)
            avg_loss = np.mean(losses)
            rsi14 = 100 - (100 / (1 + avg_gain / avg_loss)) if avg_loss > 0 else 100.0
        else:
            rsi14 = 50.0

        roc5 = ((last_close / closes[-6]) - 1) * 100 if n >= 6 else 0.0
        roc20 = ((last_close / closes[-21]) - 1) * 100 if n >= 21 else (
            ((last_close / closes[0]) - 1) * 100
        )

        # ── Regime classification ──
        if slope > 0.15 and above_sma20:
            trend_regime = "uptrend"
        elif slope < -0.15 and not above_sma20:
            trend_regime = "downtrend"
        else:
            trend_regime = "sideways"

        if atr_pct > 0.04:
            vol_regime = "high_vol"
        elif atr_pct < 0.015:
            vol_regime = "low_vol"
        else:
            vol_regime = "normal_vol"

        if rsi14 > 70:
            momentum_regime = "overbought"
        elif rsi14 < 30:
            momentum_regime = "oversold"
        else:
            momentum_regime = "neutral"

        regime_rows.append({
            "trade_id": int(trade["trade_id"]),
            "symbol": sym,
            "trade_date": tdate,
            "sma20": round(sma20, 4),
            "sma5": round(sma5, 4),
            "trend_slope": round(slope, 4),
            "above_sma20": above_sma20,
            "atr14": round(atr14, 4),
            "atr_pct": round(atr_pct, 4),
            "daily_range_pct": round(daily_range_pct, 4),
            "rsi14": round(rsi14, 2),
            "roc5": round(roc5, 2),
            "roc20": round(roc20, 2),
            "trend_regime": trend_regime,
            "vol_regime": vol_regime,
            "momentum_regime": momentum_regime,
        })

    return pd.DataFrame(regime_rows)


def main():
    db = get_db()
    ensure_daily_schema(db)

    # Get unique symbols and date range from trades
    trade_info = db.execute("""
        SELECT DISTINCT symbol,
               MIN(CAST(entry_time AS DATE)) AS min_date,
               MAX(CAST(entry_time AS DATE)) AS max_date
        FROM trades
        GROUP BY symbol
    """).fetchdf()

    symbols = sorted(trade_info["symbol"].unique().tolist())
    global_min = pd.Timestamp(trade_info["min_date"].min()) - pd.Timedelta(days=45)
    global_max = pd.Timestamp(trade_info["max_date"].max())

    # Check what's already cached
    existing = db.execute(
        "SELECT DISTINCT symbol FROM daily_bars"
    ).fetchdf()["symbol"].tolist() if db.execute(
        "SELECT COUNT(*) FROM daily_bars"
    ).fetchone()[0] > 0 else []

    to_fetch = [s for s in symbols if s not in existing]
    print(f"Unique tickers: {len(symbols)}")
    print(f"Already cached: {len(existing)}")
    print(f"To fetch: {len(to_fetch)}")
    print(f"Date range: {global_min.date()} to {global_max.date()}")

    if to_fetch:
        t0 = time.time()
        total_rows = 0

        for i in range(0, len(to_fetch), BATCH_SIZE):
            batch = to_fetch[i:i + BATCH_SIZE]
            batch_num = i // BATCH_SIZE + 1
            total_batches = (len(to_fetch) + BATCH_SIZE - 1) // BATCH_SIZE

            df = fetch_daily_bars_batch(
                batch,
                start_date=global_min.strftime("%Y-%m-%d"),
                end_date=(global_max + pd.Timedelta(days=1)).strftime("%Y-%m-%d"),
            )

            if not df.empty:
                # Insert into DuckDB
                db.execute("INSERT OR REPLACE INTO daily_bars SELECT * FROM df")
                total_rows += len(df)

            elapsed = time.time() - t0
            fetched_so_far = min(i + BATCH_SIZE, len(to_fetch))
            rate = fetched_so_far / elapsed if elapsed > 0 else 0
            eta = (len(to_fetch) - fetched_so_far) / rate if rate > 0 else 0
            print(f"  [{batch_num}/{total_batches}] {len(batch)} tickers, "
                  f"{len(df)} rows | total: {total_rows:,} | "
                  f"ETA: {eta:.1f}s")

        elapsed = time.time() - t0
        print(f"\nFetched {total_rows:,} daily bars in {elapsed:.1f}s")

    # Stats
    stats = db.execute("""
        SELECT COUNT(*) AS rows, COUNT(DISTINCT symbol) AS symbols,
               MIN(bar_date) AS first, MAX(bar_date) AS last
        FROM daily_bars
    """).fetchone()
    print(f"\nDaily bars in DB: {stats[0]:,} rows, {stats[1]} symbols, "
          f"{stats[2]} to {stats[3]}")

    # ── Compute regime features ──
    print("\nComputing regime features...")
    regime_df = compute_regime_features(db)

    if not regime_df.empty:
        db.execute("DELETE FROM trade_regime")
        db.execute("INSERT INTO trade_regime SELECT * FROM regime_df")
        print(f"  [regime] Stored {len(regime_df)} trade regime records")

        # Summary
        print("\n" + "=" * 60)
        print("REGIME DISTRIBUTION")
        print("=" * 60)
        for col in ["trend_regime", "vol_regime", "momentum_regime"]:
            print(f"\n{col}:")
            counts = regime_df[col].value_counts()
            for val, cnt in counts.items():
                pct = cnt / len(regime_df) * 100
                print(f"  {val:<15} {cnt:>6,} ({pct:.1f}%)")

    db.close()
    print("\nDone.")


if __name__ == "__main__":
    main()
