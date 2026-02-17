"""Holly AI rule extraction analytics from historical trade outcomes."""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np
import pandas as pd
from scipy import stats

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR.parent / "data" / "bridge.db"
OUTPUT_DIR = BASE_DIR / "output"
JSON_PATH = OUTPUT_DIR / "holly_rules.json"
PLOT_PATH = OUTPUT_DIR / "holly_rules_by_strategy.png"

MIN_GROUP_SIZE = 10
FEATURES: tuple[str, ...] = (
    "mfe",
    "mae",
    "hold_minutes",
    "giveback_ratio",
    "time_to_mfe_min",
    "time_to_mae_min",
    "r_multiple",
)


def load_holly_trades(days: int) -> pd.DataFrame:
    """Load Holly trades from SQLite for the requested lookback window."""
    if not DB_PATH.exists():
        return pd.DataFrame()

    conn = sqlite3.connect(DB_PATH)
    try:
        query = """
        SELECT
            entry_time,
            strategy,
            segment,
            actual_pnl,
            mfe,
            mae,
            hold_minutes,
            giveback,
            giveback_ratio,
            r_multiple,
            time_to_mfe_min,
            time_to_mae_min,
            entry_price,
            exit_price,
            shares
        FROM holly_trades
        WHERE datetime(entry_time) >= datetime('now', ? || ' days')
        """
        return pd.read_sql_query(query, conn, params=[f"-{days}"])
    except sqlite3.OperationalError as exc:
        print(f"Failed to query holly_trades: {exc}")
        return pd.DataFrame()
    finally:
        conn.close()


def cohens_d(group1: pd.Series, group2: pd.Series) -> float:
    """Compute Cohen's d effect size between two numeric groups."""
    clean1 = pd.to_numeric(group1, errors="coerce").dropna()
    clean2 = pd.to_numeric(group2, errors="coerce").dropna()

    n1 = len(clean1)
    n2 = len(clean2)
    if n1 < 2 or n2 < 2:
        return 0.0

    var1 = float(clean1.var(ddof=1))
    var2 = float(clean2.var(ddof=1))

    denominator = n1 + n2 - 2
    if denominator <= 0:
        return 0.0

    pooled_std = np.sqrt(((n1 - 1) * var1 + (n2 - 1) * var2) / denominator)
    if pooled_std <= 0 or not np.isfinite(pooled_std):
        return 0.0

    return float((clean1.mean() - clean2.mean()) / pooled_std)


def _safe_float(value: float | np.floating | None) -> float | None:
    if value is None:
        return None
    numeric = float(value)
    if not np.isfinite(numeric):
        return None
    return numeric


def build_effect_rows(df: pd.DataFrame) -> tuple[list[dict[str, float | int | str | None]], list[str]]:
    """Build Cohen's d rows for winner vs loser feature comparison."""
    warnings: list[str] = []
    winners = df[df["winner"]]
    losers = df[~df["winner"]]

    if len(winners) < MIN_GROUP_SIZE or len(losers) < MIN_GROUP_SIZE:
        warnings.append(
            "Insufficient winners/losers split for effect-size analysis "
            f"(winners={len(winners)}, losers={len(losers)}, need >= {MIN_GROUP_SIZE} each)."
        )
        return [], warnings

    rows: list[dict[str, float | int | str | None]] = []
    for feature in FEATURES:
        winner_vals = pd.to_numeric(winners[feature], errors="coerce").dropna()
        loser_vals = pd.to_numeric(losers[feature], errors="coerce").dropna()

        if len(winner_vals) < MIN_GROUP_SIZE or len(loser_vals) < MIN_GROUP_SIZE:
            warnings.append(
                f"Skipping feature '{feature}' due to insufficient data "
                f"(winners={len(winner_vals)}, losers={len(loser_vals)}, need >= {MIN_GROUP_SIZE} each)."
            )
            continue

        effect = cohens_d(winner_vals, loser_vals)
        t_stat, p_value = stats.ttest_ind(winner_vals, loser_vals, equal_var=True)

        rows.append(
            {
                "feature": feature,
                "cohens_d": _safe_float(effect),
                "abs_cohens_d": _safe_float(abs(effect)),
                "winner_mean": _safe_float(winner_vals.mean()),
                "loser_mean": _safe_float(loser_vals.mean()),
                "winner_n": int(len(winner_vals)),
                "loser_n": int(len(loser_vals)),
                "t_stat": _safe_float(t_stat),
                "p_value": _safe_float(p_value),
            }
        )

    rows.sort(key=lambda item: float(item["abs_cohens_d"] or 0.0), reverse=True)
    return rows[:10], warnings


