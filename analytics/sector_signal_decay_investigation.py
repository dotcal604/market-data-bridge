"""
Sector Signal Decay Investigation -- strat_sector_prior_wr
==========================================================
Production-grade investigation of the strategy-sector-direction conditional
win rate signal. Determines whether it is live-deployable or a decaying artifact.

3-Iteration structure:
  Iteration 1: Attack the hypothesis (try to kill the signal)
  Iteration 2: Full findings (policy comparison, threshold sensitivity, stability)
  Iteration 3: Self-critique (bootstrap CI, baseline comparison, honest verdict)

Analysis pipeline:
  1. Construct cell-level (strategy x sector x direction) win rates (no look-ahead)
  2. Compare full-history, trailing 12m/6m/3m, and exponentially weighted variants
  3. Test sign-agreement rules between long-run and recent estimates
  4. Run change-point / structural break detection
  5. Evaluate 6 deployment policies (A-F) via walk-forward OOS
  6. Stress-test all thresholds for stability
  7. Decompose stability by year/side/regime/strategy
  8. Bootstrap discrimination confidence intervals
  9. Compare to sector-only baseline (Policy F)
  10. Produce survivor table, kill table, recommended live policy

Usage:
    python analytics/sector_signal_decay_investigation.py
    python analytics/sector_signal_decay_investigation.py --output-json
"""

import argparse
import json
import logging
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from scipy import stats

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
ANALYTICS_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = ANALYTICS_DIR.parent
DATA_DIR = PROJECT_ROOT / "data"
SILVER_DIR = DATA_DIR / "silver"
SILVER_PARQUET = SILVER_DIR / "holly_trades.parquet"
OUTPUT_DIR = ANALYTICS_DIR / "output"
HOLLY_CSV = ANALYTICS_DIR / "holly_exit" / "output" / "holly_analytics.csv"

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants (defaults -- stress-tested in threshold sweep)
# ---------------------------------------------------------------------------
MIN_CELL_TRADES_DEPLOY = 30
MIN_CELL_TRADES_RECENT = 10
SHRINKAGE_PRIOR = 0.50
EWM_HALFLIFE_TRADES = 60
BREAKEVEN_WR = 0.50
SAFE_WR_THRESHOLD = 0.52
PENALTY_WR_THRESHOLD = 0.45
SIGN_AGREEMENT_THRESHOLD = 0.50
OVERLAY_CAP = 0.10

# Verdict thresholds
DEATH_DISCRIM = 0.02
DEATH_COVERAGE = 0.20
PROBATION_DISCRIM = 0.05
PROBATION_COVERAGE = 0.40
SURVIVAL_DISCRIM = 0.05
SURVIVAL_COVERAGE = 0.30

# Global data source tracker
DATA_SOURCE = "UNKNOWN"


# ---------------------------------------------------------------------------
# Data Loading
# ---------------------------------------------------------------------------
def load_trades() -> tuple[pd.DataFrame, str]:
    """Load trades from Silver DuckDB, Parquet, CSV, or synthetic fallback.
    Returns (dataframe, data_source_label)."""
    silver_ddb = SILVER_DIR / "holly_trades.duckdb"

    if silver_ddb.exists():
        try:
            import duckdb
            logger.info(f"Loading from Silver DuckDB: {silver_ddb}")
            db = duckdb.connect(str(silver_ddb), read_only=True)
            df = db.execute("SELECT * FROM holly_trades").fetchdf()
            db.close()
            return df, "REAL_SILVER_DUCKDB"
        except Exception as e:
            logger.warning(f"DuckDB load failed: {e}")

    if SILVER_PARQUET.exists():
        logger.info(f"Loading from Parquet: {SILVER_PARQUET}")
        return pd.read_parquet(SILVER_PARQUET), "REAL_SILVER_PARQUET"

    if HOLLY_CSV.exists():
        logger.info(f"Loading from CSV fallback: {HOLLY_CSV}")
        return pd.read_csv(HOLLY_CSV), "REAL_CSV"

    logger.error("No real data source found. Generating synthetic data.")
    return _generate_synthetic_data(), "SYNTHETIC"


def _generate_synthetic_data() -> pd.DataFrame:
    """Realistic synthetic trade data with known decay patterns."""
    rng = np.random.default_rng(42)
    n = 30_000
    strategies = [
        "Momentum Breakout", "VWAP Reclaim", "Opening Range Break",
        "Gap and Go", "Red to Green", "Trend Continuation",
        "Mean Reversion", "Parabolic Short",
    ]
    sectors = [
        "Technology", "Healthcare", "Consumer Cyclical", "Energy",
        "Industrials", "Financial Services", "Communication Services",
        "Basic Materials", "Consumer Defensive", "Utilities",
    ]
    directions = ["Long", "Short"]

    dates = pd.date_range("2023-01-03", "2026-03-10", freq="B")
    entry_times = np.sort(rng.choice(dates, size=n))
    df = pd.DataFrame({
        "entry_time": entry_times,
        "strategy": rng.choice(strategies, size=n),
        "sector": rng.choice(sectors, size=n),
        "direction": rng.choice(directions, size=n, p=[0.7, 0.3]),
        "entry_price": rng.uniform(5, 200, size=n).round(2),
    })

    # Base WR per cell
    cell_base_wr: dict[tuple, float] = {}
    for s in strategies:
        for sec in sectors:
            for d in directions:
                cell_base_wr[(s, sec, d)] = np.clip(rng.normal(0.52, 0.06), 0.35, 0.70)

    # Decay: 25% of cells degrade after Oct 2024
    all_cells = list(cell_base_wr.keys())
    decay_idx = rng.choice(len(all_cells), size=int(len(all_cells) * 0.25), replace=False)
    decay_cells = {all_cells[i]: rng.uniform(0.08, 0.18) for i in decay_idx}
    decay_start = pd.Timestamp("2024-10-01")

    # Structural breaks: 10% of cells break Dec 2025+
    break_idx = rng.choice(len(all_cells), size=int(len(all_cells) * 0.10), replace=False)
    break_cells = set(all_cells[i] for i in break_idx)
    break_date = pd.Timestamp("2025-12-01")

    holly_pnl = np.zeros(n)
    is_winner = np.zeros(n, dtype=bool)
    # Add vol_regime for stability tests
    vol_regimes = rng.choice(["low_vol", "normal_vol", "high_vol"], size=n, p=[0.25, 0.50, 0.25])

    for i in range(n):
        cell = (df.loc[i, "strategy"], df.loc[i, "sector"], df.loc[i, "direction"])
        wr = cell_base_wr.get(cell, 0.50)
        t = df.loc[i, "entry_time"]
        if cell in decay_cells and t >= decay_start:
            months_since = (t - decay_start).days / 30
            wr -= decay_cells[cell] * min(1.0, months_since / 6)
        if cell in break_cells and t >= break_date:
            wr = max(0.30, wr - 0.15)
        win = rng.random() < wr
        is_winner[i] = win
        holly_pnl[i] = rng.exponential(80) if win else -rng.exponential(60)

    df["holly_pnl"] = holly_pnl.round(2)
    df["is_winner"] = is_winner
    df["shares"] = rng.integers(50, 500, size=n)
    df["stop_price"] = (df["entry_price"] * rng.uniform(0.95, 0.99, size=n)).round(2)
    df["vol_regime"] = vol_regimes
    # Simulate sector_win_rate for baseline comparison
    sector_stats = df.groupby("sector")["is_winner"].mean()
    df["sector_win_rate"] = df["sector"].map(sector_stats).round(4)
    df["sector_trades"] = df["sector"].map(df.groupby("sector").size())

    logger.info(f"Generated {n:,} synthetic trades, {is_winner.sum():,} winners ({is_winner.mean():.1%})")
    return df


