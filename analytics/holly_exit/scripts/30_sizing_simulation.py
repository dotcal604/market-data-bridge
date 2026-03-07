"""
30_sizing_simulation.py — Holly Sizing Simulation Engine
========================================================
Runs three sizing engines across a scenario grid against the canonical
Silver layer, producing dual-track (vendor + price) P&L simulations.

Sizing engines:
  A) vendor_100_share  — Holly's native 100-share baseline
  B) fixed_notional    — Fixed dollar cap per trade
  C) hybrid_risk_cap   — Risk-budget + capital cap (realistic)

Outputs:
  output/reports/sizing/sizing_scenarios.parquet  — full trade-level sim
  output/reports/sizing/sizing_summary.csv        — one row per scenario
  output/reports/sizing/live_trade_profile.json   — calibration from real fills
  output/reports/sizing/charts/*.png              — comparison charts

Usage:
    python analytics/holly_exit/scripts/30_sizing_simulation.py
    python analytics/holly_exit/scripts/30_sizing_simulation.py --fills data/raw/tradersync_fills.csv
    python analytics/holly_exit/scripts/30_sizing_simulation.py --charts-only
"""

import argparse
import json
import logging
import sys
import time
from pathlib import Path
from dataclasses import dataclass, asdict
from typing import Optional

import duckdb
import numpy as np
import pandas as pd

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

SCRIPT_DIR = Path(__file__).resolve().parent
ANALYTICS_DIR = SCRIPT_DIR.parent.parent
PROJECT_ROOT = ANALYTICS_DIR.parent

SILVER_DDB = PROJECT_ROOT / "data" / "silver" / "holly_trades.duckdb"
OUTPUT_DIR = SCRIPT_DIR.parent / "output" / "reports" / "sizing"
CHART_DIR = OUTPUT_DIR / "charts"

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Sizing engines
# ---------------------------------------------------------------------------

@dataclass
class SizingScenario:
    """One sizing scenario configuration."""
    name: str
    engine: str  # "baseline" | "fixed_notional" | "hybrid_risk_cap"
    dollar_cap: Optional[float] = None
    account_equity: Optional[float] = None
    risk_frac: Optional[float] = None
    cap_frac: Optional[float] = None
    low_price_guard: bool = True


def size_baseline(df: pd.DataFrame, _scenario: SizingScenario) -> pd.Series:
    """Engine A: Holly's native 100 shares."""
    return df["shares"].copy()


def size_fixed_notional(df: pd.DataFrame, scenario: SizingScenario) -> pd.Series:
    """Engine B: Fixed dollar cap per trade."""
    cap = scenario.dollar_cap or 5000.0
    # Low-price guardrails
    effective_cap = pd.Series(cap, index=df.index)
    if scenario.low_price_guard:
        effective_cap = np.where(df["entry_price"] < 5, cap * 0.5, effective_cap)
        effective_cap = np.where(df["entry_price"] < 2, cap * 0.25, effective_cap)
    return np.floor(effective_cap / df["entry_price"].replace(0, 1)).clip(lower=0)


def size_hybrid_risk_cap(df: pd.DataFrame, scenario: SizingScenario) -> pd.Series:
    """Engine C: Risk-budget + capital cap (realistic)."""
    equity = scenario.account_equity or 50_000
    risk_frac = scenario.risk_frac or 0.005
    cap_frac = scenario.cap_frac or 0.10

    risk_budget = equity * risk_frac
    cap_budget = equity * cap_frac
    if scenario.dollar_cap:
        cap_budget = min(cap_budget, scenario.dollar_cap)

    # Low-price guardrails
    effective_cap = pd.Series(cap_budget, index=df.index)
    if scenario.low_price_guard:
        effective_cap = np.where(df["entry_price"] < 5, cap_budget * 0.5, effective_cap)
        effective_cap = np.where(df["entry_price"] < 2, cap_budget * 0.25, effective_cap)

    risk_safe = df["risk_per_share"].replace(0, float("nan"))
    shares_risk = np.floor(risk_budget / risk_safe)
    shares_cap = np.floor(effective_cap / df["entry_price"].replace(0, 1))

    return np.minimum(shares_risk, shares_cap).clip(lower=0).fillna(0)


ENGINES = {
    "baseline": size_baseline,
    "fixed_notional": size_fixed_notional,
    "hybrid_risk_cap": size_hybrid_risk_cap,
}


# ---------------------------------------------------------------------------
# Simulation runner
# ---------------------------------------------------------------------------

