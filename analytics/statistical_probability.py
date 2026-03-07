"""
Statistical Probability Analytics Engine
=========================================
Monte Carlo simulation, Bayesian posteriors, confidence intervals,
regime transitions (Markov), strategy correlations, distribution
analysis, risk metrics (VaR/CVaR), and edge significance testing.

Operates on Holly trades data (CSV or DB).

Usage:
    python analytics/statistical_probability.py [--days 90] [--strategy X] [--sims 10000]
    python analytics/statistical_probability.py --monte-carlo --sims 50000
    python analytics/statistical_probability.py --regime-transitions
    python analytics/statistical_probability.py --full

Called via MCP: run_analytics script="statistical_probability" args=["--full"]
"""

import argparse
import json
import logging
import sys
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

ANALYTICS_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = ANALYTICS_DIR.parent
DATA_DIR = PROJECT_ROOT / "data"
OUTPUT_DIR = ANALYTICS_DIR / "output"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# Silver layer (preferred source — canonical, single truth)
SILVER_DDB = DATA_DIR / "silver" / "holly_trades.duckdb"

# Legacy fallbacks
HOLLY_CSV = ANALYTICS_DIR / "holly_exit" / "output" / "holly_analytics.csv"
DB_PATH = DATA_DIR / "bridge.db"

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Data Loading
# ---------------------------------------------------------------------------

def load_holly_trades(days: Optional[int] = None, strategy: Optional[str] = None) -> pd.DataFrame:
    """Load Holly trades from Silver DuckDB (preferred), CSV fallback, or SQLite fallback."""
    if SILVER_DDB.exists():
        logger.info(f"Loading from Silver DuckDB: {SILVER_DDB}")
        import duckdb
        db = duckdb.connect(str(SILVER_DDB), read_only=True)
        df = db.execute("SELECT * FROM holly_trades").fetchdf()
        db.close()
        for col in ["trade_date", "entry_time", "exit_time"]:
            if col in df.columns:
                df[col] = pd.to_datetime(df[col])
    elif HOLLY_CSV.exists():
        logger.info(f"Silver not found, falling back to CSV: {HOLLY_CSV}")
        df = pd.read_csv(HOLLY_CSV, parse_dates=["trade_date", "entry_time", "exit_time"])
    else:
        logger.info("Silver and CSV not found, trying bridge.db...")
        import sqlite3
        conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
        df = pd.read_sql("SELECT * FROM holly_trades", conn, parse_dates=["trade_date", "entry_time", "exit_time"])
        conn.close()

    if days:
        cutoff = pd.Timestamp.now() - pd.Timedelta(days=days)
        df = df[df["trade_date"] >= cutoff]

    if strategy:
        df = df[df["strategy"] == strategy]

    logger.info(f"Loaded {len(df)} trades ({df['strategy'].nunique()} strategies)")
    return df


# ---------------------------------------------------------------------------
# 1. Monte Carlo Simulation
# ---------------------------------------------------------------------------

