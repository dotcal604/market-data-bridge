"""
28_mae_mfe_pipeline.py — Normalized MAE/MFE Analysis & Exit Simulation

Fixes all issues from script 27:
  - All excursions normalized to % of entry price AND R-multiples
  - Stratification by price bucket, position size, holding time, year
  - Selection bias check for minute-bar coverage subset
  - PnL contradiction investigation (PnL vs MFE%, shares, exposure)
  - What-if exit simulations via sequential bar walking (numba)

Usage:
    python scripts/28_mae_mfe_pipeline.py
    python scripts/28_mae_mfe_pipeline.py --part 1    # Tier 1 only (all trades)
    python scripts/28_mae_mfe_pipeline.py --part 2    # Tier 2 only (path sims)
"""

import argparse
import sys
import time
from pathlib import Path

import duckdb
import numba
import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).parent.parent))

from config.settings import DUCKDB_PATH, OUTPUT_DIR, MAX_HOLD_MINUTES
from engine.price_paths import build_all_paths
from engine.exit_rules import (
    batch_holly_baseline,
    batch_time_exit,
    batch_trailing_stop,
)

REPORTS_DIR = OUTPUT_DIR / "reports" / "mae_mfe"

# ═══════════════════════════════════════════════════════════════
# HELPERS
# ═══════════════════════════════════════════════════════════════

def pct(series: pd.Series, vals=(5, 25, 50, 75, 95)) -> dict:
    """Compute percentiles as a dict."""
    return {f"p{v}": series.quantile(v / 100) for v in vals}


def stats_row(label: str, s: pd.Series) -> dict:
    """Summary stats for a series."""
    return {
        "group": label, "n": len(s),
        "mean": s.mean(), "median": s.median(), "std": s.std(),
        **pct(s),
    }


def section(title: str):
    print(f"\n{'=' * 70}")
    print(f"  {title}")
    print(f"{'=' * 70}")


def subsection(title: str):
    print(f"\n  {'-' * 50}")
    print(f"  {title}")
    print(f"  {'-' * 50}")


# ═══════════════════════════════════════════════════════════════
# PART 1 — LOAD & NORMALIZE
# ═══════════════════════════════════════════════════════════════

def load_and_normalize() -> pd.DataFrame:
    """Load all trades, normalize MAE/MFE to % and R-multiples."""
    section("LOADING & NORMALIZING TRADES")

    con = duckdb.connect(str(DUCKDB_PATH), read_only=True)
    df = con.execute("""
        SELECT
            trade_id, symbol, strategy, direction,
            entry_time, entry_price, exit_time, exit_price,
            stop_price, target_price,
            mfe, mae,
            shares, holly_pnl, stop_buffer_pct,
            EXTRACT(EPOCH FROM (exit_time - entry_time)) / 60.0 AS hold_minutes,
            EXTRACT(YEAR FROM entry_time) AS trade_year
        FROM trades
        WHERE mfe IS NOT NULL AND mae IS NOT NULL
          AND entry_price > 0 AND stop_price IS NOT NULL
          AND direction IN ('Long', 'Short')
        ORDER BY trade_id
    """).fetchdf()
    con.close()

    # ── Normalize to % of entry price ──
    # Holly MAE/MFE are in cents. Normalize: cents / (entry_price * 100) * 100 = cents / entry_price
    df["mae_pct"] = df["mae"] / df["entry_price"]       # already in % (mae is cents, divide by price*100 for fraction, *100 for %)
    df["mfe_pct"] = df["mfe"] / df["entry_price"]

    # ── R-multiples ──
    # R = |entry_price - stop_price| (in dollars per share)
    df["R"] = np.abs(df["entry_price"] - df["stop_price"])
    df["R"] = df["R"].replace(0, np.nan)

    # MAE/MFE in R: convert cents to dollars first, then divide by R
    df["mae_r"] = (df["mae"] / 100) / df["R"]           # mae cents → dollars / R
    df["mfe_r"] = (df["mfe"] / 100) / df["R"]

    # ── PnL normalization ──
    df["is_winner"] = df["holly_pnl"] > 0
    df["pnl_per_share"] = np.where(
        df["shares"] > 0,
        df["holly_pnl"] / df["shares"],
        0.0,
    )
    df["pnl_pct"] = df["pnl_per_share"] / df["entry_price"] * 100
    df["pnl_r"] = df["pnl_per_share"] / df["R"]

    # ── Dollar exposure ──
    df["dollar_exposure"] = df["entry_price"] * df["shares"]

    # ── Raw realized return (simple price delta, NOT holly_pnl) ──
    direction_sign = np.where(df["direction"] == "Long", 1.0, -1.0)
    df["raw_return_per_share"] = direction_sign * (df["exit_price"] - df["entry_price"])
    df["raw_return_pct"] = df["raw_return_per_share"] / df["entry_price"] * 100
    df["raw_return_r"] = df["raw_return_per_share"] / df["R"]

    # ── Capture ratio (raw return / MFE, both in same units) ──
    # MFE in dollars per share = mfe cents / 100
    df["mfe_dollars"] = df["mfe"] / 100
    df["capture_ratio"] = np.where(
        df["mfe_dollars"] > 0,
        df["raw_return_per_share"] / df["mfe_dollars"],
        np.nan,
    )

    # ── Price bucket ──
    df["price_bucket"] = pd.cut(
        df["entry_price"],
        bins=[0, 5, 10, 20, 50, 9999],
        labels=["<$5", "$5-10", "$10-20", "$20-50", "$50+"],
    )

    # ── Share count quintile ──
    try:
        df["shares_q"] = pd.qcut(df["shares"], 5, labels=False, duplicates="drop")
    except ValueError:
        df["shares_q"] = pd.cut(df["shares"], 5, labels=False)

    # ── Hold time bucket ──
    df["hold_bucket"] = pd.cut(
        df["hold_minutes"].clip(0, 999),
        bins=[0, 15, 30, 60, 120, 999],
        labels=["0-15m", "15-30m", "30-60m", "1-2h", "2h+"],
    )

    print(f"  Loaded: {len(df):,} trades")
    print(f"  Winners: {df['is_winner'].sum():,} ({df['is_winner'].mean()*100:.1f}%)")
    print(f"  Direction: {(df['direction']=='Long').sum():,} Long, {(df['direction']=='Short').sum():,} Short")
    print(f"  R valid: {df['R'].notna().sum():,} ({df['R'].notna().mean()*100:.1f}%)")
    print(f"  Median R: ${df['R'].median():.2f}")
    print(f"  Price range: ${df['entry_price'].min():.2f} — ${df['entry_price'].max():.2f}")
    print(f"  Years: {int(df['trade_year'].min())} — {int(df['trade_year'].max())}")

    return df


