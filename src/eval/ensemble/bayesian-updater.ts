/**
 * Bayesian Ensemble Calibration Module
 * 
 * Implements a dynamic weight updating mechanism for the multi-agent ensemble (Claude, Gemini, OpenAI)
 * using a Dirichlet-Multinomial conjugate prior model.
 * 
 * Mathematical Framework:
 * 
 * 1. The Ensemble Weights are treated as a random vector w ~ Dirichlet(α)
 *    where α = [α_1, α_2, ..., α_K] represent the "concentration parameters" (pseudo-counts) for K models.
 * 
 * 2. Posterior Update Rule:
 *    Upon observing a trade outcome where Model i correctly predicted the direction:
 *    α_i_new = α_i_old + decay_factor * outcome_weight
 *    
 *    This allows the weights w_i = E[Dir(α)] = α_i / Σα_j to drift dynamically towards the best performers.
 * 
 * 3. Regime Conditioning:
 *    We maintain separate Alpha vectors for different market regimes (e.g., TRENDING, CHOP, VOLATILE).
 *    Weights are queried based on the current HMM state.
 */

export type ModelId = 'claude' | 'gemini' | 'openai';
export type MarketRegime = 'TRENDING' | 'CHOP' | 'VOLATILE';

// Default priors (uniform belief)
const DEFAULT_ALPHA = 1.0; 
const DECAY_FACTOR = 0.99; // Forgetting factor to prioritize recent performance

interface DirichletParams {
  claude: number;
  gemini: number;
  openai: number;
}

export class BayesianUpdater {
  // State: Map of Regime -> Dirichlet Parameters (Alphas)
  private priors: Map<MarketRegime, DirichletParams> = new Map();

  constructor() {
    this.initializePriors();
  }

  private initializePriors() {
    const regimes: MarketRegime[] = ['TRENDING', 'CHOP', 'VOLATILE'];
    for (const regime of regimes) {
      this.priors.set(regime, {
        claude: DEFAULT_ALPHA,
        gemini: DEFAULT_ALPHA,
        openai: DEFAULT_ALPHA,
      });
    }
  }

  /**
   * Get the current expected weights (E[w]) for a given regime.
   * E[w_i] = α_i / Σα_j
   * @param regime Market regime
   * @returns Normalized weights
   */
  public getWeights(regime: MarketRegime): Record<ModelId, number> {
    const alpha = this.priors.get(regime) || { claude: 1, gemini: 1, openai: 1 };
    const sumAlpha = alpha.claude + alpha.gemini + alpha.openai;

    return {
      claude: alpha.claude / sumAlpha,
      gemini: alpha.gemini / sumAlpha,
      openai: alpha.openai / sumAlpha,
    };
  }

  /**
   * Update the priors based on a trade outcome.
   * 
   * @param regime The market regime when the trade was taken.
   * @param outcome The result of the trade (-1 for loss, 1 for win).
   * @param predictions The predictions made by each model (1 for Long, -1 for Short, 0 for Neutral).
   * @param actualDirection The actual direction of the move (1 for Up, -1 for Down).
   */
  public updatePriors(
    regime: MarketRegime,
    outcome: number, // PnL or R-multiple
    predictions: Record<ModelId, number>,
    actualDirection: number
  ): void {
    const alpha = this.priors.get(regime);
    if (!alpha) return;

    // Apply decay to all alphas to keep the distribution reactive (prevent counts from growing to infinity)
    // This is effectively a "rolling window" implementation of the Dirichlet process
    alpha.claude *= DECAY_FACTOR;
    alpha.gemini *= DECAY_FACTOR;
    alpha.openai *= DECAY_FACTOR;

    // Boost the alpha of models that were correct
    const reward = Math.max(0, outcome); // Only reward positive outcomes, or we could penalize? 
    // Bayesian update typically counts "successes". 
    // If a model predicted the correct direction AND the trade was profitable.
    
    // We will use a soft update rule:
    // If model predicted correctly, add (1 * reward_magnitude) to its alpha.
    
    const updateModel = (model: ModelId) => {
      const pred = predictions[model];
      // If prediction matched actual direction
      if (pred === actualDirection) {
        // Boost alpha by the R-multiple (capped at some logical max to prevent outliers blowing up weights)
        const boost = Math.min(Math.abs(reward), 5.0); 
        alpha[model] += boost;
      }
    };

    updateModel('claude');
    updateModel('gemini');
    updateModel('openai');

    // Ensure alphas don't drop below a minimum epsilon to avoid zero division
    const epsilon = 0.1;
    alpha.claude = Math.max(alpha.claude, epsilon);
    alpha.gemini = Math.max(alpha.gemini, epsilon);
    alpha.openai = Math.max(alpha.openai, epsilon);

    this.priors.set(regime, alpha);
  }

  /**
   * Serialize state to JSON for persistence.
   * @returns JSON string
   */
  public toJSON(): string {
    return JSON.stringify(Array.from(this.priors.entries()));
  }

  /**
   * Hydrate state from JSON.
   * @param json JSON string
   */
  public fromJSON(json: string): void {
    try {
      const entries = JSON.parse(json);
      this.priors = new Map(entries);
    } catch (e) {
      // Priors will remain at defaults if hydration fails
      this.initializePriors();
    }
  }
}

// Singleton instance
export const bayesianUpdater = new BayesianUpdater();
