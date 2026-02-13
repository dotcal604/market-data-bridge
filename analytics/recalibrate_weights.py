"""Auto-tune ensemble weights from recent scored trade outcomes."""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

# Ensure analytics/ is on sys.path for bare imports when run from project root
sys.path.insert(0, str(Path(__file__).resolve().parent))

from db_loader import ANALYTICS_DIR, load_evaluations, load_model_outcomes, load_weights, save_weights

MODEL_IDS: tuple[str, ...] = ("claude", "gpt4o", "gemini")
MIN_SAMPLE_SIZE = 50
OUTPUT_DIR = ANALYTICS_DIR / "output"
AUDIT_LOG_PATH = OUTPUT_DIR / "weight_updates.jsonl"


def _safe_mean(series: pd.Series) -> float:
    if series.empty:
        return 0.0
    return float(series.mean())


def compute_model_metrics(df: pd.DataFrame) -> dict[str, dict[str, float | int]]:
    """Compute requested per-model metrics from compliant rows."""
    metrics: dict[str, dict[str, float | int]] = {}

    for model_id in MODEL_IDS:
        model_all = df[df["model_id"] == model_id].copy()
        compliant_df = model_all[model_all["compliant"] == 1].copy()

        compliant_count = int(len(compliant_df))
        if compliant_count == 0:
            metrics[model_id] = {
                "compliant_count": 0,
                "trade_prediction_count": 0,
                "accuracy": 0.0,
                "brier": 1.0,
                "avg_r": 0.0,
                "avg_score_on_wins": 0.0,
                "avg_score_on_losses": 0.0,
                "discrimination": 0.0,
                "discrimination_ratio": 0.0,
                "model_score": 0.0,
            }
            continue

        trade_predictions = compliant_df[compliant_df["should_trade"] == 1].copy()
        win_series = (compliant_df["r_multiple"] > 0).astype(float)

        predicted_trade_wins = trade_predictions[trade_predictions["r_multiple"] > 0]
        trade_count = int(len(trade_predictions))
        accuracy = float(len(predicted_trade_wins) / trade_count) if trade_count > 0 else 0.0

        probs = compliant_df["confidence"].astype(float).clip(lower=0.0, upper=100.0) / 100.0
        brier = float(np.mean((probs - win_series) ** 2))

        avg_r = _safe_mean(trade_predictions["r_multiple"].astype(float))

        wins = compliant_df[compliant_df["r_multiple"] > 0]
        losses = compliant_df[compliant_df["r_multiple"] <= 0]

        avg_score_on_wins = _safe_mean(wins["trade_score"].astype(float))
        avg_score_on_losses = _safe_mean(losses["trade_score"].astype(float))

        discrimination = avg_score_on_wins - avg_score_on_losses
        discrimination_ratio = avg_score_on_wins / max(avg_score_on_losses, 1.0)
        model_score = max(0.0, (1.0 - brier) * discrimination_ratio)

        metrics[model_id] = {
            "compliant_count": compliant_count,
            "trade_prediction_count": trade_count,
            "accuracy": accuracy,
            "brier": brier,
            "avg_r": avg_r,
            "avg_score_on_wins": avg_score_on_wins,
            "avg_score_on_losses": avg_score_on_losses,
            "discrimination": discrimination,
            "discrimination_ratio": discrimination_ratio,
            "model_score": model_score,
        }

    return metrics


def normalize_weights(metrics: dict[str, dict[str, float | int]]) -> dict[str, float]:
    """Normalize non-negative model scores to a valid weight vector."""
    raw = {model_id: float(metrics[model_id]["model_score"]) for model_id in MODEL_IDS}
    total = sum(raw.values())

    if total <= 0:
        zero_compliant = [model_id for model_id in MODEL_IDS if int(metrics[model_id]["compliant_count"]) == 0]
        active = [model_id for model_id in MODEL_IDS if model_id not in zero_compliant]

        if not active:
            return {model_id: 1.0 / len(MODEL_IDS) for model_id in MODEL_IDS}

        even_weight = 1.0 / len(active)
        weights: dict[str, float] = {}
        for model_id in MODEL_IDS:
            weights[model_id] = 0.0 if model_id in zero_compliant else even_weight
        return weights

    normalized = {model_id: raw[model_id] / total for model_id in MODEL_IDS}

    # Remove tiny floating error by re-normalizing.
    norm_total = sum(normalized.values())
    if norm_total > 0:
        normalized = {model_id: value / norm_total for model_id, value in normalized.items()}

    return normalized


