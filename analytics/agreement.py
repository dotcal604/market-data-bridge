"""Model agreement analysis for Market Data Bridge outcomes.

This script analyzes how often models agree/disagree and how that relates to
trade outcomes. It writes:
- analytics/output/agreement_analysis.json
- analytics/output/agreement_chart.png
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

from db_loader import load_eval_outcomes, load_model_outcomes

OUTPUT_DIR = Path(__file__).resolve().parent / "output"
CATEGORY_ORDER = [
    "unanimous_trade",
    "majority_trade",
    "majority_skip",
    "unanimous_skip",
]


def _classify_agreement(trade_votes: int) -> str:
    if trade_votes == 3:
        return "unanimous_trade"
    if trade_votes == 2:
        return "majority_trade"
    if trade_votes == 1:
        return "majority_skip"
    return "unanimous_skip"


def _safe_corr(left: pd.Series, right: pd.Series) -> float | None:
    aligned = pd.concat([left, right], axis=1).dropna()
    if aligned.empty:
        return None
    if aligned.iloc[:, 0].nunique() < 2 or aligned.iloc[:, 1].nunique() < 2:
        return None
    corr = aligned.iloc[:, 0].corr(aligned.iloc[:, 1])
    if pd.isna(corr):
        return None
    return float(corr)


def _pct(value: float) -> float:
    return float(value * 100.0)


def run(days: int) -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    model_df = load_model_outcomes(days=days)
    eval_df = load_eval_outcomes(days=days, trades_only=True)

    if model_df.empty or eval_df.empty:
        print(f"No outcomes found for the last {days} days.")
        return

    # Keep only evaluations where all 3 model outputs are present.
    model_counts = model_df.groupby("evaluation_id")["model_id"].nunique()
    complete_eval_ids = model_counts[model_counts == 3].index
    incomplete_evals = int((model_counts != 3).sum())

    model_complete = model_df[model_df["evaluation_id"].isin(complete_eval_ids)].copy()
    eval_complete = eval_df[eval_df["evaluation_id"].isin(complete_eval_ids)].copy()

    if len(eval_complete) < 10:
        print(
            "Not enough outcomes for robust agreement analysis "
            f"(need >= 10, found {len(eval_complete)})."
        )
        return

    pivot = (
        model_complete.pivot_table(
            index="evaluation_id",
            columns="model_id",
            values="should_trade",
            aggfunc="first",
        )
        .reindex(columns=["claude", "gpt4o", "gemini"])
        .dropna()
    )

    scores = (
        model_complete.pivot_table(
            index="evaluation_id",
            columns="model_id",
            values="trade_score",
            aggfunc="first",
        )
        .reindex(columns=["claude", "gpt4o", "gemini"])
        .dropna()
    )

    agreement_df = pd.DataFrame(index=pivot.index)
    agreement_df["trade_votes"] = pivot.sum(axis=1).astype(int)
    agreement_df["agreement_category"] = agreement_df["trade_votes"].apply(_classify_agreement)

    outcome_cols = ["evaluation_id", "r_multiple", "ensemble_trade_score"]
    agreement_df = agreement_df.reset_index().merge(
        eval_complete[outcome_cols], on="evaluation_id", how="inner"
    )

    spread_df = scores.max(axis=1) - scores.min(axis=1)
    spread_df = spread_df.rename("score_spread").reset_index()
    agreement_df = agreement_df.merge(spread_df, on="evaluation_id", how="inner")
    agreement_df["win"] = (agreement_df["r_multiple"] > 0).astype(int)
    agreement_df["abs_r_multiple"] = agreement_df["r_multiple"].abs()

    summary = (
        agreement_df.groupby("agreement_category")
        .agg(
            win_rate=("win", "mean"),
            avg_r=("r_multiple", "mean"),
            avg_ensemble_score=("ensemble_trade_score", "mean"),
            count=("evaluation_id", "count"),
        )
        .reindex(CATEGORY_ORDER)
        .fillna(0)
    )

    print("\nAgreement vs Outcome")
    printable = summary.copy()
    printable["win_rate"] = printable["win_rate"].map(lambda v: f"{_pct(v):.1f}%")
    printable["avg_r"] = printable["avg_r"].map(lambda v: f"{v:.3f}")
    printable["avg_ensemble_score"] = printable["avg_ensemble_score"].map(lambda v: f"{v:.2f}")
    print(printable.to_string())

    spread_absr_corr = _safe_corr(agreement_df["score_spread"], agreement_df["abs_r_multiple"])
    spread_win_corr = _safe_corr(agreement_df["score_spread"], agreement_df["win"])

    print("\nScore Spread Correlations")
    print(f"spread vs abs(r_multiple): {spread_absr_corr}")
    print(f"spread vs win/loss: {spread_win_corr}")

    split_23 = agreement_df[agreement_df["trade_votes"] == 2][["evaluation_id", "win"]].merge(
        pivot.reset_index(), on="evaluation_id", how="inner"
    )

    dissenter_rows: list[dict[str, float | int | str]] = []
    for model in ["claude", "gpt4o", "gemini"]:
        if split_23.empty:
            dissenter_rows.append(
                {
                    "model": model,
                    "times_dissenting": 0,
                    "dissenter_correct_pct": 0.0,
                    "majority_correct_pct": 0.0,
                }
            )
            continue

        is_dissenter = split_23[model] == 0
        subset = split_23[is_dissenter].copy()

        if subset.empty:
            dissenter_rows.append(
                {
                    "model": model,
                    "times_dissenting": 0,
                    "dissenter_correct_pct": 0.0,
                    "majority_correct_pct": 0.0,
                }
            )
            continue

        subset["dissenter_correct"] = (subset[model] == subset["win"]).astype(int)
        subset["majority_correct"] = (1 == subset["win"]).astype(int)

        dissenter_rows.append(
            {
                "model": model,
                "times_dissenting": int(len(subset)),
                "dissenter_correct_pct": _pct(float(subset["dissenter_correct"].mean())),
                "majority_correct_pct": _pct(float(subset["majority_correct"].mean())),
            }
        )

    dissenter_df = pd.DataFrame(dissenter_rows)

    print("\nContrarian Accuracy (2/3 splits)")
    print(dissenter_df.to_string(index=False))

    chart_df = summary.reset_index()
    x = np.arange(len(chart_df))
    width = 0.38

    fig, ax = plt.subplots(figsize=(10, 6))
    ax.bar(
        x - width / 2,
        chart_df["win_rate"] * 100,
        width,
        label="Win Rate (%)",
        color="#10b981",
    )
    ax.bar(
        x + width / 2,
        chart_df["avg_r"],
        width,
        label="Avg R",
        color="#8b5cf6",
    )
    ax.set_title("Agreement Category vs Outcomes")
    ax.set_xticks(x)
    ax.set_xticklabels(chart_df["agreement_category"], rotation=20, ha="right")
    ax.set_ylabel("Win Rate (%) / Avg R")
    ax.legend()
    ax.grid(axis="y", alpha=0.25)
    fig.tight_layout()

    chart_path = OUTPUT_DIR / "agreement_chart.png"
    fig.savefig(chart_path, dpi=150)
    plt.close(fig)

    result = {
        "days": days,
        "sample_size": int(len(agreement_df)),
        "incomplete_evaluations_skipped": incomplete_evals,
        "agreement_vs_outcome": [
            {
                "category": str(idx),
                "win_rate": float(row["win_rate"]),
                "avg_r": float(row["avg_r"]),
                "avg_ensemble_score": float(row["avg_ensemble_score"]),
                "count": int(row["count"]),
            }
            for idx, row in summary.iterrows()
        ],
        "spread_correlations": {
            "spread_vs_abs_r_multiple": spread_absr_corr,
            "spread_vs_win_loss": spread_win_corr,
        },
        "contrarian_accuracy": dissenter_rows,
    }

    json_path = OUTPUT_DIR / "agreement_analysis.json"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2)

    print(f"\nSaved JSON: {json_path}")
    print(f"Saved chart: {chart_path}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Model agreement analysis")
    parser.add_argument("--days", type=int, default=90, help="Lookback window in days")
    args = parser.parse_args()
    run(days=args.days)


if __name__ == "__main__":
    main()