# ═══════════════════════════════════════════════════════════════
# PART 2 — TIER 1: NORMALIZED DISTRIBUTIONS (ALL TRADES)
# ═══════════════════════════════════════════════════════════════

def tier1_distributions(df: pd.DataFrame) -> list[pd.DataFrame]:
    """Run normalized MAE/MFE distributions on full dataset."""
    section("TIER 1: NORMALIZED DISTRIBUTIONS")
    outputs = []

    winners = df[df["is_winner"]]
    losers = df[~df["is_winner"]]

    # ── 1a: MAE% Distribution (winner vs loser) ──
    subsection("MAE as % of Entry Price")
    rows = []
    for label, subset in [("ALL", df), ("WINNERS", winners), ("LOSERS", losers)]:
        mae_abs_pct = subset["mae_pct"].abs()
        rows.append(stats_row(label, mae_abs_pct))
        p = pct(mae_abs_pct)
        print(f"  {label:8s}  n={len(subset):>6,}  "
              f"median={p['p50']:.2f}%  p75={p['p75']:.2f}%  p95={p['p95']:.2f}%")
    mae_dist = pd.DataFrame(rows)
    mae_dist.to_csv(REPORTS_DIR / "mae_pct_distribution.csv", index=False)
    outputs.append(mae_dist)

    # ── 1b: MFE% Distribution ──
    subsection("MFE as % of Entry Price")
    rows = []
    for label, subset in [("ALL", df), ("WINNERS", winners), ("LOSERS", losers)]:
        mfe_pct = subset["mfe_pct"]
        rows.append(stats_row(label, mfe_pct))
        p = pct(mfe_pct)
        print(f"  {label:8s}  n={len(subset):>6,}  "
              f"median={p['p50']:.2f}%  p75={p['p75']:.2f}%  p95={p['p95']:.2f}%")
    mfe_dist = pd.DataFrame(rows)
    mfe_dist.to_csv(REPORTS_DIR / "mfe_pct_distribution.csv", index=False)
    outputs.append(mfe_dist)

    # ── 1c: MAE in R-multiples ──
    subsection("MAE in R-multiples (risk units)")
    valid_r = df[df["R"].notna() & (df["R"] > 0)]
    w_r = valid_r[valid_r["is_winner"]]
    l_r = valid_r[~valid_r["is_winner"]]
    rows = []
    for label, subset in [("ALL", valid_r), ("WINNERS", w_r), ("LOSERS", l_r)]:
        mae_r_abs = subset["mae_r"].abs()
        rows.append(stats_row(label, mae_r_abs))
        p = pct(mae_r_abs)
        print(f"  {label:8s}  n={len(subset):>6,}  "
              f"median={p['p50']:.2f}R  p75={p['p75']:.2f}R  p95={p['p95']:.2f}R")
    mae_r_dist = pd.DataFrame(rows)
    mae_r_dist.to_csv(REPORTS_DIR / "mae_r_distribution.csv", index=False)
    outputs.append(mae_r_dist)

    # ── 1d: MFE in R-multiples ──
    subsection("MFE in R-multiples")
    rows = []
    for label, subset in [("ALL", valid_r), ("WINNERS", w_r), ("LOSERS", l_r)]:
        mfe_r = subset["mfe_r"]
        rows.append(stats_row(label, mfe_r))
        p = pct(mfe_r)
        print(f"  {label:8s}  n={len(subset):>6,}  "
              f"median={p['p50']:.2f}R  p75={p['p75']:.2f}R  p95={p['p95']:.2f}R")
    mfe_r_dist = pd.DataFrame(rows)
    mfe_r_dist.to_csv(REPORTS_DIR / "mfe_r_distribution.csv", index=False)
    outputs.append(mfe_r_dist)

    # ── 1e: Capture ratio distribution ──
    subsection("Capture Ratio = raw_return / MFE")
    cap = df[df["capture_ratio"].notna() & np.isfinite(df["capture_ratio"])]
    for label, subset in [("ALL", cap), ("WINNERS", cap[cap["is_winner"]]), ("LOSERS", cap[~cap["is_winner"]])]:
        p = pct(subset["capture_ratio"])
        print(f"  {label:8s}  n={len(subset):>6,}  "
              f"median={p['p50']:.2f}  p75={p['p75']:.2f}  p95={p['p95']:.2f}")

    return outputs