def run_scenario(df: pd.DataFrame, scenario: SizingScenario) -> pd.DataFrame:
    """Run a single sizing scenario, computing dual-track outcomes."""
    engine_fn = ENGINES[scenario.engine]
    sim_shares = engine_fn(df, scenario)

    result = pd.DataFrame({
        "trade_id": df["trade_id"],
        "scenario": scenario.name,
        "engine": scenario.engine,
        "sim_shares": sim_shares,
        "tradeable": sim_shares >= 1,
    })

    risk_safe = df["risk_per_share"].replace(0, float("nan"))
    entry_safe = df["entry_price"].replace(0, float("nan"))

    # Price track
    result["sim_price_pnl"] = (sim_shares * df["signed_exit_move_ps"]).round(2)
    result["sim_price_R"] = df["price_exit_R"]  # R doesn't change with sizing
    result["sim_price_capital"] = (sim_shares * df["entry_price"]).round(2)
    result["sim_price_ron"] = (
        result["sim_price_pnl"] / result["sim_price_capital"].replace(0, float("nan")) * 100
    ).round(4)

    # Vendor track
    result["sim_vendor_pnl"] = (sim_shares * df["vendor_pnl_ps"]).round(2)
    result["sim_vendor_R"] = df["vendor_R"]
    result["sim_vendor_capital"] = result["sim_price_capital"]  # same notional
    result["sim_vendor_ron"] = (
        result["sim_vendor_pnl"] / result["sim_vendor_capital"].replace(0, float("nan")) * 100
    ).round(4)

    # Context columns for aggregation
    result["strategy"] = df["strategy"].values
    result["symbol"] = df["symbol"].values
    result["direction"] = df["direction"].values
    result["entry_price"] = df["entry_price"].values
    result["risk_per_share"] = df["risk_per_share"].values
    result["price_bucket"] = df["price_bucket"].values if "price_bucket" in df.columns else "unknown"
    result["is_winner_price"] = df["signed_exit_move_ps"] > 0
    result["is_winner_vendor"] = df["vendor_pnl_ps"] > 0

    return result


def summarize_scenario(sim: pd.DataFrame) -> dict:
    """Compute summary statistics for one scenario."""
    tradeable = sim[sim["tradeable"]]
    n_total = len(sim)
    n_tradeable = len(tradeable)

    if n_tradeable == 0:
        return {
            "scenario": sim["scenario"].iloc[0],
            "engine": sim["engine"].iloc[0],
            "n_total": n_total,
            "n_tradeable": 0,
            "pct_tradeable": 0,
        }

    # Price track stats
    price_wins = tradeable["is_winner_price"].sum()
    price_losses = n_tradeable - price_wins
    price_avg_win = tradeable.loc[tradeable["is_winner_price"], "sim_price_pnl"].mean()
    price_avg_loss = tradeable.loc[~tradeable["is_winner_price"], "sim_price_pnl"].mean()

    # Vendor track stats
    vendor_wins = tradeable["is_winner_vendor"].sum()
    vendor_avg_win = tradeable.loc[tradeable["is_winner_vendor"], "sim_vendor_pnl"].mean()
    vendor_avg_loss = tradeable.loc[~tradeable["is_winner_vendor"], "sim_vendor_pnl"].mean()

    # Low-price concentration
    if "price_bucket" in tradeable.columns:
        low_price_pnl = tradeable.loc[
            tradeable["entry_price"] < 5, "sim_price_pnl"
        ].sum()
        total_pnl = tradeable["sim_price_pnl"].sum()
        low_price_pct = (
            abs(low_price_pnl) / max(abs(total_pnl), 1) * 100
        ) if total_pnl != 0 else 0
    else:
        low_price_pct = 0

    return {
        "scenario": sim["scenario"].iloc[0],
        "engine": sim["engine"].iloc[0],
        "n_total": n_total,
        "n_tradeable": n_tradeable,
        "pct_tradeable": round(n_tradeable / n_total * 100, 1),
        # Price track
        "price_total_pnl": round(tradeable["sim_price_pnl"].sum(), 2),
        "price_mean_pnl": round(tradeable["sim_price_pnl"].mean(), 2),
        "price_median_pnl": round(tradeable["sim_price_pnl"].median(), 2),
        "price_mean_R": round(tradeable["sim_price_R"].mean(), 4),
        "price_median_R": round(tradeable["sim_price_R"].median(), 4),
        "price_win_rate": round(price_wins / n_tradeable * 100, 2),
        "price_payoff_ratio": round(
            abs(price_avg_win / price_avg_loss) if price_avg_loss else 0, 2
        ),
        "price_expectancy": round(
            (price_wins / n_tradeable) * (price_avg_win or 0)
            + (price_losses / n_tradeable) * (price_avg_loss or 0), 2
        ),
        "price_total_capital": round(tradeable["sim_price_capital"].sum(), 0),
        "price_ron_pct": round(
            tradeable["sim_price_pnl"].sum()
            / tradeable["sim_price_capital"].sum() * 100, 4
        ) if tradeable["sim_price_capital"].sum() > 0 else 0,
        # Vendor track
        "vendor_total_pnl": round(tradeable["sim_vendor_pnl"].sum(), 2),
        "vendor_mean_pnl": round(tradeable["sim_vendor_pnl"].mean(), 2),
        "vendor_median_pnl": round(tradeable["sim_vendor_pnl"].median(), 2),
        "vendor_mean_R": round(tradeable["sim_vendor_R"].mean(), 4),
        "vendor_median_R": round(tradeable["sim_vendor_R"].median(), 4),
        "vendor_win_rate": round(vendor_wins / n_tradeable * 100, 2),
        "vendor_payoff_ratio": round(
            abs(vendor_avg_win / vendor_avg_loss) if vendor_avg_loss else 0, 2
        ),
        "vendor_expectancy": round(
            (vendor_wins / n_tradeable) * (vendor_avg_win or 0)
            + ((n_tradeable - vendor_wins) / n_tradeable) * (vendor_avg_loss or 0), 2
        ),
        # Concentration
        "low_price_pnl_pct": round(low_price_pct, 1),
        "mean_sim_shares": round(tradeable["sim_shares"].mean(), 1),
        "median_sim_shares": round(tradeable["sim_shares"].median(), 1),
        "mean_capital_per_trade": round(tradeable["sim_price_capital"].mean(), 0),
    }


