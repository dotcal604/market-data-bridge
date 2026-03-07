"""
27_mae_mfe_analysis.py — MAE/MFE Path Analysis & Exit Optimization

Two-tier analysis:
  Tier 1 (ALL 28,875 trades): Holly's reported MAE/MFE values (in cents)
    - MAE/MFE distributions (% and R-multiples)
    - Winner/loser excursion profiles
    - Stop placement optimization
    - Exit optimization surface (TP vs SL heatmap)
    - R-multiple distribution

  Tier 2 (trades WITH minute bar coverage): Reconstructed price paths
    - Time-to-MAE / Time-to-MFE (minutes after entry)
    - Edge decay (MFE accumulation over time)
    - Temporal exit optimization (time stops)

Usage:
    python scripts/27_mae_mfe_analysis.py
    python scripts/27_mae_mfe_analysis.py --tier 1    # Only distribution analysis
    python scripts/27_mae_mfe_analysis.py --tier 2    # Only path analysis
"""

import argparse
import sys
import time
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).parent.parent))

from config.settings import DUCKDB_PATH, OUTPUT_DIR

REPORTS_DIR = OUTPUT_DIR / "reports"


# ═══════════════════════════════════════════════════════════════
# TIER 1 — FULL DATASET (Holly's MAE/MFE values)
# ═══════════════════════════════════════════════════════════════

def load_trades() -> pd.DataFrame:
    """Load all trades with MAE/MFE from DuckDB."""
    con = duckdb.connect(str(DUCKDB_PATH), read_only=True)
    df = con.execute("""
        SELECT
            trade_id, symbol, strategy, direction,
            entry_time, entry_price, exit_time, exit_price,
            stop_price, target_price,
            mfe, mae,
            shares, holly_pnl, stop_buffer_pct,
            EXTRACT(EPOCH FROM (exit_time - entry_time)) / 60.0 AS hold_minutes
        FROM trades
        WHERE mfe IS NOT NULL AND mae IS NOT NULL
        ORDER BY trade_id
    """).fetchdf()
    con.close()

    # Derived fields
    df["is_winner"] = df["holly_pnl"] > 0
    df["pnl_cents"] = df["holly_pnl"]  # holly_pnl is already per-trade

    # Risk (stop distance in cents)
    df["risk_cents"] = np.abs(df["entry_price"] - df["stop_price"]) * 100
    df["risk_cents"] = df["risk_cents"].replace(0, np.nan)

    # MAE/MFE as percentages of entry price
    df["mae_pct"] = (df["mae"] / (df["entry_price"] * 100)) * 100  # mae is in cents
    df["mfe_pct"] = (df["mfe"] / (df["entry_price"] * 100)) * 100

    # R-multiples (excursion in units of risk)
    df["mae_r"] = df["mae"] / df["risk_cents"]  # negative
    df["mfe_r"] = df["mfe"] / df["risk_cents"]  # positive

    # Actual PnL in R
    df["pnl_r"] = df["pnl_cents"] / df["risk_cents"]

    return df