def tier1_stratification(df: pd.DataFrame) -> list[pd.DataFrame]:
    """Stratify key metrics by price bucket, shares, hold time, year."""
    section("TIER 1: STRATIFICATION")
    outputs = []

    valid_r = df[df["R"].notna() & (df["R"] > 0)].copy()

    for strat_col, strat_name in [
        ("price_bucket", "Price Bucket"),
        ("shares_q", "Share Count Quintile"),
        ("hold_bucket", "Hold Duration"),
        ("trade_year", "Year"),
    ]:
        subsection(f"Stratification by {strat_name}")
        rows = []
        for group_val, group_df in valid_r.groupby(strat_col, observed=True):
            if len(group_df) < 20:
                continue
            wr = group_df["is_winner"].mean() * 100
            mae_pct_med = group_df["mae_pct"].abs().median()
            mfe_pct_med = group_df["mfe_pct"].median()
            mae_r_med = group_df["mae_r"].abs().median()
            mfe_r_med = group_df["mfe_r"].median()
            pnl_r_med = group_df["pnl_r"].median()
            cap_vals = group_df["capture_ratio"].dropna()
            cap_med = cap_vals.median() if len(cap_vals) > 0 else np.nan

            row = {
                "stratum": str(group_val), "n": len(group_df),
                "win_rate": wr,
                "mae_pct_median": mae_pct_med, "mfe_pct_median": mfe_pct_med,
                "mae_r_median": mae_r_med, "mfe_r_median": mfe_r_med,
                "pnl_r_median": pnl_r_med, "capture_median": cap_med,
            }
            rows.append(row)
            print(f"  {str(group_val):>8s}  n={len(group_df):>5,}  WR={wr:5.1f}%  "
                  f"MAE%={mae_pct_med:6.2f}%  MFE%={mfe_pct_med:6.2f}%  "
                  f"MAE_R={mae_r_med:5.2f}  MFE_R={mfe_r_med:5.2f}  "
                  f"cap={cap_med:5.2f}")

        strat_df = pd.DataFrame(rows)
        fname = f"strat_{strat_col}.csv"
        strat_df.to_csv(REPORTS_DIR / fname, index=False)
        outputs.append(strat_df)

    return outputs


