"""
Script 81 -- Economic Events, Market Breadth & Stock Splits Lift
================================================================
Mines the remaining unmined DuckDB tables for win/loss separation:

1. ECONOMIC EVENT FLAGS (241 rows)
   - is_fomc_day, is_nfp_day, is_event_day
   - Do Holly trades on FOMC/NFP days win more or less?

2. MARKET DAILY (13.6M rows, 19,927 symbols)
   - Market breadth: advance/decline ratio, % of stocks up
   - New highs vs new lows (approximated via 20d/50d extremes)
   - Market-wide momentum: median return, mean volume change
   - Breadth thrust indicators

3. STOCK SPLITS (27,277 rows)
   - Days since last split, days until next split
   - Split momentum (post-split drift)

Coverage: economic_event_flags covers 2015+, market_daily covers 2021+,
stock_splits has broad coverage.

Usage:
    python scripts/81_economic_breadth_splits_lift.py
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
    """Load trades + all new features from unmined tables."""
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

    # === 1. ECONOMIC EVENT FLAGS ===
    print("  Loading economic event flags...")
    econ = con.execute("""
        SELECT t.trade_id,
            COALESCE(ef.is_fomc_day, 0) AS is_fomc_day,
            COALESCE(ef.is_nfp_day, 0) AS is_nfp_day,
            COALESCE(ef.is_event_day, 0) AS is_event_day,
            -- Days to next FOMC
            (SELECT MIN(e2.date) FROM economic_event_flags e2
             WHERE e2.is_fomc_day = 1 AND e2.date > CAST(t.entry_time AS DATE))
            - CAST(t.entry_time AS DATE) AS days_to_next_fomc,
            -- Days since last FOMC
            CAST(t.entry_time AS DATE) -
            (SELECT MAX(e3.date) FROM economic_event_flags e3
             WHERE e3.is_fomc_day = 1 AND e3.date <= CAST(t.entry_time AS DATE))
            AS days_since_last_fomc
        FROM trades t
        LEFT JOIN economic_event_flags ef ON ef.date = CAST(t.entry_time AS DATE)
    """).fetchdf()
    df = df.merge(econ, on="trade_id", how="left")
    fomc_cov = (df["is_fomc_day"] == 1).sum()
    nfp_cov = (df["is_nfp_day"] == 1).sum()
    print(f"    FOMC day trades: {fomc_cov:,}, NFP day trades: {nfp_cov:,}")

    # === 2. MARKET BREADTH (from market_daily) ===
    print("  Computing market breadth features (this may take a moment)...")
    t_mb = time.time()
    breadth = con.execute("""
        WITH daily_stats AS (
            SELECT
                bar_date,
                COUNT(*) AS total_stocks,
                SUM(CASE WHEN close > open THEN 1 ELSE 0 END) AS advancing,
                SUM(CASE WHEN close < open THEN 1 ELSE 0 END) AS declining,
                AVG((close - open) / NULLIF(open, 0) * 100) AS avg_return_pct,
                MEDIAN((close - open) / NULLIF(open, 0) * 100) AS median_return_pct,
                STDDEV((close - open) / NULLIF(open, 0) * 100) AS return_dispersion,
                AVG(volume) AS avg_volume
            FROM market_daily
            WHERE close > 0 AND open > 0
            GROUP BY bar_date
        )
        SELECT
            t.trade_id,
            ds.total_stocks AS mkt_total_stocks,
            ds.advancing * 1.0 / NULLIF(ds.total_stocks, 0) AS mkt_advance_pct,
            ds.advancing * 1.0 / NULLIF(ds.declining, 0) AS mkt_ad_ratio,
            ds.avg_return_pct AS mkt_avg_return,
            ds.median_return_pct AS mkt_median_return,
            ds.return_dispersion AS mkt_return_dispersion,
            -- Prior day breadth (avoid look-ahead)
            LAG(ds.advancing * 1.0 / NULLIF(ds.total_stocks, 0))
                OVER (ORDER BY ds.bar_date) AS mkt_prior_advance_pct,
            LAG(ds.advancing * 1.0 / NULLIF(ds.declining, 0))
                OVER (ORDER BY ds.bar_date) AS mkt_prior_ad_ratio,
            LAG(ds.avg_return_pct)
                OVER (ORDER BY ds.bar_date) AS mkt_prior_avg_return,
            LAG(ds.median_return_pct)
                OVER (ORDER BY ds.bar_date) AS mkt_prior_median_return,
            LAG(ds.return_dispersion)
                OVER (ORDER BY ds.bar_date) AS mkt_prior_dispersion
        FROM trades t
        LEFT JOIN daily_stats ds ON ds.bar_date = CAST(t.entry_time AS DATE)
    """).fetchdf()
    df = df.merge(breadth, on="trade_id", how="left")
    breadth_cov = df["mkt_prior_advance_pct"].notna().sum()
    print(f"    Market breadth coverage: {breadth_cov:,}/{len(df):,} ({breadth_cov/len(df)*100:.1f}%) ({time.time()-t_mb:.1f}s)")

    # 5-day breadth thrust (rolling)
    print("  Computing 5-day breadth thrust...")
    t_bt = time.time()
    thrust = con.execute("""
        WITH daily_adv AS (
            SELECT
                bar_date,
                SUM(CASE WHEN close > open THEN 1 ELSE 0 END) * 1.0 /
                    NULLIF(COUNT(*), 0) AS adv_pct
            FROM market_daily
            WHERE close > 0 AND open > 0
            GROUP BY bar_date
        ),
        rolling AS (
            SELECT bar_date, adv_pct,
                AVG(adv_pct) OVER (ORDER BY bar_date ROWS BETWEEN 5 PRECEDING AND 1 PRECEDING) AS adv_pct_5d_avg,
                MIN(adv_pct) OVER (ORDER BY bar_date ROWS BETWEEN 5 PRECEDING AND 1 PRECEDING) AS adv_pct_5d_min,
                MAX(adv_pct) OVER (ORDER BY bar_date ROWS BETWEEN 5 PRECEDING AND 1 PRECEDING) AS adv_pct_5d_max
            FROM daily_adv
        )
        SELECT t.trade_id,
            r.adv_pct_5d_avg AS mkt_breadth_5d_avg,
            r.adv_pct_5d_max - r.adv_pct_5d_min AS mkt_breadth_5d_range,
            r.adv_pct - r.adv_pct_5d_avg AS mkt_breadth_surprise
        FROM trades t
        LEFT JOIN rolling r ON r.bar_date = CAST(t.entry_time AS DATE)
    """).fetchdf()
    df = df.merge(thrust, on="trade_id", how="left")
    print(f"    Breadth thrust computed ({time.time()-t_bt:.1f}s)")

    # === 3. STOCK SPLITS ===
    print("  Loading stock split features...")
    splits = con.execute("""
        SELECT t.trade_id,
            -- Days since last split for this ticker
            DATEDIFF('day',
                (SELECT MAX(CAST(s.execution_date AS DATE))
                 FROM stock_splits s
                 WHERE s.ticker = t.symbol
                   AND CAST(s.execution_date AS DATE) <= CAST(t.entry_time AS DATE)),
                CAST(t.entry_time AS DATE)
            ) AS days_since_split,
            -- Days to next split
            DATEDIFF('day',
                CAST(t.entry_time AS DATE),
                (SELECT MIN(CAST(s.execution_date AS DATE))
                 FROM stock_splits s
                 WHERE s.ticker = t.symbol
                   AND CAST(s.execution_date AS DATE) > CAST(t.entry_time AS DATE))
            ) AS days_to_next_split,
            -- Had a split in last 30 days?
            CASE WHEN EXISTS (
                SELECT 1 FROM stock_splits s
                WHERE s.ticker = t.symbol
                  AND CAST(s.execution_date AS DATE) BETWEEN CAST(t.entry_time AS DATE) - 30
                      AND CAST(t.entry_time AS DATE)
            ) THEN 1 ELSE 0 END AS recent_split_30d,
            -- Split ratio (most recent)
            (SELECT s.split_to / NULLIF(s.split_from, 0)
             FROM stock_splits s
             WHERE s.ticker = t.symbol
               AND CAST(s.execution_date AS DATE) <= CAST(t.entry_time AS DATE)
             ORDER BY CAST(s.execution_date AS DATE) DESC LIMIT 1
            ) AS last_split_ratio
        FROM trades t
    """).fetchdf()
    df = df.merge(splits, on="trade_id", how="left")
    split_cov = df["days_since_split"].notna().sum()
    recent_split_cov = (df["recent_split_30d"] == 1).sum()
    print(f"    Split history coverage: {split_cov:,}/{len(df):,} ({split_cov/len(df)*100:.1f}%)")
    print(f"    Recent split (30d) trades: {recent_split_cov:,}")

    elapsed = time.time() - t0
    print(f"  Total load time: {elapsed:.1f}s")
    return df


def cohens_d(wins, losses):
    """Compute Cohen's d between win/loss groups."""
    if len(wins) < 10 or len(losses) < 10:
        return 0.0, 1.0
    pooled_std = np.sqrt((np.var(wins, ddof=1) + np.var(losses, ddof=1)) / 2)
    if pooled_std == 0:
        return 0.0, 1.0
    d = (np.mean(wins) - np.mean(losses)) / pooled_std
    _, p = stats.mannwhitneyu(wins, losses, alternative="two-sided")
    return d, p


