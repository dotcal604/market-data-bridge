"""Calibration analysis for model and ensemble scores."""

from __future__ import annotations

import sys
from pathlib import Path

# Ensure analytics/ is on sys.path for bare imports when run from project root
sys.path.insert(0, str(Path(__file__).resolve().parent))

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np
import pandas as pd

from db_loader import ANALYTICS_DIR, _connect

OUTPUT_DIR = ANALYTICS_DIR / "output"
CSV_PATH = OUTPUT_DIR / "calibration_scores.csv"
PLOT_PATH = OUTPUT_DIR / "calibration_plot.png"

MODEL_COLUMNS: dict[str, str] = {
    "claude": "claude_score",
    "gpt": "gpt_score",
    "gemini": "gemini_score",
    "ensemble": "ensemble_score",
}

OUTCOME_MAP: dict[str, float] = {
    "WIN": 1.0,
    "LOSS": 0.0,
    "SCRATCH": 0.5,
}


def load_calibration_rows() -> pd.DataFrame:
    """Load one row per evaluation with all four model score columns + outcome."""
    conn = _connect()
    df = pd.read_sql_query(
        """
        SELECT
          e.id AS evaluation_id,
          MAX(CASE WHEN m.model_id = 'claude' THEN m.trade_score END) AS claude_score,
          MAX(CASE WHEN m.model_id = 'gpt4o' THEN m.trade_score END) AS gpt_score,
          MAX(CASE WHEN m.model_id = 'gemini' THEN m.trade_score END) AS gemini_score,
          e.ensemble_trade_score AS ensemble_score,
          CASE
            WHEN o.r_multiple > 0 THEN 'WIN'
            WHEN o.r_multiple < 0 THEN 'LOSS'
            ELSE 'SCRATCH'
          END AS outcome
        FROM evaluations e
        JOIN model_outputs m ON m.evaluation_id = e.id
        JOIN outcomes o ON o.evaluation_id = e.id
        WHERE o.trade_taken = 1
          AND o.r_multiple IS NOT NULL
        GROUP BY e.id, e.ensemble_trade_score, outcome
        ORDER BY e.timestamp ASC
        """,
        conn,
    )
    conn.close()
    return df


def brier_score(predicted: pd.Series, actual: pd.Series) -> float:
    """Compute mean squared error between predicted probabilities and actual outcomes."""
    return float(np.mean((predicted - actual) ** 2))


def reliability_points(predicted: pd.Series, actual: pd.Series, bins: int = 10) -> pd.DataFrame:
    """Aggregate mean predicted/actual values inside probability bins."""
    boundaries = np.linspace(0.0, 1.0, bins + 1)
    binned = pd.cut(predicted, bins=boundaries, include_lowest=True)
    points = (
        pd.DataFrame({"predicted": predicted, "actual": actual, "bin": binned})
        .groupby("bin", observed=False)
        .agg(mean_predicted=("predicted", "mean"), mean_actual=("actual", "mean"), n=("actual", "size"))
        .reset_index(drop=True)
    )
    return points.dropna(subset=["mean_predicted", "mean_actual"])


def plot_reliability(reliability: dict[str, pd.DataFrame]) -> None:
    """Plot calibration reliability diagram for all models."""
    fig, ax = plt.subplots(figsize=(10, 6))
    color_map = {
        "claude": "#8b5cf6",
        "gpt": "#10b981",
        "gemini": "#f59e0b",
        "ensemble": "#3b82f6",
    }

    for model, points in reliability.items():
        if points.empty:
            continue
        ax.plot(
            points["mean_predicted"],
            points["mean_actual"],
            marker="o",
            linewidth=2,
            label=model,
            color=color_map[model],
        )

    ax.plot([0, 1], [0, 1], linestyle="--", color="black", linewidth=1.25, label="perfect calibration")
    ax.set_title("Calibration Reliability Diagram")
    ax.set_xlabel("Predicted probability")
    ax.set_ylabel("Observed outcome rate")
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.grid(alpha=0.25)
    ax.legend()

    fig.tight_layout()
    fig.savefig(PLOT_PATH, dpi=150)
    plt.close(fig)


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    df = load_calibration_rows()
    if df.empty:
        print("No outcomes with model scores found. Nothing to calibrate.")
        return

    df["actual"] = df["outcome"].map(OUTCOME_MAP)
    df = df.dropna(subset=["actual"]).copy()

    if len(df) < 30:
        print(f"WARNING: Only {len(df)} outcomes available (<30). Calibration may be noisy.")

    for col in MODEL_COLUMNS.values():
        df[col] = pd.to_numeric(df[col], errors="coerce") / 100.0

    score_rows: list[dict[str, float | int | str]] = []
    reliability: dict[str, pd.DataFrame] = {}

    for model, col in MODEL_COLUMNS.items():
        subset = df[[col, "actual"]].dropna().copy()
        subset[col] = subset[col].clip(lower=0.0, upper=1.0)
        n_samples = int(len(subset))

        if n_samples == 0:
            score_rows.append({"model": model, "brier_score": np.nan, "n_samples": 0})
            reliability[model] = pd.DataFrame(columns=["mean_predicted", "mean_actual", "n"])
            continue

        score_rows.append(
            {
                "model": model,
                "brier_score": brier_score(subset[col], subset["actual"]),
                "n_samples": n_samples,
            }
        )
        reliability[model] = reliability_points(subset[col], subset["actual"], bins=10)

    scores_df = pd.DataFrame(score_rows)
    print(scores_df.to_string(index=False, float_format=lambda x: f"{x:.6f}"))

    scores_df.to_csv(CSV_PATH, index=False)
    plot_reliability(reliability)

    print(f"Saved: {CSV_PATH}")
    print(f"Saved: {PLOT_PATH}")


if __name__ == "__main__":
    main()
