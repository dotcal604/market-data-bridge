"""
Script 69 — Trade Regime Momentum & Macro Indicators Lift
===========================================================
Mine the remaining unmined columns from trade_regime and fred_macro_daily:
  - trade_regime: trend_regime, momentum_regime, rsi14, roc5, roc20, trend_slope,
                  sma20, sma5, above_sma20, atr14, daily_range_pct
  - fred_macro_daily: put_call_equity, put_call_total, put_call_regime,
                       put_call_5d_change, vix_regime, yield_curve_regime,
                       rate_regime, rate_direction, yield_10y, yield_2y,
                       fed_funds_rate, vix_5d_change
  - economic_event_flags: is_fomc_day, is_nfp_day, is_event_day
"""

import sys, time
from pathlib import Path
import numpy as np
import pandas as pd
import duckdb
from scipy import stats
from statsmodels.stats.multitest import multipletests

sys.path.insert(0, str(Path(__file__).parent.parent))
from config.settings import DUCKDB_PATH

REPORT_DIR = Path(__file__).parent.parent / "output" / "reports"


def welch_t(a, b):
    na, nb = len(a), len(b)
    if na < 10 or nb < 10:
        return {"cohens_d": np.nan, "p_value": np.nan}
    ma, mb = np.mean(a), np.mean(b)
    sa, sb = np.std(a, ddof=1), np.std(b, ddof=1)
    pooled = np.sqrt((sa**2 + sb**2) / 2)
    d = (ma - mb) / pooled if pooled > 0 else 0
    _, p_val = stats.ttest_ind(a, b, equal_var=False)
    return {"cohens_d": d, "p_value": p_val}


def quintile_breakdown(df, col):
    valid = df.dropna(subset=[col])
    if len(valid) < 100:
        return None
    try:
        valid = valid.copy()
        valid["q"] = pd.qcut(valid[col], 5, labels=False, duplicates="drop")
    except ValueError:
        return None
    rows = []
    for q in sorted(valid["q"].unique()):
        qdf = valid[valid["q"] == q]
        rows.append({
            "quintile": f"Q{q+1}",
            "range": f"{qdf[col].min():.4f}–{qdf[col].max():.4f}",
            "n": len(qdf),
            "wr": qdf["win"].mean() * 100,
            "avg_pnl": qdf["holly_pnl"].mean(),
        })
    return rows


