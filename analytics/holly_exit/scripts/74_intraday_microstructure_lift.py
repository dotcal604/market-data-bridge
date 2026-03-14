"""
Script 74 — Prior-Day Intraday Microstructure Lift (from minute_bars_flat)
==========================================================================
Mines the 1.66B-row minute_bars_flat table for prior-day intraday patterns
that may predict next-day Holly trade outcomes.

Features extracted (all look-ahead-free, using prior trading day):
  - last_hour_return: Return from 3:00 PM to close (closing momentum)
  - last_hour_vol_ratio: Last-hour volume / rest-of-day volume
  - close_5min_vol_ratio: Final 5-min volume / average 5-min volume
  - am_pm_vol_ratio: Morning (9:30-12:00) vs afternoon (12:00-16:00) volume
  - premarket_volume: Pre-market volume (before 9:30)
  - premarket_range_pct: Pre-market high-low range as % of close
  - bar_count_ratio: Actual bars / expected bars (liquidity proxy)
  - max_bar_volume_ratio: Max single bar volume / average bar volume (spike detection)
  - closing_vwap_dist: Distance of close from intraday VWAP

Strategy: Use DuckDB to aggregate minute bars per ticker per day, then join
to trades via prior-day lookup. Avoid pulling raw minute data into Python.

Usage:
    python scripts/74_intraday_microstructure_lift.py
"""

import sys, time, warnings
from pathlib import Path
import numpy as np
import pandas as pd
import duckdb

sys.path.insert(0, str(Path(__file__).parent.parent))
from config.settings import DUCKDB_PATH

REPORT_DIR = Path(__file__).parent.parent / "output" / "reports"
warnings.filterwarnings("ignore", category=FutureWarning)


