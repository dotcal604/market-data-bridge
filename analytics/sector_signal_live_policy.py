"""
Sector Signal Live Policy -- strat_sector_prior_wr
===================================================
Pure-function implementation of the sector signal overlay.

Provides:
  - compute_cell_bonus(): returns [-0.10, +0.10] bonus for a given cell
  - check_cell_health(): monitors cell health against kill-switch criteria
  - build_cell_lookup(): constructs the lookup table from trade data

This module is self-contained. No external dependencies beyond pandas/numpy.
It is designed to be imported by the eval engine or used as a research tool.

Usage:
    from analytics.sector_signal_live_policy import compute_cell_bonus, build_cell_lookup

    lookup = build_cell_lookup(trades_df)
    bonus = compute_cell_bonus("VWAP Reclaim", "Technology", "Long", lookup)
"""

from typing import Any

import numpy as np
import pandas as pd

# ---------------------------------------------------------------------------
# Default thresholds (validated by threshold sensitivity sweep)
# ---------------------------------------------------------------------------
MIN_FULL_N = 30
MIN_TRAIL_3M_N = 10
BREAKEVEN_WR = 0.50
SAFE_WR = 0.52
PENALTY_WR = 0.45
OVERLAY_CAP = 0.10
SHRINKAGE_PRIOR = 0.50


def build_cell_lookup(
    df: pd.DataFrame,
    min_full_n: int = MIN_FULL_N,
) -> dict[tuple[str, str, str], dict[str, float]]:
    """Build the cell lookup table from trade data.

    Args:
        df: DataFrame with columns [entry_time, strategy, sector, direction,
            is_winner, holly_pnl]. Must be sorted by entry_time.
        min_full_n: Minimum trades for a cell to appear in lookup.

    Returns:
        Dict mapping (strategy, sector, direction) -> cell stats dict.
    """
    df = df.sort_values("entry_time").copy()
    df["entry_date"] = pd.to_datetime(df["entry_time"])
    latest = df["entry_date"].max()
    trail_3m_cutoff = latest - pd.DateOffset(months=3)

    lookup: dict[tuple[str, str, str], dict[str, float]] = {}

    for cell_key, cell_df in df.groupby(["strategy", "sector", "direction"]):
        strat, sector, direction = cell_key
        full_n = len(cell_df)
        if full_n < min_full_n:
            continue

        full_wr = cell_df["is_winner"].mean()

        # Shrinkage
        sw = full_n / (full_n + min_full_n)
        shrunk_wr = sw * full_wr + (1 - sw) * SHRINKAGE_PRIOR

        # Trailing 3m
        recent = cell_df[cell_df["entry_date"] >= trail_3m_cutoff]
        trail_3m_n = len(recent)
        trail_3m_wr = recent["is_winner"].mean() if trail_3m_n >= 3 else np.nan

        lookup[(strat, sector, direction)] = {
            "full_n": full_n,
            "full_wr": round(full_wr, 4),
            "shrunk_wr": round(shrunk_wr, 4),
            "trail_3m_n": trail_3m_n,
            "trail_3m_wr": round(trail_3m_wr, 4) if np.isfinite(trail_3m_wr) else None,
        }

    return lookup


def compute_cell_bonus(
    strategy: str,
    sector: str,
    direction: str,
    cell_lookup: dict[tuple[str, str, str], dict[str, float]],
    *,
    breakeven: float = BREAKEVEN_WR,
    safe_wr: float = SAFE_WR,
    penalty_wr: float = PENALTY_WR,
    overlay_cap: float = OVERLAY_CAP,
    min_trail_3m_n: int = MIN_TRAIL_3M_N,
) -> float:
    """Compute the bonus/penalty for a given (strategy, sector, direction) cell.

    Policy E: Neutralize when trailing 3m < breakeven.

    Returns:
        Float in [-overlay_cap, +overlay_cap]. Returns 0.0 if cell not found,
        insufficient data, or kill-switch triggered.
    """
    cell = (strategy, sector, direction)
    stats = cell_lookup.get(cell)
    if stats is None:
        return 0.0

    shrunk = stats.get("shrunk_wr")
    if shrunk is None or not np.isfinite(shrunk):
        return 0.0

    # Kill switch: if trailing 3m exists and is below breakeven, neutralize
    t3m_n = stats.get("trail_3m_n", 0)
    t3m_wr = stats.get("trail_3m_wr")
    if t3m_n >= min_trail_3m_n and t3m_wr is not None and t3m_wr < breakeven:
        return 0.0

    # Bonus
    if shrunk >= safe_wr:
        return min((shrunk - breakeven) * 2, overlay_cap)
    # Penalty
    elif shrunk <= penalty_wr:
        return max((shrunk - breakeven) * 2, -overlay_cap)

    return 0.0


def check_cell_health(
    cell_lookup: dict[tuple[str, str, str], dict[str, float]],
    *,
    min_trail_3m_n: int = MIN_TRAIL_3M_N,
    kill_wr: float = 0.45,
) -> dict[str, Any]:
    """Check health of all cells against kill-switch criteria.

    Returns:
        Dict with overall health status and per-cell flags.
    """
    total = 0
    active = 0
    killed = 0
    healthy = 0
    flagged_cells = []

    for cell_key, stats in cell_lookup.items():
        total += 1
        bonus = compute_cell_bonus(cell_key[0], cell_key[1], cell_key[2], cell_lookup)
        if bonus != 0.0:
            active += 1

        t3m_n = stats.get("trail_3m_n", 0)
        t3m_wr = stats.get("trail_3m_wr")

        if t3m_n >= min_trail_3m_n and t3m_wr is not None:
            if t3m_wr < kill_wr:
                killed += 1
                flagged_cells.append({
                    "cell": cell_key,
                    "trail_3m_wr": t3m_wr,
                    "status": "KILLED",
                })
            elif t3m_wr < BREAKEVEN_WR:
                flagged_cells.append({
                    "cell": cell_key,
                    "trail_3m_wr": t3m_wr,
                    "status": "NEUTRALIZED",
                })
            else:
                healthy += 1

    # Signal-level kill switch: if >50% of survivors fail
    signal_kill = killed > total * 0.5 if total > 0 else False

    return {
        "total_cells": total,
        "active_cells": active,
        "healthy_cells": healthy,
        "killed_cells": killed,
        "signal_level_kill": signal_kill,
        "flagged": flagged_cells[:20],  # top 20
    }