def monte_carlo_equity_curves(
    pnl_series: np.ndarray,
    n_sims: int = 10000,
    n_trades: Optional[int] = None,
    starting_equity: float = 0.0,
) -> dict:
    """
    Bootstrap Monte Carlo: resample trade PnLs with replacement,
    build equity curves, compute percentile bands.
    """
    if n_trades is None:
        n_trades = len(pnl_series)

    rng = np.random.default_rng(42)
    # Shape: (n_sims, n_trades) — each row is one simulated sequence
    samples = rng.choice(pnl_series, size=(n_sims, n_trades), replace=True)
    cum_pnl = np.cumsum(samples, axis=1) + starting_equity

    final_pnl = cum_pnl[:, -1]
    max_dd = np.zeros(n_sims)
    for i in range(n_sims):
        running_max = np.maximum.accumulate(cum_pnl[i])
        drawdowns = cum_pnl[i] - running_max
        max_dd[i] = drawdowns.min()

    # Percentile bands at each trade step
    percentiles = [5, 10, 25, 50, 75, 90, 95]
    bands = {}
    for p in percentiles:
        bands[f"P{p}"] = np.percentile(cum_pnl, p, axis=0).tolist()

    return {
        "n_sims": n_sims,
        "n_trades": n_trades,
        "final_pnl": {
            "mean": float(np.mean(final_pnl)),
            "median": float(np.median(final_pnl)),
            "std": float(np.std(final_pnl)),
            "P5": float(np.percentile(final_pnl, 5)),
            "P10": float(np.percentile(final_pnl, 10)),
            "P25": float(np.percentile(final_pnl, 25)),
            "P50": float(np.percentile(final_pnl, 50)),
            "P75": float(np.percentile(final_pnl, 75)),
            "P90": float(np.percentile(final_pnl, 90)),
            "P95": float(np.percentile(final_pnl, 95)),
            "prob_positive": float(np.mean(final_pnl > 0)),
            "prob_gt_10k": float(np.mean(final_pnl > 10000)),
        },
        "max_drawdown": {
            "mean": float(np.mean(max_dd)),
            "median": float(np.median(max_dd)),
            "P5_worst": float(np.percentile(max_dd, 5)),
            "P10_worst": float(np.percentile(max_dd, 10)),
        },
        "equity_bands": bands,
    }


# ---------------------------------------------------------------------------
# 2. Bayesian Analysis
# ---------------------------------------------------------------------------

def bayesian_win_probability(wins: int, total: int, prior_alpha: float = 1.0, prior_beta: float = 1.0) -> dict:
    """
    Beta-Binomial Bayesian posterior for win probability.
    Default prior: Beta(1,1) = uniform.
    """
    post_alpha = prior_alpha + wins
    post_beta = prior_beta + (total - wins)

    from scipy.stats import beta as beta_dist

    mean = post_alpha / (post_alpha + post_beta)
    mode = (post_alpha - 1) / (post_alpha + post_beta - 2) if post_alpha > 1 and post_beta > 1 else mean
    ci_lower, ci_upper = beta_dist.ppf([0.025, 0.975], post_alpha, post_beta)

    # Probability that true win rate > X
    thresholds = [0.50, 0.55, 0.60, 0.65, 0.70]
    prob_gt = {f">{t:.0%}": float(1 - beta_dist.cdf(t, post_alpha, post_beta)) for t in thresholds}

    return {
        "prior": {"alpha": prior_alpha, "beta": prior_beta},
        "posterior": {"alpha": float(post_alpha), "beta": float(post_beta)},
        "mean": float(mean),
        "mode": float(mode),
        "ci_95": [float(ci_lower), float(ci_upper)],
        "ci_width": float(ci_upper - ci_lower),
        "prob_greater_than": prob_gt,
    }


# ---------------------------------------------------------------------------
# 3. Bootstrap Confidence Intervals
# ---------------------------------------------------------------------------

def bootstrap_ci(data: np.ndarray, stat_fn, n_boot: int = 10000, ci: float = 0.95) -> dict:
    """Non-parametric bootstrap CI for any statistic."""
    rng = np.random.default_rng(42)
    boot_stats = np.array([
        stat_fn(rng.choice(data, size=len(data), replace=True))
        for _ in range(n_boot)
    ])
    alpha = (1 - ci) / 2
    return {
        "point_estimate": float(stat_fn(data)),
        "mean": float(np.mean(boot_stats)),
        "std_error": float(np.std(boot_stats)),
        "ci_lower": float(np.percentile(boot_stats, alpha * 100)),
        "ci_upper": float(np.percentile(boot_stats, (1 - alpha) * 100)),
        "ci_level": ci,
    }


# ---------------------------------------------------------------------------
# 4. Regime Transition Matrix (Markov)
# ---------------------------------------------------------------------------

