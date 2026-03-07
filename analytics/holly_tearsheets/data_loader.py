"""Load + clean holly_analytics.csv → returns enriched DataFrame."""

import warnings

import numpy as np
import pandas as pd

from .config import HOLLY_CSV, EXPECTED_ROW_COUNT

warnings.filterwarnings("ignore", category=FutureWarning)


def load_holly_data(path=None, validate=True) -> pd.DataFrame:
    """
    Load holly_analytics.csv with proper dtypes, clean nulls, parse dates,
    and create derived columns.

    Parameters
    ----------
    path : Path or str, optional
        Override path to CSV. Defaults to config.HOLLY_CSV.
    validate : bool
        If True, run assertion checks on expected row count and column presence.

    Returns
    -------
    pd.DataFrame
        Enriched DataFrame with derived columns.
    """
    csv_path = path or HOLLY_CSV
    if not csv_path.exists():
        raise FileNotFoundError(
            f"{csv_path} not found. Run 13_export_analytics.py first."
        )

    print(f"Loading Holly data from {csv_path}...")
    df = pd.read_csv(
        csv_path,
        parse_dates=["trade_date", "entry_time", "exit_time"],
        low_memory=False,
    )
    print(f"  Raw: {len(df):,} rows, {len(df.columns)} columns")

    # ── Clean dtypes ──────────────────────────────────────────────
    # Ensure numeric columns are numeric
    numeric_cols = [
        "holly_pnl", "entry_price", "exit_price", "shares", "stop_price",
        "mfe", "mae", "stop_buffer_pct", "hold_minutes", "pnl_per_share",
        "risk_per_share", "r_multiple", "atr14", "atr_pct", "rsi14",
        "sma20", "sma5", "trend_slope", "roc5", "roc20",
        "opt_avg_pnl", "opt_profit_factor", "opt_win_rate", "opt_sharpe",
        "opt_max_drawdown", "opt_total_trades",
    ]
    for col in numeric_cols:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    # Boolean columns
    for col in ["is_winner", "is_loser", "has_minute_bars", "has_regime_data"]:
        if col in df.columns:
            df[col] = df[col].astype(bool)

    # Integer columns
    for col in ["trade_year", "trade_month", "trade_dow", "entry_hour"]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce").astype("Int64")

    # String columns — strip whitespace
    for col in ["strategy", "symbol", "direction", "trend_regime",
                "vol_regime", "momentum_regime", "opt_exit_rule", "sector"]:
        if col in df.columns:
            df[col] = df[col].astype(str).str.strip()
            df.loc[df[col].isin(["nan", "None", ""]), col] = pd.NA

    # ── Derived columns ──────────────────────────────────────────

    # trade_pnl_pct: percentage return per trade
    notional = df["entry_price"] * df["shares"]
    df["notional_exposure"] = notional
    df["trade_pnl_pct"] = np.where(
        notional > 0,
        (df["holly_pnl"] / notional) * 100,
        0.0,
    )

    # daily_pnl: will be used in returns_engine, but pre-compute group key
    # (actual aggregation happens in returns_engine)

    # regime_combo
    df["regime_combo"] = df.apply(_build_regime_combo, axis=1)

    # edge_capture_pct: for winners, how much of MFE was captured
    df["edge_capture_pct"] = np.where(
        (df["is_winner"]) & (df["mfe"] > 0),
        (df["pnl_per_share"] / df["mfe"]) * 100,
        np.nan,
    )

    # Sort by entry time for consistent ordering
    df = df.sort_values("entry_time").reset_index(drop=True)

    # ── Validation ────────────────────────────────────────────────
    if validate:
        _validate(df)

    print(f"  Loaded: {len(df):,} trades, {df['strategy'].nunique()} strategies")
    print(f"  Date range: {df['trade_date'].min().date()} to {df['trade_date'].max().date()}")
    print(f"  Directions: {df['direction'].value_counts().to_dict()}")
    print(f"  Regime coverage: {df['regime_combo'].ne('no_regime').sum():,} / {len(df):,}")

    return df


def _build_regime_combo(row) -> str:
    """Build regime combination string from trend/vol/momentum regimes."""
    parts = []
    for col in ["trend_regime", "vol_regime", "momentum_regime"]:
        val = row.get(col)
        if pd.notna(val) and val not in ("nan", "None", "", "<NA>"):
            parts.append(str(val))
    return "|".join(parts) if parts else "no_regime"


def _validate(df: pd.DataFrame):
    """Run validation checks."""
    n = len(df)
    # Allow +/- 10 rows for data updates
    if abs(n - EXPECTED_ROW_COUNT) > 100:
        print(f"  WARNING: Expected ~{EXPECTED_ROW_COUNT:,} rows, got {n:,}")

    required_cols = [
        "trade_id", "symbol", "strategy", "direction", "entry_time",
        "entry_price", "holly_pnl", "trade_date", "trade_year",
    ]
    missing = [c for c in required_cols if c not in df.columns]
    if missing:
        raise ValueError(f"Missing required columns: {missing}")

    # Check strategy count
    n_strats = df["strategy"].nunique()
    if n_strats < 100:
        print(f"  WARNING: Only {n_strats} unique strategies (expected 130+)")

    # Check date range
    min_year = df["trade_year"].min()
    max_year = df["trade_year"].max()
    if min_year > 2017 or max_year < 2025:
        print(f"  WARNING: Date range {min_year}-{max_year} seems narrow")


def get_strategy_summary(df: pd.DataFrame) -> pd.DataFrame:
    """Quick summary of strategies by trade count and PnL."""
    summary = df.groupby("strategy").agg(
        trades=("trade_id", "count"),
        total_pnl=("holly_pnl", "sum"),
        avg_pnl=("holly_pnl", "mean"),
        win_rate=("is_winner", "mean"),
        avg_hold=("hold_minutes", "mean"),
    ).sort_values("total_pnl", ascending=False)
    return summary


def filter_trades(
    df: pd.DataFrame,
    strategy: str = None,
    direction: str = None,
    regime: str = None,
    trend_regime: str = None,
    vol_regime: str = None,
    momentum_regime: str = None,
    year: int = None,
    min_trades: int = 0,
) -> pd.DataFrame:
    """Filter DataFrame by various criteria."""
    mask = pd.Series(True, index=df.index)

    if strategy:
        mask &= df["strategy"] == strategy
    if direction:
        mask &= df["direction"] == direction
    if regime:
        mask &= df["regime_combo"] == regime
    if trend_regime:
        mask &= df["trend_regime"] == trend_regime
    if vol_regime:
        mask &= df["vol_regime"] == vol_regime
    if momentum_regime:
        mask &= df["momentum_regime"] == momentum_regime
    if year:
        mask &= df["trade_year"] == year

    result = df[mask]
    if len(result) < min_trades:
        return pd.DataFrame(columns=df.columns)
    return result
