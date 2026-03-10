"""
Script 71 — Sector ETF Rotation & Broad Market Lift
======================================================
Mine the `etf_bars` table (9.6M minute bars) for:
  - SPY context: prior-day return, gap, 5d/20d returns, intraday momentum
  - Sector ETF relative strength vs SPY (prior day)
  - Sector rotation signals (which sectors leading/lagging)
  - Market breadth: # of sector ETFs up vs down

ETFs available: SPY, QQQ, IWM, DIA + 11 SPDR sectors (XLK, XLF, XLE, etc.)
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

# SIC 2-digit → SPDR sector ETF mapping
SIC_TO_ETF = {
    "28": "XLV", "80": "XLV", "38": "XLV",  # Pharma, Health, Instruments → Healthcare
    "73": "XLK", "36": "XLK", "35": "XLK", "48": "XLK",  # Software, Electronics, Hardware, Telecom → Tech
    "60": "XLF", "61": "XLF", "62": "XLF", "63": "XLF", "67": "XLF", "64": "XLF", "65": "XLF",  # Finance/Insurance/RE → Financials
    "13": "XLE", "29": "XLE",  # Oil & Gas, Petroleum → Energy
    "49": "XLU",  # Utilities
    "37": "XLI", "34": "XLI", "33": "XLI",  # Transport, Metal, Primary Metals → Industrials
    "20": "XLP", "54": "XLP", "51": "XLP",  # Food, Grocery, Wholesale → Consumer Staples
    "59": "XLY", "57": "XLY", "56": "XLY", "58": "XLY", "53": "XLY",  # Retail → Consumer Discretionary
    "50": "XLI",  # Wholesale → Industrials
    "87": "XLK",  # Engineering services → Tech
}


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

    # Load trades
    trades = con.execute("""
        SELECT trade_id, symbol, strategy, direction,
            entry_time, holly_pnl,
            CASE WHEN holly_pnl > 0 THEN 1 ELSE 0 END AS win
        FROM trades
    """).fetchdf()
    print(f"Trades: {len(trades):,}")

    # Build daily ETF returns from minute bars
    # Aggregate to daily OHLC for each ETF, then compute returns
    print("Building daily ETF summaries from minute bars...")
    etf_daily = con.execute("""
        SELECT symbol,
            CAST(bar_time AS DATE) AS trade_date,
            FIRST(open ORDER BY bar_time) AS day_open,
            MAX(high) AS day_high,
            MIN(low) AS day_low,
            LAST(close ORDER BY bar_time) AS day_close,
            SUM(volume) AS day_volume
        FROM etf_bars
        WHERE bar_time::TIME BETWEEN '09:30:00' AND '15:59:00'
        GROUP BY symbol, CAST(bar_time AS DATE)
        ORDER BY symbol, trade_date
    """).fetchdf()
    print(f"  ETF daily rows: {len(etf_daily):,} ({time.time()-t0:.1f}s)")

    # Get SIC codes for trade symbols
    sic_map = con.execute("""
        SELECT DISTINCT ticker, LEFT(sic, 2) as sic2
        FROM financials
        WHERE sic IS NOT NULL
    """).fetchdf()
    con.close()

    sic_dict = dict(zip(sic_map["ticker"], sic_map["sic2"]))

    # Compute per-ETF daily returns and rolling metrics
    etf_features = {}
    for sym in etf_daily["symbol"].unique():
        sdf = etf_daily[etf_daily["symbol"] == sym].sort_values("trade_date").copy()
        sdf["return_1d"] = sdf["day_close"].pct_change() * 100
        sdf["return_5d"] = sdf["day_close"].pct_change(5) * 100
        sdf["return_20d"] = sdf["day_close"].pct_change(20) * 100
        sdf["gap_pct"] = (sdf["day_open"] / sdf["day_close"].shift(1) - 1) * 100
        sdf["intraday_range"] = (sdf["day_high"] - sdf["day_low"]) / sdf["day_close"] * 100
        etf_features[sym] = sdf.set_index("trade_date")

    # Compute features for each trade using vectorized merges
    print("Computing per-trade ETF context features...")

    # Convert entry_time to date for lookups (Timestamp for index matching)
    trades["trade_date"] = pd.to_datetime(trades["entry_time"]).dt.normalize()

    # For look-ahead-free: we need PRIOR day's data for each trade.
    # Strategy: add a "next_trade_date" column to ETF data, so merging on trade_date
    # gives us the prior day's features.
    def make_prior_day_lookup(etf_df, prefix, cols):
        """Shift ETF features forward by 1 day so merging on trade_date gives prior-day data."""
        df = etf_df[cols].copy().reset_index()
        # Rename original index to avoid confusion
        df = df.rename(columns={"trade_date": "etf_date"})
        df.columns = ["etf_date"] + [f"{prefix}_{c}" for c in cols]
        # The etf_date is when the data was recorded.
        # Shift forward: next trading day's trade_date → this day's features (prior-day look-back).
        dates_sorted = df["etf_date"].sort_values().values
        df = df.sort_values("etf_date")
        df["trade_date"] = pd.Series(dates_sorted).shift(-1).values
        df = df.dropna(subset=["trade_date"])
        df = df.drop(columns=["etf_date"])
        return df

    # SPY features
    spy_data = etf_features.get("SPY")
    if spy_data is not None:
        spy_lookup = make_prior_day_lookup(
            spy_data, "spy",
            ["return_1d", "return_5d", "return_20d", "gap_pct", "intraday_range"]
        )
        trades = trades.merge(spy_lookup, on="trade_date", how="left")
    else:
        for c in ["spy_return_1d", "spy_return_5d", "spy_return_20d", "spy_gap_pct", "spy_intraday_range"]:
            trades[c] = np.nan

    # QQQ features
    qqq_data = etf_features.get("QQQ")
    if qqq_data is not None:
        qqq_lookup = make_prior_day_lookup(qqq_data, "qqq", ["return_1d"])
        trades = trades.merge(qqq_lookup, on="trade_date", how="left")
    else:
        trades["qqq_return_1d"] = np.nan

    # IWM features
    iwm_data = etf_features.get("IWM")
    if iwm_data is not None:
        iwm_lookup = make_prior_day_lookup(iwm_data, "iwm", ["return_1d"])
        trades = trades.merge(iwm_lookup, on="trade_date", how="left")
    else:
        trades["iwm_return_1d"] = np.nan

    # Spreads
    trades["spy_qqq_spread"] = trades["spy_return_1d"] - trades["qqq_return_1d"]
    trades["spy_iwm_spread"] = trades["spy_return_1d"] - trades["iwm_return_1d"]

    # Sector ETF relative strength: map each trade's symbol → sector ETF → prior-day return
    trades["sector_etf"] = trades["symbol"].map(sic_dict).map(SIC_TO_ETF)

    # Build a combined sector lookup: for each sector ETF, prior-day return by trade_date
    sector_lookups = []
    sector_etfs = ["XLB", "XLC", "XLE", "XLF", "XLI", "XLK", "XLP", "XLRE", "XLU", "XLV", "XLY"]
    for etf in sector_etfs:
        if etf in etf_features:
            sl = make_prior_day_lookup(etf_features[etf], "sector_etf", ["return_1d"])
            sl["sector_etf"] = etf
            sl = sl.rename(columns={"sector_etf_return_1d": "sector_etf_return_1d"})
            sector_lookups.append(sl)

    if sector_lookups:
        sector_all = pd.concat(sector_lookups, ignore_index=True)
        trades = trades.merge(sector_all, on=["trade_date", "sector_etf"], how="left")
    else:
        trades["sector_etf_return_1d"] = np.nan

    trades["sector_vs_spy_1d"] = trades["sector_etf_return_1d"] - trades["spy_return_1d"]

    # Market breadth: count how many sector ETFs were up on prior day
    breadth_rows = []
    for etf in sector_etfs:
        if etf in etf_features:
            bl = make_prior_day_lookup(etf_features[etf], etf, ["return_1d"])
            bl = bl.rename(columns={f"{etf}_return_1d": f"ret_{etf}"})
            breadth_rows.append(bl[["trade_date", f"ret_{etf}"]])

    if breadth_rows:
        breadth_df = breadth_rows[0]
        for br in breadth_rows[1:]:
            breadth_df = breadth_df.merge(br, on="trade_date", how="outer")
        ret_cols = [c for c in breadth_df.columns if c.startswith("ret_")]
        breadth_df["sectors_up_count"] = breadth_df[ret_cols].gt(0).sum(axis=1)
        breadth_df["sectors_total"] = breadth_df[ret_cols].notna().sum(axis=1)
        breadth_df["market_breadth"] = breadth_df["sectors_up_count"] / breadth_df["sectors_total"] * 100
        trades = trades.merge(breadth_df[["trade_date", "sectors_up_count", "market_breadth"]], on="trade_date", how="left")
    else:
        trades["sectors_up_count"] = np.nan
        trades["market_breadth"] = np.nan

    # Clean up temp columns
    trades = trades.drop(columns=["sector_etf"], errors="ignore")

    print(f"  Features computed ({time.time()-t0:.1f}s)")

    feature_cols = [
        "spy_return_1d", "spy_return_5d", "spy_return_20d", "spy_gap_pct", "spy_intraday_range",
        "qqq_return_1d", "iwm_return_1d",
        "spy_qqq_spread", "spy_iwm_spread",
        "sector_etf_return_1d", "sector_vs_spy_1d",
        "sectors_up_count", "market_breadth",
    ]

    # Coverage stats
    for c in feature_cols:
        n = trades[c].notna().sum()
        print(f"  {c}: {n:,} ({n/len(trades)*100:.1f}%)")

    # ── Lift analysis ──
    features = [
        ("spy_return_1d", "SPY Prior-Day Return (%)"),
        ("spy_return_5d", "SPY 5-Day Return (%)"),
        ("spy_return_20d", "SPY 20-Day Return (%)"),
        ("spy_gap_pct", "SPY Prior-Day Gap (%)"),
        ("spy_intraday_range", "SPY Prior-Day Intraday Range (%)"),
        ("qqq_return_1d", "QQQ Prior-Day Return (%)"),
        ("iwm_return_1d", "IWM Prior-Day Return (%)"),
        ("spy_qqq_spread", "SPY-QQQ Return Spread"),
        ("spy_iwm_spread", "SPY-IWM Return Spread"),
        ("sector_etf_return_1d", "Sector ETF Prior-Day Return (%)"),
        ("sector_vs_spy_1d", "Sector vs SPY Relative Strength"),
        ("sectors_up_count", "Sectors Up (Count, 0-11)"),
        ("market_breadth", "Market Breadth (% Sectors Up)"),
    ]

    feature_summary = []
    for col, label in features:
        valid = trades.dropna(subset=[col])
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

    # Direction-specific
    longs = trades[trades["direction"].str.lower() == "long"]
    shorts = trades[trades["direction"].str.lower() == "short"]
    dir_results = []
    for col, label in features:
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
    report.append("# Sector ETF Rotation & Broad Market — Lift Analysis")
    report.append("")
    report.append(f"Generated: {pd.Timestamp.now().strftime('%Y-%m-%d %H:%M')}")
    report.append(f"Trades: {len(trades):,}")
    report.append(f"ETF daily rows: {len(etf_daily):,}")
    fdr_count = sum(1 for f in feature_summary if f.get("fdr_sig"))
    report.append(f"FDR-Significant: {fdr_count}/{len(feature_summary)}")
    report.append("")

    report.append("## 1. Feature Summary")
    report.append("")
    report.append("| Feature | n | Cohen's d | p-value | FDR Sig |")
    report.append("|---------|---|-----------|---------|---------|")
    for fs in feature_summary:
        sig = "Y" if fs.get("fdr_sig") else ""
        report.append(f"| {fs['feature']} | {fs['n']:,} | {fs['d']:.3f} | {fs['p']:.4f} | {sig} |")
    report.append("")

    report.append("## 2. Quintile Breakdowns")
    report.append("")
    for col, label in features:
        rows = quintile_breakdown(trades, col)
        if rows is None:
            continue
        report.append(f"**{label}** (n={sum(r['n'] for r in rows):,})")
        report.append("")
        report.append("| Quintile | Range | n | WR | Avg P&L |")
        report.append("|----------|-------|---|----|---------|")
        for r in rows:
            report.append(f"| {r['quintile']} | {r['range']} | {r['n']:,} | {r['wr']:.1f}% | ${r['avg_pnl']:.0f} |")
        report.append("")

    report.append("## 3. Direction-Specific (Top 15)")
    report.append("")
    report.append("| Feature | n | Cohen's d | p-value |")
    report.append("|---------|---|-----------|---------|")
    for dr in dir_results[:15]:
        report.append(f"| {dr['feature']} | {dr['n']:,} | {dr['d']:.3f} | {dr['p']:.4f} |")
    report.append("")

    report.append("## 4. Conclusions")
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
    path = REPORT_DIR / "sector-etf-lift.md"
    path.write_text("\n".join(report), encoding="utf-8")
    elapsed = time.time() - t0
    print(f"\nReport: {path}")
    print(f"Done in {elapsed:.1f}s")


if __name__ == "__main__":
    main()