# ---------------------------------------------------------------------------
# Live trade calibration
# ---------------------------------------------------------------------------

def build_live_profile(fills_path: Path) -> dict:
    """Parse real fills CSV to calibrate realistic cap grid."""
    if not fills_path.exists():
        logger.warning(f"Fills file not found: {fills_path}")
        return _default_profile()

    df = pd.read_csv(fills_path)
    logger.info(f"Loaded {len(df)} fills from {fills_path.name}")

    # Handle money columns — strip $ and commas
    money_cols = ["Entry Price", "Exit Price", "Return $", "Cost",
                  "Avg Buy", "Avg Sell", "Net Return", "Commision"]
    for col in money_cols:
        if col in df.columns:
            df[col] = (
                df[col].astype(str)
                .str.replace(r"[$,()]", "", regex=True)
                .str.strip()
            )
            df[col] = pd.to_numeric(df[col], errors="coerce")

    # Also try IBKR Flex format columns
    if "Cost" not in df.columns and "CostBasis" in df.columns:
        df["Cost"] = pd.to_numeric(df["CostBasis"], errors="coerce").abs()
    if "Cost" not in df.columns and "Proceeds" in df.columns:
        # Use abs(Proceeds) as proxy for cost
        df["Cost"] = pd.to_numeric(df["Proceeds"], errors="coerce").abs()

    cost = df["Cost"].dropna()
    cost = cost[cost > 0]

    if len(cost) < 5:
        logger.warning(f"Only {len(cost)} valid cost entries, using defaults")
        return _default_profile()

    profile = {
        "source": str(fills_path),
        "trade_count": len(df),
        "valid_cost_count": len(cost),
        "cost_p25": round(float(cost.quantile(0.25)), 2),
        "cost_p50": round(float(cost.quantile(0.50)), 2),
        "cost_p75": round(float(cost.quantile(0.75)), 2),
        "cost_p90": round(float(cost.quantile(0.90)), 2),
        "cost_mean": round(float(cost.mean()), 2),
        "cost_std": round(float(cost.std()), 2),
        "cap_grid": {
            "conservative": round(float(cost.quantile(0.25)), 0),
            "moderate": round(float(cost.quantile(0.50)), 0),
            "aggressive": round(float(cost.quantile(0.75)), 0),
            "max": round(float(cost.quantile(0.90)), 0),
        },
    }

    # Entry price distribution
    entry = None
    for col in ["Entry Price", "TradePrice", "Price"]:
        if col in df.columns:
            entry = pd.to_numeric(df[col], errors="coerce").dropna()
            break
    if entry is not None and len(entry) > 0:
        profile["entry_price_p50"] = round(float(entry.median()), 2)
        profile["entry_price_mean"] = round(float(entry.mean()), 2)

    # Size distribution
    for col in ["Size", "Quantity", "TradedQuantity"]:
        if col in df.columns:
            size = pd.to_numeric(df[col], errors="coerce").abs().dropna()
            if len(size) > 0:
                profile["size_p50"] = round(float(size.median()), 0)
                profile["size_mean"] = round(float(size.mean()), 1)
                break

    return profile