def pnl_contradiction(df: pd.DataFrame) -> pd.DataFrame:
    """Investigate PnL vs MFE% contradiction."""
    section("PNL CONTRADICTION INVESTIGATION")

    valid = df[df["R"].notna() & (df["R"] > 0) & df["mfe_pct"].notna()].copy()

    # Correlations
    subsection("Correlations with holly_pnl")
    for col, label in [
        ("mfe_pct", "MFE%"),
        ("shares", "Share Count"),
        ("dollar_exposure", "Dollar Exposure"),
        ("hold_minutes", "Hold Minutes"),
        ("entry_price", "Entry Price"),
        ("mfe_r", "MFE in R"),
    ]:
        corr = valid["holly_pnl"].corr(valid[col])
        print(f"  holly_pnl vs {label:<20s}  r = {corr:+.4f}")

    # By PnL decile
    subsection("PnL Decile Analysis")
    valid["pnl_decile"] = pd.qcut(valid["holly_pnl"], 10, labels=False, duplicates="drop")
    rows = []
    for dec, gdf in valid.groupby("pnl_decile"):
        rows.append({
            "decile": int(dec),
            "n": len(gdf),
            "pnl_median": gdf["holly_pnl"].median(),
            "mfe_pct_median": gdf["mfe_pct"].median(),
            "mfe_r_median": gdf["mfe_r"].median(),
            "shares_median": gdf["shares"].median(),
            "exposure_median": gdf["dollar_exposure"].median(),
            "hold_median": gdf["hold_minutes"].median(),
            "entry_price_median": gdf["entry_price"].median(),
            "capture_median": gdf["capture_ratio"].dropna().median(),
        })

    dec_df = pd.DataFrame(rows)
    dec_df.to_csv(REPORTS_DIR / "pnl_decile_analysis.csv", index=False)

    print(f"  {'Dec':>4s} {'PnL':>10s} {'MFE%':>8s} {'MFE_R':>8s} "
          f"{'Shares':>8s} {'Exposure':>10s} {'Hold':>8s} {'Price':>8s} {'Cap':>6s}")
    for _, r in dec_df.iterrows():
        print(f"  {r['decile']:>4.0f} {r['pnl_median']:>10.0f} {r['mfe_pct_median']:>8.2f} "
              f"{r['mfe_r_median']:>8.2f} {r['shares_median']:>8.0f} "
              f"{r['exposure_median']:>10.0f} {r['hold_median']:>8.1f} "
              f"{r['entry_price_median']:>8.2f} {r['capture_median']:>6.2f}")

    return dec_df


def selection_bias_check(df: pd.DataFrame) -> pd.DataFrame:
    """Compare trades with bar coverage vs without."""
    section("SELECTION BIAS CHECK: COVERED vs UNCOVERED")

    con = duckdb.connect(str(DUCKDB_PATH), read_only=True)
    # Find which trade_ids have bars
    covered_ids = con.execute("""
        SELECT DISTINCT t.trade_id
        FROM trades t
        INNER JOIN bars b ON b.symbol = t.symbol
            AND CAST(b.bar_time AS DATE) = CAST(t.entry_time AS DATE)
    """).fetchdf()["trade_id"].tolist()
    con.close()

    df["has_bars"] = df["trade_id"].isin(covered_ids)

    rows = []
    for label, subset in [
        ("COVERED", df[df["has_bars"]]),
        ("UNCOVERED", df[~df["has_bars"]]),
    ]:
        if len(subset) == 0:
            continue
        rows.append({
            "group": label, "n": len(subset),
            "win_rate": subset["is_winner"].mean() * 100,
            "entry_price_median": subset["entry_price"].median(),
            "holly_pnl_median": subset["holly_pnl"].median(),
            "mae_pct_median": subset["mae_pct"].abs().median(),
            "mfe_pct_median": subset["mfe_pct"].median(),
            "hold_minutes_median": subset["hold_minutes"].median(),
            "year_median": subset["trade_year"].median(),
            "pct_long": (subset["direction"] == "Long").mean() * 100,
        })
        print(f"  {label:10s}  n={len(subset):>6,}  "
              f"WR={rows[-1]['win_rate']:.1f}%  "
              f"price=${rows[-1]['entry_price_median']:.2f}  "
              f"PnL=${rows[-1]['holly_pnl_median']:.0f}  "
              f"MAE%={rows[-1]['mae_pct_median']:.2f}%  "
              f"MFE%={rows[-1]['mfe_pct_median']:.2f}%  "
              f"hold={rows[-1]['hold_minutes_median']:.0f}m  "
              f"year={rows[-1]['year_median']:.0f}")

    bias_df = pd.DataFrame(rows)
    bias_df.to_csv(REPORTS_DIR / "selection_bias.csv", index=False)
    return bias_df


# ═══════════════════════════════════════════════════════════════
# NUMBA KERNELS — Per-trade R-based exit rules
# ═══════════════════════════════════════════════════════════════

@numba.njit
def _fixed_r_stop_single(ohlc, entry, direction, risk, stop_r, max_bars):
    """Exit when adverse excursion reaches stop_r * R from entry."""
    stop_dist = stop_r * risk
    for i in range(max_bars):
        h, l = ohlc[i, 1], ohlc[i, 2]
        if direction == 1:  # Long: stop if price drops stop_dist below entry
            if entry - l >= stop_dist:
                return i, entry - stop_dist, 0
        else:  # Short: stop if price rises stop_dist above entry
            if h - entry >= stop_dist:
                return i, entry + stop_dist, 0
    return max_bars - 1, ohlc[max_bars - 1, 3], 2