def regime_transitions(df: pd.DataFrame, regime_col: str = "trend_regime") -> dict:
    """
    Compute Markov transition matrix from regime sequences.
    Filters to non-null regime values, sorted by time.
    """
    subset = df.dropna(subset=[regime_col]).sort_values("trade_date")
    if len(subset) < 10:
        return {"error": f"Insufficient data for {regime_col} transitions"}

    regimes = subset[regime_col].values
    states = sorted(set(regimes))
    n = len(states)
    state_idx = {s: i for i, s in enumerate(states)}

    # Count transitions
    trans_count = np.zeros((n, n), dtype=int)
    for i in range(len(regimes) - 1):
        fr = state_idx[regimes[i]]
        to = state_idx[regimes[i + 1]]
        trans_count[fr, to] += 1

    # Normalize to probabilities
    row_sums = trans_count.sum(axis=1, keepdims=True)
    trans_prob = np.divide(trans_count, row_sums, where=row_sums > 0, out=np.zeros_like(trans_count, dtype=float))

    # Stationary distribution (left eigenvector of transpose)
    try:
        eigenvalues, eigenvectors = np.linalg.eig(trans_prob.T)
        idx = np.argmin(np.abs(eigenvalues - 1.0))
        stationary = np.real(eigenvectors[:, idx])
        stationary = stationary / stationary.sum()
    except Exception:
        stationary = row_sums.flatten() / row_sums.sum()

    # Expected duration in each state
    expected_duration = {}
    for i, s in enumerate(states):
        p_stay = trans_prob[i, i]
        expected_duration[s] = float(1 / (1 - p_stay)) if p_stay < 1 else float("inf")

    return {
        "regime_column": regime_col,
        "states": states,
        "transition_matrix": {
            states[i]: {states[j]: round(float(trans_prob[i, j]), 4) for j in range(n)}
            for i in range(n)
        },
        "transition_counts": {
            states[i]: {states[j]: int(trans_count[i, j]) for j in range(n)}
            for i in range(n)
        },
        "stationary_distribution": {s: round(float(stationary[i]), 4) for i, s in enumerate(states)},
        "expected_duration_trades": expected_duration,
        "total_transitions": int(trans_count.sum()),
    }


# ---------------------------------------------------------------------------
# 5. Strategy Correlation Matrix
# ---------------------------------------------------------------------------

def strategy_correlations(df: pd.DataFrame, min_trades: int = 50) -> dict:
    """
    PnL correlation between strategies (daily aggregation).
    Only includes strategies with >= min_trades.
    """
    # Filter strategies with enough trades
    strat_counts = df.groupby("strategy").size()
    valid_strats = strat_counts[strat_counts >= min_trades].index.tolist()

    if len(valid_strats) < 2:
        return {"error": "Need at least 2 strategies with enough trades"}

    subset = df[df["strategy"].isin(valid_strats)]

    # Daily PnL per strategy (pivot)
    daily = subset.pivot_table(
        values="holly_pnl", index="trade_date", columns="strategy", aggfunc="sum", fill_value=0
    )

    corr = daily.corr()

    # Find most/least correlated pairs
    pairs = []
    strats = list(corr.columns)
    for i in range(len(strats)):
        for j in range(i + 1, len(strats)):
            pairs.append({
                "strategy_1": strats[i],
                "strategy_2": strats[j],
                "correlation": round(float(corr.iloc[i, j]), 4),
            })

    pairs.sort(key=lambda x: x["correlation"])

    return {
        "strategies_analyzed": len(valid_strats),
        "min_trades_threshold": min_trades,
        "correlation_matrix": {s: {s2: round(float(corr.loc[s, s2]), 4) for s2 in strats} for s in strats},
        "most_correlated": pairs[-5:] if len(pairs) >= 5 else pairs,
        "least_correlated": pairs[:5] if len(pairs) >= 5 else pairs,
        "avg_correlation": round(float(corr.values[np.triu_indices_from(corr.values, k=1)].mean()), 4),
    }


