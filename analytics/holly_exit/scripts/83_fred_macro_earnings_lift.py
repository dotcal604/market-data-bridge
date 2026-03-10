"""
Script 83 -- FRED Macro Regime & Earnings Calendar Lift
=======================================================
Mines two remaining unmined DuckDB tables:

1. FRED_MACRO_DAILY (2,838 rows)
   - VIX level + 5d change + regime (low/normal/elevated/extreme)
   - Yield curve: 10y-2y spread + regime (inverted/flat/normal/steep)
   - Fed funds rate + regime (zero/low/moderate/high) + direction (hiking/holding/cutting)
   - Put/call ratios (equity + total) + regime + 5d change
   - Absolute levels AND rate-of-change features

2. EARNINGS_CALENDAR (3,368 rows)
   - Days to next earnings for the traded symbol
   - Days since last earnings
   - Trading near earnings might affect momentum behavior

Coverage: fred_macro_daily covers 2015+, earnings_calendar has broad coverage.

Usage:
    python scripts/83_fred_macro_earnings_lift.py
"""

import sys, time, warnings
from pathlib import Path
import numpy as np
import pandas as pd
import duckdb
from scipy import stats

sys.path.insert(0, str(Path(__file__).parent.parent))
from config.settings import DUCKDB_PATH

REPORT_DIR = Path(__file__).parent.parent / "output" / "reports"
warnings.filterwarnings("ignore", category=FutureWarning)


def load_features(con):
    """Load trades + FRED macro + earnings features."""
    t0 = time.time()

    # Base trades
    df = con.execute("""
        SELECT t.trade_id, t.symbol, t.strategy, t.direction,
            t.entry_time, t.entry_price, t.holly_pnl,
            CASE WHEN t.holly_pnl > 0 THEN 1 ELSE 0 END AS win,
            CAST(t.entry_time AS DATE) AS trade_date
        FROM trades t
    """).fetchdf()
    print(f"  Trades: {len(df):,}")

    # === 1. FRED MACRO DAILY ===
    print("  Loading FRED macro features...")
    macro = con.execute("""
        SELECT t.trade_id,
            m.vix,
            m.yield_spread_10y2y,
            m.yield_10y,
            m.yield_2y,
            m.fed_funds_rate,
            m.vix_5d_change,
            m.put_call_equity,
            m.put_call_total,
            m.put_call_5d_change,
            m.vix_regime,
            m.yield_curve_regime,
            m.rate_regime,
            m.rate_direction,
            m.put_call_regime,
            -- Derived: VIX relative to recent range
            m.vix - LAG(m.vix, 5) OVER (ORDER BY m.date) AS vix_5d_diff,
            -- Rate of change features
            m.yield_10y - LAG(m.yield_10y, 5) OVER (ORDER BY m.date) AS yield_10y_5d_change,
            m.yield_2y - LAG(m.yield_2y, 5) OVER (ORDER BY m.date) AS yield_2y_5d_change,
            m.fed_funds_rate - LAG(m.fed_funds_rate, 20) OVER (ORDER BY m.date) AS fed_rate_20d_change
        FROM trades t
        LEFT JOIN fred_macro_daily m ON m.date = CAST(t.entry_time AS DATE)
    """).fetchdf()
    df = df.merge(macro, on="trade_id", how="left")

    macro_cov = df["vix"].notna().sum()
    print(f"    Macro coverage: {macro_cov:,}/{len(df):,} ({100*macro_cov/len(df):.1f}%)")

    # Encode regime categories as numeric (for GBT later)
    regime_maps = {
        "vix_regime": {"low": 0, "normal": 1, "elevated": 2, "extreme": 3},
        "yield_curve_regime": {"inverted": 0, "flat": 1, "normal": 2, "steep": 3},
        "rate_regime": {"zero": 0, "low": 1, "moderate": 2, "high": 3},
        "rate_direction": {"cutting": 0, "holding": 1, "hiking": 2},
        "put_call_regime": {"bearish": 0, "neutral": 1, "bullish": 2},
    }
    for col, mapping in regime_maps.items():
        num_col = f"{col}_num"
        df[num_col] = df[col].map(mapping)

    # === 2. EARNINGS CALENDAR ===
    print("  Loading earnings calendar features...")
    earnings = con.execute("""
        SELECT t.trade_id,
            -- Days to next earnings
            DATEDIFF('day', CAST(t.entry_time AS DATE),
                (SELECT MIN(e.earnings_date) FROM earnings_calendar e
                 WHERE e.symbol = t.symbol AND e.earnings_date >= CAST(t.entry_time AS DATE))
            ) AS days_to_earnings,
            -- Days since last earnings
            DATEDIFF('day',
                (SELECT MAX(e.earnings_date) FROM earnings_calendar e
                 WHERE e.symbol = t.symbol AND e.earnings_date < CAST(t.entry_time AS DATE)),
                CAST(t.entry_time AS DATE)
            ) AS days_since_earnings,
            -- Has earnings data at all
            CASE WHEN EXISTS (SELECT 1 FROM earnings_calendar e WHERE e.symbol = t.symbol)
                 THEN 1 ELSE 0 END AS has_earnings_data
        FROM trades t
    """).fetchdf()
    df = df.merge(earnings, on="trade_id", how="left")

    earn_cov = df["has_earnings_data"].sum()
    near_earn = (df["days_to_earnings"].fillna(999) <= 5).sum()
    print(f"    Earnings coverage: {earn_cov:,}/{len(df):,} ({100*earn_cov/len(df):.1f}%)")
    print(f"    Trades within 5 days of earnings: {near_earn:,}")

    # Binary: trading near earnings (within 3 days before or after)
    df["near_earnings"] = ((df["days_to_earnings"].fillna(999) <= 3) |
                           (df["days_since_earnings"].fillna(999) <= 3)).astype(int)

    elapsed = time.time() - t0
    print(f"  All features loaded: {len(df):,} trades ({elapsed:.1f}s)")
    return df


