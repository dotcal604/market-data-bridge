"""Regime-conditioned accuracy analysis.

Builds single-dimension breakdowns and cross-tabulations from eval outcomes,
exports JSON, and renders a volatility x time-of-day win-rate heatmap.
"""

from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from matplotlib.colors import LinearSegmentedColormap

from db_loader import load_eval_outcomes

VOLATILITY_ORDER = ["low", "normal", "high", "extreme"]
TIME_OF_DAY_ORDER = [
    "premarket",
    "open_15",
    "morning",
    "midday",
    "afternoon",
    "close_15",
    "after_hours",
]
LIQUIDITY_ORDER = ["thin", "normal", "thick"]
MIN_CELL_COUNT = 5
MIN_TOTAL_OUTCOMES = 10


OUTPUT_DIR = Path(__file__).resolve().parent / "output"
JSON_OUTPUT_PATH = OUTPUT_DIR / "regime_analysis.json"
HEATMAP_OUTPUT_PATH = OUTPUT_DIR / "regime_heatmap.png"


def _calculate_metrics(frame: pd.DataFrame, column: str, ordered_values: list[str]) -> pd.DataFrame:
    """Compute win rate, avg R, avg confidence, and count for a grouped column."""
    scoped = frame.copy()
    grouped = (
        scoped.groupby(column, dropna=False)
        .agg(
            win_rate=("r_multiple", lambda s: float((s > 0).mean() * 100.0)),
            avg_r_multiple=("r_multiple", "mean"),
            avg_confidence=("ensemble_confidence", "mean"),
            count=("r_multiple", "size"),
        )
        .reset_index()
    )

    grouped[column] = pd.Categorical(grouped[column], categories=ordered_values, ordered=True)
    grouped = grouped.sort_values(column)
    grouped["win_rate"] = grouped["win_rate"].round(2)
    grouped["avg_r_multiple"] = grouped["avg_r_multiple"].round(4)
    grouped["avg_confidence"] = grouped["avg_confidence"].round(2)
    grouped["count"] = grouped["count"].astype(int)
    return grouped


def _format_for_stdout(table: pd.DataFrame) -> str:
    printable = table.copy()
    printable["win_rate"] = printable["win_rate"].map(lambda v: f"{v:.2f}%")
    printable["avg_r_multiple"] = printable["avg_r_multiple"].map(lambda v: f"{v:.4f}")
    printable["avg_confidence"] = printable["avg_confidence"].map(lambda v: f"{v:.2f}")
    printable["count"] = printable["count"].astype(int)
    return printable.to_string(index=False)


def _build_cross_tab(
    frame: pd.DataFrame,
    row_col: str,
    col_col: str,
    row_order: list[str],
    col_order: list[str],
) -> pd.DataFrame:
    rows: list[dict[str, Any]] = []

    for row_value in row_order:
        for col_value in col_order:
            cell = frame[(frame[row_col] == row_value) & (frame[col_col] == col_value)]
            count = int(len(cell))
            if count == 0:
                win_rate_value: float | None = None
            else:
                win_rate_value = float((cell["r_multiple"] > 0).mean() * 100.0)

            rows.append(
                {
                    row_col: row_value,
                    col_col: col_value,
                    "count": count,
                    "win_rate": None if win_rate_value is None else round(win_rate_value, 2),
                    "insufficient_data": count < MIN_CELL_COUNT,
                }
            )

    return pd.DataFrame(rows)


def _print_cross_tab(cross_tab: pd.DataFrame, row_col: str, col_col: str, col_order: list[str]) -> None:
    printable = cross_tab.copy()

    def cell_value(row: pd.Series) -> str:
        if row["insufficient_data"]:
            return "insufficient data"
        if row["win_rate"] is None or pd.isna(row["win_rate"]):
            return "n=0"
        return f"{row['win_rate']:.2f}% (n={int(row['count'])})"

    printable["cell"] = printable.apply(cell_value, axis=1)
    matrix = printable.pivot(index=row_col, columns=col_col, values="cell")
    matrix = matrix.reindex(columns=col_order)
    print(matrix.fillna("insufficient data").to_string())


def _cross_tab_to_json(cross_tab: pd.DataFrame, row_col: str, col_col: str) -> dict[str, dict[str, dict[str, Any]]]:
    payload: dict[str, dict[str, dict[str, Any]]] = {}
    for row_value, row_slice in cross_tab.groupby(row_col):
        payload[str(row_value)] = {}
        for _, row in row_slice.iterrows():
            payload[str(row[col_col])] = {
                "win_rate": None if pd.isna(row["win_rate"]) else float(row["win_rate"]),
                "count": int(row["count"]),
                "insufficient_data": bool(row["insufficient_data"]),
            }
    return payload


