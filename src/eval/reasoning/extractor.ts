/**
 * Structured reasoning extractor.
 *
 * Parses the terse 1-2 sentence `reasoning` field from model outputs
 * into structured key_drivers, risk_factors, and uncertainties.
 * Uses keyword matching against known feature names — no LLM call needed.
 */

export interface StructuredReasoning {
  key_drivers: Array<{ feature: string; direction: "bullish" | "bearish" | "neutral"; weight: number }>;
  risk_factors: string[];
  uncertainties: string[];
  conviction: "high" | "medium" | "low" | null;
}

// Feature keywords → canonical feature names
const FEATURE_KEYWORDS: Array<[RegExp, string]> = [
  [/\brvol\b/i, "rvol"],
  [/\brelative\s*volume\b/i, "rvol"],
  [/\bvolume\s*accel/i, "volume_acceleration"],
  [/\bvolume\b/i, "volume"],
  [/\bvwap\b/i, "vwap_deviation_pct"],
  [/\bspread\b/i, "spread_pct"],
  [/\bfloat\s*rotat/i, "float_rotation_est"],
  [/\batr\b/i, "atr_pct"],
  [/\bextens(?:ion|ded)\b/i, "price_extension_pct"],
  [/\bgap\b/i, "gap_pct"],
  [/\brange\s*pos/i, "range_position_pct"],
  [/\bmarket\s*align/i, "market_alignment"],
  [/\b(?:spy|qqq)\b/i, "market_alignment"],
  [/\btime\s*of\s*day\b|open\s*drive|power\s*hour|midday/i, "time_of_day"],
  [/\bregime\b|volatil(?:ity|e)/i, "volatility_regime"],
  [/\bliquid/i, "liquidity_bucket"],
  [/\bmomentum\b/i, "momentum"],
  [/\bexhaust/i, "exhaustion_risk"],
  [/\bcrowd/i, "float_rotation_est"],
  [/\bsupport\b/i, "support"],
  [/\bresist/i, "resistance"],
  [/\bbreakout\b/i, "breakout"],
  [/\bpullback\b/i, "pullback"],
  [/\breversal\b/i, "reversal"],
];

// Risk indicators
const RISK_PATTERNS: RegExp[] = [
  /\boverextend/i, /\bexhaust/i, /\billiquid/i, /\bwide\s*spread/i,
  /\bcrowded?\b/i, /\bthin\b/i, /\breversal\s*risk/i, /\bmean[\s-]revert/i,
  /\bfade\b/i, /\bbearish\b/i, /\bagainst\s*(?:the\s*)?(?:market|trend)/i,
  /\brisk\b/i, /\bcaution/i, /\boverhead\s*resist/i, /\bfloat\s*fully\b/i,
  /\bhigh\s*(?:of\s*day|range)/i,
];

// Uncertainty indicators
const UNCERTAINTY_PATTERNS: RegExp[] = [
  /\bambig/i, /\bunclear/i, /\bmixed\s*signal/i, /\bconflict/i,
  /\buncertain/i, /\blow\s*(?:confidence|conviction)/i, /\bnot\s*enough/i,
  /\binsufficient/i, /\blimited\s*data/i, /\bborderline/i,
];

// Bullish vs bearish signal words
const BULLISH_WORDS = /\bstrong|bullish|support|tailwind|accel|breakout|buying\s*pressure|fresh\s*momentum|bounce/i;
const BEARISH_WORDS = /\bweak|bearish|resist|headwind|exhaust|fade|reversal|selling\s*pressure|overextend/i;

function inferDirection(text: string, feature: string): "bullish" | "bearish" | "neutral" {
  // Check if the sentence around this feature leans bullish or bearish
  if (BULLISH_WORDS.test(text)) return "bullish";
  if (BEARISH_WORDS.test(text)) return "bearish";
  return "neutral";
}

function inferConviction(
  reasoning: string,
  confidence: number | null,
  tradeScore: number | null,
): "high" | "medium" | "low" | null {
  // Use model's confidence score as primary signal
  if (confidence != null) {
    if (confidence >= 75) return "high";
    if (confidence >= 45) return "medium";
    return "low";
  }
  // Fallback to trade_score
  if (tradeScore != null) {
    if (tradeScore >= 70) return "high";
    if (tradeScore >= 40) return "medium";
    return "low";
  }
  return null;
}

/**
 * Extract structured reasoning from a model's reasoning text.
 * Designed to be fast (no LLM call) and resilient to varied phrasings.
 */
export function extractStructuredReasoning(
  reasoning: string | null,
  confidence: number | null,
  tradeScore: number | null,
): StructuredReasoning {
  const empty: StructuredReasoning = {
    key_drivers: [],
    risk_factors: [],
    uncertainties: [],
    conviction: null,
  };

  if (!reasoning || reasoning.trim().length === 0) return empty;

  const text = reasoning.trim();

  // Extract key drivers by matching feature keywords
  const seenFeatures = new Set<string>();
  const key_drivers: StructuredReasoning["key_drivers"] = [];

  for (const [pattern, feature] of FEATURE_KEYWORDS) {
    if (pattern.test(text) && !seenFeatures.has(feature)) {
      seenFeatures.add(feature);
      key_drivers.push({
        feature,
        direction: inferDirection(text, feature),
        weight: key_drivers.length === 0 ? 1.0 : 0.5, // first mentioned = primary driver
      });
    }
  }

  // Extract risk factors
  const risk_factors: string[] = [];
  for (const pattern of RISK_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      // Extract a short phrase around the match
      const idx = match.index!;
      const start = Math.max(0, text.lastIndexOf(" ", Math.max(0, idx - 20)) + 1);
      const end = Math.min(text.length, text.indexOf(" ", idx + match[0].length + 15));
      const phrase = text.slice(start, end === -1 ? undefined : end).trim();
      if (phrase.length > 3 && phrase.length < 80 && !risk_factors.includes(phrase)) {
        risk_factors.push(phrase);
      }
    }
  }

  // Extract uncertainties
  const uncertainties: string[] = [];
  for (const pattern of UNCERTAINTY_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const idx = match.index!;
      const start = Math.max(0, text.lastIndexOf(" ", Math.max(0, idx - 15)) + 1);
      const end = Math.min(text.length, text.indexOf(" ", idx + match[0].length + 15));
      const phrase = text.slice(start, end === -1 ? undefined : end).trim();
      if (phrase.length > 3 && phrase.length < 80 && !uncertainties.includes(phrase)) {
        uncertainties.push(phrase);
      }
    }
  }

  const conviction = inferConviction(text, confidence, tradeScore);

  return { key_drivers, risk_factors, uncertainties, conviction };
}