# ---------------------------------------------------------------------------
# 6. Distribution Analysis
# ---------------------------------------------------------------------------

def distribution_analysis(pnl: np.ndarray) -> dict:
    """PnL distribution: normality tests, best-fit, tail analysis."""
    from scipy import stats as sp_stats

    n = len(pnl)
    mean = float(np.mean(pnl))
    std = float(np.std(pnl))
    median = float(np.median(pnl))
    skew = float(sp_stats.skew(pnl))
    kurt = float(sp_stats.kurtosis(pnl))  # excess kurtosis

    # Normality tests
    if n >= 20:
        shapiro_stat, shapiro_p = sp_stats.shapiro(pnl[:5000])  # shapiro max 5000
        dagostino_stat, dagostino_p = sp_stats.normaltest(pnl) if n >= 20 else (None, None)
        jb_stat, jb_p = sp_stats.jarque_bera(pnl)
    else:
        shapiro_stat = shapiro_p = dagostino_stat = dagostino_p = jb_stat = jb_p = None

    # Fit distributions
    fits = {}
    for dist_name in ["norm", "t", "laplace", "logistic"]:
        try:
            dist = getattr(sp_stats, dist_name)
            params = dist.fit(pnl)
            ks_stat, ks_p = sp_stats.kstest(pnl, dist_name, args=params)
            fits[dist_name] = {
                "params": [round(float(p), 6) for p in params],
                "ks_statistic": round(float(ks_stat), 6),
                "ks_p_value": round(float(ks_p), 6),
            }
        except Exception:
            pass

    best_fit = min(fits.items(), key=lambda x: x[1]["ks_statistic"])[0] if fits else "unknown"

    # Tail analysis
    pnl_sorted = np.sort(pnl)
    percentiles = {
        "P1": float(np.percentile(pnl, 1)),
        "P5": float(np.percentile(pnl, 5)),
        "P10": float(np.percentile(pnl, 10)),
        "P25": float(np.percentile(pnl, 25)),
        "P50": float(median),
        "P75": float(np.percentile(pnl, 75)),
        "P90": float(np.percentile(pnl, 90)),
        "P95": float(np.percentile(pnl, 95)),
        "P99": float(np.percentile(pnl, 99)),
    }

    return {
        "n": n,
        "mean": mean,
        "std": std,
        "median": median,
        "skewness": skew,
        "excess_kurtosis": kurt,
        "normality_tests": {
            "shapiro_wilk": {"statistic": float(shapiro_stat) if shapiro_stat else None, "p_value": float(shapiro_p) if shapiro_p else None},
            "dagostino": {"statistic": float(dagostino_stat) if dagostino_stat else None, "p_value": float(dagostino_p) if dagostino_p else None},
            "jarque_bera": {"statistic": float(jb_stat) if jb_stat else None, "p_value": float(jb_p) if jb_p else None},
        },
        "is_normal": bool(jb_p > 0.05) if jb_p else None,
        "distribution_fits": fits,
        "best_fit": best_fit,
        "percentiles": percentiles,
        "tail_ratio": round(float(abs(np.percentile(pnl, 95)) / abs(np.percentile(pnl, 5))), 4) if np.percentile(pnl, 5) != 0 else None,
    }


# ---------------------------------------------------------------------------
# 7. Risk Metrics (VaR, CVaR, Probability of Ruin)
# ---------------------------------------------------------------------------