def compute_k(sample_df: pd.DataFrame, days: int) -> tuple[float, float]:
    """Compute disagreement penalty k based on spread-to-outcome correlation."""
    evals = load_evaluations(days=days)
    spread = evals[["id", "ensemble_score_spread"]].copy()

    merged = sample_df[["evaluation_id", "r_multiple"]].drop_duplicates().merge(
        spread,
        how="left",
        left_on="evaluation_id",
        right_on="id",
    )

    merged = merged.dropna(subset=["ensemble_score_spread", "r_multiple"])
    if len(merged) < 2:
        return 0.0, 1.0

    corr = float(merged["ensemble_score_spread"].corr(merged["r_multiple"]))
    if np.isnan(corr):
        corr = 0.0

    k = float(np.clip(1.0 + 2.0 * abs(corr), 0.5, 5.0))
    return corr, k


def print_comparison(
    current_weights: dict,
    proposed_weights: dict[str, float],
    metrics: dict[str, dict[str, float | int]],
    current_k: float,
    proposed_k: float,
    sample_size: int,
) -> None:
    print("Model   | Current | Proposed | Delta   | Accuracy | Brier  | Avg R")
    for model_id in MODEL_IDS:
        current = float(current_weights.get(model_id, 0.0))
        proposed = float(proposed_weights[model_id])
        delta = proposed - current
        accuracy = float(metrics[model_id]["accuracy"])
        brier = float(metrics[model_id]["brier"])
        avg_r = float(metrics[model_id]["avg_r"])

        print(
            f"{model_id:<7} | {current:>7.3f} | {proposed:>8.3f} | {delta:+7.3f} | "
            f"{accuracy * 100:>7.1f}% | {brier:>6.3f} | {avg_r:+6.2f}"
        )

    print()
    print(f"Current k: {current_k:.2f} → Proposed k: {proposed_k:.2f}")
    print(f"Sample size: {sample_size} scored trades")


def append_audit(
    old_weights: dict,
    new_payload: dict,
    metrics_per_model: dict[str, dict[str, float | int]],
    sample_size: int,
) -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    record = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "old_weights": old_weights,
        "new_weights": new_payload,
        "metrics_per_model": metrics_per_model,
        "sample_size": sample_size,
    }

    with open(AUDIT_LOG_PATH, "a", encoding="utf-8") as f:
        f.write(json.dumps(record) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser(description="Recalibrate ensemble model weights from scored outcomes.")
    parser.add_argument("--apply", action="store_true", help="Persist proposed weights to data/weights.json")
    parser.add_argument("--days", type=int, default=180, help="Lookback window in days (default: 180)")
    args = parser.parse_args()

    outcomes = load_model_outcomes(days=args.days)
    outcomes = outcomes[outcomes["r_multiple"].notna()].copy()

    sample_size = int(outcomes["evaluation_id"].nunique())
    current_weights = load_weights()

    metrics = compute_model_metrics(outcomes)
    proposed_weights = normalize_weights(metrics)

    corr, proposed_k = compute_k(outcomes, days=args.days)
    current_k = float(current_weights.get("k", 1.5))

    print_comparison(
        current_weights=current_weights,
        proposed_weights=proposed_weights,
        metrics=metrics,
        current_k=current_k,
        proposed_k=proposed_k,
        sample_size=sample_size,
    )
    print(f"Spread/R correlation: {corr:+.4f}")

    if not args.apply:
        print("\nDry run only. Re-run with --apply to save updated weights.")
        return

    if sample_size < MIN_SAMPLE_SIZE:
        print(f"\nRefusing to apply: sample size {sample_size} is below minimum {MIN_SAMPLE_SIZE}.")
        sys.exit(1)

    payload = {
        "claude": float(proposed_weights["claude"]),
        "gpt4o": float(proposed_weights["gpt4o"]),
        "gemini": float(proposed_weights["gemini"]),
        "k": float(proposed_k),
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "sample_size": sample_size,
        "source": "recalibration",
    }

    save_weights(payload)
    append_audit(
        old_weights=current_weights,
        new_payload=payload,
        metrics_per_model=metrics,
        sample_size=sample_size,
    )

    print("\nApplied new weights to data/weights.json")
    print(f"Appended audit record: {AUDIT_LOG_PATH}")


if __name__ == "__main__":
    main()
