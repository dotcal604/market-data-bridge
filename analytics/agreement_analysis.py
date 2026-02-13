"""Agreement analysis by model direction and outcome.

Loads model scores from SQLite, classifies direction per model, computes
agreement buckets, and reports win rate by agreement type.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import pandas as pd

from db_loader import _connect

OUTPUT_DIR = Path(__file__).resolve().parent / "output"
OUTPUT_PATH = OUTPUT_DIR / "agreement_analysis.csv"


def classify_direction(score: float) -> str:
    """Map score to directional label."""
    if score > 60:
        return "bullish"
    if score < 40:
        return "bearish"
    return "neutral"


def classify_agreement(row: pd.Series) -> str:
    """Classify agreement type across three model directions."""
    directions = [row["claude_direction"], row["gpt_direction"], row["gemini_direction"]]
    unique = len(set(directions))
    if unique == 1:
        return "unanimous"
    if unique == 2:
        return "majority"
    return "split"


def outcome_to_win_value(outcome: str) -> float:
    """Convert outcome string to numeric win value."""
    mapping = {
        "WIN": 1.0,
        "LOSS": 0.0,
        "SCRATCH": 0.5,
    }
    normalized = str(outcome).upper()
    return mapping.get(normalized, float("nan"))


def load_agreement_source(days: int) -> pd.DataFrame:
    """Load per-evaluation model scores + outcome from SQLite."""
    conn = _connect()
    df = pd.read_sql_query(
        """
        SELECT
            e.id AS evaluation_id,
            e.timestamp,
            e.symbol,
            MAX(CASE WHEN m.model_id = 'claude' THEN m.trade_score END) AS claude_score,
            MAX(CASE WHEN m.model_id = 'gpt4o' THEN m.trade_score END) AS gpt_score,
            MAX(CASE WHEN m.model_id = 'gemini' THEN m.trade_score END) AS gemini_score,
            CASE
                WHEN o.r_multiple > 0 THEN 'WIN'
                WHEN o.r_multiple < 0 THEN 'LOSS'
                ELSE 'SCRATCH'
            END AS outcome
        FROM evaluations e
        JOIN model_outputs m ON m.evaluation_id = e.id
        JOIN outcomes o ON o.evaluation_id = e.id
        WHERE e.timestamp >= datetime('now', ? || ' days')
          AND o.trade_taken = 1
          AND o.r_multiple IS NOT NULL
        GROUP BY e.id, e.timestamp, e.symbol, o.r_multiple
        ORDER BY e.timestamp DESC
        """,
        conn,
        params=[f"-{days}"],
        parse_dates=["timestamp"],
    )
    conn.close()
    return df


def run(days: int) -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    source_df = load_agreement_source(days=days)
    if source_df.empty:
        print(f"No rows found in the last {days} days.")
        return

    df = source_df.dropna(subset=["claude_score", "gpt_score", "gemini_score"]).copy()
    skipped = len(source_df) - len(df)

    if df.empty:
        print("No complete rows found after skipping NULL model scores.")
        return

    df["claude_direction"] = df["claude_score"].map(classify_direction)
    df["gpt_direction"] = df["gpt_score"].map(classify_direction)
    df["gemini_direction"] = df["gemini_score"].map(classify_direction)
    df["agreement_type"] = df.apply(classify_agreement, axis=1)
    df["win_value"] = df["outcome"].map(outcome_to_win_value)

    df = df[df["win_value"].notna()].copy()

    summary = (
        df.groupby("agreement_type", as_index=False)
        .agg(
            evaluations=("evaluation_id", "count"),
            win_rate=("win_value", "mean"),
        )
        .sort_values("agreement_type")
    )

    summary["win_rate_pct"] = (summary["win_rate"] * 100.0).round(2)

    print("\nAgreement Analysis Summary")
    print(summary[["agreement_type", "evaluations", "win_rate_pct"]].to_string(index=False))
    print(f"\nRows skipped due to NULL score(s): {skipped}")

    summary.to_csv(OUTPUT_PATH, index=False)
    print(f"Saved CSV: {OUTPUT_PATH}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Agreement analysis by model direction")
    parser.add_argument("--days", type=int, default=90, help="Lookback window in days")
    args = parser.parse_args()
    run(days=args.days)


if __name__ == "__main__":
    main()
