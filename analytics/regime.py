"""Regime-conditioned accuracy analysis for eval outcomes.

Produces:
- Single-dimension breakdowns for volatility, time of day, and liquidity
- Cross-tab win-rate matrices with sample-size awareness
- JSON artifact at analytics/output/regime_analysis.json
- Heatmap artifact at analytics/output/regime_heatmap.png
"""

from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timezone
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from matplotlib.colors import LinearSegmentedColormap

from db_loader import load_eval_outcomes

OUTPUT_DIR = Path(__file__).resolve().parent / "output"
JSON_PATH = OUTPUT_DIR / "regime_analysis.json"
HEATMAP_PATH = OUTPUT_DIR / "regime_heatmap.png"

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


def _to_float(value: float | int | np.floating | np.integer | None) -> float | None:
    if value is None or pd.isna(value):
        return None
    return float(value)


def _single_dimension_breakdown(df: pd.DataFrame, column: str, order: list[str]) -> pd.DataFrame:
    working = df.copy()
    working["is_win"] = (working["r_multiple"] > 0).astype(int)

    grouped = (
        working.groupby(column, dropna=False)
        .agg(
            win_rate=("is_win", "mean"),
            avg_r_multiple=("r_multiple", "mean"),
            avg_confidence=("ensemble_confidence", "mean"),
            count=("r_multiple", "count"),
        )
        .reset_index()
    )

    grouped["win_rate"] = grouped["win_rate"] * 100.0
    grouped = grouped.set_index(column).reindex(order).reset_index()

    grouped["count"] = grouped["count"].fillna(0).astype(int)
    return grouped


def _print_breakdown(title: str, table: pd.DataFrame, dimension_col: str) -> None:
    display_df = table.copy()
    display_df["win_rate"] = display_df["win_rate"].map(
        lambda v: "-" if pd.isna(v) else f"{v:.1f}%"
    )
    display_df["avg_r_multiple"] = display_df["avg_r_multiple"].map(
        lambda v: "-" if pd.isna(v) else f"{v:.3f}"
    )
    display_df["avg_confidence"] = display_df["avg_confidence"].map(
        lambda v: "-" if pd.isna(v) else f"{v:.2f}"
    )

    print(f"\n{title}")
    print(display_df[[dimension_col, "win_rate", "avg_r_multiple", "avg_confidence", "count"]].to_string(index=False))


def _build_crosstab(df: pd.DataFrame, row_col: str, col_col: str, row_order: list[str], col_order: list[str]) -> dict:
    working = df.copy()
    working["is_win"] = (working["r_multiple"] > 0).astype(int)

    count_matrix = (
        working.pivot_table(index=row_col, columns=col_col, values="r_multiple", aggfunc="count")
        .reindex(index=row_order, columns=col_order)
        .fillna(0)
        .astype(int)
    )

    win_matrix = (
        working.pivot_table(index=row_col, columns=col_col, values="is_win", aggfunc="mean")
        .reindex(index=row_order, columns=col_order)
        * 100.0
    )

    display_matrix = pd.DataFrame(index=row_order, columns=col_order, dtype=object)
    for row in row_order:
        for col in col_order:
            n_value = int(count_matrix.loc[row, col])
            if n_value < 5:
                display_matrix.loc[row, col] = "insufficient data"
                continue

            win_rate = win_matrix.loc[row, col]
            if pd.isna(win_rate):
                display_matrix.loc[row, col] = "insufficient data"
            else:
                display_matrix.loc[row, col] = f"{win_rate:.1f}% (n={n_value})"

    return {
        "win_rate_pct": win_matrix,
        "count": count_matrix,
        "display": display_matrix,
    }


def _print_crosstab(title: str, crosstab_data: dict) -> None:
    print(f"\n{title}")
    print(crosstab_data["display"].to_string())


def _save_heatmap(win_rate_matrix: pd.DataFrame, count_matrix: pd.DataFrame) -> None:
    cmap = LinearSegmentedColormap.from_list(
        "winrate", [(0.0, "#dc2626"), (0.5, "#facc15"), (1.0, "#16a34a")]
    )

    data = win_rate_matrix.to_numpy(dtype=float)
    fig, ax = plt.subplots(figsize=(14, 6))
    image = ax.imshow(data, cmap=cmap, vmin=0, vmax=100, aspect="auto")

    ax.set_xticks(np.arange(len(win_rate_matrix.columns)))
    ax.set_yticks(np.arange(len(win_rate_matrix.index)))
    ax.set_xticklabels(win_rate_matrix.columns)
    ax.set_yticklabels(win_rate_matrix.index)
    plt.setp(ax.get_xticklabels(), rotation=45, ha="right", rotation_mode="anchor")

    for row_index, row_name in enumerate(win_rate_matrix.index):
        for col_index, col_name in enumerate(win_rate_matrix.columns):
            win_rate = win_rate_matrix.loc[row_name, col_name]
            n_value = int(count_matrix.loc[row_name, col_name])
            label = "insufficient\n(n<5)" if n_value < 5 or pd.isna(win_rate) else f"{win_rate:.1f}%\n(n={n_value})"
            ax.text(col_index, row_index, label, ha="center", va="center", color="black", fontsize=9)

    ax.set_title("Win Rate Heatmap: Volatility Regime × Time of Day")
    ax.set_xlabel("Time of Day")
    ax.set_ylabel("Volatility Regime")

    cbar = fig.colorbar(image, ax=ax)
    cbar.set_label("Win Rate (%)")

    fig.tight_layout()
    fig.savefig(HEATMAP_PATH, dpi=200)
    plt.close(fig)