def tier1_distributions(df: pd.DataFrame):
    """MAE/MFE distribution analysis on full dataset."""
    print("\n" + "=" * 70)
    print("TIER 1: MAE/MFE DISTRIBUTION ANALYSIS (ALL TRADES)")
    print("=" * 70)
    print(f"  Total trades: {len(df):,}")
    print(f"  Winners: {df['is_winner'].sum():,} ({df['is_winner'].mean()*100:.1f}%)")
    print(f"  Avg hold: {df['hold_minutes'].mean():.1f} min")

    winners = df[df["is_winner"]]
    losers = df[~df["is_winner"]]

    # ── MAE Distribution (how far trades go against you) ──
    print("\n" + "-" * 50)
    print("MAE DISTRIBUTION — Maximum Adverse Excursion")
    print("-" * 50)

    for label, subset in [("ALL TRADES", df), ("WINNERS", winners), ("LOSERS", losers)]:
        mae_abs = subset["mae"].abs()  # mae is negative, make positive for thresholds
        print(f"\n  {label} (n={len(subset):,}):")
        print(f"    Mean MAE: {subset['mae'].mean():.1f} cents ({subset['mae_pct'].mean():.2f}%)")
        print(f"    Median MAE: {subset['mae'].median():.1f} cents ({subset['mae_pct'].median():.2f}%)")

        # How many trades had MAE within thresholds (cents)
        for thresh in [5, 10, 20, 50, 100, 200]:
            pct = (mae_abs <= thresh).mean() * 100
            print(f"    MAE <= {thresh:>3}c:  {pct:5.1f}% of {label.lower()}")

    # ── MFE Distribution (how far trades go in your favor) ──
    print("\n" + "-" * 50)
    print("MFE DISTRIBUTION — Maximum Favorable Excursion")
    print("-" * 50)

    for label, subset in [("ALL TRADES", df), ("WINNERS", winners), ("LOSERS", losers)]:
        print(f"\n  {label} (n={len(subset):,}):")
        print(f"    Mean MFE: {subset['mfe'].mean():.1f} cents ({subset['mfe_pct'].mean():.2f}%)")
        print(f"    Median MFE: {subset['mfe'].median():.1f} cents ({subset['mfe_pct'].median():.2f}%)")

        for thresh in [10, 25, 50, 100, 200, 500, 1000]:
            pct = (subset["mfe"] >= thresh).mean() * 100
            print(f"    MFE >= {thresh:>4}c: {pct:5.1f}% of {label.lower()}")

    # ── R-Multiple Distribution ──
    print("\n" + "-" * 50)
    print("R-MULTIPLE DISTRIBUTION (excursion in units of risk)")
    print("-" * 50)

    valid_r = df.dropna(subset=["risk_cents"])
    valid_r = valid_r[valid_r["risk_cents"] > 0]
    winners_r = valid_r[valid_r["is_winner"]]
    losers_r = valid_r[~valid_r["is_winner"]]

    print(f"\n  Trades with valid risk: {len(valid_r):,}")

    print(f"\n  MAE (R-multiples, negative = adverse):")
    for pct in [10, 25, 50, 75, 90]:
        val = np.nanpercentile(valid_r["mae_r"], pct)
        print(f"    P{pct}: {val:.2f}R")

    print(f"\n  MFE of WINNERS (R-multiples):")
    for pct in [10, 25, 50, 75, 90, 95, 99]:
        val = np.nanpercentile(winners_r["mfe_r"], pct)
        print(f"    P{pct}: {val:.2f}R")

    print(f"\n  How far winners run:")
    for r_thresh in [1, 2, 3, 5, 10, 20, 50]:
        pct = (winners_r["mfe_r"] >= r_thresh).mean() * 100
        print(f"    MFE >= {r_thresh:>2}R: {pct:5.1f}% of winners")

    # ── Profit captured vs available ──
    print("\n" + "-" * 50)
    print("PROFIT CAPTURE EFFICIENCY")
    print("-" * 50)

    # For winners: what % of MFE was captured as profit?
    w_cap = winners[winners["mfe"] > 0].copy()
    w_cap["capture_pct"] = (w_cap["pnl_cents"] / w_cap["mfe"]) * 100
    w_cap["capture_pct"] = w_cap["capture_pct"].clip(-500, 500)

    print(f"\n  Winners with MFE > 0: {len(w_cap):,}")
    print(f"  Mean profit capture: {w_cap['capture_pct'].mean():.1f}% of MFE")
    print(f"  Median profit capture: {w_cap['capture_pct'].median():.1f}% of MFE")

    for thresh in [25, 50, 75, 90]:
        pct = (w_cap["capture_pct"] >= thresh).mean() * 100
        print(f"  Captured >= {thresh}% of MFE: {pct:.1f}% of winners")

    return valid_r


