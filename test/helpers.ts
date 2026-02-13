import { type Database as DatabaseType } from "better-sqlite3";
import { randomUUID } from "crypto";

/**
 * Deletes all rows from all tables in the test database.
 * Use this in beforeEach or afterEach to ensure test isolation.
 */
export function cleanDb(db: DatabaseType): void {
  // Disable foreign key checks temporarily
  db.pragma("foreign_keys = OFF");

  // Delete all rows from all tables
  db.exec(`
    DELETE FROM weight_history;
    DELETE FROM outcomes;
    DELETE FROM model_outputs;
    DELETE FROM evaluations;
    DELETE FROM account_snapshots;
    DELETE FROM collab_messages;
    DELETE FROM positions_snapshots;
    DELETE FROM executions;
    DELETE FROM orders;
    DELETE FROM trade_journal;
  `);

  // Re-enable foreign key checks
  db.pragma("foreign_keys = ON");
}

/**
 * Creates a sample evaluation row and returns it with all fields.
 */
export function createTestEvaluation(db: DatabaseType, overrides: Partial<TestEvaluation> = {}): TestEvaluation {
  const id = overrides.id ?? randomUUID();
  const timestamp = overrides.timestamp ?? new Date().toISOString();

  const evaluation: TestEvaluation = {
    id,
    symbol: overrides.symbol ?? "AAPL",
    direction: overrides.direction ?? "LONG",
    entry_price: overrides.entry_price ?? 150.0,
    stop_price: overrides.stop_price ?? 148.0,
    user_notes: overrides.user_notes ?? null,
    timestamp,

    // Feature vector
    features_json: overrides.features_json ?? JSON.stringify({}),
    last_price: overrides.last_price ?? 150.0,
    rvol: overrides.rvol ?? 1.5,
    vwap_deviation_pct: overrides.vwap_deviation_pct ?? 0.5,
    spread_pct: overrides.spread_pct ?? 0.05,
    float_rotation_est: overrides.float_rotation_est ?? 0.02,
    volume_acceleration: overrides.volume_acceleration ?? 1.2,
    atr_pct: overrides.atr_pct ?? 2.0,
    price_extension_pct: overrides.price_extension_pct ?? 1.5,
    gap_pct: overrides.gap_pct ?? 0.5,
    range_position_pct: overrides.range_position_pct ?? 0.75,
    volatility_regime: overrides.volatility_regime ?? "normal",
    liquidity_bucket: overrides.liquidity_bucket ?? "large",
    spy_change_pct: overrides.spy_change_pct ?? 0.3,
    qqq_change_pct: overrides.qqq_change_pct ?? 0.4,
    market_alignment: overrides.market_alignment ?? "aligned",
    time_of_day: overrides.time_of_day ?? "morning",
    minutes_since_open: overrides.minutes_since_open ?? 30,

    // Ensemble result
    ensemble_trade_score: overrides.ensemble_trade_score ?? 75.0,
    ensemble_trade_score_median: overrides.ensemble_trade_score_median ?? 75.0,
    ensemble_expected_rr: overrides.ensemble_expected_rr ?? 2.5,
    ensemble_confidence: overrides.ensemble_confidence ?? 0.8,
    ensemble_should_trade: overrides.ensemble_should_trade ?? 1,
    ensemble_unanimous: overrides.ensemble_unanimous ?? 1,
    ensemble_majority_trade: overrides.ensemble_majority_trade ?? 1,
    ensemble_score_spread: overrides.ensemble_score_spread ?? 5.0,
    ensemble_disagreement_penalty: overrides.ensemble_disagreement_penalty ?? 0.25,
    weights_json: overrides.weights_json ?? JSON.stringify({ "gpt-4o": 0.4, "claude-sonnet": 0.3, "gemini-flash": 0.3 }),

    // Guardrail
    guardrail_allowed: overrides.guardrail_allowed ?? 1,
    guardrail_flags_json: overrides.guardrail_flags_json ?? JSON.stringify([]),
    prefilter_passed: overrides.prefilter_passed ?? 1,

    // Latency
    feature_latency_ms: overrides.feature_latency_ms ?? 150,
    total_latency_ms: overrides.total_latency_ms ?? 2500,
  };

  const cols = Object.keys(evaluation);
  const placeholders = cols.map((c) => `@${c}`).join(", ");
  const sql = `INSERT INTO evaluations (${cols.join(", ")}) VALUES (${placeholders})`;
  
  const bound: Record<string, unknown> = {};
  for (const c of cols) {
    const v = evaluation[c as keyof TestEvaluation];
    if (v === undefined || v === null) bound[c] = null;
    else if (typeof v === "boolean") bound[c] = v ? 1 : 0;
    else bound[c] = v;
  }
  
  db.prepare(sql).run(bound);

  return evaluation;
}

/**
 * Creates a sample model output row linked to an evaluation.
 */
