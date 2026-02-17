// Types mirroring backend eval engine schemas

export interface FeatureVector {
  symbol: string;
  timestamp: string;
  last: number;
  bid: number;
  ask: number;
  volume: number;
  avg_volume: number;
  rvol: number;
  vwap: number;
  vwap_deviation_pct: number;
  spread_pct: number;
  float_shares: number | null;
  float_rotation_est: number;
  volume_acceleration: number;
  atr: number;
  atr_pct: number;
  high_of_day: number;
  low_of_day: number;
  prev_close: number;
  price_extension_pct: number;
  gap_pct: number;
  range_position_pct: number;
  volatility_regime: "low" | "normal" | "high" | "extreme";
  liquidity_bucket: "micro" | "small" | "mid" | "large";
  spy_change_pct: number;
  qqq_change_pct: number;
  market_alignment: "aligned" | "neutral" | "divergent";
  time_of_day: "premarket" | "open_15" | "morning" | "midday" | "afternoon" | "close_15" | "afterhours";
  minutes_since_open: number;
}

export interface ModelOutput {
  trade_score: number;
  extension_risk: number;
  exhaustion_risk: number;
  float_rotation_risk: number;
  market_alignment: number;
  expected_rr: number;
  confidence: number;
  should_trade: boolean;
  reasoning: string;
}

export interface ModelEvaluation {
  id: number;
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
  latency_ms: number;
  model_version: string | null;
  prompt_hash: string | null;
  token_count: number | null;
  api_response_id: string | null;
  timestamp: string;
}

export interface Evaluation {
  id: string;
  symbol: string;
  direction: string;
  entry_price: number | null;
  stop_price: number | null;
  user_notes: string | null;
  timestamp: string;
  features_json: string;
  ensemble_trade_score: number;
  ensemble_trade_score_median: number;
  ensemble_expected_rr: number;
  ensemble_confidence: number;
  ensemble_should_trade: number;
  ensemble_unanimous: number;
  ensemble_majority_trade: number;
  ensemble_score_spread: number;
  ensemble_disagreement_penalty: number;
  weights_json: string;
  guardrail_allowed: number;
  guardrail_flags_json: string;
  prefilter_passed: number;
  feature_latency_ms: number;
  total_latency_ms: number;
  last_price: number;
  rvol: number;
  vwap_deviation_pct: number;
  spread_pct: number;
  float_rotation_est: number;
  volume_acceleration: number;
  atr_pct: number;
  price_extension_pct: number;
  gap_pct: number;
  range_position_pct: number;
  volatility_regime: string;
  liquidity_bucket: string;
  spy_change_pct: number;
  qqq_change_pct: number;
  market_alignment: string;
  time_of_day: string;
  minutes_since_open: number;
  created_at: string;
}

export interface Outcome {
  id: number;
  evaluation_id: string;
  trade_taken: number;
  actual_entry_price: number | null;
  actual_exit_price: number | null;
  r_multiple: number | null;
  exit_reason: string | null;
  notes: string | null;
  recorded_at: string;
}

export interface EvalDetail {
  evaluation: Evaluation;
  modelOutputs: ModelEvaluation[];
  outcome: Outcome | null;
}

export interface EvalHistoryResponse {
  count: number;
  evaluations: Evaluation[];
}

export interface EvalStats {
  total_evaluations: number;
  avg_score: number;
  avg_latency_ms: number;
  trade_rate: number;
  guardrail_block_rate: number;
  model_compliance: Record<string, number>;
  outcomes_recorded: number;
  avg_r_multiple: number | null;
}

export interface EvalOutcome {
  evaluation_id: string;
  symbol: string;
  direction: string;
  timestamp: string;
  ensemble_trade_score: number;
  ensemble_should_trade: number;
  ensemble_confidence: number;
  ensemble_expected_rr: number;
  time_of_day: string;
  volatility_regime: string;
  liquidity_bucket: string;
  rvol: number;
  trade_taken: number;
  decision_type: string | null;
  confidence_rating: number | null;
  rule_followed: number | null;
  setup_type: string | null;
  r_multiple: number | null;
  exit_reason: string | null;
  recorded_at: string;
  outcome?: "correct" | "incorrect" | null;
}

export interface EvalOutcomesResponse {
  count: number;
  outcomes: EvalOutcome[];
}

export interface EnsembleWeights {
  [modelId: string]: number;
}

export interface EvalResponse {
  id: string;
  symbol: string;
  timestamp: string;
  prefilter: { passed: boolean; flags: string[] };
  features: FeatureVector;
  models: Record<string, ModelOutput & { latency_ms: number } | { error: string; latency_ms: number }>;
  ensemble: {
    trade_score: number;
    trade_score_median: number;
    expected_rr: number;
    confidence: number;
    should_trade: boolean;
    unanimous: boolean;
    majority_trade: boolean;
    score_spread: number;
    disagreement_penalty: number;
    weights_used: EnsembleWeights;
  } | null;
  guardrail: { allowed: boolean; flags: string[] };
  latency_ms: Record<string, number>;
}

// Collaboration types
export interface CollabMessage {
  id: string;
  author: "claude" | "chatgpt" | "user";
  content: string;
  timestamp: string;
  replyTo?: string;
  tags?: string[];
}

export interface CollabStats {
  totalMessages: number;
  byAuthor: Record<string, number>;
}

export interface PostMessageInput {
  content: string;
  tags?: string;
}

// Account types
export interface IBKRStatus {
  connected: boolean;
  host: string;
  port: number;
  clientId: number;
  note: string;
}

