export interface RegimeWeights {
  claude: number;
  gpt4o: number;
  gemini: number;
  k: number;
}

export interface EnsembleWeights {
  claude: number;
  gpt4o: number;
  gemini: number;
  k: number;
  updated_at: string;
  sample_size: number;
  source: string;
  regime_overrides?: {
    high?: RegimeWeights;
    low?: RegimeWeights;
  };
}

export interface EnsembleScore {
  trade_score: number;
  trade_score_median: number;
  expected_rr: number;
  confidence: number;
  should_trade: boolean;
  score_spread: number;
  disagreement_penalty: number;
  unanimous: boolean;
  majority_trade: boolean;
  weights_used: { claude: number; gpt4o: number; gemini: number };
}