def tier1_mae_of_winners(df: pd.DataFrame):
    """Critical insight: how far do winners dip before working?"""
    print("\n" + "=" * 70)
    print("CRITICAL: MAE OF WINNERS (Stop Placement Guide)")
    print("=" * 70)

    winners = df[df["is_winner"]].copy()
    mae_abs = winners["mae"].abs()

    print(f"\n  Winners: {len(winners):,}")
    print(f"  Winners with ZERO MAE (never went against): {(winners['mae'] == 0).sum():,} "
          f"({(winners['mae'] == 0).mean()*100:.1f}%)")

    # MAE distribution of winners (tells optimal stop placement)
    print(f"\n  Cumulative MAE of winners (tighter stop = more winners survived):")
    for thresh in [0, 5, 10, 15, 20, 25, 30, 50, 75, 100, 150, 200, 300, 500]:
        survived = (mae_abs <= thresh).mean() * 100
        n = (mae_abs <= thresh).sum()
        # Average PnL of survived winners
        survived_pnl = winners[mae_abs <= thresh]["holly_pnl"].mean()
        print(f"    Stop >= {thresh:>3}c: {survived:5.1f}% survived  "
              f"(n={n:>5,}, avg PnL=${survived_pnl:>8.0f})")

    # Also show in percentage terms
    mae_pct_abs = winners["mae_pct"].abs()
    print(f"\n  MAE of winners (% of entry price):")
    for thresh in [0.0, 0.25, 0.5, 0.75, 1.0, 1.5, 2.0, 3.0, 5.0]:
        survived = (mae_pct_abs <= thresh).mean() * 100
        print(f"    Stop >= {thresh:>5.2f}%: {survived:5.1f}% of winners survived")


def tier1_pattern_detection(df: pd.DataFrame):
    """Detect which pattern the system exhibits (A, B, or C)."""
    print("\n" + "=" * 70)
    print("PATTERN DETECTION")
    print("=" * 70)

    winners = df[df["is_winner"]]
    losers = df[~df["is_winner"]]

    # Pattern A: Early validation (winners have small MAE)
    w_small_mae = (winners["mae"].abs() <= 10).mean() * 100
    l_small_mae = (losers["mae"].abs() <= 10).mean() * 100

    # Pattern B: Shakeout then run (winners have larger MAE)
    w_large_mae = (winners["mae"].abs() > 50).mean() * 100

    # Pattern C: Fat-tail winners (MFE distribution is right-skewed)
    w_mfe_median = winners["mfe"].median()
    w_mfe_mean = winners["mfe"].mean()
    w_mfe_skew = w_mfe_mean / max(w_mfe_median, 1)

    # PnL distribution
    pnl_median = df["holly_pnl"].median()
    pnl_mean = df["holly_pnl"].mean()
    pnl_p90 = np.percentile(df["holly_pnl"], 90)
    pnl_p99 = np.percentile(df["holly_pnl"], 99)

    print(f"\n  Pattern A check (early validation):")
    print(f"    Winners with MAE <= 10c: {w_small_mae:.1f}%")
    print(f"    Losers with MAE <= 10c:  {l_small_mae:.1f}%")
    print(f"    Difference: {w_small_mae - l_small_mae:+.1f}pp")

    print(f"\n  Pattern B check (shakeout then run):")
    print(f"    Winners with MAE > 50c: {w_large_mae:.1f}%")

    print(f"\n  Pattern C check (fat-tail winners):")
    print(f"    MFE mean/median ratio: {w_mfe_skew:.2f}x (>2 = fat tail)")
    print(f"    Winner MFE: median={w_mfe_median:.0f}c, mean={w_mfe_mean:.0f}c")
    print(f"    PnL: median=${pnl_median:.0f}, mean=${pnl_mean:.0f}")
    print(f"    PnL P90: ${pnl_p90:.0f}, P99: ${pnl_p99:.0f}")

    # Verdict
    print(f"\n  VERDICT:")
    if w_mfe_skew > 2.0:
        print("    >> PATTERN C: Fat-tail winners (extreme right-tail distribution)")
        print("       Implication: Protect the right tail. Never cap winners.")
    if w_small_mae > 50:
        print("    >> PATTERN A elements: Many winners validate early")
        print("       Implication: Time stops could work (exit if not working quickly)")
    if w_large_mae > 30:
        print("    >> PATTERN B elements: Some winners shake out first")
        print("       Implication: Stops can't be too tight")


