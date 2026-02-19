"""
Auto-generated Pydantic models from SQLite schema.
Do not edit manually. Run 'npm run generate:schema' to update.
"""

from typing import Optional, Any
from pydantic import BaseModel

class Order(BaseModel):
    id: int
    order_id: int
    symbol: str
    action: str
    order_type: str
    total_quantity: float
    lmt_price: Optional[float]
    aux_price: Optional[float]
    tif: Optional[str]
    sec_type: Optional[str]
    exchange: Optional[str]
    currency: Optional[str]
    status: str
    filled_quantity: Optional[float]
    avg_fill_price: Optional[float]
    strategy_version: str
    order_source: str
    ai_confidence: Optional[float]
    correlation_id: str
    journal_id: Optional[int]
    parent_order_id: Optional[int]
    created_at: str
    updated_at: str

class Execution(BaseModel):
    id: int
    exec_id: str
    order_id: int
    symbol: str
    side: str
    shares: float
    price: float
    cum_qty: Optional[float]
    avg_price: Optional[float]
    commission: Optional[float]
    realized_pnl: Optional[float]
    correlation_id: str
    timestamp: str
    created_at: str

class Evaluation(BaseModel):
    id: str
    symbol: str
    direction: Optional[str]
    entry_price: Optional[float]
    stop_price: Optional[float]
    user_notes: Optional[str]
    timestamp: str
    features_json: str
    last_price: Optional[float]
    rvol: Optional[float]
    vwap_deviation_pct: Optional[float]
    spread_pct: Optional[float]
    float_rotation_est: Optional[float]
    volume_acceleration: Optional[float]
    atr_pct: Optional[float]
    price_extension_pct: Optional[float]
    gap_pct: Optional[float]
    range_position_pct: Optional[float]
    volatility_regime: Optional[str]
    liquidity_bucket: Optional[str]
    spy_change_pct: Optional[float]
    qqq_change_pct: Optional[float]
    market_alignment: Optional[str]
    time_of_day: Optional[str]
    minutes_since_open: Optional[int]
    ensemble_trade_score: Optional[float]
    ensemble_trade_score_median: Optional[float]
    ensemble_expected_rr: Optional[float]
    ensemble_confidence: Optional[float]
    ensemble_should_trade: Optional[int]
    ensemble_unanimous: Optional[int]
    ensemble_majority_trade: Optional[int]
    ensemble_score_spread: Optional[float]
    ensemble_disagreement_penalty: Optional[float]
    weights_json: Optional[str]
    guardrail_allowed: Optional[int]
    guardrail_flags_json: Optional[str]
    prefilter_passed: Optional[int]
    feature_latency_ms: Optional[int]
    total_latency_ms: Optional[int]

class ModelOutput(BaseModel):
    id: int
    evaluation_id: str
    model_id: str
    trade_score: Optional[float]
    extension_risk: Optional[float]
    exhaustion_risk: Optional[float]
    float_rotation_risk: Optional[float]
    market_alignment_score: Optional[float]
    expected_rr: Optional[float]
    confidence: Optional[float]
    should_trade: Optional[int]
    reasoning: Optional[str]
    raw_response: Optional[str]
    compliant: int
    error: Optional[str]
    latency_ms: Optional[int]
    model_version: Optional[str]
    prompt_hash: Optional[str]
    token_count: Optional[int]
    api_response_id: Optional[str]
    timestamp: str

class Outcome(BaseModel):
    id: int
    evaluation_id: str
    trade_taken: int
    decision_type: Optional[str]
    confidence_rating: Optional[int]
    rule_followed: Optional[int]
    setup_type: Optional[str]
    actual_entry_price: Optional[float]
    actual_exit_price: Optional[float]
    r_multiple: Optional[float]
    exit_reason: Optional[str]
    notes: Optional[str]
    recorded_at: str

class WeightHistory(BaseModel):
    id: int
    weights_json: str
    sample_size: Optional[int]
    reason: Optional[str]
    created_at: str