# ---------------------------------------------------------------------------
# 1. Construct strat_sector_prior_wr (no look-ahead)
# ---------------------------------------------------------------------------
def compute_strat_sector_prior_wr(df: pd.DataFrame) -> pd.DataFrame:
    """Compute prior WR for each (strategy, sector, direction) cell.
    Uses ONLY trades before current trade. No look-ahead."""
    df = df.sort_values("entry_time").reset_index(drop=True)
    n = len(df)
    prior_wr = np.full(n, np.nan)
    prior_n = np.zeros(n, dtype=int)
    prior_avg_pnl = np.full(n, np.nan)
    cell_hist: dict[tuple, dict] = {}

    for i in range(n):
        cell = (df.loc[i, "strategy"], df.loc[i, "sector"], df.loc[i, "direction"])
        win = bool(df.loc[i, "is_winner"])
        pnl = float(df.loc[i, "holly_pnl"])
        if cell in cell_hist:
            h = cell_hist[cell]
            count = len(h["wins"])
            if count >= 10:
                prior_wr[i] = sum(h["wins"]) / count
                prior_n[i] = count
                prior_avg_pnl[i] = np.mean(h["pnls"])
        else:
            cell_hist[cell] = {"wins": [], "pnls": []}
        cell_hist[cell]["wins"].append(win)
        cell_hist[cell]["pnls"].append(pnl)

    df["strat_sector_prior_wr"] = np.round(prior_wr, 4)
    df["strat_sector_prior_n"] = prior_n
    df["strat_sector_prior_avg_pnl"] = np.round(prior_avg_pnl, 2)
    coverage = np.isfinite(prior_wr).sum()
    logger.info(f"strat_sector_prior_wr coverage: {coverage:,}/{n:,} ({coverage/n:.1%})")
    return df


# ---------------------------------------------------------------------------
# 2. Cell-level decay map
# ---------------------------------------------------------------------------
def build_cell_decay_map(df: pd.DataFrame) -> pd.DataFrame:
    """Compute full/12m/6m/3m/EWM/shrunk WR for each cell."""
    df = df.copy()
    df["entry_date"] = pd.to_datetime(df["entry_time"])
    latest = df["entry_date"].max()
    cutoffs = {
        "full": pd.Timestamp.min,
        "trail_12m": latest - pd.DateOffset(months=12),
        "trail_6m": latest - pd.DateOffset(months=6),
        "trail_3m": latest - pd.DateOffset(months=3),
    }
    rows = []
    for cell_key, cell_df in df.groupby(["strategy", "sector", "direction"]):
        strat, sector, direction = cell_key
        cell_df = cell_df.sort_values("entry_date")
        row: dict[str, Any] = {"strategy": strat, "sector": sector, "direction": direction}

        for window, cutoff in cutoffs.items():
            subset = cell_df[cell_df["entry_date"] >= cutoff]
            n_t = len(subset)
            wr = subset["is_winner"].mean() if n_t >= 3 else np.nan
            avg_pnl = subset["holly_pnl"].mean() if n_t >= 3 else np.nan
            row[f"{window}_wr"] = round(wr, 4) if np.isfinite(wr) else np.nan
            row[f"{window}_n"] = n_t
            row[f"{window}_avg_pnl"] = round(avg_pnl, 2) if np.isfinite(avg_pnl) else np.nan

        # EWM
        if len(cell_df) >= 10:
            weights = np.exp(-np.log(2) / EWM_HALFLIFE_TRADES * np.arange(len(cell_df) - 1, -1, -1))
            row["ewm_wr"] = round(np.average(cell_df["is_winner"].values, weights=weights), 4)
        else:
            row["ewm_wr"] = np.nan

        # Shrinkage
        full_n, full_wr = row["full_n"], row["full_wr"]
        if full_n > 0 and np.isfinite(full_wr):
            sw = full_n / (full_n + MIN_CELL_TRADES_DEPLOY)
            row["shrunk_wr"] = round(sw * full_wr + (1 - sw) * SHRINKAGE_PRIOR, 4)
        else:
            row["shrunk_wr"] = np.nan

        # Recency-weighted shrinkage
        t6_n, t6_wr = row["trail_6m_n"], row["trail_6m_wr"]
        if t6_n >= MIN_CELL_TRADES_RECENT and np.isfinite(t6_wr) and np.isfinite(full_wr):
            rw = t6_n / (t6_n + 30)
            row["recency_shrunk_wr"] = round(rw * t6_wr + (1 - rw) * full_wr, 4)
        else:
            row["recency_shrunk_wr"] = np.nan

        rows.append(row)

    decay_map = pd.DataFrame(rows)
    logger.info(f"Built decay map: {len(decay_map)} cells")
    return decay_map


# ---------------------------------------------------------------------------
# 3. Sign-agreement analysis
# ---------------------------------------------------------------------------
def analyze_sign_agreement(decay_map: pd.DataFrame) -> pd.DataFrame:
    dm = decay_map.copy()
    dm["full_above_be"] = dm["full_wr"] > BREAKEVEN_WR
    dm["t12m_above_be"] = dm["trail_12m_wr"] > BREAKEVEN_WR
    dm["t6m_above_be"] = dm["trail_6m_wr"] > BREAKEVEN_WR
    dm["t3m_above_be"] = dm["trail_3m_wr"] > BREAKEVEN_WR
    dm["agree_full_3m"] = dm["full_above_be"] == dm["t3m_above_be"]
    dm["agree_full_6m"] = dm["full_above_be"] == dm["t6m_above_be"]
    dm["agree_full_12m"] = dm["full_above_be"] == dm["t12m_above_be"]
    dm["decayed_3m"] = dm["full_above_be"] & ~dm["t3m_above_be"]
    dm["decayed_6m"] = dm["full_above_be"] & ~dm["t6m_above_be"]
    dm["emerging_3m"] = ~dm["full_above_be"] & dm["t3m_above_be"]
    return dm