def cohens_d(wins, losses):
    """Compute Cohen's d effect size."""
    n1, n2 = len(wins), len(losses)
    if n1 < 5 or n2 < 5:
        return 0.0
    m1, m2 = wins.mean(), losses.mean()
    s1, s2 = wins.std(ddof=1), losses.std(ddof=1)
    sp = np.sqrt(((n1 - 1) * s1 ** 2 + (n2 - 1) * s2 ** 2) / (n1 + n2 - 2))
    if sp < 1e-12:
        return 0.0
    return (m1 - m2) / sp


def analyze_features(df, features, label=""):
    """Analyze win/loss separation for a set of features."""
    results = []
    wins = df[df["win"] == 1]
    losses = df[df["win"] == 0]

    for feat in features:
        vals = df[feat].dropna()
        if len(vals) < 100:
            continue

        w = wins[feat].dropna()
        l = losses[feat].dropna()
        if len(w) < 30 or len(l) < 30:
            continue

        d = cohens_d(w, l)
        t_stat, p_val = stats.ttest_ind(w, l, equal_var=False)
        coverage = len(vals) / len(df)

        results.append({
            "feature": feat,
            "d": d,
            "abs_d": abs(d),
            "p": p_val,
            "win_mean": w.mean(),
            "loss_mean": l.mean(),
            "coverage": coverage,
            "n": len(vals),
        })

    res = pd.DataFrame(results).sort_values("abs_d", ascending=False)

    # FDR correction
    if len(res) > 0:
        from statsmodels.stats.multitest import multipletests
        _, fdr_p, _, _ = multipletests(res["p"], method="fdr_bh")
        res["fdr_p"] = fdr_p
        res["fdr_sig"] = fdr_p < 0.05

    return res


def analyze_direction_split(df, features):
    """Check if features have different effects for long vs short trades."""
    results = []
    for direction in ["long", "short"]:
        sub = df[df["direction"] == direction]
        if len(sub) < 200:
            continue
        wins = sub[sub["win"] == 1]
        losses = sub[sub["win"] == 0]

        for feat in features:
            w = wins[feat].dropna()
            l = losses[feat].dropna()
            if len(w) < 20 or len(l) < 20:
                continue
            d = cohens_d(w, l)
            results.append({
                "feature": feat,
                "direction": direction,
                "d": d,
                "abs_d": abs(d),
                "n": len(w) + len(l),
            })

    return pd.DataFrame(results)


def analyze_regime_winrates(df, regime_col, label=""):
    """Compute win rates by regime category."""
    results = []
    for regime in df[regime_col].dropna().unique():
        sub = df[df[regime_col] == regime]
        if len(sub) < 50:
            continue
        wr = sub["win"].mean()
        results.append({
            "regime": regime,
            "n": len(sub),
            "win_rate": wr,
            "pnl_mean": sub["holly_pnl"].mean(),
        })
    return pd.DataFrame(results).sort_values("win_rate", ascending=False)


