"""Custom metrics that QuantStats doesn't provide natively.

Includes trade-level analytics, regime-aware metrics, and Holly-specific
calculations like edge capture, MFE/MAE utilization, and R-multiple distributions.
"""

import numpy as np
import pandas as pd


def trade_level_metrics(df: pd.DataFrame) -> dict:
    """
    Compute trade-level metrics from the raw Holly DataFrame.
    These complement the return-based metrics from QuantStats.
    """
    metrics = {}

    # ── Core trade stats ──────────────────────────────────────────
    metrics["total_trades"] = len(df)
    metrics["unique_symbols"] = df["symbol"].nunique()
    metrics["unique_strategies"] = df["strategy"].nunique()

    # Win / loss
    winners = df[df["is_winner"]]
    losers = df[df["is_loser"]]
    metrics["winners"] = len(winners)
    metrics["losers"] = len(losers)
    metrics["win_rate"] = len(winners) / max(len(df), 1)

    # PnL
    metrics["total_pnl"] = df["holly_pnl"].sum()
    metrics["avg_pnl"] = df["holly_pnl"].mean()
    metrics["median_pnl"] = df["holly_pnl"].median()
    metrics["std_pnl"] = df["holly_pnl"].std()
    metrics["avg_win"] = winners["holly_pnl"].mean() if len(winners) else 0
    metrics["avg_loss"] = losers["holly_pnl"].mean() if len(losers) else 0
    metrics["largest_win"] = df["holly_pnl"].max()
    metrics["largest_loss"] = df["holly_pnl"].min()

    # Payoff ratio
    metrics["payoff_ratio"] = (
        abs(metrics["avg_win"] / metrics["avg_loss"])
        if metrics["avg_loss"] != 0 else float("inf")
    )

    # Profit factor
    gross_profit = winners["holly_pnl"].sum() if len(winners) else 0
    gross_loss = abs(losers["holly_pnl"].sum()) if len(losers) else 1
    metrics["profit_factor"] = gross_profit / max(gross_loss, 1)

    # Expectancy
    metrics["expectancy"] = (
        metrics["win_rate"] * metrics["avg_win"]
        + (1 - metrics["win_rate"]) * metrics["avg_loss"]
    )

    # ── R-multiple analysis ───────────────────────────────────────
    r_mult = df["r_multiple"].dropna()
    if len(r_mult) > 0:
        metrics["avg_r_multiple"] = r_mult.mean()
        metrics["median_r_multiple"] = r_mult.median()
        metrics["r_multiple_std"] = r_mult.std()
        # Winsorize at 99th percentile for meaningful stats
        r_clipped = r_mult.clip(upper=r_mult.quantile(0.99))
        metrics["avg_r_multiple_winsorized"] = r_clipped.mean()
        metrics["pct_above_1r"] = (r_mult > 1).mean()
        metrics["pct_above_2r"] = (r_mult > 2).mean()
        metrics["pct_below_neg1r"] = (r_mult < -1).mean()

    # ── MFE / MAE analysis ────────────────────────────────────────
    if "mfe" in df.columns and "mae" in df.columns:
        mfe = df["mfe"].dropna()
        mae = df["mae"].dropna()
        if len(mfe) > 0:
            metrics["avg_mfe_cents"] = mfe.mean()
            metrics["median_mfe_cents"] = mfe.median()
            metrics["avg_mae_cents"] = mae.mean()
            metrics["median_mae_cents"] = mae.median()

            # MFE/MAE ratio: how much favorable vs adverse excursion
            mae_abs = mae.abs()
            valid = mae_abs > 0
            if valid.sum() > 0:
                metrics["mfe_mae_ratio"] = (mfe[valid] / mae_abs[valid]).median()

    # ── Edge capture ──────────────────────────────────────────────
    edge_cap = df["edge_capture_pct"].dropna()
    if len(edge_cap) > 0:
        metrics["avg_edge_capture_pct"] = edge_cap.mean()
        metrics["median_edge_capture_pct"] = edge_cap.median()

    # ── Hold time analysis ────────────────────────────────────────
    hold = df["hold_minutes"].dropna()
    if len(hold) > 0:
        metrics["avg_hold_minutes"] = hold.mean()
        metrics["median_hold_minutes"] = hold.median()
        metrics["pct_under_30min"] = (hold < 30).mean()
        metrics["pct_over_2hrs"] = (hold > 120).mean()

    # ── Direction split ───────────────────────────────────────────
    for direction in ["Long", "Short"]:
        d_df = df[df["direction"] == direction]
        if len(d_df) > 0:
            prefix = direction.lower()
            metrics[f"{prefix}_trades"] = len(d_df)
            metrics[f"{prefix}_win_rate"] = d_df["is_winner"].mean()
            metrics[f"{prefix}_avg_pnl"] = d_df["holly_pnl"].mean()
            metrics[f"{prefix}_total_pnl"] = d_df["holly_pnl"].sum()

    # ── Streak analysis ───────────────────────────────────────────
    if len(df) > 1:
        wins = df["is_winner"].values
        max_win_streak, max_loss_streak = _compute_streaks(wins)
        metrics["max_win_streak"] = max_win_streak
        metrics["max_loss_streak"] = max_loss_streak

    # ── Consecutive loss drawdown ─────────────────────────────────
    cum_pnl = df["holly_pnl"].cumsum()
    running_max = cum_pnl.cummax()
    drawdown = cum_pnl - running_max
    metrics["max_trade_drawdown"] = drawdown.min()
    if running_max.max() > 0:
        metrics["max_trade_drawdown_pct"] = drawdown.min() / running_max.max()

    return metrics