def risk_metrics(pnl: np.ndarray, win_rate: float) -> dict:
    """Value at Risk, Conditional VaR, probability of ruin, Kelly."""
    n = len(pnl)
    wins = pnl[pnl > 0]
    losses = pnl[pnl < 0]

    avg_win = float(np.mean(wins)) if len(wins) > 0 else 0
    avg_loss = float(np.mean(losses)) if len(losses) > 0 else 0
    payoff_ratio = abs(avg_win / avg_loss) if avg_loss != 0 else 0

    # Kelly criterion
    kelly = win_rate - (1 - win_rate) / payoff_ratio if payoff_ratio > 0 else 0

    # VaR (Historical)
    var_95 = float(np.percentile(pnl, 5))
    var_99 = float(np.percentile(pnl, 1))

    # CVaR (Expected Shortfall)
    cvar_95 = float(np.mean(pnl[pnl <= var_95])) if np.any(pnl <= var_95) else var_95
    cvar_99 = float(np.mean(pnl[pnl <= var_99])) if np.any(pnl <= var_99) else var_99

    # Probability of ruin (simplified geometric)
    if win_rate > 0.5 and payoff_ratio > 0:
        q_over_p = (1 - win_rate) / win_rate
        # Prob of ruin with 10-unit bankroll
        prob_ruin_10 = min(1.0, q_over_p ** 10)
        prob_ruin_20 = min(1.0, q_over_p ** 20)
    else:
        prob_ruin_10 = 1.0
        prob_ruin_20 = 1.0

    # Max consecutive losses expected
    if win_rate < 1:
        expected_max_losing_streak = round(np.log(n) / np.log(1 / (1 - win_rate)), 1)
    else:
        expected_max_losing_streak = 0

    return {
        "var_95_per_trade": var_95,
        "var_99_per_trade": var_99,
        "cvar_95_per_trade": cvar_95,
        "cvar_99_per_trade": cvar_99,
        "kelly_criterion": round(float(kelly), 4),
        "half_kelly": round(float(kelly / 2), 4),
        "quarter_kelly": round(float(kelly / 4), 4),
        "payoff_ratio": round(float(payoff_ratio), 4),
        "prob_of_ruin_10_units": round(float(prob_ruin_10), 6),
        "prob_of_ruin_20_units": round(float(prob_ruin_20), 6),
        "expected_max_losing_streak": expected_max_losing_streak,
        "avg_win": avg_win,
        "avg_loss": avg_loss,
        "win_count": int(len(wins)),
        "loss_count": int(len(losses)),
    }


# ---------------------------------------------------------------------------
# 8. Edge Significance Testing
# ---------------------------------------------------------------------------

def edge_significance(pnl: np.ndarray, n_permutations: int = 10000) -> dict:
    """
    Permutation test: Is the observed mean PnL significantly different from zero?
    Also runs t-test and bootstrap.
    """
    from scipy import stats as sp_stats

    observed_mean = float(np.mean(pnl))
    n = len(pnl)

    # Parametric: one-sample t-test (H0: mean = 0)
    t_stat, t_p = sp_stats.ttest_1samp(pnl, 0)

    # Non-parametric: permutation test (randomly flip signs)
    rng = np.random.default_rng(42)
    perm_means = np.zeros(n_permutations)
    for i in range(n_permutations):
        signs = rng.choice([-1, 1], size=n)
        perm_means[i] = np.mean(pnl * signs)

    p_value_perm = float(np.mean(np.abs(perm_means) >= abs(observed_mean)))

    # Bootstrap CI for mean
    boot = bootstrap_ci(pnl, np.mean, n_boot=n_permutations)

    # Effect size (Cohen's d)
    cohens_d = observed_mean / np.std(pnl) if np.std(pnl) > 0 else 0

    return {
        "observed_mean_pnl": observed_mean,
        "n_trades": n,
        "t_test": {
            "t_statistic": round(float(t_stat), 4),
            "p_value": round(float(t_p), 6),
            "significant_05": bool(t_p < 0.05),
            "significant_01": bool(t_p < 0.01),
        },
        "permutation_test": {
            "n_permutations": n_permutations,
            "p_value": round(float(p_value_perm), 6),
            "significant_05": bool(p_value_perm < 0.05),
        },
        "bootstrap_ci_95": {
            "lower": boot["ci_lower"],
            "upper": boot["ci_upper"],
            "excludes_zero": bool(boot["ci_lower"] > 0 or boot["ci_upper"] < 0),
        },
        "effect_size": {
            "cohens_d": round(float(cohens_d), 4),
            "interpretation": (
                "large" if abs(cohens_d) >= 0.8 else
                "medium" if abs(cohens_d) >= 0.5 else
                "small" if abs(cohens_d) >= 0.2 else
                "negligible"
            ),
        },
        "verdict": (
            "Strong Edge" if t_p < 0.01 and p_value_perm < 0.05 and abs(cohens_d) >= 0.2 else
            "Likely Edge" if t_p < 0.05 and boot["ci_lower"] > 0 else
            "Possible Edge" if t_p < 0.10 else
            "No Statistical Edge"
        ),
    }