def main():
    print(f"Connecting to {DUCKDB_PATH}")
    con = duckdb.connect(str(DUCKDB_PATH), read_only=True)
    df = load_features(con)
    con.close()

    # === CONTINUOUS FEATURES ===
    continuous_feats = [
        "vix", "vix_5d_change", "vix_5d_diff",
        "yield_spread_10y2y", "yield_10y", "yield_2y",
        "yield_10y_5d_change", "yield_2y_5d_change",
        "fed_funds_rate", "fed_rate_20d_change",
        "put_call_equity", "put_call_total", "put_call_5d_change",
        "days_to_earnings", "days_since_earnings",
    ]
    regime_num_feats = [
        "vix_regime_num", "yield_curve_regime_num",
        "rate_regime_num", "rate_direction_num", "put_call_regime_num",
    ]
    binary_feats = ["near_earnings", "has_earnings_data"]

    all_feats = continuous_feats + regime_num_feats + binary_feats

    print("\n  === CONTINUOUS FEATURE ANALYSIS ===")
    res = analyze_features(df, all_feats)
    print(f"\n  {'Feature':<30s} {'d':>7s} {'p':>10s} {'FDR':>5s} {'WinM':>8s} {'LossM':>8s} {'Cov':>6s} {'N':>7s}")
    print("  " + "-" * 87)
    for _, r in res.iterrows():
        sig = "*" if r.get("fdr_sig", False) else ""
        print(f"  {r['feature']:<30s} {r['d']:>+7.3f} {r['p']:>10.2e} {sig:>5s} "
              f"{r['win_mean']:>8.3f} {r['loss_mean']:>8.3f} {r['coverage']:>5.1%} {r['n']:>7,}")

    fdr_sig = res[res.get("fdr_sig", False) == True] if "fdr_sig" in res.columns else pd.DataFrame()
    print(f"\n  FDR-significant features: {len(fdr_sig)}/{len(res)}")

    # === REGIME WIN RATES ===
    print("\n  === REGIME WIN RATE ANALYSIS ===")
    regime_cols = ["vix_regime", "yield_curve_regime", "rate_regime",
                   "rate_direction", "put_call_regime"]
    overall_wr = df["win"].mean()
    print(f"  Overall win rate: {overall_wr:.1%}")

    for rcol in regime_cols:
        rr = analyze_regime_winrates(df, rcol)
        if len(rr) == 0:
            continue
        print(f"\n  {rcol}:")
        for _, row in rr.iterrows():
            delta = row["win_rate"] - overall_wr
            flag = " <<<" if abs(delta) > 0.02 else ""
            print(f"    {row['regime']:<12s}  WR={row['win_rate']:.1%}  "
                  f"delta={delta:+.1%}  N={row['n']:>5,}  "
                  f"avg_pnl=${row['pnl_mean']:.2f}{flag}")

    # === DIRECTION SPLITS ===
    print("\n  === DIRECTION-SPECIFIC ANALYSIS ===")
    dir_res = analyze_direction_split(df, continuous_feats + regime_num_feats)
    if len(dir_res) > 0:
        # Pivot to show long vs short d side by side
        pivot = dir_res.pivot_table(index="feature", columns="direction",
                                     values="d", aggfunc="first")
        if "long" in pivot.columns and "short" in pivot.columns:
            pivot["diff"] = (pivot["long"] - pivot["short"]).abs()
            pivot = pivot.sort_values("diff", ascending=False)
            print(f"\n  {'Feature':<30s} {'Long d':>8s} {'Short d':>8s} {'|Diff|':>8s}")
            print("  " + "-" * 58)
            for feat, row in pivot.head(20).iterrows():
                flag = " <<<" if row["diff"] > 0.10 else ""
                print(f"  {feat:<30s} {row.get('long', 0):>+8.3f} {row.get('short', 0):>+8.3f} "
                      f"{row['diff']:>8.3f}{flag}")

    # === VIX QUINTILE ANALYSIS ===
    print("\n  === VIX QUINTILE WIN RATES ===")
    vix_valid = df[df["vix"].notna()].copy()
    if len(vix_valid) > 500:
        vix_valid["vix_q"] = pd.qcut(vix_valid["vix"], 5, labels=False, duplicates="drop")
        for q in sorted(vix_valid["vix_q"].unique()):
            sub = vix_valid[vix_valid["vix_q"] == q]
            vmin, vmax = sub["vix"].min(), sub["vix"].max()
            wr = sub["win"].mean()
            delta = wr - overall_wr
            flag = " <<<" if abs(delta) > 0.02 else ""
            print(f"    Q{q}: VIX {vmin:.1f}-{vmax:.1f}  WR={wr:.1%}  delta={delta:+.1%}  "
                  f"N={len(sub):>5,}{flag}")

    # === PUT/CALL QUINTILE ===
    print("\n  === PUT/CALL EQUITY QUINTILE WIN RATES ===")
    pc_valid = df[df["put_call_equity"].notna()].copy()
    if len(pc_valid) > 500:
        pc_valid["pc_q"] = pd.qcut(pc_valid["put_call_equity"], 5, labels=False, duplicates="drop")
        for q in sorted(pc_valid["pc_q"].unique()):
            sub = pc_valid[pc_valid["pc_q"] == q]
            pcmin, pcmax = sub["put_call_equity"].min(), sub["put_call_equity"].max()
            wr = sub["win"].mean()
            delta = wr - overall_wr
            flag = " <<<" if abs(delta) > 0.02 else ""
            print(f"    Q{q}: P/C {pcmin:.2f}-{pcmax:.2f}  WR={wr:.1%}  delta={delta:+.1%}  "
                  f"N={len(sub):>5,}{flag}")

    # === EARNINGS PROXIMITY ANALYSIS ===
    print("\n  === EARNINGS PROXIMITY ANALYSIS ===")
    for days_thresh in [1, 3, 5, 10]:
        near = df[(df["days_to_earnings"].fillna(999) <= days_thresh) |
                  (df["days_since_earnings"].fillna(999) <= days_thresh)]
        far = df[~df.index.isin(near.index)]
        if len(near) < 30:
            continue
        wr_near = near["win"].mean()
        wr_far = far["win"].mean()
        print(f"    ±{days_thresh}d of earnings: WR={wr_near:.1%} (N={len(near):,}) vs "
              f"far: WR={wr_far:.1%} (N={len(far):,})  delta={wr_near - wr_far:+.1%}")

    # === WRITE REPORT ===
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    rpt = REPORT_DIR / "fred-macro-earnings-lift.md"
    with open(rpt, "w") as f:
        f.write("# Script 83 — FRED Macro Regime & Earnings Calendar Lift\n\n")

        f.write("## Feature Separation (Cohen's d)\n\n")
        f.write(f"| Feature | d | p | FDR-sig | Win Mean | Loss Mean | Coverage | N |\n")
        f.write(f"|---------|---|---|---------|----------|-----------|----------|---|\n")
        for _, r in res.iterrows():
            sig = "Yes" if r.get("fdr_sig", False) else ""
            f.write(f"| {r['feature']} | {r['d']:+.3f} | {r['p']:.2e} | {sig} | "
                    f"{r['win_mean']:.3f} | {r['loss_mean']:.3f} | {r['coverage']:.1%} | {r['n']:,} |\n")

        f.write(f"\n**FDR-significant features: {len(fdr_sig)}/{len(res)}**\n\n")

        f.write("## Regime Win Rates\n\n")
        for rcol in regime_cols:
            rr = analyze_regime_winrates(df, rcol)
            if len(rr) == 0:
                continue
            f.write(f"### {rcol}\n\n")
            f.write(f"| Regime | Win Rate | Delta | N | Avg PnL |\n")
            f.write(f"|--------|----------|-------|---|--------|\n")
            for _, row in rr.iterrows():
                delta = row["win_rate"] - overall_wr
                f.write(f"| {row['regime']} | {row['win_rate']:.1%} | {delta:+.1%} | "
                        f"{row['n']:,} | ${row['pnl_mean']:.2f} |\n")
            f.write("\n")

        f.write("## Direction-Specific Effects\n\n")
        if len(dir_res) > 0:
            pivot = dir_res.pivot_table(index="feature", columns="direction",
                                         values="d", aggfunc="first")
            if "long" in pivot.columns and "short" in pivot.columns:
                pivot["diff"] = (pivot["long"] - pivot["short"]).abs()
                pivot = pivot.sort_values("diff", ascending=False)
                f.write(f"| Feature | Long d | Short d | |Diff| |\n")
                f.write(f"|---------|--------|---------|--------|\n")
                for feat, row in pivot.head(15).iterrows():
                    f.write(f"| {feat} | {row.get('long', 0):+.3f} | "
                            f"{row.get('short', 0):+.3f} | {row['diff']:.3f} |\n")
            f.write("\n")

    print(f"\nReport: {rpt}")
    print("Done.")


if __name__ == "__main__":
    main()