def tier1_exit_optimization_surface(df: pd.DataFrame):
    """Build TP vs SL expected value heatmap."""
    print("\n" + "=" * 70)
    print("EXIT OPTIMIZATION SURFACE (TP vs SL, R-multiples)")
    print("=" * 70)

    valid = df.dropna(subset=["risk_cents"])
    valid = valid[valid["risk_cents"] > 0].copy()

    # Simulate different stop loss and take profit levels
    sl_levels = [0.5, 0.75, 1.0, 1.5, 2.0, 3.0]  # R-multiples
    tp_levels = [1.0, 2.0, 3.0, 5.0, 8.0, 10.0, 15.0, 20.0]  # R-multiples

    print(f"\n  Trades with valid risk: {len(valid):,}")
    print(f"  Simulating {len(sl_levels)} SL x {len(tp_levels)} TP combinations...")

    results = []

    for sl_r in sl_levels:
        for tp_r in tp_levels:
            # For each trade, simulate the outcome with these SL/TP levels
            # Using MAE/MFE as proxies:
            # - If MAE exceeded SL: stopped out (loss = -SL)
            # - If MFE reached TP before MAE hit SL: took profit (gain = +TP)
            # - Neither: original exit (actual PnL)
            #
            # NOTE: This is approximate since we don't have the TIME ordering
            # of MAE vs MFE. We use a conservative assumption: if both would
            # have triggered, assume the stop was hit first (worst case).

            sl_cents = sl_r * valid["risk_cents"]
            tp_cents = tp_r * valid["risk_cents"]

            mae_hit = valid["mae"].abs() >= sl_cents
            mfe_hit = valid["mfe"] >= tp_cents

            # Outcomes
            pnl_sim = valid["pnl_cents"].copy()

            # If only SL hit: loss
            pnl_sim[mae_hit & ~mfe_hit] = -sl_cents[mae_hit & ~mfe_hit]

            # If only TP hit: profit
            pnl_sim[~mae_hit & mfe_hit] = tp_cents[~mae_hit & mfe_hit]

            # If both hit: conservative = SL wins
            # (In tier 2 with paths, we can resolve this properly)
            pnl_sim[mae_hit & mfe_hit] = -sl_cents[mae_hit & mfe_hit]

            ev = pnl_sim.mean()
            wr = (pnl_sim > 0).mean() * 100
            n_sl = mae_hit.sum()
            n_tp = (~mae_hit & mfe_hit).sum()

            results.append({
                "SL_R": sl_r, "TP_R": tp_r,
                "EV": ev, "WR": wr,
                "n_stopped": n_sl, "n_tp": n_tp,
            })

    res_df = pd.DataFrame(results)

    # Print as a table
    print(f"\n  Expected Value (cents) by SL x TP:")
    print(f"\n  {'SL \\\\ TP':>8}", end="")
    for tp in tp_levels:
        print(f"  {tp:>6.1f}R", end="")
    print()
    print("  " + "-" * (8 + len(tp_levels) * 8))

    for sl in sl_levels:
        row = res_df[res_df["SL_R"] == sl]
        print(f"  {sl:>6.1f}R", end="")
        for tp in tp_levels:
            ev = row[row["TP_R"] == tp]["EV"].iloc[0]
            print(f"  {ev:>6.0f}", end="")
        print()

    # Win rate table
    print(f"\n  Win Rate (%) by SL x TP:")
    print(f"\n  {'SL \\\\ TP':>8}", end="")
    for tp in tp_levels:
        print(f"  {tp:>6.1f}R", end="")
    print()
    print("  " + "-" * (8 + len(tp_levels) * 8))

    for sl in sl_levels:
        row = res_df[res_df["SL_R"] == sl]
        print(f"  {sl:>6.1f}R", end="")
        for tp in tp_levels:
            wr = row[row["TP_R"] == tp]["WR"].iloc[0]
            print(f"  {wr:>5.1f}%", end="")
        print()

    # Find optimal
    best = res_df.loc[res_df["EV"].idxmax()]
    print(f"\n  OPTIMAL (highest EV): SL={best['SL_R']:.1f}R, TP={best['TP_R']:.1f}R")
    print(f"    EV = {best['EV']:.0f} cents, WR = {best['WR']:.1f}%")

    # Current system baseline
    baseline_ev = valid["pnl_cents"].mean()
    print(f"\n  BASELINE (current system): EV = {baseline_ev:.0f} cents")
    print(f"  Improvement potential: {best['EV'] - baseline_ev:+.0f} cents/trade")

    return res_df


