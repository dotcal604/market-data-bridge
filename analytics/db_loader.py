"""
Database loader for Market Data Bridge analytics.

Connects to the SQLite database (data/market-data-bridge.db) and returns DataFrames
ready for analysis. All analytics scripts should import from here.

Usage:
    from db_loader import load_eval_outcomes, load_model_outputs, load_weights, DB_PATH
"""

import json
import sqlite3
from pathlib import Path
from typing import Optional, Type

import pandas as pd
from pydantic import BaseModel

try:
    from .schema import Evaluation, ModelOutput, Outcome, WeightHistory
except ImportError:
    # Allow running this script directly for testing
    from schema import Evaluation, ModelOutput, Outcome, WeightHistory


# ── Paths ────────────────────────────────────────────────────────────────────

ANALYTICS_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = ANALYTICS_DIR.parent
DATA_DIR = PROJECT_ROOT / "data"
DB_PATH = DATA_DIR / "market-data-bridge.db"
LEGACY_DB_PATH = DATA_DIR / "bridge.db"
WEIGHTS_PATH = DATA_DIR / "weights.json"


def _resolve_db_path() -> Path:
    """Resolve analytics DB path, preferring market-data-bridge.db."""
    if DB_PATH.exists():
        return DB_PATH
    if LEGACY_DB_PATH.exists():
        return LEGACY_DB_PATH
    return DB_PATH


def _connect() -> sqlite3.Connection:
    """Open a read-only connection to the analytics SQLite DB."""
    db_path = _resolve_db_path()
    if not db_path.exists():
        raise FileNotFoundError(
            f"Database not found at {db_path}. "
            "Start the server at least once to create it."
        )
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


# ── Validation ───────────────────────────────────────────────────────────────

def validate_schema(df: pd.DataFrame, model: Type[BaseModel], exclude: list[str] = None, strict: bool = True):
    """
    Validate that DataFrame columns match the Pydantic model fields.

    Args:
        df: DataFrame to validate
        model: Pydantic model class
        exclude: List of columns to ignore (expected to be missing)
        strict: If True, warns if non-excluded model fields are missing in DataFrame.
    """
    if df.empty:
        return

    if exclude is None:
        exclude = []

    df_cols = set(df.columns)
    model_fields = set(model.model_fields.keys())

    # Expected fields are model fields minus excluded ones
    expected_fields = model_fields - set(exclude)

    # Check for missing columns
    missing = expected_fields - df_cols
    if strict and missing:
        print(f"Warning: DataFrame is missing columns required by {model.__name__}: {missing}")

    # We could also check for extra columns, but joined queries usually have extra columns
    # from other tables, so we skip that check by default.


def _build_select_cols(model: Type[BaseModel], exclude: list[str] = None) -> str:
    """Helper to build SELECT clause from Pydantic model fields."""
    if exclude is None:
        exclude = []
    cols = [c for c in model.model_fields.keys() if c not in exclude]
    return ", ".join(cols)


# ── Weights ──────────────────────────────────────────────────────────────────

def load_weights() -> dict:
    """Load current ensemble weights from data/weights.json."""
    with open(WEIGHTS_PATH) as f:
        return json.load(f)


def save_weights(weights: dict) -> None:
    """Write updated weights to data/weights.json (for recalibration script)."""
    with open(WEIGHTS_PATH, "w") as f:
        json.dump(weights, f, indent=2)


def insert_weight_history(weights: dict, reason: str | None = None) -> None:
    """
    Insert a weight history record into the database.
    
    Args:
        weights: Dictionary with claude, gpt4o, gemini, k, sample_size, source, etc.
        reason: Description of why weights changed (e.g., "recalibration")
    """
    conn = sqlite3.connect(DB_PATH)
    try:
        sample_size = weights.get("sample_size")
        conn.execute(
            """
            INSERT INTO weight_history (weights_json, sample_size, reason, created_at)
            VALUES (?, ?, ?, datetime('now'))
            """,
            (json.dumps(weights), sample_size, reason)
        )
        conn.commit()
    finally:
        conn.close()


