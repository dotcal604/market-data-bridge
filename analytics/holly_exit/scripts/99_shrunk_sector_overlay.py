"""
Script 99 -- Shrunk Strategy-Sector Prior Overlay
===================================================
Builds a hierarchical Bayesian-shrunk strat_sector_prior_wr and tests it
as an AQS v2 ranking modifier.

Shrinkage hierarchy:
    strategy-sector cell → strategy prior → global prior
    Weighted by cell sample size (empirical Bayes).

Key outputs:
    1. Raw vs shrunk effect sizes (overall + regime slices)
    2. AQS v2 baseline vs AQS v2 + overlay (decile spread, d, AUC)
    3. Cold-start / activation diagnostics
    4. Rolling 3mo/6mo effect size monitoring
    5. Deployment-ready parameters (cap, floor, shrinkage weights)

Usage:
    python scripts/99_shrunk_sector_overlay.py
"""

import sys
import time
import warnings
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd
from scipy import stats

sys.path.insert(0, str(Path(__file__).parent.parent))
from config.settings import DUCKDB_PATH

warnings.filterwarnings("ignore")


# ─── AQS v2 reimplementation (deterministic, matches aqs.ts) ───────────────

def compute_aqs_v2(row):
    """Pure function replicating src/eval/aqs.ts scoring logic."""
    score = 50.0
    reasons = []
    direction = row.get("direction", "").lower()
    is_long = direction == "long"
    is_short = direction == "short"

    entry_price = row.get("entry_price")
    stop_price = row.get("stop_price")
    market_cap = row.get("market_cap")
    vol_regime = row.get("vol_regime", "")
    exchange = row.get("primary_exchange", "")

    # Hard filters
    if is_long and market_cap is not None and market_cap < 3e8:
        return 0.0, ["SKIP_LONG_SC"]
    if exchange and "OTC" in str(exchange).upper():
        return 0.0, ["SKIP_OTC"]

    # Vol regime
    if vol_regime:
        vr = str(vol_regime).lower()
        if is_long:
            if vr in ("normal_vol", "low_vol"):
                score += 10; reasons.append("VOL_ALIGNED")
            elif vr == "high_vol":
                score -= 10; reasons.append("VOL_ADVERSE")
        elif is_short:
            if vr == "high_vol":
                score += 7; reasons.append("VOL_ALIGNED")
            elif vr == "normal_vol":
                score -= 15; reasons.append("VOL_ADVERSE")

    # Short non-small-cap penalty
    if is_short and market_cap is not None and market_cap >= 3e8:
        score -= 3; reasons.append("SHORT_NONSC_PEN")

    # Risk structure
    if entry_price and stop_price and entry_price > 0:
        risk_pct = abs(entry_price - stop_price) / entry_price * 100
        if is_long:
            if risk_pct < 0.85:
                score += 5; reasons.append("RISK_TIGHT")
            elif risk_pct > 4.10:
                score -= 5; reasons.append("RISK_WIDE")
        elif is_short:
            if risk_pct > 4.75:
                score += 5; reasons.append("RISK_WIDE_SHORT")
            elif risk_pct < 1.00:
                score -= 5; reasons.append("RISK_TIGHT_SHORT")

    # Price bucket (Long only)
    if is_long and entry_price:
        if 50 <= entry_price <= 100:
            score += 5; reasons.append("PRICE_SWEET")
        elif 5 <= entry_price <= 20:
            score -= 5; reasons.append("PRICE_LOW")

    # Short small-cap bonus
    if is_short and market_cap is not None and market_cap < 3e8:
        score += 20; reasons.append("SHORT_SC_EDGE")

    # Rolling strategy WR (Phase 2)
    strat_wr = row.get("strategy_recent_wr")
    if strat_wr is not None and not np.isnan(strat_wr):
        if strat_wr > 60:
            score += 10; reasons.append("STRAT_HOT")
        elif strat_wr < 35:
            score -= 15; reasons.append("STRAT_COLD")

    # News count (Phase 2)
    news_24h = row.get("news_count_24h")
    if news_24h is not None and not np.isnan(news_24h):
        if news_24h > 10:
            score += 10; reasons.append("NEWS_HIGH")
        elif news_24h > 5:
            score += 5; reasons.append("NEWS_MOD")

    return max(0, min(100, score)), reasons