# ═══════════════════════════════════════════════════════════════
# TIER 2 — PATH ANALYSIS (trades with minute bar coverage)
# ═══════════════════════════════════════════════════════════════

def load_trade_paths() -> pd.DataFrame:
    """Reconstruct price paths from minute bars for covered trades.

    Uses BOTH bars (fetched specifically for Holly) and minute_bars_flat
    (Polygon flat files) for maximum coverage.
    """
    print("\n" + "=" * 70)
    print("TIER 2: LOADING TRADE PATHS FROM MINUTE BARS")
    print("=" * 70)

    con = duckdb.connect(str(DUCKDB_PATH), read_only=True)

    # Check which tables exist
    tables = [r[0] for r in con.execute("SHOW TABLES").fetchall()]
    has_bars = "bars" in tables
    has_flat = "minute_bars_flat" in tables

    print(f"  bars table: {'yes' if has_bars else 'no'}")
    print(f"  minute_bars_flat table: {'yes' if has_flat else 'no'}")

    # Build the path query using UNION of both sources for max coverage
    bar_sources = []
    if has_bars:
        bar_sources.append("""
            SELECT symbol, bar_time, open, high, low, close, volume
            FROM bars
        """)
    if has_flat:
        bar_sources.append("""
            SELECT ticker AS symbol, bar_time, open, high, low, close, volume
            FROM minute_bars_flat
        """)

    if not bar_sources:
        print("  ERROR: No minute bar tables found!")
        con.close()
        return pd.DataFrame()

    bar_union = " UNION ALL ".join(bar_sources)

    # For each trade, get all minute bars between entry and exit
    # Use a chunked approach to avoid memory issues
    trades = con.execute("""
        SELECT trade_id, symbol, direction,
               entry_time, exit_time, entry_price, stop_price,
               mfe, mae, holly_pnl
        FROM trades
        WHERE mfe IS NOT NULL AND mae IS NOT NULL
        ORDER BY trade_id
    """).fetchdf()

    # First, check coverage efficiently
    coverage_query = f"""
        WITH bar_data AS ({bar_union})
        SELECT t.trade_id, COUNT(b.bar_time) as bar_count
        FROM trades t
        LEFT JOIN bar_data b ON b.symbol = t.symbol
            AND b.bar_time >= t.entry_time
            AND b.bar_time <= t.exit_time
        GROUP BY t.trade_id
        HAVING COUNT(b.bar_time) > 0
    """

    print("  Checking bar coverage (this may take a moment)...")
    t0 = time.time()
    coverage = con.execute(coverage_query).fetchdf()
    elapsed = time.time() - t0
    print(f"  Coverage check: {elapsed:.1f}s")
    print(f"  Trades with bars: {len(coverage):,} / {len(trades):,} "
          f"({len(coverage)/len(trades)*100:.1f}%)")

    if coverage.empty:
        con.close()
        return pd.DataFrame()

    # Get the covered trade IDs
    covered_ids = set(coverage["trade_id"].tolist())
    avg_bars = coverage["bar_count"].mean()
    print(f"  Average bars per trade: {avg_bars:.1f}")

    # Now fetch the actual paths in chunks
    print("  Fetching price paths...")

    path_query = f"""
        WITH bar_data AS ({bar_union})
        SELECT t.trade_id, t.symbol, t.direction,
               t.entry_price, t.stop_price,
               b.bar_time, b.high, b.low, b.close,
               EXTRACT(EPOCH FROM (b.bar_time - t.entry_time)) / 60.0 AS minutes_after_entry
        FROM trades t
        JOIN bar_data b ON b.symbol = t.symbol
            AND b.bar_time >= t.entry_time
            AND b.bar_time <= t.exit_time
        WHERE t.trade_id IN (SELECT trade_id FROM ({coverage_query}))
        ORDER BY t.trade_id, b.bar_time
    """

    t0 = time.time()
    paths = con.execute(path_query).fetchdf()
    elapsed = time.time() - t0
    print(f"  Paths loaded: {len(paths):,} bars in {elapsed:.1f}s")

    con.close()
    return paths


