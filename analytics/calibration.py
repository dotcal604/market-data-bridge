"""Confidence calibration analysis for Market Data Bridge models and ensemble."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

# Ensure analytics/ is on sys.path for bare imports when run from project root
sys.path.insert(0, str(Path(__file__).resolve().parent))

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np
import pandas as pd

from db_loader import load_eval_outcomes, load_model_outcomes

OUTPUT_DIR = Path(__file__).resolve().parent / "output"
MODEL_IDS: tuple[str, ...] = ("claude", "gpt4o", "gemini")


def outcome_from_r_multiple(r_multiple: pd.Series) -> pd.Series:
    """Convert R-multiple to binary win outcome (1=win, 0=loss/breakeven)."""
    return (r_multiple > 0).astype(int)


def brier_score(confidence: pd.Series, outcome: pd.Series) -> float:
    """Compute Brier score using confidence in [0, 100] and binary outcomes."""
    probs = confidence.astype(float) / 100.0
    return float(np.mean((probs - outcome.astype(float)) ** 2))


def calibration_buckets(
    confidence: pd.Series,
    outcome: pd.Series,
) -> pd.DataFrame:
    """Build 10 confidence buckets with actual win-rate and count."""
    conf = confidence.astype(float).clip(lower=0, upper=100)
    bucket_index = np.floor(conf / 10).astype(int).clip(0, 9)

    bucket_df = pd.DataFrame({"bucket": bucket_index, "outcome": outcome.astype(int)})
    grouped = (
        bucket_df.groupby("bucket", as_index=False)
        .agg(count=("outcome", "size"), win_rate=("outcome", "mean"))
        .set_index("bucket")
    )

    rows: list[dict[str, float | int | str | None]] = []
    for bucket in range(10):
        start = bucket * 10
        end = (bucket + 1) * 10
        label = f"[{start}-{end})" if bucket < 9 else "[90-100]"
        if bucket in grouped.index:
            count = int(grouped.loc[bucket, "count"])
            win_rate = float(grouped.loc[bucket, "win_rate"])
        else:
            count = 0
            win_rate = np.nan
        rows.append(
            {
                "bucket": bucket,
                "label": label,
                "predicted_confidence": float(start + 5),
                "count": count,
                "actual_win_rate": None if np.isnan(win_rate) else win_rate,
            }
        )

    return pd.DataFrame(rows)


def plot_calibration_curve(buckets: pd.DataFrame, title: str, output_path: Path) -> None:
    """Plot calibration curve with count bars on a secondary axis."""
    x = buckets["predicted_confidence"].to_numpy(dtype=float)
    win_rates = pd.to_numeric(buckets["actual_win_rate"], errors="coerce").to_numpy(dtype=float)
    counts = buckets["count"].to_numpy(dtype=float)

    fig, ax1 = plt.subplots(figsize=(10, 6))
    ax2 = ax1.twinx()

    ax2.bar(x, counts, width=8.5, alpha=0.2, color="tab:blue", label="Observation count")

    valid = ~np.isnan(win_rates)
    ax1.plot([0, 100], [0, 1], "k--", linewidth=1.2, label="Perfect calibration")
    ax1.plot(x[valid], win_rates[valid], marker="o", linewidth=2, color="tab:orange", label="Actual win rate")

    ax1.set_xlim(0, 100)
    ax1.set_ylim(0, 1)
    ax1.set_xlabel("Predicted confidence (%)")
    ax1.set_ylabel("Actual win rate")
    ax2.set_ylabel("Observation count")
    ax1.set_title(title)

    lines1, labels1 = ax1.get_legend_handles_labels()
    lines2, labels2 = ax2.get_legend_handles_labels()
    ax1.legend(lines1 + lines2, labels1 + labels2, loc="best")

    fig.tight_layout()
    fig.savefig(output_path, dpi=150)
    plt.close(fig)


def plot_model_calibration(
    model_bucket_map: dict[str, pd.DataFrame],
    output_path: Path,
) -> None:
    """Render per-model calibration curves in 3 stacked subplots."""
    fig, axes = plt.subplots(3, 1, figsize=(10, 14), sharex=True)

    for ax, model_id in zip(axes, MODEL_IDS):
        buckets = model_bucket_map.get(model_id)
        if buckets is None or buckets.empty:
            ax.text(0.5, 0.5, "No compliant predictions", ha="center", va="center")
            ax.set_title(model_id)
            ax.set_ylim(0, 1)
            ax.set_xlim(0, 100)
            continue

        x = buckets["predicted_confidence"].to_numpy(dtype=float)
        win_rates = pd.to_numeric(buckets["actual_win_rate"], errors="coerce").to_numpy(dtype=float)
        counts = buckets["count"].to_numpy(dtype=float)
        valid = ~np.isnan(win_rates)

        ax2 = ax.twinx()
        ax2.bar(x, counts, width=8.5, alpha=0.2, color="tab:blue")

        ax.plot([0, 100], [0, 1], "k--", linewidth=1)
        ax.plot(x[valid], win_rates[valid], marker="o", linewidth=2, color="tab:orange")
        ax.set_title(model_id)
        ax.set_ylabel("Win rate")
        ax2.set_ylabel("Count")
        ax.set_ylim(0, 1)
        ax.set_xlim(0, 100)

    axes[-1].set_xlabel("Predicted confidence (%)")
    fig.suptitle("Calibration Curves by Model", y=0.995)
    fig.tight_layout()
    fig.savefig(output_path, dpi=150)
    plt.close(fig)


def main() -> None:
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    eval_outcomes = load_eval_outcomes(days=90)
    eval_outcomes = eval_outcomes[eval_outcomes["r_multiple"].notna()].copy()

    scored_trades = len(eval_outcomes)
    if scored_trades < 50:
        print(f"WARNING: Only {scored_trades} scored trades available (< 50). Calibration may be noisy.")

    if scored_trades == 0:
        print("No scored trades found. Exiting without generating calibration outputs.")
        return

    model_outcomes = load_model_outcomes(days=90)
    model_outcomes = model_outcomes[
        (model_outcomes["r_multiple"].notna()) & (model_outcomes["compliant"].astype(bool))
    ].copy()

    ensemble_outcome = outcome_from_r_multiple(eval_outcomes["r_multiple"])
    ensemble_brier = brier_score(eval_outcomes["ensemble_confidence"], ensemble_outcome)

    brier_scores: dict[str, float | None] = {
        "claude": None,
        "gpt4o": None,
        "gemini": None,
        "ensemble": ensemble_brier,
    }
    model_bucket_map: dict[str, pd.DataFrame] = {}

    for model_id in MODEL_IDS:
        model_df = model_outcomes[model_outcomes["model_id"] == model_id].copy()
        if model_df.empty:
            print(f"WARNING: No compliant predictions for {model_id}; skipping model-level metrics.")
            continue

        model_target = outcome_from_r_multiple(model_df["r_multiple"])
        model_brier = brier_score(model_df["confidence"], model_target)
        brier_scores[model_id] = model_brier
        model_bucket_map[model_id] = calibration_buckets(model_df["confidence"], model_target)

    ensemble_buckets = calibration_buckets(eval_outcomes["ensemble_confidence"], ensemble_outcome)

    for key in ["claude", "gpt4o", "gemini", "ensemble"]:
        value = brier_scores[key]
        if value is None:
            print(f"Brier score ({key}): N/A")
        else:
            print(f"Brier score ({key}): {value:.6f}")

    output_json = {
        "buckets": ensemble_buckets.to_dict(orient="records"),
        "brier_scores": brier_scores,
    }

    calibration_json_path = OUTPUT_DIR / "calibration.json"
    with open(calibration_json_path, "w", encoding="utf-8") as f:
        json.dump(output_json, f, indent=2)

    plot_calibration_curve(
        ensemble_buckets,
        title="Ensemble Confidence Calibration",
        output_path=OUTPUT_DIR / "calibration_curve.png",
    )

    plot_model_calibration(
        model_bucket_map=model_bucket_map,
        output_path=OUTPUT_DIR / "calibration_by_model.png",
    )

    print(f"Saved: {calibration_json_path}")
    print(f"Saved: {OUTPUT_DIR / 'calibration_curve.png'}")
    print(f"Saved: {OUTPUT_DIR / 'calibration_by_model.png'}")


if __name__ == "__main__":
    main()