def _table_to_records(table: pd.DataFrame, dimension_col: str) -> list[dict]:
    records: list[dict] = []
    for _, row in table.iterrows():
        records.append(
            {
                dimension_col: row[dimension_col],
                "win_rate": _to_float(row["win_rate"]),
                "avg_r_multiple": _to_float(row["avg_r_multiple"]),
                "avg_confidence": _to_float(row["avg_confidence"]),
                "count": int(row["count"]),
            }
        )
    return records


def _crosstab_to_json(crosstab_data: dict) -> dict:
    win_rate = crosstab_data["win_rate_pct"]
    count = crosstab_data["count"]

    result: dict[str, dict[str, dict[str, float | int | str | None]] | dict[str, list[str]]] = {
        "rows": list(win_rate.index),
        "columns": list(win_rate.columns),
        "cells": {},
    }

    cells: dict[str, dict[str, float | int | str | None]] = {}
    for row in win_rate.index:
        for col in win_rate.columns:
            key = f"{row}|{col}"
            n_value = int(count.loc[row, col])
            win_value = _to_float(win_rate.loc[row, col])
            status = "insufficient data" if n_value < 5 or win_value is None else "ok"
            cells[key] = {
                "row": row,
                "column": col,
                "win_rate": win_value,
                "count": n_value,
                "status": status,
            }

    result["cells"] = cells
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description="Regime-conditioned accuracy analysis")
    parser.add_argument("--days", type=int, default=90, help="Lookback window in days")
    args = parser.parse_args()

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    df = load_eval_outcomes(days=args.days, trades_only=True)
    total_trades = len(df)

    if total_trades < 10:
        message = (
            f"Only {total_trades} trade outcomes found in the last {args.days} days. "
            "Need at least 10 outcomes for reliable regime analysis."
        )
        print(message)
        payload = {
            "metadata": {
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "lookback_days": args.days,
                "total_trades": total_trades,
                "message": message,
            },
            "single_dimension": {},
            "cross_tabulations": {},
        }
        with open(JSON_PATH, "w", encoding="utf-8") as file:
            json.dump(payload, file, indent=2)
        return

    vol_table = _single_dimension_breakdown(df, "volatility_regime", VOLATILITY_ORDER)
    tod_table = _single_dimension_breakdown(df, "time_of_day", TIME_OF_DAY_ORDER)
    liq_table = _single_dimension_breakdown(df, "liquidity_bucket", LIQUIDITY_ORDER)

    _print_breakdown("Volatility Regime Breakdown", vol_table, "volatility_regime")
    _print_breakdown("Time of Day Breakdown", tod_table, "time_of_day")
    _print_breakdown("Liquidity Bucket Breakdown", liq_table, "liquidity_bucket")

    vol_by_tod = _build_crosstab(
        df,
        row_col="volatility_regime",
        col_col="time_of_day",
        row_order=VOLATILITY_ORDER,
        col_order=TIME_OF_DAY_ORDER,
    )
    vol_by_liq = _build_crosstab(
        df,
        row_col="volatility_regime",
        col_col="liquidity_bucket",
        row_order=VOLATILITY_ORDER,
        col_order=LIQUIDITY_ORDER,
    )

    _print_crosstab("Volatility Regime × Time of Day (Win Rate + Count)", vol_by_tod)
    _print_crosstab("Volatility Regime × Liquidity Bucket (Win Rate + Count)", vol_by_liq)

    _save_heatmap(vol_by_tod["win_rate_pct"], vol_by_tod["count"])

    output = {
        "metadata": {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "lookback_days": args.days,
            "total_trades": total_trades,
        },
        "single_dimension": {
            "volatility_regime": _table_to_records(vol_table, "volatility_regime"),
            "time_of_day": _table_to_records(tod_table, "time_of_day"),
            "liquidity_bucket": _table_to_records(liq_table, "liquidity_bucket"),
        },
        "cross_tabulations": {
            "volatility_x_time_of_day": _crosstab_to_json(vol_by_tod),
            "volatility_x_liquidity_bucket": _crosstab_to_json(vol_by_liq),
        },
        "artifacts": {
            "heatmap_path": str(HEATMAP_PATH),
        },
    }

    with open(JSON_PATH, "w", encoding="utf-8") as file:
        json.dump(output, file, indent=2)

    print(f"\nSaved JSON report: {JSON_PATH}")
    print(f"Saved heatmap: {HEATMAP_PATH}")


if __name__ == "__main__":
    main()