def load_features(con):
    """Load trades and compute prior-day intraday features from minute_bars_flat."""
    t0 = time.time()

    # Load trades
    trades = con.execute("""
        SELECT trade_id, symbol, strategy, direction,
            entry_time, entry_price, holly_pnl,
            CASE WHEN holly_pnl > 0 THEN 1 ELSE 0 END AS win
        FROM trades
    """).fetchdf()
    print(f"  Trades: {len(trades):,}")

    # Build per-ticker per-day intraday summary using DuckDB
    # This runs entirely inside DuckDB — no raw minute data in Python
    print("  Computing per-ticker daily intraday summaries (DuckDB)...")
    t1 = time.time()

    daily_intraday = con.execute("""
        WITH bars AS (
            SELECT
                ticker,
                CAST(bar_time AS DATE) AS bar_date,
                bar_time,
                EXTRACT(HOUR FROM bar_time) AS hr,
                EXTRACT(MINUTE FROM bar_time) AS mn,
                EXTRACT(HOUR FROM bar_time) * 60 + EXTRACT(MINUTE FROM bar_time) AS minutes,
                open, high, low, close, volume, transactions
            FROM minute_bars_flat
            WHERE bar_time::TIME BETWEEN '04:00:00' AND '19:59:00'
        ),
        daily_agg AS (
            SELECT
                ticker,
                bar_date,
                -- RTH metrics (9:30-15:59)
                SUM(CASE WHEN minutes BETWEEN 570 AND 959 THEN volume ELSE 0 END) AS rth_volume,
                COUNT(CASE WHEN minutes BETWEEN 570 AND 959 THEN 1 END) AS rth_bar_count,
                -- Morning volume (9:30-11:59)
                SUM(CASE WHEN minutes BETWEEN 570 AND 719 THEN volume ELSE 0 END) AS am_volume,
                -- Afternoon volume (12:00-15:59)
                SUM(CASE WHEN minutes BETWEEN 720 AND 959 THEN volume ELSE 0 END) AS pm_volume,
                -- Last hour volume (15:00-15:59)
                SUM(CASE WHEN minutes BETWEEN 900 AND 959 THEN volume ELSE 0 END) AS last_hour_volume,
                -- Rest of day volume (9:30-14:59)
                SUM(CASE WHEN minutes BETWEEN 570 AND 899 THEN volume ELSE 0 END) AS rest_day_volume,
                -- Final 5 min volume (15:55-15:59)
                SUM(CASE WHEN minutes BETWEEN 955 AND 959 THEN volume ELSE 0 END) AS close_5min_volume,
                -- Pre-market volume (4:00-9:29)
                SUM(CASE WHEN minutes < 570 THEN volume ELSE 0 END) AS premarket_volume,
                -- Pre-market range
                MAX(CASE WHEN minutes < 570 THEN high END) AS premarket_high,
                MIN(CASE WHEN minutes < 570 THEN low END) AS premarket_low,
                -- RTH OHLC
                MAX(CASE WHEN minutes BETWEEN 570 AND 570 THEN open END) AS rth_open,
                LAST(close ORDER BY bar_time) FILTER (WHERE minutes BETWEEN 570 AND 959) AS rth_close,
                MAX(CASE WHEN minutes BETWEEN 570 AND 959 THEN high END) AS rth_high,
                MIN(CASE WHEN minutes BETWEEN 570 AND 959 THEN low END) AS rth_low,
                -- 3:00 PM price (start of last hour)
                MAX(CASE WHEN minutes = 900 THEN open END) AS price_3pm,
                -- Max single bar volume (spike detection)
                MAX(CASE WHEN minutes BETWEEN 570 AND 959 THEN volume END) AS max_bar_volume,
                -- VWAP approximation: sum(volume * typical_price) / sum(volume)
                SUM(CASE WHEN minutes BETWEEN 570 AND 959
                    THEN volume * (high + low + close) / 3.0 ELSE 0 END) AS vwap_numerator,
                -- Average bar volume for close_5min ratio
                AVG(CASE WHEN minutes BETWEEN 570 AND 949 THEN volume END) AS avg_bar_volume_excl_close
            FROM bars
            GROUP BY ticker, bar_date
            HAVING rth_bar_count >= 30  -- minimum liquidity threshold
        )
        SELECT
            ticker,
            bar_date,
            -- Last hour return
            CASE WHEN price_3pm > 0 AND rth_close > 0
                THEN (rth_close - price_3pm) / price_3pm * 100
            END AS last_hour_return,
            -- Last hour volume ratio
            CASE WHEN rest_day_volume > 0
                THEN last_hour_volume * 1.0 / rest_day_volume
            END AS last_hour_vol_ratio,
            -- Close 5-min volume ratio
            CASE WHEN avg_bar_volume_excl_close > 0
                THEN (close_5min_volume / 5.0) / avg_bar_volume_excl_close
            END AS close_5min_vol_ratio,
            -- AM/PM volume ratio
            CASE WHEN pm_volume > 0
                THEN am_volume * 1.0 / pm_volume
            END AS am_pm_vol_ratio,
            -- Pre-market volume
            premarket_volume,
            -- Pre-market range %
            CASE WHEN rth_close > 0 AND premarket_high IS NOT NULL AND premarket_low IS NOT NULL
                THEN (premarket_high - premarket_low) / rth_close * 100
            END AS premarket_range_pct,
            -- Bar count ratio (actual / expected ~390 for full RTH)
            rth_bar_count * 1.0 / 390 AS bar_count_ratio,
            -- Max bar volume spike ratio
            CASE WHEN rth_volume > 0 AND rth_bar_count > 0
                THEN max_bar_volume * 1.0 / (rth_volume / rth_bar_count)
            END AS max_bar_volume_ratio,
            -- Closing VWAP distance
            CASE WHEN rth_volume > 0 AND rth_close > 0
                THEN (rth_close - vwap_numerator / rth_volume) / rth_close * 100
            END AS closing_vwap_dist
        FROM daily_agg
    """).fetchdf()
    print(f"  Daily intraday summaries: {len(daily_intraday):,} rows ({time.time()-t1:.1f}s)")

    # Build prior-day lookup: shift dates forward by 1 trading day
    print("  Building prior-day lookup...")
    daily_intraday = daily_intraday.sort_values(["ticker", "bar_date"])

    # Normalize bar_date to datetime for consistent merging
    daily_intraday["bar_date"] = pd.to_datetime(daily_intraday["bar_date"])

    # For each ticker, the next trading day gets the current day's features
    daily_intraday["trade_date"] = daily_intraday.groupby("ticker")["bar_date"].shift(-1)
    daily_intraday = daily_intraday.dropna(subset=["trade_date"])

    # Merge to trades
    trades["trade_date"] = pd.to_datetime(trades["entry_time"]).dt.normalize()
    daily_intraday["trade_date"] = pd.to_datetime(daily_intraday["trade_date"])

    # Diagnostics
    trade_syms = set(trades["symbol"].unique())
    micro_syms = set(daily_intraday["ticker"].unique())
    overlap_syms = trade_syms & micro_syms
    print(f"  Trade symbols: {len(trade_syms):,}, Minute-bar symbols: {len(micro_syms):,}, Overlap: {len(overlap_syms):,}")
    trade_dates = set(trades["trade_date"].dt.date)
    micro_dates = set(daily_intraday["trade_date"].dt.date)
    date_overlap = trade_dates & micro_dates
    print(f"  Trade dates: {len(trade_dates):,}, Minute-bar trade_dates: {len(micro_dates):,}, Overlap: {len(date_overlap):,}")
    # Trades within minute_bars date range
    micro_min = daily_intraday["trade_date"].min()
    micro_max = daily_intraday["trade_date"].max()
    in_range = trades[(trades["trade_date"] >= micro_min) & (trades["trade_date"] <= micro_max)]
    print(f"  Trades in minute_bars date range ({micro_min.date()} to {micro_max.date()}): {len(in_range):,}/{len(trades):,}")

    feature_cols = [
        "last_hour_return", "last_hour_vol_ratio", "close_5min_vol_ratio",
        "am_pm_vol_ratio", "premarket_volume", "premarket_range_pct",
        "bar_count_ratio", "max_bar_volume_ratio", "closing_vwap_dist",
    ]
    merge_cols = ["ticker", "trade_date"] + feature_cols
    trades = trades.merge(
        daily_intraday[merge_cols].rename(columns={"ticker": "symbol"}),
        on=["symbol", "trade_date"], how="left"
    )

    coverage = trades[feature_cols[0]].notna().sum()
    print(f"  Coverage: {coverage:,}/{len(trades):,} ({coverage/len(trades)*100:.1f}%)")
    print(f"  Total load time: {time.time()-t0:.1f}s")

    return trades, feature_cols


