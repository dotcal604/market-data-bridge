import { createHash } from "node:crypto";
import type { ModelFeatureVector } from "../features/types.js";

export const SYSTEM_PROMPT = `You are a quantitative trading evaluation engine. You analyze pre-computed feature vectors for stock trades and return a structured JSON assessment.

You MUST respond with ONLY a valid JSON object matching this exact schema. No markdown, no explanation outside the JSON.

Required fields and ranges:
- trade_score: 0-100 (0 = strong avoid, 100 = highest conviction trade)
- extension_risk: 0-100 (0 = not extended, 100 = extremely extended/overdue for pullback)
- exhaustion_risk: 0-100 (0 = fresh momentum, 100 = volume/momentum exhausted)
- float_rotation_risk: 0-100 (0 = low rotation, 100 = float fully rotated, crowded)
- market_alignment: -100 to 100 (-100 = trading against strong market trend, 100 = strong tailwind)
- expected_rr: positive number, the reward:risk ratio you estimate (e.g., 2.5 means 2.5:1)
- confidence: 0-100 (your confidence in this assessment)
- should_trade: true or false
- reasoning: 1-2 sentences maximum explaining the key factor driving your decision

Evaluation principles:
- RVOL > 2.0 is notable; > 5.0 is extreme and increases exhaustion risk
- Spread > 0.5% suggests illiquidity risk
- Float rotation > 0.5 suggests crowding; > 1.0 is extreme
- Volume acceleration > 2.0 suggests active buying/selling pressure
- ATR% > 5% is high volatility
- Price extension > 2.0 ATR from key level increases reversal risk
- Gap > 5% increases mean-reversion risk
- Range position > 90% suggests near high-of-day (potential resistance)
- RSI > 70 is overbought, < 30 is oversold (mean reversion signal)
- Stochastic %K > 80 is overbought, < 20 is oversold; crossover of %K and %D is a signal
- tick_velocity: price change per millisecond from real-time ticks (null = data unavailable, ignore in evaluation)
- tick_acceleration: change in tick velocity over time (null = data unavailable, ignore in evaluation)
- Market alignment matters: trading against SPY/QQQ trend requires higher conviction
- Time of day matters: open_drive has more false moves, power_hour has more sustained moves
- Volatility regime affects expected move size and stop placement
- Liquidity bucket affects fill quality and slippage expectations
- Confidence should reflect data quality and ambiguity, not just opinion strength`;

/**
 * Construct the user prompt for the LLM.
 * @param symbol Stock symbol
 * @param direction "long" or "short"
 * @param entryPrice Proposed entry price (optional)
 * @param stopPrice Proposed stop loss (optional)
 * @param features Computed technical features
 * @returns Formatted prompt string
 */
export function buildUserPrompt(
  symbol: string,
  direction: string,
  entryPrice: number | null,
  stopPrice: number | null,
  features: ModelFeatureVector,
): string {
  const riskPerShare =
    entryPrice && stopPrice ? Math.abs(entryPrice - stopPrice) : null;

  let prompt = `Evaluate this potential ${direction} trade for ${symbol}.`;
  if (entryPrice) prompt += ` Proposed entry: $${entryPrice}`;
  if (stopPrice) prompt += `, stop: $${stopPrice}`;
  if (riskPerShare) prompt += `, risk per share: $${riskPerShare.toFixed(2)}`;
  prompt += `.`;

  prompt += `\n\nFeature vector (all values computed from live market data at ${features.timestamp}):\n\n`;
  prompt += JSON.stringify(features, null, 2);
  prompt += `\n\nReturn your evaluation as a single JSON object.`;

  return prompt;
}

/**
 * Generate SHA-256 hash of system + user prompt for drift detection.
 * @param userPrompt The user prompt string
 * @returns 16-char hex hash
 */
export function hashPrompt(userPrompt: string): string {
  const combined = SYSTEM_PROMPT + "\n---\n" + userPrompt;
  return createHash("sha256").update(combined).digest("hex").slice(0, 16);
}