@numba.njit(parallel=True)
def batch_fixed_r_stop(paths, entries, directions, risks, stop_r, max_bars):
    n = paths.shape[0]
    exit_bars = np.empty(n, dtype=np.int64)
    exit_prices = np.empty(n, dtype=np.float64)
    exit_reasons = np.empty(n, dtype=np.int64)
    for i in numba.prange(n):
        actual = min(max_bars, paths.shape[1])
        exit_bars[i], exit_prices[i], exit_reasons[i] = _fixed_r_stop_single(
            paths[i], entries[i], directions[i], risks[i], stop_r, actual
        )
    return exit_bars, exit_prices, exit_reasons


@numba.njit
def _be_after_r_single(ohlc, entry, direction, risk, trigger_r, max_bars):
    """After price reaches +trigger_r * R, move stop to breakeven (entry)."""
    trigger_dist = trigger_r * risk
    triggered = False
    for i in range(max_bars):
        h, l = ohlc[i, 1], ohlc[i, 2]
        if direction == 1:
            excursion = h - entry
            adverse = entry - l
        else:
            excursion = entry - l
            adverse = h - entry

        if not triggered:
            if excursion >= trigger_dist:
                triggered = True
        else:
            # Stopped at breakeven if price returns to entry
            if adverse >= 0:  # price at or beyond entry (adverse direction)
                return i, entry, 0
    return max_bars - 1, ohlc[max_bars - 1, 3], 2


@numba.njit(parallel=True)
def batch_be_after_r(paths, entries, directions, risks, trigger_r, max_bars):
    n = paths.shape[0]
    exit_bars = np.empty(n, dtype=np.int64)
    exit_prices = np.empty(n, dtype=np.float64)
    exit_reasons = np.empty(n, dtype=np.int64)
    for i in numba.prange(n):
        actual = min(max_bars, paths.shape[1])
        exit_bars[i], exit_prices[i], exit_reasons[i] = _be_after_r_single(
            paths[i], entries[i], directions[i], risks[i], trigger_r, actual
        )
    return exit_bars, exit_prices, exit_reasons


@numba.njit
def _trail_after_r_single(ohlc, entry, direction, risk, trigger_r, trail_r, max_bars):
    """After +trigger_r*R, trail at trail_r*R below peak."""
    trigger_dist = trigger_r * risk
    trail_dist = trail_r * risk
    triggered = False
    peak = 0.0
    for i in range(max_bars):
        h, l = ohlc[i, 1], ohlc[i, 2]
        if direction == 1:
            excursion = h - entry
            low_exc = l - entry
        else:
            excursion = entry - l
            low_exc = entry - h

        if not triggered:
            if excursion >= trigger_dist:
                triggered = True
                peak = excursion
        else:
            if excursion > peak:
                peak = excursion
            stop_level = peak - trail_dist
            if low_exc <= stop_level:
                exit_p = entry + stop_level if direction == 1 else entry - stop_level
                return i, exit_p, 0
    return max_bars - 1, ohlc[max_bars - 1, 3], 2


@numba.njit(parallel=True)
def batch_trail_after_r(paths, entries, directions, risks, trigger_r, trail_r, max_bars):
    n = paths.shape[0]
    exit_bars = np.empty(n, dtype=np.int64)
    exit_prices = np.empty(n, dtype=np.float64)
    exit_reasons = np.empty(n, dtype=np.int64)
    for i in numba.prange(n):
        actual = min(max_bars, paths.shape[1])
        exit_bars[i], exit_prices[i], exit_reasons[i] = _trail_after_r_single(
            paths[i], entries[i], directions[i], risks[i], trigger_r, trail_r, actual
        )
    return exit_bars, exit_prices, exit_reasons