def _default_profile() -> dict:
    """Fallback cap grid when no fills data available."""
    return {
        "source": "default (no fills data)",
        "trade_count": 0,
        "cap_grid": {
            "conservative": 2000,
            "moderate": 3500,
            "aggressive": 5000,
            "max": 7500,
        },
    }


# ---------------------------------------------------------------------------
# Scenario grid builder
# ---------------------------------------------------------------------------

def build_scenario_grid(profile: dict) -> list[SizingScenario]:
    """Build the full scenario grid."""
    grid = profile.get("cap_grid", _default_profile()["cap_grid"])
    scenarios = []

    # A) Baseline
    scenarios.append(SizingScenario(
        name="baseline_100_share",
        engine="baseline",
    ))

    # B) Fixed-notional from live calibration
    for label, cap in grid.items():
        scenarios.append(SizingScenario(
            name=f"fixed_{label}_{int(cap)}",
            engine="fixed_notional",
            dollar_cap=float(cap),
        ))

    # C) Hybrid risk+cap scenarios
    equities = [25_000, 50_000, 100_000]
    risk_fracs = [0.0025, 0.005, 0.0075]  # 0.25%, 0.50%, 0.75%
    cap_fracs = [0.05, 0.10, 0.15]  # 5%, 10%, 15%

    for equity in equities:
        for rf in risk_fracs:
            for cf in cap_fracs:
                rf_pct = f"{rf*100:.2f}".rstrip("0").rstrip(".")
                cf_pct = f"{cf*100:.0f}"
                name = f"hybrid_{equity//1000}k_r{rf_pct}_c{cf_pct}"
                scenarios.append(SizingScenario(
                    name=name,
                    engine="hybrid_risk_cap",
                    account_equity=float(equity),
                    risk_frac=rf,
                    cap_frac=cf,
                ))

    # C+) Hybrid with dollar cap from live data
    for cap_label in ["moderate", "aggressive"]:
        cap = grid.get(cap_label, 3500)
        for equity in [50_000, 100_000]:
            scenarios.append(SizingScenario(
                name=f"hybrid_{equity//1000}k_r0.5_c10_cap{int(cap)}",
                engine="hybrid_risk_cap",
                account_equity=float(equity),
                risk_frac=0.005,
                cap_frac=0.10,
                dollar_cap=float(cap),
            ))

    return scenarios


# ---------------------------------------------------------------------------
# Charts
# ---------------------------------------------------------------------------