def tier2_time_to_extremes(paths: pd.DataFrame, trades: pd.DataFrame):
    """Compute time-to-MAE and time-to-MFE for each trade."""
    print("\n" + "-" * 50)
    print("TIME-TO-MAE / TIME-TO-MFE (minutes after entry)")
    print("-" * 50)

    results = []

    for trade_id, group in paths.groupby("trade_id"):
        if group.empty:
            continue

        entry_price = group["entry_price"].iloc[0]
        direction = group["direction"].iloc[0]

        # Running MAE/MFE calculation
        if direction == "Long":
            running_mae = ((group["low"] - entry_price) * 100).cummin()
            running_mfe = ((group["high"] - entry_price) * 100).cummax()
        else:  # Short
            running_mae = ((entry_price - group["high"]) * 100).cummin()
            running_mfe = ((entry_price - group["low"]) * 100).cummax()

        # Time to peak MAE (most adverse point)
        mae_idx = running_mae.idxmin()
        time_to_mae = group.loc[mae_idx, "minutes_after_entry"]
        peak_mae = running_mae.min()

        # Time to peak MFE (most favorable point)
        mfe_idx = running_mfe.idxmax()
        time_to_mfe = group.loc[mfe_idx, "minutes_after_entry"]
        peak_mfe = running_mfe.max()

        # MFE at various time intervals
        mfe_at = {}
        for t in [1, 5, 10, 15, 30, 60, 90, 120]:
            mask = group["minutes_after_entry"] <= t
            if mask.any():
                if direction == "Long":
                    mfe_at[f"mfe_at_{t}m"] = ((group.loc[mask, "high"] - entry_price) * 100).max()
                else:
                    mfe_at[f"mfe_at_{t}m"] = ((entry_price - group.loc[mask, "low"]) * 100).max()
            else:
                mfe_at[f"mfe_at_{t}m"] = 0.0

        trade_info = trades[trades["trade_id"] == trade_id]
        is_winner = trade_info["is_winner"].iloc[0] if len(trade_info) > 0 else False
        holly_pnl = trade_info["holly_pnl"].iloc[0] if len(trade_info) > 0 else 0

        results.append({
            "trade_id": trade_id,
            "time_to_mae": time_to_mae,
            "time_to_mfe": time_to_mfe,
            "peak_mae": peak_mae,
            "peak_mfe": peak_mfe,
            "bar_count": len(group),
            "hold_minutes": group["minutes_after_entry"].max(),
            "is_winner": is_winner,
            "holly_pnl": holly_pnl,
            **mfe_at,
        })

    result_df = pd.DataFrame(results)
    winners = result_df[result_df["is_winner"]]
    losers = result_df[~result_df["is_winner"]]

    print(f"\n  Trades analyzed: {len(result_df):,}")
    print(f"  Winners: {len(winners):,}, Losers: {len(losers):,}")

    print(f"\n  Time-to-MAE (minutes after entry):")
    print(f"    All:     median={result_df['time_to_mae'].median():.1f}m, "
          f"mean={result_df['time_to_mae'].mean():.1f}m")
    print(f"    Winners: median={winners['time_to_mae'].median():.1f}m, "
          f"mean={winners['time_to_mae'].mean():.1f}m")
    print(f"    Losers:  median={losers['time_to_mae'].median():.1f}m, "
          f"mean={losers['time_to_mae'].mean():.1f}m")

    print(f"\n  Time-to-MFE (minutes after entry):")
    print(f"    All:     median={result_df['time_to_mfe'].median():.1f}m, "
          f"mean={result_df['time_to_mfe'].mean():.1f}m")
    print(f"    Winners: median={winners['time_to_mfe'].median():.1f}m, "
          f"mean={winners['time_to_mfe'].mean():.1f}m")
    print(f"    Losers:  median={losers['time_to_mfe'].median():.1f}m, "
          f"mean={losers['time_to_mfe'].mean():.1f}m")

    # Edge accumulation over time
    print(f"\n  MFE accumulation over time (avg MFE reached by time T):")
    for t in [1, 5, 10, 15, 30, 60, 90, 120]:
        col = f"mfe_at_{t}m"
        if col in result_df.columns:
            all_mfe = result_df[col].mean()
            w_mfe = winners[col].mean() if len(winners) > 0 else 0
            l_mfe = losers[col].mean() if len(losers) > 0 else 0
            print(f"    {t:>3}m: ALL={all_mfe:>6.0f}c  WIN={w_mfe:>6.0f}c  LOSE={l_mfe:>6.0f}c")

    return result_df