# ---------------------------------------------------------------------------
# 9. Per-Strategy Statistical Profile
# ---------------------------------------------------------------------------

def strategy_profiles(df: pd.DataFrame, min_trades: int = 30) -> list:
    """Compute full statistical profile per strategy."""
    profiles = []
    for strat, group in df.groupby("strategy"):
        n = len(group)
        if n < min_trades:
            continue

        pnl = group["holly_pnl"].values
        wins = int((pnl > 0).sum())
        wr = wins / n

        profile = {
            "strategy": strat,
            "n_trades": n,
            "win_rate": round(wr, 4),
            "total_pnl": round(float(pnl.sum()), 2),
            "avg_pnl": round(float(pnl.mean()), 2),
            "std_pnl": round(float(pnl.std()), 2),
        }

        # Bayesian
        try:
            bayes = bayesian_win_probability(wins, n)
            profile["bayesian_wr_mean"] = bayes["mean"]
            profile["bayesian_ci_95"] = bayes["ci_95"]
            profile["prob_wr_gt_50"] = bayes["prob_greater_than"][">50%"]
            profile["prob_wr_gt_60"] = bayes["prob_greater_than"][">60%"]
        except Exception:
            pass

        # Edge significance
        try:
            edge = edge_significance(pnl, n_permutations=5000)
            profile["t_stat"] = edge["t_test"]["t_statistic"]
            profile["t_p_value"] = edge["t_test"]["p_value"]
            profile["edge_verdict"] = edge["verdict"]
            profile["cohens_d"] = edge["effect_size"]["cohens_d"]
        except Exception:
            pass

        # Risk
        try:
            risk = risk_metrics(pnl, wr)
            profile["kelly"] = risk["kelly_criterion"]
            profile["var_95"] = risk["var_95_per_trade"]
            profile["payoff_ratio"] = risk["payoff_ratio"]
        except Exception:
            pass

        profiles.append(profile)

    # Sort by edge strength
    profiles.sort(key=lambda x: x.get("t_stat", 0), reverse=True)
    return profiles


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def run_full_analysis(df: pd.DataFrame, n_sims: int = 10000) -> dict:
    """Run all analyses and return comprehensive results."""
    pnl = df["holly_pnl"].dropna().values
    wins = int((pnl > 0).sum())
    total = len(pnl)
    wr = wins / total if total > 0 else 0

    logger.info(f"Running full analysis: {total} trades, {wr:.1%} WR")

    results = {
        "metadata": {
            "total_trades": total,
            "win_rate": round(wr, 4),
            "total_pnl": round(float(pnl.sum()), 2),
            "strategies": int(df["strategy"].nunique()),
            "date_range": [str(df["trade_date"].min().date()), str(df["trade_date"].max().date())],
        }
    }

    # 1. Monte Carlo
    logger.info(f"Monte Carlo ({n_sims} simulations)...")
    results["monte_carlo"] = monte_carlo_equity_curves(pnl, n_sims=n_sims)

    # 2. Bayesian
    logger.info("Bayesian posterior...")
    results["bayesian"] = bayesian_win_probability(wins, total)

    # 3. Bootstrap CIs
    logger.info("Bootstrap confidence intervals...")
    results["bootstrap"] = {
        "mean_pnl": bootstrap_ci(pnl, np.mean),
        "median_pnl": bootstrap_ci(pnl, np.median),
        "win_rate": bootstrap_ci((pnl > 0).astype(float), np.mean),
        "sharpe_approx": bootstrap_ci(pnl, lambda x: np.mean(x) / np.std(x) if np.std(x) > 0 else 0),
    }

    # 4. Regime transitions
    logger.info("Regime transition matrices...")
    results["regime_transitions"] = {}
    for col in ["trend_regime", "vol_regime", "momentum_regime"]:
        if col in df.columns:
            results["regime_transitions"][col] = regime_transitions(df, col)

    # 5. Strategy correlations
    logger.info("Strategy correlations...")
    results["strategy_correlations"] = strategy_correlations(df, min_trades=50)

    # 6. Distribution analysis
    logger.info("Distribution analysis...")
    results["distribution"] = distribution_analysis(pnl)

    # 7. Risk metrics
    logger.info("Risk metrics...")
    results["risk"] = risk_metrics(pnl, wr)

    # 8. Edge significance
    logger.info("Edge significance testing...")
    results["edge_significance"] = edge_significance(pnl)

    # 9. Per-strategy profiles
    logger.info("Strategy profiles...")
    results["strategy_profiles"] = strategy_profiles(df, min_trades=30)

    return results