# ── Evaluations ──────────────────────────────────────────────────────────────

def load_evaluations(days: int = 90, symbol: str | None = None) -> pd.DataFrame:
    """
    Load evaluations that passed pre-filter.

    Returns DataFrame with columns matching Evaluation model (excluding features_json).
    """
    conn = _connect()
    conditions = ["prefilter_passed = 1"]
    params: list = []

    conditions.append("timestamp >= datetime('now', ? || ' days')")
    params.append(f"-{days}")

    if symbol:
        conditions.append("symbol = ?")
        params.append(symbol)

    # Dynamically build SELECT list from schema, excluding large blobs
    select_cols = _build_select_cols(Evaluation, exclude=["features_json", "weights_json", "guardrail_flags_json"])

    where = " AND ".join(conditions)
    df = pd.read_sql_query(
        f"""
        SELECT {select_cols}
        FROM evaluations
        WHERE {where}
        ORDER BY timestamp DESC
        """,
        conn,
        params=params,
        parse_dates=["timestamp"],
    )
    conn.close()

    validate_schema(df, Evaluation, exclude=["features_json", "weights_json", "guardrail_flags_json"])
    return df


# ── Model Outputs ────────────────────────────────────────────────────────────

def load_model_outputs(days: int = 90, symbol: str | None = None) -> pd.DataFrame:
    """
    Load per-model outputs joined with evaluation metadata.
    """
    conn = _connect()
    conditions = ["e.prefilter_passed = 1"]
    params: list = []

    conditions.append("e.timestamp >= datetime('now', ? || ' days')")
    params.append(f"-{days}")

    if symbol:
        conditions.append("e.symbol = ?")
        params.append(symbol)

    where = " AND ".join(conditions)

    # We still use manual selection for joins to handle aliasing and specific needs
    df = pd.read_sql_query(
        f"""
        SELECT
            m.evaluation_id, m.model_id,
            m.trade_score, m.confidence, m.expected_rr,
            m.should_trade, m.compliant, m.latency_ms, m.model_version,
            m.extension_risk, m.exhaustion_risk,
            m.float_rotation_risk, m.market_alignment_score,
            e.symbol, e.direction, e.timestamp,
            e.time_of_day, e.volatility_regime, e.liquidity_bucket,
            e.ensemble_trade_score, e.ensemble_should_trade
        FROM model_outputs m
        JOIN evaluations e ON m.evaluation_id = e.id
        WHERE {where}
        ORDER BY e.timestamp DESC
        """,
        conn,
        params=params,
        parse_dates=["timestamp"],
    )
    conn.close()

    # Validate against models (partial)
    # We exclude fields not selected in the query to avoid warnings
    validate_schema(df, ModelOutput, exclude=[
        "id", "reasoning", "raw_response", "error",
        "prompt_hash", "token_count", "api_response_id", "timestamp"
    ])
    # For Evaluation, we only select a few fields, so strict validation would be too noisy
    validate_schema(df, Evaluation, strict=False)

    return df


# ── Eval Outcomes (the key analytics join) ───────────────────────────────────

def load_eval_outcomes(
    days: int = 90,
    symbol: str | None = None,
    trades_only: bool = True,
) -> pd.DataFrame:
    """
    Load evaluations joined with outcomes — the core analytics table.
    """
    conn = _connect()
    conditions: list[str] = []
    params: list = []

    if trades_only:
        conditions.append("o.trade_taken = 1")

    if symbol:
        conditions.append("e.symbol = ?")
        params.append(symbol)

    if days:
        conditions.append("e.timestamp >= datetime('now', ? || ' days')")
        params.append(f"-{days}")

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""

    # Note: we manually alias e.id as evaluation_id to match Outcome model FK
    # but Outcome model also has 'id' (primary key of outcome table).

    df = pd.read_sql_query(
        f"""
        SELECT
            e.id as evaluation_id,
            e.symbol, e.direction, e.timestamp,
            e.ensemble_trade_score, e.ensemble_confidence,
            e.ensemble_expected_rr, e.ensemble_should_trade,
            e.time_of_day, e.volatility_regime, e.liquidity_bucket,
            e.rvol, e.minutes_since_open,
            o.trade_taken, o.decision_type,
            o.confidence_rating, o.rule_followed, o.setup_type,
            o.r_multiple, o.exit_reason, o.recorded_at
        FROM evaluations e
        JOIN outcomes o ON o.evaluation_id = e.id
        {where}
        ORDER BY e.timestamp DESC
        """,
        conn,
        params=params,
        parse_dates=["timestamp", "recorded_at"],
    )
    conn.close()

    validate_schema(df, Evaluation, strict=False)
    validate_schema(df, Outcome, exclude=["id", "actual_entry_price", "actual_exit_price", "notes"])

    return df