def _generate_heatmap(cross_tab: pd.DataFrame) -> None:
    pivot_win = cross_tab.pivot(index="volatility_regime", columns="time_of_day", values="win_rate")
    pivot_count = cross_tab.pivot(index="volatility_regime", columns="time_of_day", values="count")

    pivot_win = pivot_win.reindex(index=VOLATILITY_ORDER, columns=TIME_OF_DAY_ORDER)
    pivot_count = pivot_count.reindex(index=VOLATILITY_ORDER, columns=TIME_OF_DAY_ORDER)

    heat_values = pivot_win.to_numpy(dtype=float) / 100.0
    display_values = np.where(np.isnan(heat_values), np.nan, heat_values)

    cmap = LinearSegmentedColormap.from_list("regime_wr", ["#dc2626", "#facc15", "#16a34a"], N=256)

    fig, ax = plt.subplots(figsize=(14, 5.5))
    image = ax.imshow(display_values, cmap=cmap, vmin=0.0, vmax=1.0, aspect="auto")

    ax.set_xticks(np.arange(len(TIME_OF_DAY_ORDER)))
    ax.set_yticks(np.arange(len(VOLATILITY_ORDER)))
    ax.set_xticklabels(TIME_OF_DAY_ORDER, rotation=35, ha="right")
    ax.set_yticklabels(VOLATILITY_ORDER)
    ax.set_xlabel("time_of_day")
    ax.set_ylabel("volatility_regime")
    ax.set_title("Win Rate Heatmap: Volatility Regime × Time of Day")

    for i, row_name in enumerate(VOLATILITY_ORDER):
        for j, col_name in enumerate(TIME_OF_DAY_ORDER):
            win_rate = pivot_win.loc[row_name, col_name]
            count = int(pivot_count.loc[row_name, col_name]) if not pd.isna(pivot_count.loc[row_name, col_name]) else 0
            if count < MIN_CELL_COUNT:
                label = "insufficient\ndata"
            elif pd.isna(win_rate):
                label = "n=0"
            else:
                label = f"{win_rate:.1f}%\n(n={count})"
            ax.text(j, i, label, ha="center", va="center", color="black", fontsize=8, fontweight="bold")

    colorbar = fig.colorbar(image, ax=ax)
    colorbar.set_label("Win rate")
    colorbar.set_ticks([0.4, 0.5, 0.6])
    colorbar.set_ticklabels(["40%", "50%", "60%"])

    fig.tight_layout()
    fig.savefig(HEATMAP_OUTPUT_PATH, dpi=180)
    plt.close(fig)


def run(days: int) -> None:
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    outcomes = load_eval_outcomes(days=days, trades_only=True)
    total_outcomes = int(len(outcomes))

    if total_outcomes < MIN_TOTAL_OUTCOMES:
        message = (
            f"Not enough outcomes for robust regime analysis: found {total_outcomes}, "
            f"need at least {MIN_TOTAL_OUTCOMES}."
        )
        print(message)
        payload = {
            "metadata": {
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "total_trades": total_outcomes,
                "days": days,
                "message": message,
            },
            "single_dimension": {},
            "cross_tabs": {},
        }
        JSON_OUTPUT_PATH.write_text(json.dumps(payload, indent=2))
        return

    volatility_table = _calculate_metrics(outcomes, "volatility_regime", VOLATILITY_ORDER)
    time_table = _calculate_metrics(outcomes, "time_of_day", TIME_OF_DAY_ORDER)
    liquidity_table = _calculate_metrics(outcomes, "liquidity_bucket", LIQUIDITY_ORDER)

    print("\n=== Volatility Regime Breakdown ===")
    print(_format_for_stdout(volatility_table))

    print("\n=== Time-of-Day Breakdown ===")
    print(_format_for_stdout(time_table))

    print("\n=== Liquidity Bucket Breakdown ===")
    print(_format_for_stdout(liquidity_table))

    vol_time = _build_cross_tab(
        outcomes,
        row_col="volatility_regime",
        col_col="time_of_day",
        row_order=VOLATILITY_ORDER,
        col_order=TIME_OF_DAY_ORDER,
    )
    vol_liquidity = _build_cross_tab(
        outcomes,
        row_col="volatility_regime",
        col_col="liquidity_bucket",
        row_order=VOLATILITY_ORDER,
        col_order=LIQUIDITY_ORDER,
    )

    print("\n=== Cross-tab: volatility_regime × time_of_day ===")
    _print_cross_tab(vol_time, "volatility_regime", "time_of_day", TIME_OF_DAY_ORDER)

    print("\n=== Cross-tab: volatility_regime × liquidity_bucket ===")
    _print_cross_tab(vol_liquidity, "volatility_regime", "liquidity_bucket", LIQUIDITY_ORDER)

    _generate_heatmap(vol_time)

    payload = {
        "metadata": {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "total_trades": total_outcomes,
            "days": days,
        },
        "single_dimension": {
            "volatility_regime": volatility_table.to_dict(orient="records"),
            "time_of_day": time_table.to_dict(orient="records"),
            "liquidity_bucket": liquidity_table.to_dict(orient="records"),
        },
        "cross_tabs": {
            "volatility_x_time_of_day": _cross_tab_to_json(
                vol_time,
                row_col="volatility_regime",
                col_col="time_of_day",
            ),
            "volatility_x_liquidity_bucket": _cross_tab_to_json(
                vol_liquidity,
                row_col="volatility_regime",
                col_col="liquidity_bucket",
            ),
        },
    }

    JSON_OUTPUT_PATH.write_text(json.dumps(payload, indent=2))
    print(f"\nSaved JSON report to {JSON_OUTPUT_PATH}")
    print(f"Saved heatmap to {HEATMAP_OUTPUT_PATH}")


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Regime-conditioned accuracy analysis")
    parser.add_argument("--days", type=int, default=90, help="Lookback window in days (default: 90)")
    return parser.parse_args()


if __name__ == "__main__":
    args = _parse_args()
    run(days=args.days)