def build_strategy_summary(df: pd.DataFrame) -> tuple[list[dict[str, float | int | str | None]], list[str]]:
    """Aggregate win rate and metrics by strategy, skipping tiny groups."""
    warnings: list[str] = []
    rows: list[dict[str, float | int | str | None]] = []

    grouped = df.groupby("strategy", dropna=False)
    for strategy, group in grouped:
        strategy_name = str(strategy) if pd.notna(strategy) and str(strategy).strip() else "(unknown)"
        if len(group) < MIN_GROUP_SIZE:
            warnings.append(
                f"Skipping strategy '{strategy_name}' due to insufficient data "
                f"(n={len(group)}, need >= {MIN_GROUP_SIZE})."
            )
            continue

        rows.append(
            {
                "strategy": strategy_name,
                "n": int(len(group)),
                "win_rate": _safe_float(float(group["winner"].mean())),
                "avg_r_multiple": _safe_float(pd.to_numeric(group["r_multiple"], errors="coerce").mean()),
                "avg_giveback_ratio": _safe_float(pd.to_numeric(group["giveback_ratio"], errors="coerce").mean()),
            }
        )

    rows.sort(key=lambda item: int(item["n"]), reverse=True)
    return rows, warnings


def plot_strategy_win_rates(strategy_rows: list[dict[str, float | int | str | None]]) -> None:
    """Save a bar chart of strategy win rates."""
    if not strategy_rows:
        print("No strategy groups met minimum sample size; skipping win-rate chart.")
        return

    chart_df = pd.DataFrame(strategy_rows)
    chart_df = chart_df.sort_values("win_rate", ascending=False)

    fig, ax = plt.subplots(figsize=(12, 6))
    ax.bar(chart_df["strategy"], chart_df["win_rate"] * 100.0, color="#10b981")
    ax.set_title("Holly Strategy Win Rate")
    ax.set_ylabel("Win Rate (%)")
    ax.set_xlabel("Strategy")
    ax.set_ylim(0, 100)
    ax.grid(axis="y", alpha=0.25)
    ax.tick_params(axis="x", rotation=35)

    fig.tight_layout()
    fig.savefig(PLOT_PATH, dpi=150)
    plt.close(fig)


