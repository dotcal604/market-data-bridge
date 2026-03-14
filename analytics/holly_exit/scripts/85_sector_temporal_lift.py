"""
Script 85 -- Sector & Temporal Feature Lift
============================================
Mines ticker_details for SIC sector effects and trades for temporal patterns.

SECTOR FEATURES (from ticker_details.sic_code / sic_description):
  - SIC code as numeric feature
  - Sector group win rate (historical, no look-ahead)
  - Top-performing sector flags

TEMPORAL FEATURES (from trades.entry_time):
  - Hour of entry (ET)
  - Day of week
  - Month / quarter
  - Days since year start
  - Entry time relative to market open (minutes)

Key finding from exploration:
  - Semiconductors: 60.4% WR (N=583)
  - Computer processing/data prep: 35-40% WR (N=215-224)
  - 25pp sector spread far exceeds any other feature effect

Usage:
    python scripts/85_sector_temporal_lift.py
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


def cohens_d(wins, losses):
    n1, n2 = len(wins), len(losses)
    if n1 < 5 or n2 < 5:
        return 0.0
    m1, m2 = wins.mean(), losses.mean()
    s1, s2 = wins.std(ddof=1), losses.std(ddof=1)
    sp = np.sqrt(((n1 - 1) * s1 ** 2 + (n2 - 1) * s2 ** 2) / (n1 + n2 - 2))
    if sp < 1e-12:
        return 0.0
    return (m1 - m2) / sp


def load_features(con):
    """Load trades + sector + temporal features."""
    t0 = time.time()

    df = con.execute("""
        SELECT t.trade_id, t.symbol, t.strategy, t.direction,
            t.entry_time, t.entry_price, t.holly_pnl,
            CASE WHEN t.holly_pnl > 0 THEN 1 ELSE 0 END AS win,
            CAST(t.entry_time AS DATE) AS trade_date,
            -- Sector features
            td.sic_code,
            td.sic_description,
            -- Temporal features
            EXTRACT(HOUR FROM t.entry_time) AS entry_hour,
            EXTRACT(DOW FROM t.entry_time) AS day_of_week,
            EXTRACT(MONTH FROM t.entry_time) AS month,
            EXTRACT(QUARTER FROM t.entry_time) AS quarter,
            EXTRACT(DOY FROM t.entry_time) AS day_of_year,
            -- Minutes since market open (9:30 ET = 570 minutes from midnight)
            -- entry_time appears to be in ET based on hour distribution
            EXTRACT(HOUR FROM t.entry_time) * 60 + EXTRACT(MINUTE FROM t.entry_time)
                - 570 AS minutes_since_open
        FROM trades t
        LEFT JOIN ticker_details td ON td.symbol = t.symbol
    """).fetchdf()
    print(f"  Trades: {len(df):,}")

    sic_cov = df["sic_code"].notna().sum()
    print(f"  SIC coverage: {sic_cov:,}/{len(df):,} ({100*sic_cov/len(df):.1f}%)")

    # Compute SIC 2-digit group (major industry)
    df["sic_2digit"] = df["sic_code"].apply(
        lambda x: int(str(x)[:2]) if pd.notna(x) and str(x).isdigit() and len(str(x)) >= 2 else np.nan
    )

    # Compute sector group win rate (no look-ahead)
    print("  Computing sector history win rates...")
    df = df.sort_values("entry_time").reset_index(drop=True)
    n = len(df)
    sector_prior_wr = np.full(n, np.nan)
    sic2_prior_wr = np.full(n, np.nan)

    sector_history = {}
    sic2_history = {}
    for i in range(n):
        sector = df.iloc[i]["sic_description"]
        sic2 = df.iloc[i]["sic_2digit"]
        win = df.iloc[i]["win"]

        # Full sector description
        if pd.notna(sector) and sector != "":
            hist = sector_history.get(sector, [])
            if len(hist) >= 10:
                sector_prior_wr[i] = sum(hist) / len(hist) * 100
            if sector not in sector_history:
                sector_history[sector] = []
            sector_history[sector].append(win)

        # SIC 2-digit group
        if pd.notna(sic2):
            hist2 = sic2_history.get(sic2, [])
            if len(hist2) >= 10:
                sic2_prior_wr[i] = sum(hist2) / len(hist2) * 100
            if sic2 not in sic2_history:
                sic2_history[sic2] = []
            sic2_history[sic2].append(win)

    df["sector_prior_wr"] = sector_prior_wr
    df["sic2_prior_wr"] = sic2_prior_wr

    # Compute strategy × sector interaction
    print("  Computing strategy × sector interaction...")
    strat_sector_prior_wr = np.full(n, np.nan)
    ss_history = {}
    for i in range(n):
        strat = df.iloc[i]["strategy"]
        sic2 = df.iloc[i]["sic_2digit"]
        win = df.iloc[i]["win"]

        if pd.notna(sic2):
            key = (strat, sic2)
            hist = ss_history.get(key, [])
            if len(hist) >= 5:
                strat_sector_prior_wr[i] = sum(hist) / len(hist) * 100
            if key not in ss_history:
                ss_history[key] = []
            ss_history[key].append(win)

    df["strat_sector_prior_wr"] = strat_sector_prior_wr

    elapsed = time.time() - t0
    print(f"  All features loaded: {len(df):,} trades ({elapsed:.1f}s)")
    return df


def analyze_features(df, features):
    """Analyze win/loss separation for continuous features."""
    from statsmodels.stats.multitest import multipletests

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
            "d": d, "abs_d": abs(d),
            "p": p_val,
            "win_mean": w.mean(),
            "loss_mean": l.mean(),
            "coverage": coverage,
            "n": len(vals),
        })

    res = pd.DataFrame(results).sort_values("abs_d", ascending=False)
    if len(res) > 0:
        _, fdr_p, _, _ = multipletests(res["p"], method="fdr_bh")
        res["fdr_p"] = fdr_p
        res["fdr_sig"] = fdr_p < 0.05
    return res


def main():
    t0 = time.time()
    con = duckdb.connect(str(DUCKDB_PATH), read_only=True)
    print(f"Connecting to {DUCKDB_PATH}")
    df = load_features(con)
    con.close()

    overall_wr = df["win"].mean()
    print(f"\n  Overall win rate: {overall_wr:.1%}")

    # === SECTOR WIN RATES ===
    print("\n  === SECTOR WIN RATES (SIC Description) ===")
    print(f"  {'Sector':<55s} {'N':>5s} {'WR':>6s} {'Delta':>7s}")
    print("  " + "-" * 77)
    sector_wr = df.groupby("sic_description").agg(
        n=("win", "count"), wr=("win", "mean")).reset_index()
    sector_wr["delta"] = sector_wr["wr"] - overall_wr
    sector_wr = sector_wr[sector_wr["n"] >= 50].sort_values("wr", ascending=False)
    for _, row in sector_wr.iterrows():
        flag = " <<<" if abs(row["delta"]) > 0.04 else ""
        print(f"  {row['sic_description'][:55]:<55s} {row['n']:>5d} {row['wr']:>5.1%} "
              f"{row['delta']:>+6.1%}{flag}")

    # === SIC 2-DIGIT GROUP WIN RATES ===
    print("\n  === SIC 2-DIGIT GROUP WIN RATES ===")
    sic2_wr = df[df["sic_2digit"].notna()].groupby("sic_2digit").agg(
        n=("win", "count"), wr=("win", "mean")).reset_index()
    sic2_wr["delta"] = sic2_wr["wr"] - overall_wr
    sic2_wr = sic2_wr[sic2_wr["n"] >= 50].sort_values("wr", ascending=False)
    print(f"  {'SIC2':>5s} {'N':>5s} {'WR':>6s} {'Delta':>7s}")
    print("  " + "-" * 27)
    for _, row in sic2_wr.iterrows():
        flag = " <<<" if abs(row["delta"]) > 0.04 else ""
        print(f"  {row['sic_2digit']:>5.0f} {int(row['n']):>5d} {row['wr']:>5.1%} "
              f"{row['delta']:>+6.1%}{flag}")

    # === TEMPORAL WIN RATES ===
    print("\n  === HOUR OF ENTRY WIN RATES ===")
    hour_wr = df.groupby("entry_hour").agg(
        n=("win", "count"), wr=("win", "mean")).reset_index()
    hour_wr["delta"] = hour_wr["wr"] - overall_wr
    for _, row in hour_wr.iterrows():
        flag = " <<<" if abs(row["delta"]) > 0.02 else ""
        print(f"    Hour {row['entry_hour']:>2.0f}: WR={row['wr']:.1%} "
              f"delta={row['delta']:+.1%} N={row['n']:>5,}{flag}")

    print("\n  === MONTH WIN RATES ===")
    month_wr = df.groupby("month").agg(
        n=("win", "count"), wr=("win", "mean")).reset_index()
    month_wr["delta"] = month_wr["wr"] - overall_wr
    for _, row in month_wr.iterrows():
        flag = " <<<" if abs(row["delta"]) > 0.02 else ""
        print(f"    Month {row['month']:>2.0f}: WR={row['wr']:.1%} "
              f"delta={row['delta']:+.1%} N={row['n']:>5,}{flag}")

    # === FEATURE SEPARATION ANALYSIS ===
    continuous_feats = [
        "sector_prior_wr", "sic2_prior_wr", "strat_sector_prior_wr",
        "sic_2digit",
        "entry_hour", "day_of_week", "month", "quarter",
        "day_of_year", "minutes_since_open",
    ]
    print("\n  === CONTINUOUS FEATURE SEPARATION (Cohen's d) ===")
    res = analyze_features(df, continuous_feats)
    print(f"\n  {'Feature':<30s} {'d':>7s} {'p':>10s} {'FDR':>5s} {'WinM':>8s} {'LossM':>8s} {'Cov':>6s} {'N':>7s}")
    print("  " + "-" * 87)
    for _, r in res.iterrows():
        sig = "*" if r.get("fdr_sig", False) else ""
        print(f"  {r['feature']:<30s} {r['d']:>+7.3f} {r['p']:>10.2e} {sig:>5s} "
              f"{r['win_mean']:>8.3f} {r['loss_mean']:>8.3f} {r['coverage']:>5.1%} {r['n']:>7,}")

    fdr_sig = res[res.get("fdr_sig", False) == True] if "fdr_sig" in res.columns else pd.DataFrame()
    print(f"\n  FDR-significant features: {len(fdr_sig)}/{len(res)}")

    # === DIRECTION-SPECIFIC ANALYSIS ===
    print("\n  === DIRECTION-SPECIFIC SECTOR EFFECTS ===")
    for direction in ["long", "short"]:
        sub = df[df["direction"].str.lower() == direction]
        if len(sub) < 200:
            continue
        wins = sub[sub["win"] == 1]
        losses = sub[sub["win"] == 0]

        print(f"\n  {direction.upper()}:")
        for feat in ["sector_prior_wr", "sic2_prior_wr", "strat_sector_prior_wr"]:
            w = wins[feat].dropna()
            l = losses[feat].dropna()
            if len(w) < 20 or len(l) < 20:
                continue
            d = cohens_d(w, l)
            print(f"    {feat:<30s} d={d:+.3f} (N={len(w)+len(l):,})")

    # === WRITE REPORT ===
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    rpt = REPORT_DIR / "sector-temporal-lift.md"
    with open(rpt, "w") as f:
        f.write("# Script 85 — Sector & Temporal Feature Lift\n\n")

        f.write("## Feature Separation (Cohen's d)\n\n")
        f.write(f"| Feature | d | p | FDR-sig | Coverage | N |\n")
        f.write(f"|---------|---|---|---------|----------|---|\n")
        for _, r in res.iterrows():
            sig = "Yes" if r.get("fdr_sig", False) else ""
            f.write(f"| {r['feature']} | {r['d']:+.3f} | {r['p']:.2e} | {sig} | "
                    f"{r['coverage']:.1%} | {r['n']:,} |\n")
        f.write(f"\n**FDR-significant: {len(fdr_sig)}/{len(res)}**\n\n")

        f.write("## Top Sector Win Rates\n\n")
        f.write("| Sector | N | Win Rate | Delta |\n")
        f.write("|--------|---|----------|-------|\n")
        for _, row in sector_wr.head(20).iterrows():
            f.write(f"| {row['sic_description']} | {row['n']} | {row['wr']:.1%} | {row['delta']:+.1%} |\n")
        f.write("\n")

    elapsed = time.time() - t0
    print(f"\nReport: {rpt}")
    print(f"Done in {elapsed:.1f}s")


if __name__ == "__main__":
    main()