def _compute_streaks(wins: np.ndarray) -> tuple[int, int]:
    """Compute max win and loss streaks from boolean array."""
    max_win = max_loss = current_win = current_loss = 0
    for w in wins:
        if w:
            current_win += 1
            current_loss = 0
        else:
            current_loss += 1
            current_win = 0
        max_win = max(max_win, current_win)
        max_loss = max(max_loss, current_loss)
    return max_win, max_loss


def time_of_day_analysis(df: pd.DataFrame) -> pd.DataFrame:
    """Break down performance by entry hour."""
    if "entry_hour" not in df.columns:
        return pd.DataFrame()

    return df.groupby("entry_hour").agg(
        trades=("trade_id", "count"),
        win_rate=("is_winner", "mean"),
        avg_pnl=("holly_pnl", "mean"),
        total_pnl=("holly_pnl", "sum"),
        avg_hold=("hold_minutes", "mean"),
    ).sort_index()


def day_of_week_analysis(df: pd.DataFrame) -> pd.DataFrame:
    """Break down performance by day of week."""
    dow_map = {0: "Monday", 1: "Tuesday", 2: "Wednesday", 3: "Thursday", 4: "Friday"}
    if "trade_dow" not in df.columns:
        return pd.DataFrame()

    result = df.groupby("trade_dow").agg(
        trades=("trade_id", "count"),
        win_rate=("is_winner", "mean"),
        avg_pnl=("holly_pnl", "mean"),
        total_pnl=("holly_pnl", "sum"),
    ).sort_index()
    result.index = result.index.map(lambda x: dow_map.get(x, str(x)))
    return result


def monthly_seasonality(df: pd.DataFrame) -> pd.DataFrame:
    """Break down performance by calendar month."""
    month_map = {
        1: "Jan", 2: "Feb", 3: "Mar", 4: "Apr", 5: "May", 6: "Jun",
        7: "Jul", 8: "Aug", 9: "Sep", 10: "Oct", 11: "Nov", 12: "Dec",
    }
    if "trade_month" not in df.columns:
        return pd.DataFrame()

    result = df.groupby("trade_month").agg(
        trades=("trade_id", "count"),
        win_rate=("is_winner", "mean"),
        avg_pnl=("holly_pnl", "mean"),
        total_pnl=("holly_pnl", "sum"),
    ).sort_index()
    result.index = result.index.map(lambda x: month_map.get(x, str(x)))
    return result


def compute_kelly_criterion(df: pd.DataFrame) -> float:
    """Kelly criterion from trade-level data: f* = W - (1-W)/R."""
    win_rate = df["is_winner"].mean()
    winners = df[df["is_winner"]]["holly_pnl"]
    losers = df[df["is_loser"]]["holly_pnl"]
    if len(losers) == 0 or losers.mean() == 0:
        return 0.0
    payoff = abs(winners.mean() / losers.mean())
    kelly = win_rate - (1 - win_rate) / payoff
    return kelly


def compute_cpc_index(df: pd.DataFrame) -> float:
    """CPC Index = Profit Factor × Win Rate × Payoff Ratio."""
    winners = df[df["is_winner"]]["holly_pnl"]
    losers = df[df["is_loser"]]["holly_pnl"]
    if len(losers) == 0 or len(winners) == 0:
        return 0.0
    win_rate = len(winners) / len(df)
    gross_profit = winners.sum()
    gross_loss = abs(losers.sum())
    pf = gross_profit / max(gross_loss, 1)
    payoff = abs(winners.mean() / losers.mean())
    return pf * win_rate * payoff