def print_summary(results: dict) -> None:
    """Print human-readable summary to stdout."""
    meta = results["metadata"]
    print(f"\n{'='*60}")
    print(f"STATISTICAL PROBABILITY ANALYSIS")
    print(f"{'='*60}")
    print(f"Trades: {meta['total_trades']:,} | Win Rate: {meta['win_rate']:.1%} | PnL: ${meta['total_pnl']:,.2f}")
    print(f"Strategies: {meta['strategies']} | Range: {meta['date_range'][0]} to {meta['date_range'][1]}")

    # Bayesian
    b = results["bayesian"]
    print(f"\n--- Bayesian Win Probability ---")
    print(f"Posterior: {b['mean']:.1%} (95% CI: {b['ci_95'][0]:.1%} - {b['ci_95'][1]:.1%})")
    for k, v in b["prob_greater_than"].items():
        print(f"  P(WR {k}): {v:.1%}")

    # Edge
    e = results["edge_significance"]
    print(f"\n--- Edge Significance ---")
    print(f"Verdict: {e['verdict']}")
    print(f"t-test: t={e['t_test']['t_statistic']:.2f}, p={e['t_test']['p_value']:.4f}")
    print(f"Permutation: p={e['permutation_test']['p_value']:.4f}")
    print(f"Effect size: d={e['effect_size']['cohens_d']:.3f} ({e['effect_size']['interpretation']})")
    ci = e["bootstrap_ci_95"]
    print(f"Bootstrap CI: ${ci['lower']:.2f} to ${ci['upper']:.2f} (excludes zero: {ci['excludes_zero']})")

    # Monte Carlo
    mc = results["monte_carlo"]["final_pnl"]
    print(f"\n--- Monte Carlo ({results['monte_carlo']['n_sims']:,} sims, {results['monte_carlo']['n_trades']:,} trades) ---")
    print(f"P5:  ${mc['P5']:>12,.2f}   (worst 5%)")
    print(f"P25: ${mc['P25']:>12,.2f}")
    print(f"P50: ${mc['P50']:>12,.2f}   (median)")
    print(f"P75: ${mc['P75']:>12,.2f}")
    print(f"P95: ${mc['P95']:>12,.2f}   (best 5%)")
    print(f"Prob positive: {mc['prob_positive']:.1%}")

    dd = results["monte_carlo"]["max_drawdown"]
    print(f"Max DD (median): ${dd['median']:,.2f} | Worst 5%: ${dd['P5_worst']:,.2f}")

    # Risk
    r = results["risk"]
    print(f"\n--- Risk Metrics ---")
    print(f"VaR 95%: ${r['var_95_per_trade']:.2f} | CVaR 95%: ${r['cvar_95_per_trade']:.2f}")
    print(f"Kelly: {r['kelly_criterion']:.1%} | Half-Kelly: {r['half_kelly']:.1%}")
    print(f"Payoff Ratio: {r['payoff_ratio']:.2f}x | Ruin (10u): {r['prob_of_ruin_10_units']:.4%}")

    # Distribution
    d = results["distribution"]
    print(f"\n--- Distribution ---")
    print(f"Skewness: {d['skewness']:.3f} | Kurtosis: {d['excess_kurtosis']:.3f}")
    print(f"Best fit: {d['best_fit']} | Normal: {'Yes' if d.get('is_normal') else 'No'}")

    # Top strategies
    profiles = results.get("strategy_profiles", [])
    if profiles:
        print(f"\n--- Top Strategies by Edge (min 30 trades) ---")
        print(f"{'Strategy':<25} {'N':>5} {'WR':>6} {'PnL':>10} {'t-stat':>7} {'Kelly':>6} {'Verdict'}")
        for p in profiles[:15]:
            print(f"{p['strategy']:<25} {p['n_trades']:>5} {p['win_rate']:>5.1%} ${p['total_pnl']:>9,.0f} {p.get('t_stat',0):>7.2f} {p.get('kelly',0):>5.1%} {p.get('edge_verdict','?')}")


