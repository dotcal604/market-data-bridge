export type ModelId = "claude" | "gpt4o" | "gemini";

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
  model_id: ModelId;
  output: ModelOutput | null;
  raw_response: string;
  latency_ms: number;
  error: string | null;
  compliant: boolean;
  model_version: string;
  prompt_hash: string;
  token_count: number;
  api_response_id: string;
  timestamp: string;
}