export interface StatusResponse {
  status: string;
  easternTime: string;
  marketSession: string;
  marketData: string;
  screener: string;
  ibkr: IBKRStatus;
  timestamp: string;
}

export interface AccountSummary {
  account: string;
  netLiquidation: number | null;
  totalCashValue: number | null;
  settledCash: number | null;
  buyingPower: number | null;
  grossPositionValue: number | null;
  maintMarginReq: number | null;
  excessLiquidity: number | null;
  availableFunds: number | null;
  currency: string;
  timestamp: string;
}

export interface PnLData {
  account: string;
  dailyPnL: number | null;
  unrealizedPnL: number | null;
  realizedPnL: number | null;
  timestamp: string;
}

export interface AccountSnapshot {
  id: number;
  net_liquidation: number | null;
  total_cash_value: number | null;
  buying_power: number | null;
  daily_pnl: number | null;
  unrealized_pnl: number | null;
  realized_pnl: number | null;
  created_at: string;
}

export interface IntradayPnLResponse {
  snapshots: AccountSnapshot[];
  count: number;
}

export interface Position {
  account: string;
  symbol: string;
  secType: string;
  exchange: string;
  currency: string;
  position: number;
  avgCost: number;
}

export interface PositionsResponse {
  count: number;
  positions: Position[];
  error?: string;
}

export interface AccountSummaryResponse {
  summary?: AccountSummary;
  error?: string;
}

export interface AccountSnapshot {
  id: number;
  net_liquidation: number | null;
  total_cash_value: number | null;
  buying_power: number | null;
  daily_pnl: number | null;
  unrealized_pnl: number | null;
  realized_pnl: number | null;
  created_at: string;
}

export interface IntradayPnLResponse {
  count: number;
  snapshots: AccountSnapshot[];
}

// Journal types
export interface JournalEntry {
  id: number;
  symbol: string | null;
  strategy_version: string | null;
  reasoning: string;
  ai_recommendations: string | null;
  tags: string | null;
  outcome_tags: string | null;
  notes: string | null;
  spy_price: number | null;
  vix_level: number | null;
  gap_pct: number | null;
  relative_volume: number | null;
  time_of_day: string | null;
  session_type: string | null;
  spread_pct: number | null;
  created_at: string;
  updated_at: string;
}

export interface JournalHistoryResponse {
  count: number;
  entries: JournalEntry[];
}

// Order types
export interface OpenOrder {
  orderId: number;
  symbol: string;
  action: "BUY" | "SELL";
  orderType: "MKT" | "LMT" | "STP" | "STP LMT";
  totalQuantity: number;
  lmtPrice: number | null;
  auxPrice: number | null;
  status: string;
  remaining: number;
  tif: string;
}

export interface CompletedOrder {
  orderId: number;
  symbol: string;
  action: "BUY" | "SELL";
  orderType: "MKT" | "LMT" | "STP" | "STP LMT";
  totalQuantity: number;
  filledQuantity: number;
  avgFillPrice: number | null;
  status: string;
  completedTime: string;
}

export interface OrdersResponse {
  count: number;
  orders: OpenOrder[];
}

export interface CompletedOrdersResponse {
  count: number;
  orders: CompletedOrder[];
}

export interface CancelOrderResponse {
  orderId: number;
  status: string;
}

export interface CancelAllOrdersResponse {
  status: string;
}

// Order placement types
export interface PlaceOrderRequest {
  symbol: string;
  action: "BUY" | "SELL";
  orderType: "MKT" | "LMT" | "STP" | "STP LMT" | "TRAIL" | "TRAIL LIMIT" | "REL" | "MIT" | "MOC" | "LOC";
  totalQuantity: number;
  lmtPrice?: number;
  auxPrice?: number;
  trailingPercent?: number;
  trailStopPrice?: number;
  discretionaryAmt?: number;
  tif?: "DAY" | "GTC" | "IOC" | "GTD";
  goodTillDate?: string;
  outsideRth?: boolean;
  secType?: string;
  exchange?: string;
  currency?: string;
}

export interface PlaceOrderResponse {
  orderId: number;
  symbol: string;
  action: string;
  orderType: string;
  totalQuantity: number;
  lmtPrice: number | null;
  auxPrice: number | null;
  status: string;
  correlation_id: string;
}

export interface QuoteResponse {
  symbol: string;
  last: number | null;
  bid: number | null;
  ask: number | null;
  volume: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  prevClose: number | null;
  source: "ibkr" | "yahoo";
}

// Executions API types
export interface Execution {
  execId: string;
  orderId: number;
  symbol: string;
  secType: string;
  side: string;
  shares: number;
  price: number;
  cumQty: number;
  avgPrice: number;
  time: string;
  commission: number;
  realizedPnL: number;
}

export interface ExecutionHistoryResponse {
  count: number;
  executions: Execution[];
  error?: string;
}

// Flatten types
export interface FlattenConfig {
  enabled: boolean;
  time: string;
  firedToday: string;
}

export interface FlattenResult {
  flattened: Array<{ symbol: string; position: number; orderId: number }>;
  skipped: Array<{ symbol: string; reason: string }>;
  error?: string;
}

// Options types
export interface OptionContract {
  contractSymbol: string;
  strike: number;
  expiration: string;
  type: "C" | "P";
  lastPrice: number | null;
  bid: number | null;
  ask: number | null;
  volume: number | null;
  openInterest: number | null;
  impliedVolatility: number | null;
  inTheMoney: boolean;
}

export interface OptionsChainData {
  symbol: string;
  expirations: string[];
  strikes: number[];
  calls: OptionContract[];
  puts: OptionContract[];
}