def tier2_early_validation_test(time_df: pd.DataFrame):
    """Test: do winners reveal themselves early?"""
    print("\n" + "-" * 50)
    print("EARLY VALIDATION TEST")
    print("Does MFE at time T predict final outcome?")
    print("-" * 50)

    for t in [1, 5, 10, 15, 30]:
        col = f"mfe_at_{t}m"
        if col not in time_df.columns:
            continue

        # Split into high/low MFE at time T
        median_mfe = time_df[col].median()
        high_mfe = time_df[time_df[col] > median_mfe]
        low_mfe = time_df[time_df[col] <= median_mfe]

        high_wr = high_mfe["is_winner"].mean() * 100
        low_wr = low_mfe["is_winner"].mean() * 100
        high_avg_pnl = high_mfe["holly_pnl"].mean()
        low_avg_pnl = low_mfe["holly_pnl"].mean()

        print(f"\n  At {t}m — median MFE threshold = {median_mfe:.0f}c:")
        print(f"    Above median: WR={high_wr:.1f}%, avg PnL=${high_avg_pnl:.0f} (n={len(high_mfe):,})")
        print(f"    Below median: WR={low_wr:.1f}%, avg PnL=${low_avg_pnl:.0f} (n={len(low_mfe):,})")
        print(f"    Spread: {high_wr - low_wr:+.1f}pp WR, ${high_avg_pnl - low_avg_pnl:+.0f} PnL")


def tier2_time_stop_simulation(time_df: pd.DataFrame, paths: pd.DataFrame, trades: pd.DataFrame):
    """Simulate time-based exit rules."""
    print("\n" + "-" * 50)
    print("TIME STOP SIMULATION")
    print("Exit if MFE < threshold at time T")
    print("-" * 50)

    # For each time stop, compute: if MFE < threshold at time T, exit at current price
    # Compare to baseline (full hold)
    baseline_ev = time_df["holly_pnl"].mean()
    baseline_wr = time_df["is_winner"].mean() * 100
    print(f"\n  Baseline: EV=${baseline_ev:.0f}, WR={baseline_wr:.1f}%")

    for t in [5, 10, 15, 30, 60]:
        col = f"mfe_at_{t}m"
        if col not in time_df.columns:
            continue

        for thresh_c in [0, 10, 25, 50]:
            # Trades where MFE at time T < threshold → would exit early
            would_exit = time_df[time_df[col] < thresh_c]
            would_hold = time_df[time_df[col] >= thresh_c]

            if len(would_exit) == 0 or len(would_hold) == 0:
                continue

            # For exited trades, assume PnL = 0 (scratch, exit at breakeven-ish)
            # For held trades, use actual PnL
            sim_pnl = pd.concat([
                pd.Series([0.0] * len(would_exit)),
                would_hold["holly_pnl"],
            ])
            sim_ev = sim_pnl.mean()
            sim_wr = (sim_pnl > 0).mean() * 100
            n_exit = len(would_exit)
            pct_exit = n_exit / len(time_df) * 100

            # Only print if this rule exits a meaningful number of trades
            if pct_exit > 2:
                delta_ev = sim_ev - baseline_ev
                print(f"    Exit if MFE<{thresh_c}c at {t:>2}m: "
                      f"exits {pct_exit:.0f}% of trades, "
                      f"EV=${sim_ev:.0f} ({delta_ev:+.0f}), WR={sim_wr:.1f}%")