def analyze_features(trades, feature_cols):
    """Run Cohen's d and FDR analysis on intraday features."""
    from scipy import stats

    results = []
    for col in feature_cols:
        mask = trades[col].notna()
        if mask.sum() < 100:
            continue
        wins = trades.loc[mask & (trades["win"] == 1), col]
        losses = trades.loc[mask & (trades["win"] == 0), col]
        if len(wins) < 50 or len(losses) < 50:
            continue
        pooled = np.sqrt((wins.std()**2 + losses.std()**2) / 2)
        d = (wins.mean() - losses.mean()) / pooled if pooled > 0 else 0
        _, p = stats.ttest_ind(wins, losses, equal_var=False)
        results.append({
            "feature": col, "d": d, "p": p,
            "win_mean": wins.mean(), "loss_mean": losses.mean(),
            "n": mask.sum(), "abs_d": abs(d),
        })

    df = pd.DataFrame(results).sort_values("abs_d", ascending=False)

    # FDR correction
    m = len(df)
    df = df.sort_values("p")
    df["rank"] = range(1, m + 1)
    df["fdr_threshold"] = df["rank"] / m * 0.05
    df["fdr_significant"] = df["p"] < df["fdr_threshold"]
    df = df.sort_values("abs_d", ascending=False)

    return df


def analyze_by_direction(trades, feature_cols):
    """Run analysis split by long/short direction."""
    from scipy import stats
    results = []
    for direction in ["long", "short"]:
        mask_dir = trades["direction"].str.lower() == direction
        for col in feature_cols:
            mask = mask_dir & trades[col].notna()
            if mask.sum() < 100:
                continue
            wins = trades.loc[mask & (trades["win"] == 1), col]
            losses = trades.loc[mask & (trades["win"] == 0), col]
            if len(wins) < 50 or len(losses) < 50:
                continue
            pooled = np.sqrt((wins.std()**2 + losses.std()**2) / 2)
            d = (wins.mean() - losses.mean()) / pooled if pooled > 0 else 0
            _, p = stats.ttest_ind(wins, losses, equal_var=False)
            results.append({
                "direction": direction, "feature": col,
                "d": d, "p": p, "abs_d": abs(d), "n": mask.sum(),
            })
    return pd.DataFrame(results).sort_values("abs_d", ascending=False) if results else pd.DataFrame()