@numba.njit
def _partial_at_r_single(ohlc, entry, direction, risk, tp_r, partial_frac, trail_r, max_bars):
    """Scale out partial_frac at +tp_r*R, trail remainder at trail_r*R."""
    tp_dist = tp_r * risk
    trail_dist = trail_r * risk
    partial_filled = False
    partial_pnl = 0.0
    remainder = 1.0 - partial_frac
    peak_after = 0.0
    for i in range(max_bars):
        h, l, c = ohlc[i, 1], ohlc[i, 2], ohlc[i, 3]
        if direction == 1:
            excursion = h - entry
            low_exc = l - entry
        else:
            excursion = entry - l
            low_exc = entry - h

        if not partial_filled:
            if excursion >= tp_dist:
                partial_filled = True
                partial_pnl = tp_dist * partial_frac
                peak_after = excursion
        else:
            if excursion > peak_after:
                peak_after = excursion
            drawdown = peak_after - low_exc
            if drawdown >= trail_dist:
                remainder_pnl = (peak_after - trail_dist) * remainder
                blended = partial_pnl + remainder_pnl
                exit_p = entry + blended if direction == 1 else entry - blended
                return i, exit_p, 0

    last_c = ohlc[max_bars - 1, 3]
    if partial_filled:
        if direction == 1:
            remainder_pnl = (last_c - entry) * remainder
        else:
            remainder_pnl = (entry - last_c) * remainder
        blended = partial_pnl + remainder_pnl
        exit_p = entry + blended if direction == 1 else entry - blended
    else:
        exit_p = last_c
    return max_bars - 1, exit_p, 2


@numba.njit(parallel=True)
def batch_partial_at_r(paths, entries, directions, risks, tp_r, partial_frac, trail_r, max_bars):
    n = paths.shape[0]
    exit_bars = np.empty(n, dtype=np.int64)
    exit_prices = np.empty(n, dtype=np.float64)
    exit_reasons = np.empty(n, dtype=np.int64)
    for i in numba.prange(n):
        actual = min(max_bars, paths.shape[1])
        exit_bars[i], exit_prices[i], exit_reasons[i] = _partial_at_r_single(
            paths[i], entries[i], directions[i], risks[i], tp_r, partial_frac, trail_r, actual
        )
    return exit_bars, exit_prices, exit_reasons


# ═══════════════════════════════════════════════════════════════
# PART 5 — TIER 2: PATH RECONSTRUCTION & ANALYSIS
# ═══════════════════════════════════════════════════════════════

def path_based_analysis(paths: np.ndarray, meta: pd.DataFrame) -> pd.DataFrame:
    """Compute normalized MAE%/MFE% from reconstructed bar paths."""
    section("TIER 2: PATH-BASED MAE/MFE (RECONSTRUCTED)")

    entries = meta["eff_entry_price"].values
    directions = meta["direction_int"].values
    n_trades = len(meta)
    max_bars = paths.shape[1]

    # ── Per-trade running MAE/MFE from bars ──
    # For Long: favorable = high - entry, adverse = entry - low (negated)
    # For Short: favorable = entry - low, adverse = high - entry (negated)
    mae_abs = np.zeros(n_trades)
    mfe_val = np.zeros(n_trades)
    time_to_mae = np.zeros(n_trades, dtype=np.int64)
    time_to_mfe = np.zeros(n_trades, dtype=np.int64)

    for i in range(n_trades):
        entry = entries[i]
        d = directions[i]
        best = 0.0
        worst = 0.0
        best_bar = 0
        worst_bar = 0
        for j in range(max_bars):
            h, l = paths[i, j, 1], paths[i, j, 2]
            if h == 0 and l == 0:
                break  # padded region
            if d == 1:  # Long
                fav = h - entry
                adv = entry - l  # positive = adverse
            else:  # Short
                fav = entry - l
                adv = h - entry
            if fav > best:
                best = fav
                best_bar = j
            if adv > worst:
                worst = adv
                worst_bar = j

        mfe_val[i] = best
        mae_abs[i] = worst
        time_to_mfe[i] = best_bar
        time_to_mae[i] = worst_bar

    # Normalize to % of entry and R
    meta = meta.copy()
    meta["path_mfe_pct"] = mfe_val / entries * 100
    meta["path_mae_pct"] = mae_abs / entries * 100  # stored as positive
    meta["path_mfe_dollars"] = mfe_val
    meta["path_mae_dollars"] = mae_abs
    meta["time_to_mfe"] = time_to_mfe
    meta["time_to_mae"] = time_to_mae

    # R-multiples from stop_price (need to load from DB)
    con = duckdb.connect(str(DUCKDB_PATH), read_only=True)
    stop_df = con.execute(
        "SELECT trade_id, stop_price FROM trades"
    ).fetchdf()
    con.close()
    meta = meta.merge(stop_df, on="trade_id", how="left")
    meta["R_path"] = np.abs(meta["eff_entry_price"] - meta["stop_price"])
    meta["R_path"] = meta["R_path"].replace(0, np.nan)
    meta["path_mfe_r"] = mfe_val / meta["R_path"].values
    meta["path_mae_r"] = mae_abs / meta["R_path"].values

    # Realized return at Holly's exit bar
    holly_bars = meta["holly_exit_bar"].values.astype(int)
    holly_exit_close = np.array([
        paths[i, min(holly_bars[i], max_bars - 1), 3] for i in range(n_trades)
    ])
    meta["realized_return"] = np.where(
        directions == 1,
        holly_exit_close - entries,
        entries - holly_exit_close,
    )
    meta["realized_pct"] = meta["realized_return"] / entries * 100
    meta["realized_r"] = meta["realized_return"] / meta["R_path"]
    meta["path_capture"] = np.where(
        mfe_val > 0,
        meta["realized_return"] / mfe_val,
        np.nan,
    )

    # ── Print summary ──
    subsection("Path-Reconstructed Excursion Summary")
    print(f"  Trades with paths: {n_trades:,}")
    w = meta[meta["holly_pnl"] > 0]
    l = meta[meta["holly_pnl"] <= 0]
    for label, subset in [("ALL", meta), ("WINNERS", w), ("LOSERS", l)]:
        print(f"\n  {label} (n={len(subset):,}):")
        print(f"    MAE%   median={subset['path_mae_pct'].median():.2f}%  "
              f"p75={subset['path_mae_pct'].quantile(.75):.2f}%  "
              f"p95={subset['path_mae_pct'].quantile(.95):.2f}%")
        print(f"    MFE%   median={subset['path_mfe_pct'].median():.2f}%  "
              f"p75={subset['path_mfe_pct'].quantile(.75):.2f}%  "
              f"p95={subset['path_mfe_pct'].quantile(.95):.2f}%")
        v = subset[subset["R_path"].notna()]
        if len(v) > 0:
            print(f"    MAE_R  median={v['path_mae_r'].median():.2f}R  "
                  f"p75={v['path_mae_r'].quantile(.75):.2f}R")
            print(f"    MFE_R  median={v['path_mfe_r'].median():.2f}R  "
                  f"p75={v['path_mfe_r'].quantile(.75):.2f}R")
        print(f"    t_MAE  median={subset['time_to_mae'].median():.0f}m  "
              f"p75={subset['time_to_mae'].quantile(.75):.0f}m")
        print(f"    t_MFE  median={subset['time_to_mfe'].median():.0f}m  "
              f"p75={subset['time_to_mfe'].quantile(.75):.0f}m")
        print(f"    capture median={subset['path_capture'].dropna().median():.2f}")

    # Save per-trade detail
    out_cols = [
        "trade_id", "symbol", "strategy", "direction",
        "eff_entry_price", "holly_pnl",
        "path_mae_pct", "path_mfe_pct", "path_mae_r", "path_mfe_r",
        "time_to_mae", "time_to_mfe",
        "realized_pct", "realized_r", "path_capture",
        "holly_exit_bar",
    ]
    meta[out_cols].to_csv(REPORTS_DIR / "path_excursions.csv", index=False)

    return meta