def tier2_edge_decay(paths: pd.DataFrame, trades: pd.DataFrame):
    """Edge decay analysis: does the signal weaken over time?"""
    print("\n" + "-" * 50)
    print("EDGE DECAY ANALYSIS")
    print("Win rate by minutes after alert")
    print("-" * 50)

    # Compute PnL at each time interval (if we exited at minute T)
    time_intervals = [1, 2, 5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240]

    results = []
    for trade_id, group in paths.groupby("trade_id"):
        entry_price = group["entry_price"].iloc[0]
        direction = group["direction"].iloc[0]

        trade_info = trades[trades["trade_id"] == trade_id]
        if len(trade_info) == 0:
            continue
        actual_pnl = trade_info["holly_pnl"].iloc[0]

        row = {"trade_id": trade_id, "actual_pnl": actual_pnl}

        for t in time_intervals:
            bars_in_window = group[group["minutes_after_entry"] <= t]
            if bars_in_window.empty:
                row[f"pnl_at_{t}m"] = np.nan
                continue

            last_close = bars_in_window.iloc[-1]["close"]
            if direction == "Long":
                pnl_at_t = (last_close - entry_price) * 100  # cents
            else:
                pnl_at_t = (entry_price - last_close) * 100

            row[f"pnl_at_{t}m"] = pnl_at_t

        results.append(row)

    decay_df = pd.DataFrame(results)

    print(f"\n  Trades analyzed: {len(decay_df):,}")
    print(f"\n  {'Time':>6}  {'Avg PnL':>10}  {'WR':>6}  {'Median PnL':>12}  {'n valid':>8}")
    print(f"  {'-'*50}")

    for t in time_intervals:
        col = f"pnl_at_{t}m"
        if col not in decay_df.columns:
            continue
        valid = decay_df[col].dropna()
        if len(valid) < 50:
            continue
        avg = valid.mean()
        wr = (valid > 0).mean() * 100
        med = valid.median()
        print(f"  {t:>4}m  ${avg:>9.0f}  {wr:>5.1f}%  ${med:>11.0f}  {len(valid):>8,}")

    # Compare to actual final PnL
    actual_avg = decay_df["actual_pnl"].mean()
    actual_wr = (decay_df["actual_pnl"] > 0).mean() * 100
    actual_med = decay_df["actual_pnl"].median()
    print(f"  {'FINAL':>6}  ${actual_avg:>9.0f}  {actual_wr:>5.1f}%  ${actual_med:>11.0f}  {len(decay_df):>8,}")

    return decay_df


# ═══════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(description="MAE/MFE Path Analysis & Exit Optimization")
    parser.add_argument("--tier", type=int, choices=[1, 2], default=None,
                        help="Run only tier 1 or tier 2 (default: both)")
    args = parser.parse_args()

    REPORTS_DIR.mkdir(parents=True, exist_ok=True)

    t0 = time.time()

    # Load trades
    print("Loading trades...")
    trades = load_trades()
    print(f"  Loaded {len(trades):,} trades")

    # ── TIER 1: Full dataset analysis ──
    if args.tier in (None, 1):
        valid_r = tier1_distributions(trades)
        tier1_mae_of_winners(trades)
        tier1_pattern_detection(trades)
        surface_df = tier1_exit_optimization_surface(trades)

        # Save surface to CSV
        surface_file = REPORTS_DIR / "exit_optimization_surface.csv"
        surface_df.to_csv(surface_file, index=False)
        print(f"\n  Surface saved: {surface_file}")

    # ── TIER 2: Path analysis (trades with bar coverage) ──
    if args.tier in (None, 2):
        paths = load_trade_paths()

        if not paths.empty:
            time_df = tier2_time_to_extremes(paths, trades)
            tier2_early_validation_test(time_df)
            tier2_time_stop_simulation(time_df, paths, trades)
            decay_df = tier2_edge_decay(paths, trades)

            # Save results
            time_file = REPORTS_DIR / "mae_mfe_time_analysis.csv"
            time_df.to_csv(time_file, index=False)
            print(f"\n  Time analysis saved: {time_file}")

            decay_file = REPORTS_DIR / "edge_decay_analysis.csv"
            decay_df.to_csv(decay_file, index=False)
            print(f"\n  Edge decay saved: {decay_file}")

    elapsed = time.time() - t0
    print(f"\n{'=' * 70}")
    print(f"MAE/MFE analysis complete in {elapsed / 60:.1f}m")
    print(f"{'=' * 70}")


if __name__ == "__main__":
    main()
