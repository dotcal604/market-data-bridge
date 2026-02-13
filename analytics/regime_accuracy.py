"""Regime-conditioned win-rate analysis.

Analyzes completed outcomes by:
- volatility regime extracted from evaluations.features_json
- time of day bucket derived from evaluation timestamp in Eastern Time

Outputs:
- Console summary tables (with sample sizes)
- CSV: analytics/output/regime_accuracy.csv
- Heatmap: analytics/output/regime_heatmap.png
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

# Ensure analytics/ is on sys.path for bare imports when run from project root
sys.path.insert(0, str(Path(__file__).resolve().parent))

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import pandas as pd
import seaborn as sns

import db_loader

OUTPUT_DIR = Path(__file__).resolve().parent / "output"
CSV_PATH = OUTPUT_DIR / "regime_accuracy.csv"
HEATMAP_PATH = OUTPUT_DIR / "regime_heatmap.png"

VOLATILITY_ORDER = ["low_vol", "normal", "high_vol"]
TIME_OF_DAY_ORDER = ["morning", "midday", "afternoon"]


def _parse_features(features_json: str | None) -> dict:
    if not features_json:
        return {}
    try:
        parsed = json.loads(features_json)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _derive_time_of_day_et(ts: pd.Timestamp) -> str | None:
    if pd.isna(ts):
        return None

    timestamp = pd.Timestamp(ts)
    if timestamp.tzinfo is None:
        timestamp = timestamp.tz_localize("UTC")

    et = timestamp.tz_convert("America/New_York")
    minutes = et.hour * 60 + et.minute

    market_open = 9 * 60 + 30
    morning_end = 11 * 60
    midday_end = 14 * 60
    afternoon_end = 16 * 60

    if market_open <= minutes < morning_end:
        return "morning"
    if morning_end <= minutes < midday_end:
        return "midday"
    if midday_end <= minutes <= afternoon_end:
        return "afternoon"
    return None


def load_regime_dataset() -> pd.DataFrame:
    """Load evaluation/model data with outcomes and extracted feature fields."""
    db_loader.DB_PATH = db_loader.DATA_DIR / "market-data-bridge.db"
    conn = db_loader._connect()

    df = pd.read_sql_query(
        """
        SELECT
          e.id AS evaluation_id,
          e.timestamp,
          e.ensemble_trade_score AS ensemble_score,
          e.features_json,
          o.r_multiple,
          m.model_id
        FROM evaluations e
        JOIN outcomes o ON o.evaluation_id = e.id
        JOIN model_outputs m ON m.evaluation_id = e.id
        WHERE o.trade_taken = 1
          AND o.r_multiple IS NOT NULL
        ORDER BY e.timestamp DESC
        """,
        conn,
        parse_dates=["timestamp"],
    )
    conn.close()

    if df.empty:
        return df

    # model_outputs is one-to-many, dedupe to one row/evaluation
    df = df.drop_duplicates(subset=["evaluation_id"])

    parsed = df["features_json"].apply(_parse_features)
    df["volatility_regime"] = parsed.apply(lambda x: x.get("volatility_regime"))
    df["relative_volume"] = pd.to_numeric(
        parsed.apply(lambda x: x.get("relative_volume")), errors="coerce"
    )

    df["time_of_day"] = df["timestamp"].apply(_derive_time_of_day_et)
    df["outcome"] = (df["r_multiple"] > 0).astype(int)

    return df


def summarize(df: pd.DataFrame) -> pd.DataFrame:
    filtered = df[
        df["volatility_regime"].isin(VOLATILITY_ORDER)
        & df["time_of_day"].isin(TIME_OF_DAY_ORDER)
    ].copy()

    grouped = (
        filtered.groupby(["volatility_regime", "time_of_day"], as_index=False)
        .agg(
            samples=("outcome", "count"),
            wins=("outcome", "sum"),
            win_rate=("outcome", "mean"),
            avg_ensemble_score=("ensemble_score", "mean"),
            avg_relative_volume=("relative_volume", "mean"),
        )
    )
    grouped["win_rate"] = grouped["win_rate"] * 100.0
    return grouped


def print_tables(summary_df: pd.DataFrame) -> None:
    if summary_df.empty:
        print("No completed trade outcomes available for regime accuracy analysis.")
        return

    display = summary_df.copy()
    display["win_rate"] = display["win_rate"].map(lambda v: f"{v:.1f}%")
    display["avg_ensemble_score"] = display["avg_ensemble_score"].map(lambda v: f"{v:.2f}")
    display["avg_relative_volume"] = display["avg_relative_volume"].map(
        lambda v: "-" if pd.isna(v) else f"{v:.2f}"
    )

    print("\nRegime × Time-of-Day Win Rate Summary")
    print(
        display[
            [
                "volatility_regime",
                "time_of_day",
                "samples",
                "wins",
                "win_rate",
                "avg_ensemble_score",
                "avg_relative_volume",
            ]
        ].to_string(index=False)
    )

    pivot_rates = summary_df.pivot(
        index="volatility_regime", columns="time_of_day", values="win_rate"
    ).reindex(index=VOLATILITY_ORDER, columns=TIME_OF_DAY_ORDER)
    pivot_counts = summary_df.pivot(
        index="volatility_regime", columns="time_of_day", values="samples"
    ).reindex(index=VOLATILITY_ORDER, columns=TIME_OF_DAY_ORDER)

    print("\nWin Rate Matrix (%)")
    print(pivot_rates.round(1).fillna("-").to_string())

    print("\nSample Size Matrix")
    print(pivot_counts.fillna(0).astype(int).to_string())


def save_heatmap(summary_df: pd.DataFrame) -> None:
    heatmap_data = summary_df.pivot(
        index="volatility_regime", columns="time_of_day", values="win_rate"
    ).reindex(index=VOLATILITY_ORDER, columns=TIME_OF_DAY_ORDER)

    count_data = summary_df.pivot(
        index="volatility_regime", columns="time_of_day", values="samples"
    ).reindex(index=VOLATILITY_ORDER, columns=TIME_OF_DAY_ORDER)

    annotations = heatmap_data.copy()
    for row in heatmap_data.index:
        for col in heatmap_data.columns:
            rate = heatmap_data.loc[row, col]
            n = count_data.loc[row, col]
            if pd.isna(rate):
                annotations.loc[row, col] = "n=0"
            else:
                annotations.loc[row, col] = f"{rate:.1f}%\nn={int(n)}"

    plt.figure(figsize=(8, 5))
    sns.heatmap(
        heatmap_data,
        annot=annotations,
        fmt="",
        cmap="RdYlGn",
        vmin=0,
        vmax=100,
        linewidths=0.5,
        cbar_kws={"label": "Win Rate (%)"},
    )
    plt.title("Win Rate by Volatility Regime × Time of Day")
    plt.xlabel("Time of Day (ET)")
    plt.ylabel("Volatility Regime")
    plt.tight_layout()
    plt.savefig(HEATMAP_PATH, dpi=160)
    plt.close()


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    df = load_regime_dataset()
    if df.empty:
        print("No data found. Nothing to export.")
        return

    total_outcomes = int(df["outcome"].count())
    if total_outcomes < 50:
        print(f"WARNING: only {total_outcomes} outcomes found (<50). Results may be noisy.")

    summary_df = summarize(df)
    print_tables(summary_df)

    summary_df.to_csv(CSV_PATH, index=False)
    save_heatmap(summary_df)

    print(f"\nSaved CSV: {CSV_PATH}")
    print(f"Saved heatmap: {HEATMAP_PATH}")


if __name__ == "__main__":
    main()