# ─── Hierarchical shrinkage ─────────────────────────────────────────────────

def build_shrunk_priors(df, min_cell=5, min_strat=10):
    """
    Build empirical Bayes shrunk strategy-sector priors.

    Hierarchy:
        raw cell WR → shrink toward strategy WR → shrink toward global WR
    Shrinkage weight = min_cell / (min_cell + cell_n)
    """
    df = df.sort_values("entry_time").reset_index(drop=True)
    n = len(df)

    # Accumulators
    global_wins, global_count = 0, 0
    strat_wins, strat_count = {}, {}
    cell_wins, cell_count = {}, {}

    raw_wr = np.full(n, np.nan)
    shrunk_wr = np.full(n, np.nan)
    cell_n = np.full(n, np.nan)
    strat_prior = np.full(n, np.nan)
    global_prior_arr = np.full(n, np.nan)

    for i in range(n):
        strat = df.loc[i, "strategy"]
        sic2 = df.loc[i, "sic2"]
        win = df.loc[i, "win"]

        cell_key = f"{strat}_{sic2}" if pd.notna(sic2) else None

        # Current global prior
        gp = global_wins / global_count * 100 if global_count >= 20 else np.nan
        global_prior_arr[i] = gp

        # Current strategy prior
        sp = np.nan
        if strat in strat_count and strat_count[strat] >= min_strat:
            sp = strat_wins[strat] / strat_count[strat] * 100
        strat_prior[i] = sp

        # Current cell prior (raw)
        if cell_key and cell_key in cell_count and cell_count[cell_key] >= min_cell:
            cn = cell_count[cell_key]
            cwr = cell_wins[cell_key] / cn * 100
            raw_wr[i] = cwr
            cell_n[i] = cn

            # Hierarchical shrinkage
            # shrinkage weight toward strategy prior
            alpha = min_cell / (min_cell + cn)  # high alpha = more shrinkage

            if not np.isnan(sp):
                target = sp
            elif not np.isnan(gp):
                target = gp
            else:
                target = 50.0  # uninformative

            shrunk_wr[i] = (1 - alpha) * cwr + alpha * target
        elif not np.isnan(sp):
            # Cold start: fall back to strategy prior
            shrunk_wr[i] = sp
            cell_n[i] = 0

        # Update accumulators (AFTER computing features — no look-ahead)
        global_count += 1
        global_wins += win
        strat_count[strat] = strat_count.get(strat, 0) + 1
        strat_wins[strat] = strat_wins.get(strat, 0) + win
        if cell_key:
            cell_count[cell_key] = cell_count.get(cell_key, 0) + 1
            cell_wins[cell_key] = cell_wins.get(cell_key, 0) + win

    df["raw_strat_sector_wr"] = raw_wr
    df["shrunk_strat_sector_wr"] = shrunk_wr
    df["cell_n"] = cell_n
    df["strat_prior_wr"] = strat_prior
    df["global_prior_wr"] = global_prior_arr

    return df


# ─── Overlay computation ────────────────────────────────────────────────────

def compute_overlay(row, cap=10.0, neutral_band=2.0):
    """
    Convert shrunk strat_sector_prior_wr into a capped AQS bonus/penalty.

    Logic:
        shrunk WR > global WR + neutral_band → positive bonus (capped)
        shrunk WR < global WR - neutral_band → negative penalty (capped)
        otherwise → 0 (neutral)

    Returns (bonus, reason_code)
    """
    shrunk = row.get("shrunk_strat_sector_wr")
    gp = row.get("global_prior_wr")
    cn = row.get("cell_n", 0)

    if np.isnan(shrunk) if isinstance(shrunk, float) else shrunk is None:
        return 0.0, "SSP_MISSING"
    if np.isnan(gp) if isinstance(gp, float) else gp is None:
        return 0.0, "SSP_NO_BASELINE"

    delta = shrunk - gp

    if delta > neutral_band:
        bonus = min(delta - neutral_band, cap)
        confidence = "HIGH" if cn and cn > 30 else "MED" if cn and cn > 10 else "LOW"
        return bonus, f"SSP_BONUS_{confidence}"
    elif delta < -neutral_band:
        penalty = max(delta + neutral_band, -cap)
        confidence = "HIGH" if cn and cn > 30 else "MED" if cn and cn > 10 else "LOW"
        return penalty, f"SSP_PENALTY_{confidence}"
    else:
        return 0.0, "SSP_NEUTRAL"