export function createTestModelOutput(
  db: DatabaseType,
  evaluationId: string,
  overrides: Partial<TestModelOutput> = {}
): TestModelOutput {
  const timestamp = overrides.timestamp ?? new Date().toISOString();

  const modelOutput: TestModelOutput = {
    evaluation_id: evaluationId,
    model_id: overrides.model_id ?? "gpt-4o",

    // Parsed output fields
    trade_score: overrides.trade_score ?? 75.0,
    extension_risk: overrides.extension_risk ?? 3.0,
    exhaustion_risk: overrides.exhaustion_risk ?? 2.0,
    float_rotation_risk: overrides.float_rotation_risk ?? 1.0,
    market_alignment_score: overrides.market_alignment_score ?? 8.0,
    expected_rr: overrides.expected_rr ?? 2.5,
    confidence: overrides.confidence ?? 0.8,
    should_trade: overrides.should_trade ?? 1,
    reasoning: overrides.reasoning ?? "Strong momentum with healthy volume",

    // Meta / audit
    raw_response: overrides.raw_response ?? JSON.stringify({}),
    compliant: overrides.compliant ?? 1,
    error: overrides.error ?? null,
    latency_ms: overrides.latency_ms ?? 800,
    model_version: overrides.model_version ?? "gpt-4o-2024-11-20",
    prompt_hash: overrides.prompt_hash ?? "abc123",
    token_count: overrides.token_count ?? 500,
    api_response_id: overrides.api_response_id ?? null,
    timestamp,
  };

  const cols = Object.keys(modelOutput);
  const placeholders = cols.map((c) => `@${c}`).join(", ");
  const sql = `INSERT INTO model_outputs (${cols.join(", ")}) VALUES (${placeholders})`;
  
  const bound: Record<string, unknown> = {};
  for (const c of cols) {
    const v = modelOutput[c as keyof TestModelOutput];
    if (v === undefined || v === null) bound[c] = null;
    else if (typeof v === "boolean") bound[c] = v ? 1 : 0;
    else bound[c] = v;
  }
  
  db.prepare(sql).run(bound);

  return modelOutput;
}

/**
 * Creates a sample outcome row linked to an evaluation.
 */
export function createTestOutcome(
  db: DatabaseType,
  evaluationId: string,
  overrides: Partial<TestOutcome> = {}
): TestOutcome {
  const recordedAt = overrides.recorded_at ?? new Date().toISOString();

  const outcome: TestOutcome = {
    evaluation_id: evaluationId,
    trade_taken: overrides.trade_taken ?? 1,
    actual_entry_price: overrides.actual_entry_price ?? 150.0,
    actual_exit_price: overrides.actual_exit_price ?? 153.0,
    r_multiple: overrides.r_multiple ?? 1.5,
    exit_reason: overrides.exit_reason ?? "Target hit",
    notes: overrides.notes ?? null,
    recorded_at: recordedAt,
  };

  const cols = Object.keys(outcome);
  const placeholders = cols.map((c) => `@${c}`).join(", ");
  const sql = `INSERT INTO outcomes (${cols.join(", ")}) VALUES (${placeholders})`;
  
  const bound: Record<string, unknown> = {};
  for (const c of cols) {
    const v = outcome[c as keyof TestOutcome];
    if (v === undefined || v === null) bound[c] = null;
    else if (typeof v === "boolean") bound[c] = v ? 1 : 0;
    else bound[c] = v;
  }
  
  db.prepare(sql).run(bound);

  return outcome;
}

// ── Type Definitions ─────────────────────────────────────────────────────

export interface TestEvaluation {
  id: string;
  symbol: string;
  direction: string | null;
  entry_price: number | null;
  stop_price: number | null;
  user_notes: string | null;
  timestamp: string;
  features_json: string;
  last_price: number | null;
  rvol: number | null;
  vwap_deviation_pct: number | null;
  spread_pct: number | null;
  float_rotation_est: number | null;
  volume_acceleration: number | null;
  atr_pct: number | null;
  price_extension_pct: number | null;
  gap_pct: number | null;
  range_position_pct: number | null;
  volatility_regime: string | null;
  liquidity_bucket: string | null;
  spy_change_pct: number | null;
  qqq_change_pct: number | null;
  market_alignment: string | null;
  time_of_day: string | null;
  minutes_since_open: number | null;
  ensemble_trade_score: number | null;
  ensemble_trade_score_median: number | null;
  ensemble_expected_rr: number | null;
  ensemble_confidence: number | null;
  ensemble_should_trade: number | null;
  ensemble_unanimous: number | null;
  ensemble_majority_trade: number | null;
  ensemble_score_spread: number | null;
  ensemble_disagreement_penalty: number | null;
  weights_json: string | null;
  guardrail_allowed: number | null;
  guardrail_flags_json: string | null;
  prefilter_passed: number | null;
  feature_latency_ms: number | null;
  total_latency_ms: number | null;
}

export interface TestModelOutput {
  evaluation_id: string;
  model_id: string;
  trade_score: number | null;
  extension_risk: number | null;
  exhaustion_risk: number | null;
  float_rotation_risk: number | null;
  market_alignment_score: number | null;
  expected_rr: number | null;
  confidence: number | null;
  should_trade: number | null;
  reasoning: string | null;
  raw_response: string | null;
  compliant: number;
  error: string | null;
  latency_ms: number | null;
  model_version: string | null;
  prompt_hash: string | null;
  token_count: number | null;
  api_response_id: string | null;
  timestamp: string;
}

export interface TestOutcome {
  evaluation_id: string;
  trade_taken: number;
  actual_entry_price: number | null;
  actual_exit_price: number | null;
  r_multiple: number | null;
  exit_reason: string | null;
  notes: string | null;
  recorded_at: string;
}