# ═══════════════════════════════════════════════════════════════
# PART 6 — WHAT-IF EXIT SIMULATIONS
# ═══════════════════════════════════════════════════════════════

def compute_sim_stats(meta: pd.DataFrame, exit_bars, exit_prices, directions, entries, label: str) -> dict:
    """Compute standard stats for a simulation result."""
    pnl = np.where(directions == 1, exit_prices - entries, entries - exit_prices)
    wins = pnl > 0
    n = len(pnl)
    wr = wins.sum() / n * 100 if n > 0 else 0

    risks = meta["R_path"].values
    valid_r = (risks > 0) & np.isfinite(risks)
    pnl_r = np.where(valid_r, pnl / risks, np.nan)

    total_pnl = np.nansum(pnl)
    gross_profit = np.nansum(pnl[wins])
    gross_loss = np.abs(np.nansum(pnl[~wins]))
    pf = gross_profit / gross_loss if gross_loss > 0 else np.inf

    return {
        "scenario": label,
        "n_trades": n,
        "win_rate": wr,
        "median_pnl": np.nanmedian(pnl),
        "mean_pnl": np.nanmean(pnl),
        "total_pnl": total_pnl,
        "profit_factor": pf,
        "median_pnl_r": np.nanmedian(pnl_r[valid_r]),
        "mean_pnl_r": np.nanmean(pnl_r[valid_r]),
        "median_exit_bar": np.median(exit_bars),
        "p95_drawdown_pct": np.nanpercentile(-pnl / entries * 100, 95),
    }