def generate_charts(df_silver: pd.DataFrame, summary_df: pd.DataFrame):
    """Generate comparison charts."""
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError:
        logger.warning("matplotlib not available, skipping charts")
        return

    CHART_DIR.mkdir(parents=True, exist_ok=True)

    # 1. Entry price histogram
    fig, ax = plt.subplots(figsize=(10, 6))
    ax.hist(df_silver["entry_price"].clip(upper=200), bins=80, edgecolor="black", alpha=0.7)
    ax.set_xlabel("Entry Price ($)")
    ax.set_ylabel("Count")
    ax.set_title("Holly Trade Entry Price Distribution")
    ax.axvline(5, color="red", linestyle="--", label="$5 low-price threshold")
    ax.legend()
    fig.tight_layout()
    fig.savefig(CHART_DIR / "entry_price_histogram.png", dpi=150)
    plt.close(fig)

    # 2. Baseline notional histogram
    if "baseline_notional" in df_silver.columns:
        fig, ax = plt.subplots(figsize=(10, 6))
        ax.hist(df_silver["baseline_notional"].clip(upper=50000), bins=80, edgecolor="black", alpha=0.7)
        ax.set_xlabel("Baseline Notional (100 shares × entry price)")
        ax.set_ylabel("Count")
        ax.set_title("100-Share Notional Exposure Distribution")
        fig.tight_layout()
        fig.savefig(CHART_DIR / "baseline_notional_histogram.png", dpi=150)
        plt.close(fig)

    # 3. Vendor R vs Price R scatter
    if "vendor_R" in df_silver.columns and "price_exit_R" in df_silver.columns:
        mask = df_silver["vendor_R"].notna() & df_silver["price_exit_R"].notna()
        subset = df_silver[mask].sample(min(5000, mask.sum()), random_state=42)
        fig, ax = plt.subplots(figsize=(8, 8))
        ax.scatter(subset["price_exit_R"], subset["vendor_R"], alpha=0.15, s=8)
        lims = [-5, 5]
        ax.plot(lims, lims, "r--", alpha=0.5, label="y=x (perfect agreement)")
        ax.set_xlim(lims)
        ax.set_ylim(lims)
        ax.set_xlabel("Price Exit R")
        ax.set_ylabel("Vendor R (holly_pnl-derived)")
        ax.set_title("Vendor R vs Price R — Dual Track Comparison")
        ax.legend()
        fig.tight_layout()
        fig.savefig(CHART_DIR / "vendor_vs_price_R_scatter.png", dpi=150)
        plt.close(fig)

    # 4. Strategy boxplots (vendor R)
    if "vendor_R" in df_silver.columns:
        strat_counts = df_silver["strategy"].value_counts()
        top_strats = strat_counts.head(15).index.tolist()
        subset = df_silver[df_silver["strategy"].isin(top_strats)].copy()
        subset["vendor_R_clip"] = subset["vendor_R"].clip(-5, 5)

        fig, ax = plt.subplots(figsize=(14, 7))
        subset.boxplot(column="vendor_R_clip", by="strategy", ax=ax, vert=True, rot=45)
        ax.set_title("Vendor R by Strategy (top 15)")
        ax.set_ylabel("Vendor R (clipped ±5)")
        ax.axhline(0, color="red", linestyle="--", alpha=0.5)
        fig.suptitle("")
        fig.tight_layout()
        fig.savefig(CHART_DIR / "vendor_R_by_strategy_boxplot.png", dpi=150)
        plt.close(fig)

    # 5. Scenario comparison bar chart
    if len(summary_df) > 0:
        # Pick a subset of interesting scenarios
        highlight = summary_df[
            summary_df["scenario"].str.contains("baseline|moderate|aggressive|hybrid_50k_r0.5_c10")
        ].head(8)
        if len(highlight) >= 2:
            fig, axes = plt.subplots(1, 2, figsize=(14, 6))

            # Total PnL comparison
            axes[0].barh(highlight["scenario"], highlight["price_total_pnl"], alpha=0.7, label="Price Track")
            axes[0].barh(highlight["scenario"], highlight["vendor_total_pnl"], alpha=0.4, label="Vendor Track")
            axes[0].set_xlabel("Total P&L ($)")
            axes[0].set_title("Total P&L by Scenario")
            axes[0].legend()

            # Tradeable fraction
            axes[1].barh(highlight["scenario"], highlight["pct_tradeable"], alpha=0.7, color="green")
            axes[1].set_xlabel("% Tradeable")
            axes[1].set_title("Tradeable Fraction by Scenario")
            axes[1].set_xlim(0, 105)

            fig.tight_layout()
            fig.savefig(CHART_DIR / "scenario_comparison.png", dpi=150)
            plt.close(fig)

    logger.info(f"Charts saved to {CHART_DIR}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Holly Sizing Simulation")
    parser.add_argument("--fills", type=Path, help="Path to real fills CSV for calibration")
    parser.add_argument("--charts-only", action="store_true", help="Regenerate charts from existing data")
    parser.add_argument("--no-charts", action="store_true", help="Skip chart generation")
    args = parser.parse_args()

    start = time.time()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # ── Load Silver ───────────────────────────────────────────────
    if not SILVER_DDB.exists():
        logger.error(f"Silver DuckDB not found: {SILVER_DDB}")
        logger.error("Run: python analytics/build_silver.py")
        sys.exit(1)

    logger.info(f"Loading Silver from {SILVER_DDB}")
    db = duckdb.connect(str(SILVER_DDB), read_only=True)
    df = db.execute("SELECT * FROM holly_trades").fetchdf()
    db.close()
    logger.info(f"Loaded {len(df):,} trades, {len(df.columns)} columns")

    # Check required columns
    required = ["trade_id", "entry_price", "risk_per_share", "signed_exit_move_ps",
                 "vendor_pnl_ps", "price_exit_R", "vendor_R", "shares"]
    missing = [c for c in required if c not in df.columns]
    if missing:
        logger.error(f"Silver is missing columns: {missing}")
        logger.error("Rebuild Silver: python analytics/build_silver.py")
        sys.exit(1)

    # ── Calibration from real fills ───────────────────────────────
    fills_path = args.fills
    if not fills_path:
        # Try default locations
        for candidate in [
            SCRIPT_DIR.parent / "data" / "raw" / "tradersync_fills.csv",
            PROJECT_ROOT / "data" / "inbox" / "fills.csv",
        ]:
            if candidate.exists():
                fills_path = candidate
                break

    profile = build_live_profile(fills_path) if fills_path else _default_profile()
    profile_path = OUTPUT_DIR / "live_trade_profile.json"
    with open(profile_path, "w") as f:
        json.dump(profile, f, indent=2)
    logger.info(f"Live profile → {profile_path}")
    logger.info(f"Cap grid: {profile['cap_grid']}")

    # ── Build & run scenario grid ─────────────────────────────────
    scenarios = build_scenario_grid(profile)
    logger.info(f"Running {len(scenarios)} scenarios...")

    all_sims = []
    summaries = []

    for i, scenario in enumerate(scenarios):
        sim = run_scenario(df, scenario)
        summary = summarize_scenario(sim)
        all_sims.append(sim)
        summaries.append(summary)

        if (i + 1) % 10 == 0:
            logger.info(f"  {i+1}/{len(scenarios)} scenarios complete")

    logger.info(f"All {len(scenarios)} scenarios complete")

    # ── Save outputs ──────────────────────────────────────────────
    summary_df = pd.DataFrame(summaries)
    summary_path = OUTPUT_DIR / "sizing_summary.csv"
    summary_df.to_csv(summary_path, index=False)
    logger.info(f"Summary → {summary_path} ({len(summary_df)} scenarios)")

    # Full sim (trade-level) — this can be large
    sim_df = pd.concat(all_sims, ignore_index=True)
    sim_path = OUTPUT_DIR / "sizing_scenarios.parquet"
    sim_df.to_parquet(sim_path, index=False, engine="pyarrow")
    logger.info(f"Full sim → {sim_path} ({len(sim_df):,} rows)")

    # ── Charts ────────────────────────────────────────────────────
    if not args.no_charts:
        generate_charts(df, summary_df)

    # ── Executive summary ─────────────────────────────────────────
    duration = time.time() - start
    baseline = summary_df[summary_df["scenario"] == "baseline_100_share"].iloc[0]

    print(f"\n{'='*70}")
    print(f"SIZING SIMULATION COMPLETE — {len(scenarios)} scenarios, {duration:.1f}s")
    print(f"{'='*70}")
    print(f"\nTrades: {len(df):,}")
    print(f"Strategies: {df['strategy'].nunique()}")
    print(f"\n-- Baseline (100 shares) --")
    print(f"  Price track:  ${baseline['price_total_pnl']:>12,.2f}  WR: {baseline['price_win_rate']:.1f}%  Mean R: {baseline['price_mean_R']:.3f}")
    print(f"  Vendor track: ${baseline['vendor_total_pnl']:>12,.2f}  WR: {baseline['vendor_win_rate']:.1f}%  Mean R: {baseline['vendor_mean_R']:.3f}")
    print(f"  Low-price PnL concentration: {baseline['low_price_pnl_pct']:.1f}%")

    # Show top scenarios by expectancy
    realistic = summary_df[summary_df["engine"] == "hybrid_risk_cap"].nlargest(5, "price_expectancy")
    if len(realistic) > 0:
        print(f"\n-- Top 5 Hybrid Scenarios (by price expectancy) --")
        for _, row in realistic.iterrows():
            print(f"  {row['scenario']:<45s}  "
                  f"E[${row['price_expectancy']:>7.2f}]  "
                  f"WR: {row['price_win_rate']:.1f}%  "
                  f"Total: ${row['price_total_pnl']:>12,.0f}  "
                  f"Tradeable: {row['pct_tradeable']:.0f}%")

    # Vendor vs price divergence
    if "vendor_total_pnl" in baseline and "price_total_pnl" in baseline:
        delta = baseline["vendor_total_pnl"] - baseline["price_total_pnl"]
        print(f"\n-- Vendor vs Price Track Divergence (baseline) --")
        print(f"  Vendor - Price total PnL: ${delta:>+12,.2f}")
        print(f"  {'WARNING: Significant divergence' if abs(delta) > 10000 else '  Tracks are reasonably aligned'}")

    print(f"\nOutputs: {OUTPUT_DIR}")
    print(f"{'='*70}\n")


if __name__ == "__main__":
    main()