def main():
    parser = argparse.ArgumentParser(description="Statistical Probability Analytics")
    parser.add_argument("--days", type=int, default=None, help="Filter to last N days")
    parser.add_argument("--strategy", type=str, default=None, help="Filter to strategy")
    parser.add_argument("--sims", type=int, default=10000, help="Monte Carlo simulations")
    parser.add_argument("--full", action="store_true", help="Run full analysis")
    parser.add_argument("--monte-carlo", action="store_true", help="Monte Carlo only")
    parser.add_argument("--regime-transitions", action="store_true", help="Regime transitions only")
    parser.add_argument("--output", type=str, default=None, help="Output JSON path")
    args = parser.parse_args()

    df = load_holly_trades(days=args.days, strategy=args.strategy)
    if len(df) < 20:
        logger.error(f"Insufficient data: {len(df)} trades")
        sys.exit(1)

    if args.monte_carlo:
        pnl = df["holly_pnl"].dropna().values
        results = {"monte_carlo": monte_carlo_equity_curves(pnl, n_sims=args.sims)}
    elif args.regime_transitions:
        results = {"regime_transitions": {}}
        for col in ["trend_regime", "vol_regime", "momentum_regime"]:
            if col in df.columns:
                results["regime_transitions"][col] = regime_transitions(df, col)
    else:
        results = run_full_analysis(df, n_sims=args.sims)
        print_summary(results)

    # Save JSON
    out_path = Path(args.output) if args.output else OUTPUT_DIR / "statistical_probability.json"
    # Convert numpy types for JSON serialization
    class NumpyEncoder(json.JSONEncoder):
        def default(self, obj):
            if isinstance(obj, (np.integer,)): return int(obj)
            if isinstance(obj, (np.floating,)): return float(obj)
            if isinstance(obj, (np.ndarray,)): return obj.tolist()
            if isinstance(obj, (np.bool_,)): return bool(obj)
            return super().default(obj)

    with open(out_path, "w") as f:
        json.dump(results, f, indent=2, cls=NumpyEncoder)
    logger.info(f"Results saved to {out_path}")

    # Also print JSON to stdout for MCP
    print(json.dumps(results, indent=2, cls=NumpyEncoder))


if __name__ == "__main__":
    main()