def print_summary(
    sample_size: int,
    winners: int,
    losers: int,
    effect_rows: list[dict[str, float | int | str | None]],
    strategy_rows: list[dict[str, float | int | str | None]],
) -> None:
    """Print a concise console summary table."""
    print("\nHolly Rule Extraction Summary")
    print("=" * 72)
    print(f"Trades analyzed: {sample_size} | Winners: {winners} | Losers: {losers}")

    if effect_rows:
        effect_df = pd.DataFrame(effect_rows)
        printable = effect_df[["feature", "cohens_d", "winner_mean", "loser_mean", "p_value"]].copy()
        printable["cohens_d"] = printable["cohens_d"].map(lambda v: f"{float(v):.3f}" if v is not None else "n/a")
        printable["winner_mean"] = printable["winner_mean"].map(
            lambda v: f"{float(v):.3f}" if v is not None else "n/a"
        )
        printable["loser_mean"] = printable["loser_mean"].map(
            lambda v: f"{float(v):.3f}" if v is not None else "n/a"
        )
        printable["p_value"] = printable["p_value"].map(lambda v: f"{float(v):.4f}" if v is not None else "n/a")

        print("\nTop Rules by |Cohen's d|")
        print(printable.to_string(index=False))
    else:
        print("\nNo valid effect-size rules were produced.")

    if strategy_rows:
        strategy_df = pd.DataFrame(strategy_rows)
        strategy_print = strategy_df[["strategy", "n", "win_rate", "avg_r_multiple", "avg_giveback_ratio"]].copy()
        strategy_print["win_rate"] = strategy_print["win_rate"].map(
            lambda v: f"{float(v) * 100:.1f}%" if v is not None else "n/a"
        )
        strategy_print["avg_r_multiple"] = strategy_print["avg_r_multiple"].map(
            lambda v: f"{float(v):.3f}" if v is not None else "n/a"
        )
        strategy_print["avg_giveback_ratio"] = strategy_print["avg_giveback_ratio"].map(
            lambda v: f"{float(v):.3f}" if v is not None else "n/a"
        )

        print("\nStrategy Breakdown")
        print(strategy_print.to_string(index=False))
    else:
        print("\nNo strategy groups met minimum sample size.")


def run(days: int) -> None:
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    df = load_holly_trades(days=days)
    if df.empty:
        print(f"No holly_trades rows found in the last {days} days.")
        payload = {
            "metadata": {
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "lookback_days": days,
                "sample_size": 0,
                "message": "No data available",
            },
            "top_rules": [],
            "strategy_summary": [],
            "warnings": ["No rows available for analysis."],
        }
        with open(JSON_PATH, "w", encoding="utf-8") as file:
            json.dump(payload, file, indent=2)
        return

    df["winner"] = pd.to_numeric(df["actual_pnl"], errors="coerce") > 0
    valid = df[df["actual_pnl"].notna()].copy()

    if len(valid) < MIN_GROUP_SIZE:
        message = f"Only {len(valid)} rows have actual_pnl in last {days} days; need at least {MIN_GROUP_SIZE}."
        print(message)
        payload = {
            "metadata": {
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "lookback_days": days,
                "sample_size": int(len(valid)),
                "message": message,
            },
            "top_rules": [],
            "strategy_summary": [],
            "warnings": [message],
        }
        with open(JSON_PATH, "w", encoding="utf-8") as file:
            json.dump(payload, file, indent=2)
        return

    effect_rows, effect_warnings = build_effect_rows(valid)
    strategy_rows, strategy_warnings = build_strategy_summary(valid)

    plot_strategy_win_rates(strategy_rows)

    winners = int(valid["winner"].sum())
    losers = int((~valid["winner"]).sum())

    print_summary(
        sample_size=len(valid),
        winners=winners,
        losers=losers,
        effect_rows=effect_rows,
        strategy_rows=strategy_rows,
    )

    all_warnings = [*effect_warnings, *strategy_warnings]
    for warning in all_warnings:
        print(f"WARNING: {warning}")

    payload = {
        "metadata": {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "lookback_days": days,
            "sample_size": int(len(valid)),
            "winners": winners,
            "losers": losers,
        },
        "top_rules": effect_rows,
        "strategy_summary": strategy_rows,
        "warnings": all_warnings,
    }

    with open(JSON_PATH, "w", encoding="utf-8") as file:
        json.dump(payload, file, indent=2)

    print(f"\nSaved JSON: {JSON_PATH}")
    if PLOT_PATH.exists():
        print(f"Saved chart: {PLOT_PATH}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract statistically significant Holly trading rules")
    parser.add_argument("--days", type=int, default=90, help="Lookback window in days")
    args = parser.parse_args()
    run(days=args.days)


if __name__ == "__main__":
    main()