def main():
    t0 = time.time()
    con = duckdb.connect(str(DUCKDB_PATH), read_only=True)
    print(f"Connected to {DUCKDB_PATH.name}")

    df = con.execute("""
        SELECT t.trade_id, t.symbol, t.strategy, t.direction,
            t.entry_time, t.holly_pnl,
            CASE WHEN t.holly_pnl > 0 THEN 1 ELSE 0 END AS win,
            -- Trade regime (unmined columns)
            r.trend_regime, r.momentum_regime,
            r.rsi14, r.roc5, r.roc20, r.trend_slope,
            r.sma20, r.sma5, r.above_sma20,
            r.atr14, r.daily_range_pct,
            -- Macro (unmined columns)
            fm.put_call_equity, fm.put_call_total,
            fm.put_call_regime, fm.put_call_5d_change,
            fm.vix_regime, fm.yield_curve_regime,
            fm.rate_regime, fm.rate_direction,
            fm.yield_10y, fm.yield_2y, fm.fed_funds_rate,
            fm.vix_5d_change,
            -- Economic events
            ef.is_fomc_day, ef.is_nfp_day, ef.is_event_day
        FROM trades t
        LEFT JOIN trade_regime r ON r.trade_id = t.trade_id
        LEFT JOIN fred_macro_daily fm ON fm.date = CAST(t.entry_time AS DATE)
        LEFT JOIN economic_event_flags ef ON ef.date = CAST(t.entry_time AS DATE)
    """).fetchdf()
    con.close()
    print(f"Loaded {len(df):,} trades ({time.time()-t0:.1f}s)")

    # Encode categoricals
    df["trend_regime_ord"] = df["trend_regime"].map({"down": 0, "neutral": 1, "up": 2})
    df["momentum_regime_ord"] = df["momentum_regime"].map({"oversold": 0, "neutral": 1, "overbought": 2})
    df["vix_regime_ord"] = df["vix_regime"].map({"low": 0, "normal": 1, "high": 2, "extreme": 3})
    df["yield_curve_regime_ord"] = df["yield_curve_regime"].map({"inverted": 0, "flat": 1, "normal": 2, "steep": 3})
    df["rate_regime_ord"] = df["rate_regime"].map({"easing": 0, "stable": 1, "tightening": 2})
    df["rate_direction_ord"] = df["rate_direction"].map({"falling": 0, "stable": 1, "rising": 2})
    df["put_call_regime_ord"] = df["put_call_regime"].map({"bullish": 0, "neutral": 1, "bearish": 2})

    # ── Feature definitions ──
    continuous_features = [
        ("rsi14", "RSI 14-Day"),
        ("roc5", "Rate of Change 5-Day (%)"),
        ("roc20", "Rate of Change 20-Day (%)"),
        ("trend_slope", "Trend Slope"),
        ("daily_range_pct", "Daily Range (%)"),
        ("put_call_equity", "Put/Call Ratio (Equity)"),
        ("put_call_total", "Put/Call Ratio (Total)"),
        ("put_call_5d_change", "Put/Call 5-Day Change"),
        ("vix_5d_change", "VIX 5-Day Change"),
        ("yield_10y", "10-Year Yield"),
        ("yield_2y", "2-Year Yield"),
        ("fed_funds_rate", "Fed Funds Rate"),
    ]

    ordinal_features = [
        ("trend_regime_ord", "Trend Regime (down/neutral/up)"),
        ("momentum_regime_ord", "Momentum Regime (oversold/neutral/overbought)"),
        ("vix_regime_ord", "VIX Regime"),
        ("yield_curve_regime_ord", "Yield Curve Regime"),
        ("rate_regime_ord", "Rate Regime"),
        ("rate_direction_ord", "Rate Direction"),
        ("put_call_regime_ord", "Put/Call Regime"),
    ]

    binary_features = [
        ("above_sma20", "Above 20-Day SMA"),
        ("is_fomc_day", "FOMC Day"),
        ("is_nfp_day", "NFP Day"),
        ("is_event_day", "Economic Event Day"),
    ]

    # ── Lift analysis (all features) ──
    all_features = continuous_features + ordinal_features
    feature_summary = []
    for col, label in all_features:
        valid = df.dropna(subset=[col])
        if len(valid) < 100:
            continue
        winners = valid[valid["win"] == 1][col]
        losers = valid[valid["win"] == 0][col]
        t = welch_t(winners, losers)
        if np.isnan(t["cohens_d"]):
            continue
        feature_summary.append({
            "feature": label, "col": col,
            "n": len(valid), "d": t["cohens_d"], "p": t["p_value"],
        })

    # FDR
    if feature_summary:
        pvals = [f["p"] for f in feature_summary]
        reject, _, _, _ = multipletests(pvals, method="fdr_bh", alpha=0.05)
        for i, fs in enumerate(feature_summary):
            fs["fdr_sig"] = reject[i]
    feature_summary.sort(key=lambda x: abs(x["d"]), reverse=True)

    # Binary features
    binary_results = []
    for col, label in binary_features:
        valid = df.dropna(subset=[col])
        if len(valid) < 50:
            continue
        yes = valid[valid[col] == 1]
        no = valid[valid[col] == 0]
        if len(yes) < 10 or len(no) < 10:
            continue
        t = welch_t(yes["holly_pnl"], no["holly_pnl"])
        binary_results.append({
            "feature": label,
            "prevalence": len(yes) / len(valid) * 100,
            "wr_yes": yes["win"].mean() * 100,
            "wr_no": no["win"].mean() * 100,
            "pnl_yes": yes["holly_pnl"].mean(),
            "pnl_no": no["holly_pnl"].mean(),
            "d": t["cohens_d"],
            "p": t["p_value"],
        })

    # Direction-specific
    longs = df[df["direction"].str.lower() == "long"]
    shorts = df[df["direction"].str.lower() == "short"]
    dir_results = []
    for col, label in all_features:
        for ddf, dname in [(longs, "Longs"), (shorts, "Shorts")]:
            valid = ddf.dropna(subset=[col])
            if len(valid) < 50:
                continue
            w = valid[valid["win"] == 1][col]
            l = valid[valid["win"] == 0][col]
            t = welch_t(w, l)
            if not np.isnan(t["cohens_d"]):
                dir_results.append({
                    "feature": f"{label} ({dname})",
                    "d": t["cohens_d"], "p": t["p_value"], "n": len(valid),
                })
    dir_results.sort(key=lambda x: abs(x["d"]), reverse=True)

    # ── Build report ──
    report = []
    report.append("# Regime Momentum & Macro Indicators — Lift Analysis")
    report.append("")
    report.append(f"Generated: {pd.Timestamp.now().strftime('%Y-%m-%d %H:%M')}")
    report.append(f"Trades: {len(df):,}")
    fdr_count = sum(1 for f in feature_summary if f.get("fdr_sig"))
    report.append(f"FDR-Significant: {fdr_count}/{len(feature_summary)}")
    report.append("")

    report.append("## 1. Feature Summary (Continuous & Ordinal)")
    report.append("")
    report.append("| Feature | n | Cohen's d | p-value | FDR Sig |")
    report.append("|---------|---|-----------|---------|---------|\n")
    for fs in feature_summary:
        sig = "Y" if fs.get("fdr_sig") else ""
        report.append(f"| {fs['feature']} | {fs['n']:,} | {fs['d']:.3f} | {fs['p']:.4f} | {sig} |")
    report.append("")

    report.append("## 2. Binary Features")
    report.append("")
    report.append("| Feature | Prevalence | WR (Yes) | WR (No) | P&L (Yes) | P&L (No) | d | p |")
    report.append("|---------|-----------|----------|---------|-----------|----------|---|---|\n")
    for br in binary_results:
        report.append(f"| {br['feature']} | {br['prevalence']:.1f}% | {br['wr_yes']:.1f}% | {br['wr_no']:.1f}% "
                      f"| ${br['pnl_yes']:.0f} | ${br['pnl_no']:.0f} | {br['d']:.3f} | {br['p']:.4f} |")
    report.append("")

    # Quintile breakdowns for top features
    report.append("## 3. Quintile Breakdowns")
    report.append("")
    for col, label in continuous_features:
        rows = quintile_breakdown(df, col)
        if rows is None:
            continue
        report.append(f"**{label}** (n={sum(r['n'] for r in rows):,})")
        report.append("")
        report.append("| Quintile | Range | n | WR | Avg P&L |")
        report.append("|----------|-------|---|----|---------|\n")
        for r in rows:
            report.append(f"| {r['quintile']} | {r['range']} | {r['n']:,} | {r['wr']:.1f}% | ${r['avg_pnl']:.0f} |")
        report.append("")

    # Categorical breakdowns
    report.append("## 4. Categorical Regime Breakdowns")
    report.append("")
    cat_features = [
        ("trend_regime", "Trend Regime"),
        ("momentum_regime", "Momentum Regime"),
        ("vix_regime", "VIX Regime"),
        ("yield_curve_regime", "Yield Curve Regime"),
        ("rate_regime", "Rate Regime"),
        ("put_call_regime", "Put/Call Regime"),
    ]
    for col, label in cat_features:
        valid = df.dropna(subset=[col])
        if len(valid) < 100:
            continue
        report.append(f"**{label}**")
        report.append("")
        report.append("| Value | n | WR | Avg P&L |")
        report.append("|-------|---|----|---------|\n")
        for val in sorted(valid[col].unique()):
            vdf = valid[valid[col] == val]
            report.append(f"| {val} | {len(vdf):,} | {vdf['win'].mean()*100:.1f}% | ${vdf['holly_pnl'].mean():.0f} |")
        report.append("")

    # Direction-specific
    report.append("## 5. Direction-Specific (Top 15)")
    report.append("")
    report.append("| Feature | n | Cohen's d | p-value |")
    report.append("|---------|---|-----------|---------|\n")
    for dr in dir_results[:15]:
        report.append(f"| {dr['feature']} | {dr['n']:,} | {dr['d']:.3f} | {dr['p']:.4f} |")
    report.append("")

    # Conclusions
    report.append("## 6. Conclusions")
    report.append("")
    sig_features = [f for f in feature_summary if f.get("fdr_sig")]
    if sig_features:
        report.append("**FDR-significant features:**")
        for f in sig_features:
            report.append(f"- {f['feature']}: d={f['d']:.3f}")
    else:
        report.append("*No FDR-significant features found.*")
    report.append("")

    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    path = REPORT_DIR / "regime-momentum-lift.md"
    path.write_text("\n".join(report), encoding="utf-8")
    elapsed = time.time() - t0
    print(f"\nReport: {path}")
    print(f"Done in {elapsed:.1f}s")


if __name__ == "__main__":
    main()