def analyze_features(df, features, label="Global"):
    """Run Cohen's d analysis on a list of features."""
    results = []
    wins = df[df["win"] == 1]
    losses = df[df["win"] == 0]

    for feat in features:
        valid = df[feat].notna()
        n = valid.sum()
        if n < 50:
            continue
        w = wins.loc[valid & (df["win"] == 1), feat].values
        l = losses.loc[valid & (df["win"] == 0), feat].values
        if len(w) < 20 or len(l) < 20:
            continue
        d, p = cohens_d(w, l)
        results.append({"feature": feat, "d": d, "p": p, "n": n})

    results = sorted(results, key=lambda x: abs(x["d"]), reverse=True)

    # FDR correction
    if results:
        p_vals = np.array([r["p"] for r in results])
        m = len(p_vals)
        ranks = np.argsort(np.argsort(p_vals)) + 1
        fdr = p_vals * m / ranks
        fdr_sig = fdr <= 0.05
        for i, r in enumerate(results):
            r["fdr_sig"] = fdr_sig[i]
            r["fdr_p"] = fdr[i]

    return results


def main():
    t0 = time.time()
    con = duckdb.connect(str(DUCKDB_PATH), read_only=True)
    print(f"Connected to {DUCKDB_PATH.name}")
    df = load_features(con)
    con.close()

    # Define feature groups
    econ_features = [
        "is_fomc_day", "is_nfp_day", "is_event_day",
        "days_to_next_fomc", "days_since_last_fomc",
    ]

    breadth_features = [
        "mkt_prior_advance_pct", "mkt_prior_ad_ratio",
        "mkt_prior_avg_return", "mkt_prior_median_return", "mkt_prior_dispersion",
        "mkt_breadth_5d_avg", "mkt_breadth_5d_range", "mkt_breadth_surprise",
    ]

    split_features = [
        "days_since_split", "days_to_next_split",
        "recent_split_30d", "last_split_ratio",
    ]

    all_features = econ_features + breadth_features + split_features

    # === Global Analysis ===
    print(f"\n=== Cohen's d Analysis (Global) ===")
    results = analyze_features(df, all_features)
    fdr_count = sum(1 for r in results if r.get("fdr_sig", False))
    print(f"FDR-significant: {fdr_count}/{len(results)}")
    for r in results:
        marker = "  ***" if r.get("fdr_sig") else "     "
        print(f"{marker} {r['feature']:30s} d={r['d']:+.3f}  p={r['p']:.4f}  n={r['n']:,}")

    # === Direction-Specific Analysis ===
    print(f"\n=== Direction-Specific Analysis ===")
    dir_results = []
    for direction in ["long", "short"]:
        mask = df["direction"].str.lower() == direction
        sub = df[mask]
        dr = analyze_features(sub, all_features, label=direction)
        for r in dr:
            r["direction"] = direction
        dir_results.extend(dr)

    dir_results = sorted(dir_results, key=lambda x: abs(x["d"]), reverse=True)
    for r in dir_results[:15]:
        print(f"  {r['direction']:5s} {r['feature']:30s} d={r['d']:+.3f}  p={r['p']:.4f}  n={r['n']:,}")

    # === Category-specific breakdown ===
    print(f"\n=== Economic Event Day Win Rates ===")
    for flag in ["is_fomc_day", "is_nfp_day", "is_event_day"]:
        on = df[df[flag] == 1]
        off = df[df[flag] == 0]
        if len(on) > 0:
            print(f"  {flag}: ON={on['win'].mean()*100:.1f}% (n={len(on):,})  "
                  f"OFF={off['win'].mean()*100:.1f}% (n={len(off):,})  "
                  f"delta={on['win'].mean()*100 - off['win'].mean()*100:+.1f}pp")

    # === Build report ===
    report = []
    report.append("# Economic Events, Market Breadth & Stock Splits Lift")
    report.append("")
    report.append(f"Generated: {pd.Timestamp.now().strftime('%Y-%m-%d %H:%M')}")
    report.append(f"Total trades: {len(df):,}")
    report.append("")

    report.append("## 1. Feature Sources")
    report.append("")
    report.append("| Source | Table | Rows | Features | Coverage |")
    report.append("|--------|-------|------|----------|----------|")
    breadth_cov = df["mkt_prior_advance_pct"].notna().sum()
    split_cov = df["days_since_split"].notna().sum()
    econ_cov = (df["days_to_next_fomc"].notna()).sum()
    report.append(f"| Economic Events | economic_event_flags | 241 | {len(econ_features)} | "
                  f"{econ_cov:,}/{len(df):,} ({econ_cov/len(df)*100:.1f}%) |")
    report.append(f"| Market Breadth | market_daily | 13.6M | {len(breadth_features)} | "
                  f"{breadth_cov:,}/{len(df):,} ({breadth_cov/len(df)*100:.1f}%) |")
    report.append(f"| Stock Splits | stock_splits | 27,277 | {len(split_features)} | "
                  f"{split_cov:,}/{len(df):,} ({split_cov/len(df)*100:.1f}%) |")
    report.append("")

    report.append("## 2. Cohen's d Results (Global)")
    report.append("")
    report.append("| Feature | d | p-value | n | FDR sig? | Category |")
    report.append("|---------|---|---------|---|----------|----------|")
    for r in results:
        cat = ("Economic" if r["feature"] in econ_features else
               "Breadth" if r["feature"] in breadth_features else "Split")
        sig = "YES" if r.get("fdr_sig") else ""
        report.append(f"| {r['feature']} | {r['d']:+.3f} | {r['p']:.4f} | {r['n']:,} | {sig} | {cat} |")
    report.append("")

    report.append("## 3. Direction-Specific Results (Top 15)")
    report.append("")
    report.append("| Direction | Feature | d | p-value | n |")
    report.append("|-----------|---------|---|---------|---|")
    for r in dir_results[:15]:
        report.append(f"| {r['direction']} | {r['feature']} | {r['d']:+.3f} | {r['p']:.4f} | {r['n']:,} |")
    report.append("")

    report.append("## 4. Economic Event Day Win Rates")
    report.append("")
    report.append("| Event | WR (on) | WR (off) | Delta | n (on) |")
    report.append("|-------|---------|----------|-------|--------|")
    for flag in ["is_fomc_day", "is_nfp_day", "is_event_day"]:
        on = df[df[flag] == 1]
        off = df[df[flag] == 0]
        if len(on) > 0:
            d = on['win'].mean()*100 - off['win'].mean()*100
            report.append(f"| {flag} | {on['win'].mean()*100:.1f}% | {off['win'].mean()*100:.1f}% | "
                          f"{d:+.1f}pp | {len(on):,} |")
    report.append("")

    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    path = REPORT_DIR / "economic-breadth-splits-lift.md"
    path.write_text("\n".join(report), encoding="utf-8")
    elapsed = time.time() - t0
    print(f"\nReport: {path}")
    print(f"Done in {elapsed:.1f}s")


if __name__ == "__main__":
    main()