# ── Model Outputs with Outcomes (for weight recalibration) ───────────────────

def load_model_outcomes(days: int = 90) -> pd.DataFrame:
    """
    Load per-model predictions alongside trade outcomes.
    """
    conn = _connect()
    df = pd.read_sql_query(
        """
        SELECT
            m.evaluation_id, m.model_id,
            m.trade_score, m.confidence, m.expected_rr,
            m.should_trade, m.compliant,
            e.symbol, e.timestamp, e.time_of_day, e.volatility_regime,
            o.trade_taken, o.r_multiple
        FROM model_outputs m
        JOIN evaluations e ON m.evaluation_id = e.id
        JOIN outcomes o ON o.evaluation_id = e.id
        WHERE e.prefilter_passed = 1
          AND o.trade_taken = 1
          AND o.r_multiple IS NOT NULL
          AND e.timestamp >= datetime('now', ? || ' days')
        ORDER BY e.timestamp DESC
        """,
        conn,
        params=[f"-{days}"],
        parse_dates=["timestamp"],
    )
    conn.close()

    validate_schema(df, ModelOutput, strict=False)
    validate_schema(df, Outcome, strict=False)

    return df


# ── Weight History ───────────────────────────────────────────────────────────

def load_weight_history() -> pd.DataFrame:
    """Load historical weight snapshots."""
    conn = _connect()

    # Use dynamic select for weight history
    select_cols = _build_select_cols(WeightHistory)

    df = pd.read_sql_query(
        f"SELECT {select_cols} FROM weight_history ORDER BY created_at DESC",
        conn,
        parse_dates=["created_at"],
    )
    conn.close()
    # Parse weights_json into separate columns
    if not df.empty and "weights_json" in df.columns:
        weights_expanded = df["weights_json"].apply(json.loads).apply(pd.Series)
        df = pd.concat([df.drop(columns=["weights_json"]), weights_expanded], axis=1)

    validate_schema(df, WeightHistory, exclude=["weights_json"]) # expanded
    return df


# ── Quick summary (for sanity checks) ───────────────────────────────────────

def summary() -> dict:
    """Quick count of rows in key tables."""
    conn = _connect()
    counts = {}
    for table in [
        "evaluations", "model_outputs", "outcomes",
        "orders", "executions", "trade_journal", "weight_history",
    ]:
        row = conn.execute(f"SELECT COUNT(*) as n FROM {table}").fetchone()
        counts[table] = row["n"]

    # Outcomes with r_multiple
    row = conn.execute(
        "SELECT COUNT(*) as n FROM outcomes WHERE trade_taken = 1 AND r_multiple IS NOT NULL"
    ).fetchone()
    counts["scored_trades"] = row["n"]

    conn.close()
    return counts


if __name__ == "__main__":
    resolved = _resolve_db_path()
    print("Market Data Bridge — Analytics DB Loader")
    print(f"DB path: {resolved}")
    print(f"DB exists: {resolved.exists()}")
    if resolved.exists():
        print(f"\nTable counts: {summary()}")
        w = load_weights()
        print(f"Current weights: claude={w['claude']}, gpt4o={w['gpt4o']}, gemini={w['gemini']}, k={w['k']}")
    else:
        print("\nDatabase not created yet. Start the server first.")