# ─── Effect size helpers ────────────────────────────────────────────────────

def cohens_d(sub, feat):
    """Cohen's d between wins and losses for a feature."""
    v = sub[sub[feat].notna()]
    if len(v) < 30:
        return None, None, 0
    w = v[v["win"] == 1][feat]
    l = v[v["win"] == 0][feat]
    if len(w) < 10 or len(l) < 10:
        return None, None, 0
    n1, n2 = len(w), len(l)
    ps = np.sqrt(((n1 - 1) * w.var() + (n2 - 1) * l.var()) / (n1 + n2 - 2))
    if ps == 0:
        return None, None, 0
    d = (w.mean() - l.mean()) / ps
    _, p = stats.ttest_ind(w, l)
    return d, p, len(v)


def sig(p):
    return "***" if p < 0.001 else "**" if p < 0.01 else "*" if p < 0.05 else "   "


# ─── Main ───────────────────────────────────────────────────────────────────

def main():
    print("=" * 70)
    print("Script 99: Shrunk Strategy-Sector Prior Overlay vs AQS v2")
    print("=" * 70)
    t0 = time.time()

    con = duckdb.connect(str(DUCKDB_PATH), read_only=True)
    print(f"Connected to {DUCKDB_PATH.name}")

    # Load trades + sector info + regime + features needed for AQS
    df = con.execute("""
        SELECT
            t.trade_id, CAST(t.entry_time AS DATE) AS entry_date,
            t.entry_time, t.symbol, t.direction, t.strategy,
            t.entry_price, t.stop_price, t.holly_pnl,
            CASE WHEN t.holly_pnl > 0 THEN 1 ELSE 0 END AS win,
            td.sic_code, td.sic_description, td.market_cap,
            r.vol_regime,
            bf.news_count_24h
        FROM trades t
        LEFT JOIN ticker_details td ON t.symbol = td.symbol
        LEFT JOIN trade_regime r ON t.trade_id = r.trade_id
        LEFT JOIN benzinga_features_broad bf ON bf.trade_id = t.trade_id
        WHERE t.holly_pnl IS NOT NULL
        ORDER BY t.entry_time
    """).df()

    # Strategy rolling WR (needed for AQS Phase 2)
    df = df.sort_values("entry_time").reset_index(drop=True)
    strat_hist = {}
    strat_wr_arr = np.full(len(df), np.nan)
    for i in range(len(df)):
        s = df.loc[i, "strategy"]
        w = df.loc[i, "win"]
        if s in strat_hist and len(strat_hist[s]) >= 10:
            strat_wr_arr[i] = sum(strat_hist[s]) / len(strat_hist[s]) * 100
        strat_hist.setdefault(s, []).append(w)
    df["strategy_recent_wr"] = strat_wr_arr

    con.close()

    # SIC2
    def safe_sic2(x):
        if pd.isna(x) or x == "" or x is None:
            return None
        try:
            return str(int(float(x)))[:2]
        except Exception:
            return None

    df["sic2"] = df["sic_code"].apply(safe_sic2)
    print(f"Trades: {len(df):,} | SIC: {df['sic2'].notna().sum():,} "
          f"({df['sic2'].notna().mean()*100:.0f}%)")
    print(f"Date range: {df['entry_date'].min()} to {df['entry_date'].max()}")

    # ═══════════════════════════════════════════════════════════════════════
    # PART 1: Build shrunk priors
    # ═══════════════════════════════════════════════════════════════════════
    print(f"\n{'='*70}")
    print("PART 1: HIERARCHICAL SHRINKAGE")
    print(f"{'='*70}")

    df = build_shrunk_priors(df, min_cell=5, min_strat=10)

    raw_avail = df["raw_strat_sector_wr"].notna().sum()
    shrunk_avail = df["shrunk_strat_sector_wr"].notna().sum()
    print(f"  Raw cell WR available:   {raw_avail:,} "
          f"({raw_avail/len(df)*100:.1f}%)")
    print(f"  Shrunk WR available:     {shrunk_avail:,} "
          f"({shrunk_avail/len(df)*100:.1f}%)")
    print(f"  Cold-start fallbacks:    {shrunk_avail - raw_avail:,}")

    # ═══════════════════════════════════════════════════════════════════════
    # PART 2: Raw vs Shrunk effect sizes
    # ═══════════════════════════════════════════════════════════════════════
    print(f"\n{'='*70}")
    print("PART 2: RAW vs SHRUNK EFFECT SIZES")
    print(f"{'='*70}")

    for feat in ["raw_strat_sector_wr", "shrunk_strat_sector_wr"]:
        d, p, n = cohens_d(df, feat)
        print(f"  {feat:30s}: d={d:+.3f} {sig(p)} N={n:,}" if d else
              f"  {feat:30s}: insufficient data")

    # Direction split
    print("\n  By direction:")
    for feat in ["raw_strat_sector_wr", "shrunk_strat_sector_wr"]:
        for direction in ["Long", "Short"]:
            sub = df[df["direction"] == direction]
            d, p, n = cohens_d(sub, feat)
            if d:
                print(f"    {feat[:20]:20s} {direction:6s}: "
                      f"d={d:+.3f} {sig(p)} N={n:,}")

    # Quarter-sample temporal stability
    print("\n  Quarter-sample temporal stability:")
    q = len(df) // 4
    for feat in ["raw_strat_sector_wr", "shrunk_strat_sector_wr"]:
        vals = []
        for i, lbl in enumerate(["Q1", "Q2", "Q3", "Q4"]):
            sub = df.iloc[i * q:(i + 1) * q if i < 3 else len(df)]
            d, p, n = cohens_d(sub, feat)
            vals.append((lbl, d, p, n))
        parts = []
        for lbl, d, p, n in vals:
            if d:
                parts.append(f"{lbl}={d:+.3f}{sig(p).strip()}")
            else:
                parts.append(f"{lbl}=insuff")
        print(f"    {feat[:30]:30s}: {' | '.join(parts)}")

    # ═══════════════════════════════════════════════════════════════════════
    # PART 3: Compute AQS v2 and AQS v2 + overlay
    # ═══════════════════════════════════════════════════════════════════════
    print(f"\n{'='*70}")
    print("PART 3: AQS v2 BASELINE vs AQS v2 + OVERLAY")
    print(f"{'='*70}")

    aqs_scores = []
    aqs_overlay_scores = []
    overlay_reasons = []

    for i in range(len(df)):
        row = df.iloc[i]
        base_score, base_reasons = compute_aqs_v2(row)
        bonus, ssp_reason = compute_overlay(row)

        aqs_scores.append(base_score)
        aqs_overlay_scores.append(max(0, min(100, base_score + bonus)))
        overlay_reasons.append(ssp_reason)

    df["aqs_v2"] = aqs_scores
    df["aqs_v2_overlay"] = aqs_overlay_scores
    df["ssp_reason"] = overlay_reasons

    # AQS distribution
    print(f"\n  AQS v2 distribution:")
    print(f"    Mean: {df['aqs_v2'].mean():.1f} | "
          f"Std: {df['aqs_v2'].std():.1f} | "
          f"Zero-scored: {(df['aqs_v2']==0).sum():,}")

    print(f"\n  AQS v2+overlay distribution:")
    print(f"    Mean: {df['aqs_v2_overlay'].mean():.1f} | "
          f"Std: {df['aqs_v2_overlay'].std():.1f} | "
          f"Zero-scored: {(df['aqs_v2_overlay']==0).sum():,}")

    # Overlay activation stats
    print(f"\n  Overlay activation:")
    vc = df["ssp_reason"].value_counts()
    for reason, count in vc.items():
        pct = count / len(df) * 100
        print(f"    {reason:25s}: {count:>6,} ({pct:.1f}%)")

    # ═══════════════════════════════════════════════════════════════════════
    # PART 4: Decile analysis — AQS v2 vs AQS v2 + overlay
    # ═══════════════════════════════════════════════════════════════════════
    print(f"\n{'='*70}")
    print("PART 4: DECILE ANALYSIS (60/40 TRAIN/TEST SPLIT)")
    print(f"{'='*70}")

    split = int(len(df) * 0.6)
    test = df.iloc[split:].copy()
    print(f"  Test set: {len(test):,} trades")

    for score_col, label in [
        ("aqs_v2", "AQS v2 (baseline)"),
        ("aqs_v2_overlay", "AQS v2 + SSP overlay"),
        ("shrunk_strat_sector_wr", "Shrunk SSP alone"),
    ]:
        valid = test[test[score_col].notna() & (test[score_col] != 0)].copy()
        if len(valid) < 100:
            print(f"\n  {label}: insufficient non-zero scores")
            continue

        valid["decile"] = pd.qcut(
            valid[score_col], 10, labels=False, duplicates="drop"
        )
        dec = valid.groupby("decile").agg(
            n=("win", "count"),
            wr=("win", "mean"),
            avg_pnl=("holly_pnl", "mean"),
        )
        d10 = dec.iloc[-1]
        d1 = dec.iloc[0]

        # Cohen's d on top vs bottom decile PnL
        d10_pnl = valid[valid["decile"] == dec.index[-1]]["holly_pnl"]
        d1_pnl = valid[valid["decile"] == dec.index[0]]["holly_pnl"]
        n1, n2 = len(d10_pnl), len(d1_pnl)
        if n1 > 10 and n2 > 10:
            ps = np.sqrt(
                ((n1 - 1) * d10_pnl.var() + (n2 - 1) * d1_pnl.var())
                / (n1 + n2 - 2)
            )
            d_val = abs(d10_pnl.mean() - d1_pnl.mean()) / ps if ps > 0 else 0
        else:
            d_val = 0

        print(f"\n  {label}:")
        print(f"    D10: WR={d10['wr']*100:.1f}%, "
              f"avg PnL=${d10['avg_pnl']:,.0f} (N={int(d10['n'])})")
        print(f"    D1:  WR={d1['wr']*100:.1f}%, "
              f"avg PnL=${d1['avg_pnl']:,.0f} (N={int(d1['n'])})")
        print(f"    Spread: ${d10['avg_pnl'] - d1['avg_pnl']:,.0f} "
              f"| d={d_val:.3f}")
        print(f"    WR spread: {(d10['wr']-d1['wr'])*100:+.1f} pp")

        # Full decile table
        print(f"    {'Dec':>4} {'N':>6} {'WR':>7} {'Avg PnL':>10}")
        for idx, row_d in dec.iterrows():
            print(f"    {idx:>4} {int(row_d['n']):>6} "
                  f"{row_d['wr']*100:>6.1f}% ${row_d['avg_pnl']:>9,.0f}")

    # ═══════════════════════════════════════════════════════════════════════
    # PART 5: Direction-split analysis
    # ═══════════════════════════════════════════════════════════════════════
    print(f"\n{'='*70}")
    print("PART 5: DIRECTION-SPLIT DECILE ANALYSIS (TEST SET)")
    print(f"{'='*70}")

    for direction in ["Long", "Short"]:
        dir_test = test[test["direction"] == direction]
        print(f"\n  --- {direction} (N={len(dir_test):,}) ---")

        for score_col, label in [
            ("aqs_v2", "AQS v2"),
            ("aqs_v2_overlay", "AQS v2 + SSP"),
        ]:
            valid = dir_test[
                dir_test[score_col].notna() & (dir_test[score_col] != 0)
            ].copy()
            if len(valid) < 50:
                print(f"    {label}: insufficient data")
                continue
            valid["decile"] = pd.qcut(
                valid[score_col], 5, labels=False, duplicates="drop"
            )
            dec = valid.groupby("decile").agg(
                n=("win", "count"),
                wr=("win", "mean"),
                avg_pnl=("holly_pnl", "mean"),
            )
            top = dec.iloc[-1]
            bot = dec.iloc[0]
            print(f"    {label}:")
            print(f"      Top quintile: WR={top['wr']*100:.1f}%, "
                  f"PnL=${top['avg_pnl']:,.0f}")
            print(f"      Bot quintile: WR={bot['wr']*100:.1f}%, "
                  f"PnL=${bot['avg_pnl']:,.0f}")
            print(f"      Spread: ${top['avg_pnl']-bot['avg_pnl']:,.0f} "
                  f"| WR: {(top['wr']-bot['wr'])*100:+.1f}pp")

    # ═══════════════════════════════════════════════════════════════════════
    # PART 6: Rolling effect size monitoring
    # ═══════════════════════════════════════════════════════════════════════
    print(f"\n{'='*70}")
    print("PART 6: ROLLING 3-MONTH EFFECT SIZE")
    print(f"{'='*70}")

    df["entry_month"] = pd.to_datetime(df["entry_date"]).dt.to_period("M")
    months = sorted(df["entry_month"].unique())

    print(f"  {'Period':>12} {'d_raw':>8} {'d_shrunk':>10} {'N':>6} {'Activation%':>12}")
    for i in range(2, len(months)):
        window = df[
            (df["entry_month"] >= months[i - 2])
            & (df["entry_month"] <= months[i])
        ]
        if len(window) < 50:
            continue

        d_raw, _, n_raw = cohens_d(window, "raw_strat_sector_wr")
        d_shrunk, _, n_shrunk = cohens_d(window, "shrunk_strat_sector_wr")
        activation = (window["ssp_reason"].str.contains("BONUS|PENALTY")).mean() * 100

        period = f"{months[i-2]}-{months[i]}"
        d_raw_s = f"{d_raw:+.3f}" if d_raw else "  n/a"
        d_shrunk_s = f"{d_shrunk:+.3f}" if d_shrunk else "  n/a"
        print(f"  {period:>12} {d_raw_s:>8} {d_shrunk_s:>10} "
              f"{max(n_raw, n_shrunk):>6,} {activation:>11.1f}%")

    # ═══════════════════════════════════════════════════════════════════════
    # PART 7: Cell-size analysis (the trap on the field)
    # ═══════════════════════════════════════════════════════════════════════
    print(f"\n{'='*70}")
    print("PART 7: CELL-SIZE DIAGNOSTICS")
    print(f"{'='*70}")

    has_cell = df[df["cell_n"].notna() & (df["cell_n"] > 0)]
    print(f"\n  Cell size distribution (N={len(has_cell):,} trades with cells):")
    buckets = [(5, 10), (10, 20), (20, 50), (50, 100), (100, 500), (500, 9999)]
    for lo, hi in buckets:
        mask = (has_cell["cell_n"] >= lo) & (has_cell["cell_n"] < hi)
        sub = has_cell[mask]
        if len(sub) < 30:
            continue
        d, p, n = cohens_d(sub, "shrunk_strat_sector_wr")
        d_s = f"d={d:+.3f} {sig(p)}" if d else "insuff"
        wr = sub["win"].mean() * 100
        print(f"    N={lo:>3}-{hi:<4}: {len(sub):>5,} trades | "
              f"WR={wr:.1f}% | {d_s}")

    # Unique cells
    has_cell_key = df[df["sic2"].notna()].copy()
    has_cell_key["cell_key"] = (
        has_cell_key["strategy"] + "_" + has_cell_key["sic2"]
    )
    unique_cells = has_cell_key["cell_key"].nunique()
    active_cells = has_cell_key[has_cell_key["cell_n"] > 0]["cell_key"].nunique()
    print(f"\n  Unique strategy-sector cells: {unique_cells:,}")
    print(f"  Active cells (n>={5}):         {active_cells:,}")
    print(f"  Cold-start rate:               "
          f"{(1 - active_cells/unique_cells)*100:.1f}%")

    # ═══════════════════════════════════════════════════════════════════════
    # PART 8: Deployment parameters
    # ═══════════════════════════════════════════════════════════════════════
    print(f"\n{'='*70}")
    print("PART 8: DEPLOYMENT PARAMETERS")
    print(f"{'='*70}")

    print("""
  Recommended AQS v2 integration:
    feature:       shrunk_strat_sector_wr
    mode:          ranking modifier (bonus/penalty on AQS base score)
    cap:           +/- 10 points
    neutral_band:  +/- 2% WR from global prior
    min_cell:      5 (shrinkage denominator)
    min_strat:     10 (strategy prior floor)
    cold_start:    fall back to strategy_prior_wr

  Reason codes:
    SSP_BONUS_HIGH   — favorable, N>30
    SSP_BONUS_MED    — favorable, N=10-30
    SSP_BONUS_LOW    — favorable, N=5-10
    SSP_PENALTY_*    — same tiers, unfavorable
    SSP_NEUTRAL      — within neutral band
    SSP_MISSING      — no sector data
    SSP_NO_BASELINE  — insufficient global history

  Monitoring:
    - Rolling 3mo d on shrunk_strat_sector_wr
    - Activation % by direction
    - Cell-size distribution shift
    - Cold-start rate trend
""")

    elapsed = time.time() - t0
    print(f"Script 99 complete in {elapsed:.1f}s")


if __name__ == "__main__":
    main()