def main():
    t0 = time.time()
    con = duckdb.connect(str(DUCKDB_PATH), read_only=True)
    print(f"Connected to {DUCKDB_PATH.name}")

    trades, feature_cols = load_features(con)
    con.close()

    print("\n=== Cohen's d Analysis (Global) ===")
    results = analyze_features(trades, feature_cols)
    sig_count = results["fdr_significant"].sum()
    print(f"FDR-significant: {sig_count}/{len(results)}")
    for _, r in results.iterrows():
        flag = "***" if r["fdr_significant"] else "   "
        print(f"  {flag} {r['feature']:28s} d={r['d']:+.3f}  p={r['p']:.4f}  n={r['n']:,}")

    print("\n=== Direction-Specific Analysis ===")
    dir_results = analyze_by_direction(trades, feature_cols)
    if len(dir_results) > 0:
        for _, r in dir_results.head(10).iterrows():
            print(f"  {r['direction']:5s} {r['feature']:28s} d={r['d']:+.3f}  p={r['p']:.4f}  n={r['n']:,}")

    # ── Build report ──
    report = []
    report.append("# Script 74 — Prior-Day Intraday Microstructure Lift")
    report.append("")
    report.append(f"Generated: {pd.Timestamp.now().strftime('%Y-%m-%d %H:%M')}")
    report.append(f"Source: minute_bars_flat (1.66B rows)")
    report.append(f"Trades: {len(trades):,}")
    coverage = trades[feature_cols[0]].notna().sum()
    report.append(f"Coverage: {coverage:,} ({coverage/len(trades)*100:.1f}%)")
    report.append(f"FDR-significant features: {sig_count}/{len(results)}")
    report.append("")

    report.append("## Global Results (all trades)")
    report.append("")
    report.append("| Feature | Cohen's d | p-value | n | FDR Sig |")
    report.append("|---------|-----------|---------|---|---------|")
    for _, r in results.iterrows():
        sig = "Yes" if r["fdr_significant"] else "No"
        report.append(f"| {r['feature']} | {r['d']:+.4f} | {r['p']:.2e} | {r['n']:,} | {sig} |")
    report.append("")

    if len(dir_results) > 0:
        report.append("## Direction-Specific (Top 10)")
        report.append("")
        report.append("| Direction | Feature | Cohen's d | p-value | n |")
        report.append("|-----------|---------|-----------|---------|---|")
        for _, r in dir_results.head(10).iterrows():
            report.append(f"| {r['direction']} | {r['feature']} | {r['d']:+.4f} | {r['p']:.2e} | {r['n']:,} |")
        report.append("")

    report.append("## Feature Descriptions")
    report.append("")
    report.append("- **last_hour_return**: Return from 3:00 PM to close (closing momentum)")
    report.append("- **last_hour_vol_ratio**: Last-hour volume / rest-of-day volume")
    report.append("- **close_5min_vol_ratio**: Final 5-min avg volume / RTH avg bar volume")
    report.append("- **am_pm_vol_ratio**: Morning (9:30-12) vs afternoon (12-16) volume")
    report.append("- **premarket_volume**: Total pre-market volume (4:00-9:29)")
    report.append("- **premarket_range_pct**: Pre-market range as % of RTH close")
    report.append("- **bar_count_ratio**: Actual bars / 390 expected (liquidity proxy)")
    report.append("- **max_bar_volume_ratio**: Max single bar volume / avg bar volume")
    report.append("- **closing_vwap_dist**: Distance of close from intraday VWAP (%)")
    report.append("")

    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    path = REPORT_DIR / "intraday-microstructure-lift.md"
    path.write_text("\n".join(report), encoding="utf-8")
    elapsed = time.time() - t0
    print(f"\nReport: {path}")
    print(f"Done in {elapsed:.1f}s")


if __name__ == "__main__":
    main()