def whatif_simulations(paths: np.ndarray, meta: pd.DataFrame) -> pd.DataFrame:
    """Run all what-if exit simulations."""
    section("WHAT-IF EXIT SIMULATIONS")

    entries = meta["eff_entry_price"].values
    directions = meta["direction_int"].values
    risks = meta["R_path"].values
    holly_exit_bars = meta["holly_exit_bar"].values
    max_bars = paths.shape[1]
    n = paths.shape[0]

    # Replace NaN risks with a fallback (median R) to avoid numba issues
    median_r = np.nanmedian(risks[risks > 0])
    safe_risks = np.where((risks > 0) & np.isfinite(risks), risks, median_r)

    results = []

    # ── 0. Holly baseline ──
    subsection("0. Holly Baseline")
    eb, ep, er = batch_holly_baseline(paths, entries, directions, holly_exit_bars, max_bars)
    results.append(compute_sim_stats(meta, eb, ep, directions, entries, "Holly Baseline"))

    # ── 1. 15-min time stop ──
    subsection("1. Time Stop — 15 minutes")
    eb, ep, er = batch_time_exit(paths, entries, directions, 15, max_bars)
    results.append(compute_sim_stats(meta, eb, ep, directions, entries, "Time Stop 15m"))

    # ── 2a. Fixed stop at -0.75R ──
    subsection("2a. Fixed Stop at -0.75R")
    eb, ep, er = batch_fixed_r_stop(paths, entries, directions, safe_risks, 0.75, max_bars)
    results.append(compute_sim_stats(meta, eb, ep, directions, entries, "Stop -0.75R"))

    # ── 2b. Fixed stop at -1.25R ──
    subsection("2b. Fixed Stop at -1.25R")
    eb, ep, er = batch_fixed_r_stop(paths, entries, directions, safe_risks, 1.25, max_bars)
    results.append(compute_sim_stats(meta, eb, ep, directions, entries, "Stop -1.25R"))

    # ── 3. Move to BE after +1R ──
    subsection("3. Breakeven after +1R")
    eb, ep, er = batch_be_after_r(paths, entries, directions, safe_risks, 1.0, max_bars)
    results.append(compute_sim_stats(meta, eb, ep, directions, entries, "BE after +1R"))

    # ── 4. Trail after +2R (trail at 1R below peak) ──
    subsection("4. Trail after +2R (1R trail)")
    eb, ep, er = batch_trail_after_r(paths, entries, directions, safe_risks, 2.0, 1.0, max_bars)
    results.append(compute_sim_stats(meta, eb, ep, directions, entries, "Trail after +2R"))

    # ── 5. Scale out 50% at +1R, trail remainder at 1R ──
    subsection("5. Scale 50% at +1R, trail remainder")
    eb, ep, er = batch_partial_at_r(paths, entries, directions, safe_risks, 1.0, 0.5, 1.0, max_bars)
    # Note: exit_prices from partial are blended (weighted avg of partial + remainder)
    results.append(compute_sim_stats(meta, eb, ep, directions, entries, "50% at +1R + trail"))

    # ── Print comparison table ──
    sim_df = pd.DataFrame(results)
    subsection("SIMULATION COMPARISON")
    print(f"  {'Scenario':<25s} {'WR':>6s} {'Med PnL':>9s} {'Mean PnL':>9s} "
          f"{'Total':>12s} {'PF':>6s} {'Med R':>7s} {'Med Bar':>8s}")
    for _, r in sim_df.iterrows():
        print(f"  {r['scenario']:<25s} {r['win_rate']:>5.1f}% "
              f"${r['median_pnl']:>8.2f} ${r['mean_pnl']:>8.2f} "
              f"${r['total_pnl']:>11,.0f} {r['profit_factor']:>5.2f}x "
              f"{r['median_pnl_r']:>6.2f}R {r['median_exit_bar']:>7.0f}m")

    sim_df.to_csv(REPORTS_DIR / "whatif_simulations.csv", index=False)
    return sim_df


# ═══════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(
        description="Normalized MAE/MFE Analysis & Exit Simulation Pipeline"
    )
    parser.add_argument(
        "--part", type=int, default=0,
        help="1=Tier1 only, 2=Tier2 only, 0=both (default)",
    )
    args = parser.parse_args()

    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    t0 = time.time()

    run_t1 = args.part in (0, 1)
    run_t2 = args.part in (0, 2)

    if run_t1:
        df = load_and_normalize()
        tier1_distributions(df)
        tier1_stratification(df)
        pnl_contradiction(df)
        selection_bias_check(df)

    if run_t2:
        section("BUILDING PRICE PATHS")
        db = duckdb.connect(str(DUCKDB_PATH), read_only=True)
        paths, meta = build_all_paths(db, max_hold_minutes=MAX_HOLD_MINUTES)
        db.close()
        print(f"  Paths shape: {paths.shape}")
        print(f"  Trades with paths: {len(meta):,}")

        meta = path_based_analysis(paths, meta)
        whatif_simulations(paths, meta)

    elapsed = time.time() - t0
    section(f"PIPELINE COMPLETE — {elapsed:.1f}s")
    print(f"  Reports saved to: {REPORTS_DIR}")


if __name__ == "__main__":
    main()