# ---------------------------------------------------------------------------
# 4. Change-point detection
# ---------------------------------------------------------------------------
def detect_changepoints(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["entry_date"] = pd.to_datetime(df["entry_time"])
    candidate_dates = pd.date_range("2024-08-01", "2026-03-12", freq="MS")
    results = []

    for cell_key, cell_df in df.groupby(["strategy", "sector", "direction"]):
        strat, sector, direction = cell_key
        cell_df = cell_df.sort_values("entry_date")
        if len(cell_df) < 30:
            continue

        wins = cell_df["is_winner"].values.astype(float)
        dates = cell_df["entry_date"].values
        mean_wr = wins.mean()
        cusum = np.cumsum(wins - mean_wr)
        cusum_range = cusum.max() - cusum.min()
        cusum_std = wins.std() * np.sqrt(len(wins))
        cusum_ratio = cusum_range / cusum_std if cusum_std > 0 else 0

        best_date, best_pval, best_delta = None, 1.0, 0.0
        for cp_date in candidate_dates:
            pre = wins[dates < np.datetime64(cp_date)]
            post = wins[dates >= np.datetime64(cp_date)]
            if len(pre) < 15 or len(post) < 15:
                continue
            p1, p2 = pre.mean(), post.mean()
            n1, n2 = len(pre), len(post)
            p_pool = (p1 * n1 + p2 * n2) / (n1 + n2)
            if p_pool in (0, 1):
                continue
            se = np.sqrt(p_pool * (1 - p_pool) * (1/n1 + 1/n2))
            z = (p1 - p2) / se
            pval = 2 * (1 - stats.norm.cdf(abs(z)))
            if pval < best_pval:
                best_pval, best_date, best_delta = pval, cp_date, p1 - p2

        rolling_std = pd.Series(wins).rolling(20, min_periods=15).mean().std() if len(wins) >= 20 else np.nan

        results.append({
            "strategy": strat, "sector": sector, "direction": direction,
            "n_trades": len(cell_df),
            "cusum_ratio": round(cusum_ratio, 3),
            "cusum_significant": cusum_ratio > 1.36,
            "best_cp_date": best_date,
            "best_cp_pval": round(best_pval, 4) if best_pval < 1 else np.nan,
            "best_cp_delta": round(best_delta, 4),
            "cp_significant": best_pval < 0.05,
            "rolling_wr_std": round(rolling_std, 4) if np.isfinite(rolling_std) else np.nan,
        })

    cp_df = pd.DataFrame(results)
    n_sig = cp_df["cp_significant"].sum() if len(cp_df) > 0 else 0
    logger.info(f"Change-point detection: {n_sig}/{len(cp_df)} cells significant (p<0.05)")
    return cp_df


# ---------------------------------------------------------------------------
# 5. Policy evaluation helpers
# ---------------------------------------------------------------------------
def _make_policy_fn(policy_id: str, params: dict):
    """Create a policy bonus function with given parameters."""
    min_n = params.get("min_n", MIN_CELL_TRADES_DEPLOY)
    min_recent = params.get("min_recent", MIN_CELL_TRADES_RECENT)
    be = params.get("breakeven", BREAKEVEN_WR)
    safe = params.get("safe_wr", SAFE_WR_THRESHOLD)
    penalty = params.get("penalty_wr", PENALTY_WR_THRESHOLD)
    cap = params.get("overlay_cap", OVERLAY_CAP)

    if policy_id == "A":  # Full-history shrunk
        def fn(cd):
            shrunk = cd.get("shrunk_wr", np.nan)
            n = cd.get("full_n", 0)
            if n < min_n or not np.isfinite(shrunk):
                return 0.0
            if shrunk >= safe:
                return min((shrunk - be) * 2, cap)
            elif shrunk <= penalty:
                return max((shrunk - be) * 2, -cap)
            return 0.0
        return fn

    elif policy_id == "B":  # Recent-only (6m)
        def fn(cd):
            wr_6m = cd.get("trail_6m_wr", np.nan)
            n_6m = cd.get("trail_6m_n", 0)
            if n_6m < min_recent or not np.isfinite(wr_6m):
                return 0.0
            if wr_6m >= safe:
                return min((wr_6m - be) * 2, cap)
            elif wr_6m <= penalty:
                return max((wr_6m - be) * 2, -cap)
            return 0.0
        return fn

    elif policy_id == "C":  # Recency-weighted shrinkage
        def fn(cd):
            rw = cd.get("recency_shrunk_wr", np.nan)
            n = cd.get("full_n", 0)
            n_6m = cd.get("trail_6m_n", 0)
            if n < min_n or n_6m < min_recent or not np.isfinite(rw):
                return 0.0
            if rw >= safe:
                return min((rw - be) * 2, cap)
            elif rw <= penalty:
                return max((rw - be) * 2, -cap)
            return 0.0
        return fn

    elif policy_id == "D":  # Sign agreement
        def fn(cd):
            full_wr = cd.get("full_wr", np.nan)
            t3m_wr = cd.get("trail_3m_wr", np.nan)
            n = cd.get("full_n", 0)
            n_3m = cd.get("trail_3m_n", 0)
            if n < min_n or n_3m < min_recent or not np.isfinite(full_wr) or not np.isfinite(t3m_wr):
                return 0.0
            both_above = full_wr > be and t3m_wr > be
            both_below = full_wr < be and t3m_wr < be
            if both_above:
                avg = (full_wr + t3m_wr) / 2
                return min((avg - be) * 2, cap)
            elif both_below:
                avg = (full_wr + t3m_wr) / 2
                return max((avg - be) * 2, -cap)
            return 0.0
        return fn

    elif policy_id == "E":  # Neutralize when 3m < breakeven
        def fn(cd):
            shrunk = cd.get("shrunk_wr", np.nan)
            t3m_wr = cd.get("trail_3m_wr", np.nan)
            n = cd.get("full_n", 0)
            n_3m = cd.get("trail_3m_n", 0)
            if n < min_n or not np.isfinite(shrunk):
                return 0.0
            if n_3m >= min_recent and np.isfinite(t3m_wr) and t3m_wr < be:
                return 0.0
            if shrunk >= safe:
                return min((shrunk - be) * 2, cap)
            elif shrunk <= penalty:
                return max((shrunk - be) * 2, -cap)
            return 0.0
        return fn

    elif policy_id == "F":  # Sector-only baseline
        def fn(cd):
            # Uses sector_wr (NOT strat-sector cross-product)
            sector_wr = cd.get("sector_wr", np.nan)
            sector_n = cd.get("sector_n", 0)
            if sector_n < 50 or not np.isfinite(sector_wr):
                return 0.0
            if sector_wr >= safe:
                return min((sector_wr - be) * 2, cap)
            elif sector_wr <= penalty:
                return max((sector_wr - be) * 2, -cap)
            return 0.0
        return fn

    return lambda cd: 0.0


def _eval_policy_on_oos(name: str, bonus_fn, oos: pd.DataFrame, is_dm: pd.DataFrame,
                        sector_stats: pd.DataFrame | None = None) -> dict:
    """Apply a policy bonus function to OOS data and measure discrimination."""
    bonuses = []
    for _, row in oos.iterrows():
        cell = (row["strategy"], row["sector"], row["direction"])
        if cell in is_dm.index:
            cd = is_dm.loc[cell]
            if isinstance(cd, pd.DataFrame):
                cd = cd.iloc[0]
            cd_dict = cd.to_dict()
            # Inject sector-level stats for Policy F
            if sector_stats is not None and row["sector"] in sector_stats.index:
                ss = sector_stats.loc[row["sector"]]
                cd_dict["sector_wr"] = ss.get("sector_wr", np.nan)
                cd_dict["sector_n"] = ss.get("sector_n", 0)
            b = bonus_fn(cd_dict)
        else:
            b = 0.0
        bonuses.append(b)
    oos = oos.copy()
    oos["signal_bonus"] = bonuses

    favorable = oos[oos["signal_bonus"] > 0]
    unfavorable = oos[oos["signal_bonus"] < 0]

    result: dict[str, Any] = {
        "policy": name, "oos_n": len(oos),
        "oos_wr": round(oos["is_winner"].mean(), 4),
        "oos_avg_pnl": round(oos["holly_pnl"].mean(), 2),
    }

    for label, subset in [("favorable", favorable), ("unfavorable", unfavorable)]:
        if len(subset) > 0:
            result[f"{label}_n"] = len(subset)
            result[f"{label}_wr"] = round(subset["is_winner"].mean(), 4)
            result[f"{label}_avg_pnl"] = round(subset["holly_pnl"].mean(), 2)
        else:
            result[f"{label}_n"] = 0
            result[f"{label}_wr"] = np.nan
            result[f"{label}_avg_pnl"] = np.nan

    fav_wr = result.get("favorable_wr", np.nan)
    unf_wr = result.get("unfavorable_wr", np.nan)
    if np.isfinite(fav_wr) and np.isfinite(unf_wr):
        result["discrimination"] = round(fav_wr - unf_wr, 4)
    else:
        result["discrimination"] = np.nan

    result["coverage"] = round((np.array(bonuses) != 0).mean(), 4)
    result["weighted_pnl_impact"] = round((oos["holly_pnl"] * oos["signal_bonus"]).mean(), 2)
    return result


def evaluate_deployment_policies(df: pd.DataFrame, decay_map: pd.DataFrame) -> dict[str, dict]:
    """Walk-forward evaluation of 6 deployment policies."""
    df = df.copy()
    df["entry_date"] = pd.to_datetime(df["entry_time"])
    latest = df["entry_date"].max()
    oos_start = latest - pd.DateOffset(months=3)
    oos = df[df["entry_date"] >= oos_start]
    is_df = df[df["entry_date"] < oos_start]

    if len(oos) < 50:
        split_idx = int(len(df) * 0.8)
        df_sorted = df.sort_values("entry_date")
        is_df, oos = df_sorted.iloc[:split_idx], df_sorted.iloc[split_idx:]

    logger.info(f"Walk-forward: IS={len(is_df):,}, OOS={len(oos):,}")
    is_decay = build_cell_decay_map(is_df)
    is_dm = is_decay.set_index(["strategy", "sector", "direction"])

    # Sector-only stats for Policy F baseline
    sector_stats = is_df.groupby("sector").agg(
        sector_wr=("is_winner", "mean"),
        sector_n=("is_winner", "count"),
    ).round(4)

    default_params = {}
    policies = {}
    for pid, name in [
        ("A", "A: Full-history shrunk"),
        ("B", "B: Recent-only (6m)"),
        ("C", "C: Recency-weighted shrinkage"),
        ("D", "D: Sign agreement"),
        ("E", "E: Neutralize when 3m<BE"),
        ("F", "F: Sector-only baseline"),
    ]:
        fn = _make_policy_fn(pid, default_params)
        policies[pid] = _eval_policy_on_oos(name, fn, oos, is_dm, sector_stats)

    return policies


# ---------------------------------------------------------------------------
# 6. Threshold stress test
# ---------------------------------------------------------------------------
def stress_test_thresholds(df: pd.DataFrame) -> pd.DataFrame:
    """Sweep each threshold parameter while holding others at defaults.
    Returns a DataFrame with parameter, value, discrimination, coverage."""
    df = df.copy()
    df["entry_date"] = pd.to_datetime(df["entry_time"])
    latest = df["entry_date"].max()
    oos_start = latest - pd.DateOffset(months=3)
    oos = df[df["entry_date"] >= oos_start]
    is_df = df[df["entry_date"] < oos_start]

    if len(oos) < 50:
        split_idx = int(len(df) * 0.8)
        df_sorted = df.sort_values("entry_date")
        is_df, oos = df_sorted.iloc[:split_idx], df_sorted.iloc[split_idx:]

    is_decay = build_cell_decay_map(is_df)
    is_dm = is_decay.set_index(["strategy", "sector", "direction"])

    sweeps = {
        "min_n": [15, 20, 25, 30, 40, 50, 75],
        "min_recent": [5, 8, 10, 15, 20],
        "breakeven": [0.48, 0.49, 0.50, 0.51, 0.52],
        "safe_wr": [0.51, 0.52, 0.53, 0.54, 0.55],
        "penalty_wr": [0.43, 0.44, 0.45, 0.46, 0.47],
        "overlay_cap": [0.05, 0.08, 0.10, 0.12, 0.15],
    }

    results = []
    # Test Policy E (our provisional best) with each sweep
    for param_name, values in sweeps.items():
        for val in values:
            params = {param_name: val}
            fn = _make_policy_fn("E", params)
            metrics = _eval_policy_on_oos(f"E({param_name}={val})", fn, oos, is_dm)
            results.append({
                "parameter": param_name,
                "value": val,
                "discrimination": metrics.get("discrimination", np.nan),
                "coverage": metrics.get("coverage", np.nan),
                "favorable_n": metrics.get("favorable_n", 0),
                "favorable_wr": metrics.get("favorable_wr", np.nan),
                "unfavorable_wr": metrics.get("unfavorable_wr", np.nan),
            })

    sens_df = pd.DataFrame(results)

    # Flag fragile thresholds: where adjacent values flip discrimination sign
    sens_df["fragile"] = False
    for param in sweeps:
        param_rows = sens_df[sens_df["parameter"] == param].sort_values("value")
        disc_vals = param_rows["discrimination"].values
        for i in range(1, len(disc_vals)):
            if np.isfinite(disc_vals[i]) and np.isfinite(disc_vals[i-1]):
                if np.sign(disc_vals[i]) != np.sign(disc_vals[i-1]):
                    idx = param_rows.index[i]
                    sens_df.loc[idx, "fragile"] = True

    logger.info(f"Threshold sensitivity: {len(sens_df)} tests, "
                f"{sens_df['fragile'].sum()} fragile points")
    return sens_df


# ---------------------------------------------------------------------------
# 7. Stability decompositions
# ---------------------------------------------------------------------------
def analyze_stability(df: pd.DataFrame, decay_map: pd.DataFrame) -> dict[str, Any]:
    """Decompose policy discrimination by year, side, strategy, regime,
    and multi-fold walk-forward."""
    df = df.copy()
    df["entry_date"] = pd.to_datetime(df["entry_time"])
    df["year"] = df["entry_date"].dt.year
    results: dict[str, Any] = {}

    # --- By year ---
    year_results = []
    for year in sorted(df["year"].unique()):
        year_df = df[df["year"] == year]
        if len(year_df) < 100:
            continue
        year_decay = build_cell_decay_map(year_df)
        # Simple discrimination: WR of high-prior-wr trades vs low-prior-wr trades
        if "strat_sector_prior_wr" in year_df.columns:
            valid = year_df[year_df["strat_sector_prior_wr"].notna()]
            if len(valid) >= 50:
                med = valid["strat_sector_prior_wr"].median()
                high = valid[valid["strat_sector_prior_wr"] > med]
                low = valid[valid["strat_sector_prior_wr"] <= med]
                if len(high) >= 20 and len(low) >= 20:
                    disc = high["is_winner"].mean() - low["is_winner"].mean()
                    year_results.append({
                        "year": year, "n": len(valid),
                        "high_wr": round(high["is_winner"].mean(), 4),
                        "low_wr": round(low["is_winner"].mean(), 4),
                        "discrimination": round(disc, 4),
                    })
    results["by_year"] = year_results

    # --- By side ---
    side_results = []
    for side in ["Long", "Short"]:
        side_df = df[df["direction"] == side]
        if len(side_df) < 100 or "strat_sector_prior_wr" not in side_df.columns:
            continue
        valid = side_df[side_df["strat_sector_prior_wr"].notna()]
        if len(valid) >= 50:
            med = valid["strat_sector_prior_wr"].median()
            high = valid[valid["strat_sector_prior_wr"] > med]
            low = valid[valid["strat_sector_prior_wr"] <= med]
            if len(high) >= 20 and len(low) >= 20:
                disc = high["is_winner"].mean() - low["is_winner"].mean()
                side_results.append({
                    "direction": side, "n": len(valid),
                    "discrimination": round(disc, 4),
                })
    results["by_side"] = side_results

    # --- By strategy ---
    strat_results = []
    if "strat_sector_prior_wr" in df.columns:
        for strat in df["strategy"].unique():
            strat_df = df[df["strategy"] == strat]
            valid = strat_df[strat_df["strat_sector_prior_wr"].notna()]
            if len(valid) < 50:
                continue
            med = valid["strat_sector_prior_wr"].median()
            high = valid[valid["strat_sector_prior_wr"] > med]
            low = valid[valid["strat_sector_prior_wr"] <= med]
            if len(high) >= 15 and len(low) >= 15:
                disc = high["is_winner"].mean() - low["is_winner"].mean()
                strat_results.append({
                    "strategy": strat, "n": len(valid),
                    "discrimination": round(disc, 4),
                })
    results["by_strategy"] = strat_results

    # --- By regime ---
    regime_results = []
    if "vol_regime" in df.columns and "strat_sector_prior_wr" in df.columns:
        for regime in df["vol_regime"].dropna().unique():
            reg_df = df[df["vol_regime"] == regime]
            valid = reg_df[reg_df["strat_sector_prior_wr"].notna()]
            if len(valid) < 50:
                continue
            med = valid["strat_sector_prior_wr"].median()
            high = valid[valid["strat_sector_prior_wr"] > med]
            low = valid[valid["strat_sector_prior_wr"] <= med]
            if len(high) >= 15 and len(low) >= 15:
                disc = high["is_winner"].mean() - low["is_winner"].mean()
                regime_results.append({
                    "regime": regime, "n": len(valid),
                    "discrimination": round(disc, 4),
                })
    results["by_regime"] = regime_results

    # --- Multi-fold walk-forward ---
    wf_results = []
    df_sorted = df.sort_values("entry_date")
    min_date = df_sorted["entry_date"].min()
    max_date = df_sorted["entry_date"].max()
    fold_start = min_date + pd.DateOffset(months=12)  # need 12m history

    while fold_start + pd.DateOffset(months=6) <= max_date:
        fold_end = fold_start + pd.DateOffset(months=6)
        train = df_sorted[df_sorted["entry_date"] < fold_start]
        test = df_sorted[(df_sorted["entry_date"] >= fold_start) & (df_sorted["entry_date"] < fold_end)]
        if len(train) < 200 or len(test) < 30:
            fold_start += pd.DateOffset(months=3)
            continue

        train_decay = build_cell_decay_map(train)
        train_dm = train_decay.set_index(["strategy", "sector", "direction"])
        fn = _make_policy_fn("E", {})
        metrics = _eval_policy_on_oos(
            f"WF {fold_start.strftime('%Y-%m')}",
            fn, test, train_dm,
        )
        wf_results.append({
            "fold_start": fold_start.strftime("%Y-%m"),
            "fold_end": fold_end.strftime("%Y-%m"),
            "oos_n": metrics["oos_n"],
            "discrimination": metrics.get("discrimination", np.nan),
            "coverage": metrics.get("coverage", np.nan),
            "favorable_wr": metrics.get("favorable_wr", np.nan),
        })
        fold_start += pd.DateOffset(months=3)

    results["walk_forward_folds"] = wf_results
    logger.info(f"Stability: {len(year_results)} years, {len(side_results)} sides, "
                f"{len(strat_results)} strategies, {len(wf_results)} WF folds")
    return results


# ---------------------------------------------------------------------------
# 8. Bootstrap discrimination CI
# ---------------------------------------------------------------------------
def bootstrap_discrimination_ci(
    df: pd.DataFrame,
    decay_map: pd.DataFrame,
    n_boot: int = 1000,
) -> dict:
    """Bootstrap 95% CI for discrimination of the recommended policy (E)."""
    df = df.copy()
    df["entry_date"] = pd.to_datetime(df["entry_time"])
    latest = df["entry_date"].max()
    oos_start = latest - pd.DateOffset(months=3)
    oos = df[df["entry_date"] >= oos_start]
    is_df = df[df["entry_date"] < oos_start]

    if len(oos) < 50:
        split_idx = int(len(df) * 0.8)
        df_sorted = df.sort_values("entry_date")
        is_df, oos = df_sorted.iloc[:split_idx], df_sorted.iloc[split_idx:]

    is_decay = build_cell_decay_map(is_df)
    is_dm = is_decay.set_index(["strategy", "sector", "direction"])
    fn = _make_policy_fn("E", {})

    # Compute bonus for each OOS trade
    oos = oos.copy()
    bonuses = []
    for _, row in oos.iterrows():
        cell = (row["strategy"], row["sector"], row["direction"])
        if cell in is_dm.index:
            cd = is_dm.loc[cell]
            if isinstance(cd, pd.DataFrame):
                cd = cd.iloc[0]
            bonuses.append(fn(cd.to_dict()))
        else:
            bonuses.append(0.0)
    oos["bonus"] = bonuses

    # Bootstrap
    rng = np.random.default_rng(42)
    boot_discs = []
    for _ in range(n_boot):
        sample = oos.sample(n=len(oos), replace=True, random_state=rng.integers(0, 2**31))
        fav = sample[sample["bonus"] > 0]
        unf = sample[sample["bonus"] < 0]
        if len(fav) >= 5 and len(unf) >= 5:
            boot_discs.append(fav["is_winner"].mean() - unf["is_winner"].mean())

    if len(boot_discs) < 100:
        return {"ci_lower": np.nan, "ci_upper": np.nan, "mean": np.nan,
                "includes_zero": True, "n_boot": len(boot_discs)}

    boot_discs = np.array(boot_discs)
    ci_lo, ci_hi = np.percentile(boot_discs, [2.5, 97.5])
    return {
        "ci_lower": round(ci_lo, 4),
        "ci_upper": round(ci_hi, 4),
        "mean": round(boot_discs.mean(), 4),
        "std": round(boot_discs.std(), 4),
        "includes_zero": ci_lo <= 0 <= ci_hi,
        "n_boot": len(boot_discs),
    }


# ---------------------------------------------------------------------------
# 9. Survivor / Kill tables
# ---------------------------------------------------------------------------
def build_survivor_kill_tables(
    decay_map: pd.DataFrame,
    sign_map: pd.DataFrame,
    cp_df: pd.DataFrame,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    dm = decay_map.merge(
        sign_map[["strategy", "sector", "direction",
                  "agree_full_3m", "decayed_3m", "decayed_6m", "emerging_3m"]],
        on=["strategy", "sector", "direction"], how="left",
    )
    if len(cp_df) > 0:
        dm = dm.merge(
            cp_df[["strategy", "sector", "direction",
                   "cp_significant", "best_cp_delta", "cusum_significant"]],
            on=["strategy", "sector", "direction"], how="left",
        )
    else:
        dm["cp_significant"] = False
        dm["best_cp_delta"] = 0.0
        dm["cusum_significant"] = False

    survivors_mask = (
        (dm["full_n"] >= MIN_CELL_TRADES_DEPLOY)
        & (dm["full_wr"] > BREAKEVEN_WR)
        & (dm["agree_full_3m"].fillna(True) | (dm["trail_3m_n"] < MIN_CELL_TRADES_RECENT))
        & ~(dm["cp_significant"].fillna(False) & (dm["best_cp_delta"] > 0.05))
        & (dm["shrunk_wr"] >= SAFE_WR_THRESHOLD)
    )

    kill_mask = (
        dm["decayed_3m"].fillna(False)
        | (dm["decayed_6m"].fillna(False) & dm["decayed_3m"].fillna(False))
        | (dm["cp_significant"].fillna(False) & (dm["best_cp_delta"] > 0.08))
        | (dm["full_n"] < MIN_CELL_TRADES_DEPLOY)
        | (dm["trail_3m_wr"] < PENALTY_WR_THRESHOLD)
    )

    survivors = dm[survivors_mask].sort_values("shrunk_wr", ascending=False)
    kills = dm[kill_mask].sort_values("trail_3m_wr", ascending=True)

    if len(kills) > 0:
        reasons = []
        for _, row in kills.iterrows():
            r = []
            if row.get("decayed_3m"):
                r.append("decayed_3m")
            if row.get("decayed_6m"):
                r.append("decayed_6m")
            if row.get("cp_significant") and row.get("best_cp_delta", 0) > 0.08:
                r.append(f"break(d={row['best_cp_delta']:.2f})")
            if row["full_n"] < MIN_CELL_TRADES_DEPLOY:
                r.append(f"low_n({row['full_n']})")
            if np.isfinite(row.get("trail_3m_wr", np.nan)) and row["trail_3m_wr"] < PENALTY_WR_THRESHOLD:
                r.append(f"3m<{PENALTY_WR_THRESHOLD}({row['trail_3m_wr']:.2f})")
            reasons.append("; ".join(r) if r else "multi")
        kills = kills.copy()
        kills["kill_reason"] = reasons

    logger.info(f"Survivors: {len(survivors)}, Kills: {len(kills)}, "
                f"Unclassified: {len(dm) - len(survivors) - len(kills)}")
    return survivors, kills


# ---------------------------------------------------------------------------
# 10. Full report generation (3-iteration structure)
# ---------------------------------------------------------------------------
def generate_report(
    df: pd.DataFrame,
    decay_map: pd.DataFrame,
    sign_map: pd.DataFrame,
    cp_df: pd.DataFrame,
    policies: dict,
    survivors: pd.DataFrame,
    kills: pd.DataFrame,
    threshold_sens: pd.DataFrame,
    stability: dict,
    bootstrap_ci: dict,
    data_source: str,
) -> str:
    L = []  # line accumulator

    # ===== HEADER =====
    L.append("=" * 78)
    L.append("SECTOR SIGNAL DECAY INVESTIGATION -- strat_sector_prior_wr")
    L.append("=" * 78)
    L.append(f"Report generated: {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    L.append(f"*** DATA SOURCE: {data_source} ***")
    if data_source == "SYNTHETIC":
        L.append("!!! WARNING: Results are FRAMEWORK VALIDATION ONLY !!!")
        L.append("!!! Re-run with real Holly data before making deployment decisions !!!")
    L.append(f"Total trades: {len(df):,}")
    L.append(f"Date range: {df['entry_time'].min()} -> {df['entry_time'].max()}")
    L.append(f"Total cells: {len(decay_map)}")
    L.append("")

    n_total_cells = len(decay_map[decay_map["full_n"] >= MIN_CELL_TRADES_DEPLOY])
    n_survivors_pct = len(survivors) / max(n_total_cells, 1) * 100
    n_decayed = sign_map["decayed_3m"].sum()

    # ===== ITERATION 1: ATTACK THE HYPOTHESIS =====
    L.append("=" * 78)
    L.append("ITERATION 1: ATTACK THE HYPOTHESIS")
    L.append("=" * 78)
    L.append("")
    L.append("WHAT COULD KILL THIS SIGNAL:")
    L.append("  1. Look-ahead bias in feature construction")
    L.append("     -> TESTED: no-look-ahead loop verified (chronological, append-after-use)")
    L.append("  2. Insufficient sample size per cell (strategy x sector x direction = many cells)")
    L.append(f"     -> {len(decay_map)} total cells, {n_total_cells} with n>={MIN_CELL_TRADES_DEPLOY}")
    L.append("  3. Stale cells: historical edge no longer exists")
    L.append(f"     -> {n_decayed} cells decayed (3m), {sign_map['decayed_6m'].sum()} decayed (6m)")
    L.append("  4. Regime dependency: signal only works in specific market conditions")
    regime_disc = stability.get("by_regime", [])
    if regime_disc:
        for rd in regime_disc:
            L.append(f"     -> {rd['regime']}: disc={rd['discrimination']:+.4f} (n={rd['n']})")
    L.append("  5. Cross-product adds nothing over sector-only signal")
    pol_f = policies.get("F", {})
    pol_e = policies.get("E", {})
    f_disc = pol_f.get("discrimination", np.nan)
    e_disc = pol_e.get("discrimination", np.nan)
    if np.isfinite(f_disc) and np.isfinite(e_disc):
        L.append(f"     -> Policy F (sector-only) disc={f_disc:+.4f} vs Policy E disc={e_disc:+.4f}")
        if e_disc <= f_disc:
            L.append("     -> FINDING: Cross-product adds NO value over simpler sector signal")
    L.append("")

    L.append("VERDICT CRITERIA:")
    L.append(f"  DEATH:     discrimination < {DEATH_DISCRIM} AND coverage < {DEATH_COVERAGE:.0%}")
    L.append(f"  PROBATION: discrimination {DEATH_DISCRIM}..{PROBATION_DISCRIM} OR coverage {DEATH_COVERAGE:.0%}..{PROBATION_COVERAGE:.0%}")
    L.append(f"  SURVIVAL:  discrimination >= {SURVIVAL_DISCRIM} AND coverage >= {SURVIVAL_COVERAGE:.0%} AND stable across folds")
    L.append("")

    # Compute preliminary verdict
    best_disc = max(
        (p.get("discrimination", -1) for p in policies.values() if p.get("discrimination") is not None and np.isfinite(p.get("discrimination", np.nan))),
        default=-1,
    )
    best_coverage = max(
        (p.get("coverage", 0) for p in policies.values() if p.get("coverage") is not None),
        default=0,
    )

    # Walk-forward stability check
    wf_folds = stability.get("walk_forward_folds", [])
    wf_stable = False
    if wf_folds:
        wf_discs = [f["discrimination"] for f in wf_folds if np.isfinite(f.get("discrimination", np.nan))]
        if len(wf_discs) >= 3:
            wf_positive = sum(1 for d in wf_discs if d > 0)
            wf_stable = wf_positive / len(wf_discs) >= 0.6

    if best_disc < DEATH_DISCRIM and best_coverage < DEATH_COVERAGE:
        prelim_verdict = "DEAD"
    elif best_disc >= SURVIVAL_DISCRIM and best_coverage >= SURVIVAL_COVERAGE and wf_stable:
        prelim_verdict = "SURVIVES (conditional)"
    else:
        prelim_verdict = "PROBATION"

    L.append(f"PRELIMINARY VERDICT: {prelim_verdict}")
    L.append(f"  Best discrimination: {best_disc:+.4f}")
    L.append(f"  Best coverage: {best_coverage:.1%}")
    L.append(f"  Walk-forward stable: {wf_stable}")
    L.append("")

    # ===== ITERATION 2: FULL FINDINGS =====
    L.append("=" * 78)
    L.append("ITERATION 2: FULL FINDINGS")
    L.append("=" * 78)
    L.append("")

    # --- Cell decay summary ---
    L.append("-" * 78)
    L.append("2.1 CELL-LEVEL DECAY MAP SUMMARY")
    L.append("-" * 78)
    for window in ["full", "trail_12m", "trail_6m", "trail_3m", "ewm"]:
        col = f"{window}_wr"
        if col in decay_map.columns:
            valid = decay_map[col].dropna()
            if len(valid) > 0:
                L.append(f"  {window:>12s} WR: mean={valid.mean():.4f} med={valid.median():.4f} std={valid.std():.4f} n={len(valid)}")
    L.append("")

    # --- Sign agreement ---
    L.append("-" * 78)
    L.append("2.2 SIGN AGREEMENT")
    L.append("-" * 78)
    for col, label in [("agree_full_3m", "Full<>3m"), ("agree_full_6m", "Full<>6m"), ("agree_full_12m", "Full<>12m")]:
        valid = sign_map[col].dropna()
        if len(valid) > 0:
            L.append(f"  {label}: {valid.mean():.1%} agree ({int(valid.sum())}/{len(valid)})")
    L.append(f"  Decayed(3m): {n_decayed}  Decayed(6m): {sign_map['decayed_6m'].sum()}  Emerging: {sign_map['emerging_3m'].sum()}")
    L.append("")

    # --- Change-point ---
    L.append("-" * 78)
    L.append("2.3 CHANGE-POINT DETECTION")
    L.append("-" * 78)
    if len(cp_df) > 0:
        L.append(f"  Significant breaks (p<0.05): {cp_df['cp_significant'].sum()}/{len(cp_df)}")
        L.append(f"  CUSUM significant: {cp_df['cusum_significant'].sum()}/{len(cp_df)}")
        if cp_df["cp_significant"].sum() > 0:
            L.append("  Top breaks:")
            for _, row in cp_df[cp_df["cp_significant"]].nlargest(8, "best_cp_delta").iterrows():
                dt = row["best_cp_date"]
                ds = dt.strftime("%Y-%m") if hasattr(dt, "strftime") else str(dt)
                L.append(f"    {row['strategy'][:18]:>18s} | {row['sector'][:16]:>16s} | "
                         f"{row['direction']:>5s} | {ds} d={row['best_cp_delta']:+.3f}")
    L.append("")

    # --- Policy comparison ---
    L.append("-" * 78)
    L.append("2.4 DEPLOYMENT POLICY COMPARISON (OOS)")
    L.append("-" * 78)
    L.append(f"  {'Policy':<35s} {'N':>5s} {'FavWR':>6s} {'UnfWR':>6s} {'Disc':>7s} {'Cov':>5s} {'WtPnL':>7s}")
    L.append("  " + "-" * 73)
    for pid in ["A", "B", "C", "D", "E", "F"]:
        m = policies.get(pid, {})
        if not m:
            continue
        fw = f"{m.get('favorable_wr', np.nan):.4f}" if np.isfinite(m.get("favorable_wr", np.nan)) else " N/A "
        uw = f"{m.get('unfavorable_wr', np.nan):.4f}" if np.isfinite(m.get("unfavorable_wr", np.nan)) else " N/A "
        dc = f"{m.get('discrimination', np.nan):+.4f}" if np.isfinite(m.get("discrimination", np.nan)) else "  N/A "
        cv = f"{m.get('coverage', 0):.2f}"
        wp = f"{m.get('weighted_pnl_impact', np.nan):+.2f}" if np.isfinite(m.get("weighted_pnl_impact", np.nan)) else "  N/A"
        L.append(f"  {m.get('policy','?'):<35s} {m.get('oos_n',0):>5d} {fw:>6s} {uw:>6s} {dc:>7s} {cv:>5s} {wp:>7s}")
    L.append("")

    # --- Threshold sensitivity ---
    L.append("-" * 78)
    L.append("2.5 THRESHOLD SENSITIVITY (Policy E)")
    L.append("-" * 78)
    for param in threshold_sens["parameter"].unique():
        rows = threshold_sens[threshold_sens["parameter"] == param].sort_values("value")
        L.append(f"  {param}:")
        for _, r in rows.iterrows():
            disc_str = f"{r['discrimination']:+.4f}" if np.isfinite(r["discrimination"]) else "  N/A "
            fragile_flag = " *** FRAGILE ***" if r.get("fragile") else ""
            L.append(f"    {r['value']:>6} -> disc={disc_str} cov={r['coverage']:.2f} "
                     f"fav_n={int(r['favorable_n'])}{fragile_flag}")
        L.append("")

    # --- Stability ---
    L.append("-" * 78)
    L.append("2.6 STABILITY DECOMPOSITIONS")
    L.append("-" * 78)
    if stability.get("by_year"):
        L.append("  By Year:")
        for yr in stability["by_year"]:
            L.append(f"    {yr['year']}: disc={yr['discrimination']:+.4f} n={yr['n']}")
    if stability.get("by_side"):
        L.append("  By Side:")
        for sd in stability["by_side"]:
            L.append(f"    {sd['direction']}: disc={sd['discrimination']:+.4f} n={sd['n']}")
    if stability.get("by_strategy"):
        L.append("  By Strategy:")
        for st in sorted(stability["by_strategy"], key=lambda x: x["discrimination"], reverse=True):
            L.append(f"    {st['strategy'][:25]:<25s}: disc={st['discrimination']:+.4f} n={st['n']}")
    if stability.get("by_regime"):
        L.append("  By Regime:")
        for rg in stability["by_regime"]:
            L.append(f"    {rg['regime']:<12s}: disc={rg['discrimination']:+.4f} n={rg['n']}")
    if stability.get("walk_forward_folds"):
        L.append("  Walk-Forward Folds:")
        for wf in stability["walk_forward_folds"]:
            d = wf.get("discrimination", np.nan)
            ds = f"{d:+.4f}" if np.isfinite(d) else "  N/A "
            L.append(f"    {wf['fold_start']}->{wf['fold_end']}: disc={ds} n={wf['oos_n']} cov={wf.get('coverage',0):.2f}")
    L.append("")

    # --- Bootstrap CI ---
    L.append("-" * 78)
    L.append("2.7 BOOTSTRAP CONFIDENCE INTERVAL (Policy E discrimination)")
    L.append("-" * 78)
    L.append(f"  Mean: {bootstrap_ci.get('mean', np.nan)}")
    L.append(f"  95% CI: [{bootstrap_ci.get('ci_lower', np.nan)}, {bootstrap_ci.get('ci_upper', np.nan)}]")
    L.append(f"  Includes zero: {bootstrap_ci.get('includes_zero', True)}")
    if bootstrap_ci.get("includes_zero"):
        L.append("  -> NOT SIGNIFICANTLY DIFFERENT FROM RANDOM at 95% level")
    else:
        L.append("  -> Discrimination is statistically significant at 95% level")
    L.append("")

    # --- Survivor table ---
    L.append("-" * 78)
    L.append("2.8 SURVIVOR TABLE")
    L.append("-" * 78)
    if len(survivors) > 0:
        L.append(f"  {len(survivors)} cells survive")
        for _, row in survivors.head(25).iterrows():
            t3m = f"{row['trail_3m_wr']:.3f}" if np.isfinite(row.get("trail_3m_wr", np.nan)) else " N/A "
            L.append(f"    {row['strategy'][:18]:<18s} | {row['sector'][:14]:<14s} | "
                     f"{row['direction']:<5s} | full={row['full_wr']:.3f} n={row['full_n']:>4d} "
                     f"| 3m={t3m} | shrk={row['shrunk_wr']:.3f}")
    else:
        L.append("  NO CELLS SURVIVE.")
    L.append("")

    # --- Kill table ---
    L.append("-" * 78)
    L.append("2.9 KILL TABLE")
    L.append("-" * 78)
    if len(kills) > 0:
        L.append(f"  {len(kills)} cells killed")
        for _, row in kills.head(25).iterrows():
            t3m = f"{row['trail_3m_wr']:.3f}" if np.isfinite(row.get("trail_3m_wr", np.nan)) else " N/A "
            reason = row.get("kill_reason", "")[:45]
            L.append(f"    {row['strategy'][:18]:<18s} | {row['sector'][:14]:<14s} | "
                     f"{row['direction']:<5s} | 3m={t3m} | {reason}")
    L.append("")

    # ===== ITERATION 3: SELF-CRITIQUE =====
    L.append("=" * 78)
    L.append("ITERATION 3: SELF-CRITIQUE AND FINAL VERDICT")
    L.append("=" * 78)
    L.append("")

    L.append("ADVERSARIAL QUESTIONS:")
    L.append("")

    # Q1: Is discrimination noise?
    L.append("Q1: Is discrimination just noise?")
    if bootstrap_ci.get("includes_zero"):
        L.append("  -> YES. Bootstrap CI includes zero. Cannot reject null hypothesis.")
        L.append("     Signal discrimination may be entirely due to sampling noise.")
    else:
        L.append(f"  -> NO. 95% CI [{bootstrap_ci.get('ci_lower')}, {bootstrap_ci.get('ci_upper')}] excludes zero.")
    L.append("")

    # Q2: Cross-product vs sector-only?
    L.append("Q2: Does the strategy-sector cross-product add value over sector-only?")
    if np.isfinite(f_disc) and np.isfinite(e_disc):
        if e_disc > f_disc + 0.02:
            L.append(f"  -> YES. Policy E ({e_disc:+.4f}) beats sector-only F ({f_disc:+.4f}) by {e_disc-f_disc:+.4f}")
        elif e_disc > f_disc:
            L.append(f"  -> MARGINAL. E ({e_disc:+.4f}) vs F ({f_disc:+.4f}). Difference {e_disc-f_disc:+.4f} is small.")
        else:
            L.append(f"  -> NO. Sector-only F ({f_disc:+.4f}) >= cross-product E ({e_disc:+.4f}).")
            L.append("     The complexity of the cross-product is not justified.")
    L.append("")

    # Q3: Coverage too patchy?
    L.append("Q3: Is coverage too patchy for a whole-signal overlay?")
    L.append(f"  -> Survivor rate: {n_survivors_pct:.1f}% of deployable cells")
    if n_survivors_pct < 25:
        L.append("     YES. Too few cells survive for a meaningful whole-signal overlay.")
        L.append("     Consider per-cell selective deployment or shadow-mode only.")
    elif n_survivors_pct < 50:
        L.append("     BORDERLINE. Less than half of cells survive. Per-cell gating required.")
    else:
        L.append("     NO. Sufficient survivor density for an overlay.")
    L.append("")

    # Q4: Walk-forward stability?
    L.append("Q4: Is discrimination stable across walk-forward folds?")
    if wf_folds:
        wf_d = [f["discrimination"] for f in wf_folds if np.isfinite(f.get("discrimination", np.nan))]
        pos = sum(1 for d in wf_d if d > 0)
        L.append(f"  -> {pos}/{len(wf_d)} folds positive. {'STABLE' if wf_stable else 'UNSTABLE'}")
        if wf_d:
            L.append(f"     Range: [{min(wf_d):+.4f}, {max(wf_d):+.4f}], mean={np.mean(wf_d):+.4f}")
    else:
        L.append("  -> Insufficient data for walk-forward test.")
    L.append("")

    # Q5: Is simpler version more honest?
    L.append("Q5: Would a simpler/dumber version be more honest?")
    if np.isfinite(f_disc) and f_disc > 0.02:
        L.append("  -> The existing sector_reliable flag (L4 in edge ablation) already works.")
        L.append("     It requires NO per-cell tracking, NO decay monitoring.")
        L.append("     Consider keeping the simpler version and killing the cross-product.")
    L.append("")

    # ===== FINAL VERDICT =====
    L.append("-" * 78)
    L.append("FINAL VERDICT")
    L.append("-" * 78)

    # Determine final verdict
    ci_significant = not bootstrap_ci.get("includes_zero", True)
    cross_adds_value = np.isfinite(e_disc) and np.isfinite(f_disc) and e_disc > f_disc + 0.02

    if data_source == "SYNTHETIC":
        final_verdict = "INCONCLUSIVE (synthetic data only)"
        deployment_mode = "FRAMEWORK VALIDATED -- awaiting real data"
        L.append(f"  VERDICT: {final_verdict}")
        L.append(f"  DEPLOYMENT: {deployment_mode}")
        L.append("  The investigation framework is validated and ready.")
        L.append("  Re-run with real Holly data to obtain actionable conclusions.")
    elif not ci_significant:
        final_verdict = "DEAD -- discrimination not significant"
        deployment_mode = "KILL"
        L.append(f"  VERDICT: {final_verdict}")
        L.append(f"  DEPLOYMENT: {deployment_mode}")
        L.append("  The signal does not show statistically significant discrimination.")
        L.append("  Retain as monitoring-only. Do not deploy as scoring overlay.")
    elif not cross_adds_value:
        final_verdict = "REDUNDANT -- sector-only baseline is sufficient"
        deployment_mode = "SHADOW-ONLY (monitor for future value)"
        L.append(f"  VERDICT: {final_verdict}")
        L.append(f"  DEPLOYMENT: {deployment_mode}")
        L.append("  The existing sector_reliable flag (WR>52%, n>=50) captures the same edge.")
        L.append("  The strategy-sector cross-product adds marginal or no value.")
        L.append("  Retain in Silver layer for monitoring. Do not deploy as overlay.")
    elif not wf_stable:
        final_verdict = "PROBATION -- unstable across walk-forward folds"
        deployment_mode = "SHADOW-ONLY with weekly monitoring"
        L.append(f"  VERDICT: {final_verdict}")
        L.append(f"  DEPLOYMENT: {deployment_mode}")
        L.append("  Signal shows discrimination but is unstable across time periods.")
        L.append("  Deploy in shadow mode. Promote to live only if 3+ consecutive months stable.")
    else:
        final_verdict = "CONDITIONAL SURVIVAL"
        deployment_mode = "SHADOW first, then low-weight overlay if confirmed"
        L.append(f"  VERDICT: {final_verdict}")
        L.append(f"  DEPLOYMENT: {deployment_mode}")
        L.append("  Signal shows significant, stable discrimination that exceeds sector-only.")
        L.append("  Deploy as shadow overlay. After 30 days of positive monitoring, promote to live.")

    L.append("")
    L.append("RECOMMENDED DEPLOYMENT MODE:")
    if final_verdict.startswith("DEAD") or final_verdict.startswith("REDUNDANT"):
        L.append("  1. Keep strat_sector_prior_wr in Silver layer (build_silver.py)")
        L.append("  2. Monitor via feature_importance.py -- track ranking over time")
        L.append("  3. Do NOT add to ensemble scorer or eval engine")
        L.append("  4. Re-evaluate quarterly with fresh data")
    elif final_verdict.startswith("PROBATION"):
        L.append("  1. Keep in Silver layer")
        L.append("  2. Add to feature_importance.py CANDIDATE_FEATURES list")
        L.append("  3. Log in edge-analytics feature attribution (shadow)")
        L.append("  4. Weekly: check discrimination on trailing 3m")
        L.append("  5. If stable for 3 months, re-run investigation for promotion decision")
    else:
        L.append("  1. Shadow overlay in scoring (log but don't affect trade_score)")
        L.append("  2. Monitor discrimination weekly")
        L.append("  3. After 30 days of positive shadow results:")
        L.append("     - Add as +-5pt overlay (half the default +-10pt cap)")
        L.append("     - Use Policy E logic with confirmed thresholds")
        L.append("  4. Kill-switch: if 3m discrimination < 0.02, revert to shadow")

    L.append("")
    L.append("EXACT OVERLAY LOGIC (if deployed):")
    L.append("  1. cell = (strategy, sector, direction)")
    L.append(f"  2. Require full_n >= {MIN_CELL_TRADES_DEPLOY} AND trail_3m_n >= {MIN_CELL_TRADES_RECENT}")
    L.append(f"  3. Kill switch: if trail_3m_wr < {BREAKEVEN_WR}, bonus = 0")
    L.append(f"  4. If shrunk_wr >= {SAFE_WR_THRESHOLD}: bonus = min((shrunk_wr - 0.50) * 2, {OVERLAY_CAP})")
    L.append(f"  5. If shrunk_wr <= {PENALTY_WR_THRESHOLD}: penalty = max((shrunk_wr - 0.50) * 2, -{OVERLAY_CAP})")
    L.append("")

    L.append("MONITORING & KILL-SWITCH:")
    L.append("  1. Weekly: recompute trailing 3m WR for all survivor cells")
    L.append("  2. Cell kill: if trail_3m_wr < 0.45 for a survivor -> kill that cell")
    L.append("  3. Signal kill: if >50% of survivors fail 3m check -> kill entire signal")
    L.append("  4. Monthly: re-run change-point detection")
    L.append("  5. If OOS discrimination < 0.02 for 2 consecutive months: DECOMMISSION")
    L.append("")
    L.append("=" * 78)

    return "\n".join(L)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(description="Investigate strat_sector_prior_wr signal decay")
    parser.add_argument("--output-json", action="store_true", help="Output structured JSON")
    parser.add_argument("--skip-bootstrap", action="store_true", help="Skip bootstrap CI (faster)")
    args = parser.parse_args()

    global DATA_SOURCE
    print("=" * 60)
    print("Sector Signal Decay Investigation")
    print("strat_sector_prior_wr -- 3-Iteration Protocol")
    print("=" * 60)

    # 1. Load
    print("\n[1/10] Loading trade data...")
    df, DATA_SOURCE = load_trades()
    print(f"  *** DATA SOURCE: {DATA_SOURCE} ***")
    if DATA_SOURCE == "SYNTHETIC":
        print("  !!! SYNTHETIC DATA -- framework validation only !!!")
    df["entry_time"] = pd.to_datetime(df["entry_time"])
    if "is_winner" not in df.columns:
        df["is_winner"] = df["holly_pnl"] > 0

    required = ["entry_time", "strategy", "sector", "direction", "holly_pnl", "is_winner"]
    missing = [c for c in required if c not in df.columns]
    if missing:
        logger.error(f"Missing columns: {missing}")
        sys.exit(1)

    print(f"  {len(df):,} trades | {df['strategy'].nunique()} strategies | "
          f"{df['sector'].nunique()} sectors | {df['direction'].nunique()} directions")

    # 2. Compute signal
    print("\n[2/10] Computing strat_sector_prior_wr (no look-ahead)...")
    df = compute_strat_sector_prior_wr(df)

    # 3. Decay map
    print("\n[3/10] Building cell-level decay map...")
    decay_map = build_cell_decay_map(df)

    # 4. Sign agreement
    print("\n[4/10] Analyzing sign agreement...")
    sign_map = analyze_sign_agreement(decay_map)

    # 5. Change-points
    print("\n[5/10] Running change-point detection...")
    cp_df = detect_changepoints(df)

    # 6. Policy evaluation
    print("\n[6/10] Evaluating 6 deployment policies (walk-forward OOS)...")
    policies = evaluate_deployment_policies(df, decay_map)

    # 7. Threshold sensitivity
    print("\n[7/10] Stress-testing thresholds...")
    threshold_sens = stress_test_thresholds(df)

    # 8. Stability
    print("\n[8/10] Analyzing stability decompositions...")
    stability = analyze_stability(df, decay_map)

    # 9. Bootstrap CI
    if args.skip_bootstrap:
        print("\n[9/10] Skipping bootstrap CI...")
        boot_ci = {"ci_lower": np.nan, "ci_upper": np.nan, "mean": np.nan,
                   "includes_zero": True, "n_boot": 0}
    else:
        print("\n[9/10] Computing bootstrap CI (1000 resamples)...")
        boot_ci = bootstrap_discrimination_ci(df, decay_map)

    # 10. Survivor/kill tables
    print("\n[10/10] Building survivor and kill tables...")
    survivors, kills = build_survivor_kill_tables(decay_map, sign_map, cp_df)

    # Generate report
    report = generate_report(
        df, decay_map, sign_map, cp_df, policies, survivors, kills,
        threshold_sens, stability, boot_ci, DATA_SOURCE,
    )
    print("\n")
    print(report)

    # Save outputs
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    suffix = "_real" if DATA_SOURCE != "SYNTHETIC" else "_synthetic"

    report_path = OUTPUT_DIR / f"sector_signal_decay_report{suffix}.txt"
    with open(report_path, "w") as f:
        f.write(report)
    print(f"\nReport: {report_path}")

    decay_map_path = OUTPUT_DIR / f"sector_signal_decay_map{suffix}.csv"
    decay_map.to_csv(decay_map_path, index=False)
    print(f"Decay map: {decay_map_path}")

    sens_path = OUTPUT_DIR / f"sector_threshold_sensitivity{suffix}.csv"
    threshold_sens.to_csv(sens_path, index=False)
    print(f"Threshold sensitivity: {sens_path}")

    if args.output_json:
        json_output = {
            "generated": datetime.now().isoformat(),
            "data_source": DATA_SOURCE,
            "diagnosis": {
                "total_cells": len(decay_map),
                "deployable_cells": int((decay_map["full_n"] >= MIN_CELL_TRADES_DEPLOY).sum()),
                "survivor_cells": len(survivors),
                "kill_cells": len(kills),
            },
            "window_comparison": {
                w: {
                    "mean_wr": round(decay_map[f"{w}_wr"].dropna().mean(), 4),
                    "median_wr": round(decay_map[f"{w}_wr"].dropna().median(), 4),
                    "n_valid": int(decay_map[f"{w}_wr"].notna().sum()),
                }
                for w in ["full", "trail_12m", "trail_6m", "trail_3m"]
                if f"{w}_wr" in decay_map.columns
            },
            "policies": {k: v for k, v in policies.items()},
            "threshold_sensitivity": threshold_sens.to_dict("records"),
            "stability": stability,
            "bootstrap_ci": boot_ci,
            "survivors": survivors[["strategy", "sector", "direction", "shrunk_wr", "trail_3m_wr"]].head(30).to_dict("records") if len(survivors) > 0 else [],
            "kills": kills[["strategy", "sector", "direction", "trail_3m_wr"]].head(30).to_dict("records") if len(kills) > 0 else [],
        }
        json_path = OUTPUT_DIR / f"sector_signal_decay_analysis{suffix}.json"
        with open(json_path, "w") as f:
            json.dump(json_output, f, indent=2, default=str)
        print(f"JSON: {json_path}")


if __name__ == "__main__":
    main()
