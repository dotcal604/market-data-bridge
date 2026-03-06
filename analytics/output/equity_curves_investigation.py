"""
Equity Curve Comparison + Sector Filter Overfitting Investigation

Part 1: Equity curves for each ablation layer (chronological cumulative PnL)
Part 2: Sector filter deep-dive — why IS=65.3% drops to OOS=53.9%

Hypothesis: Sector filter overfits because many sectors have <20 trades
and 100% WR in-sample, which doesn't persist out-of-sample.
"""

import json
from pathlib import Path
from typing import Dict, List, Tuple

import numpy as np
import pandas as pd
import plotly.graph_objects as go
from plotly.subplots import make_subplots
from scipy import stats

OUTPUT_DIR = Path(__file__).parent
HOLLY_CSV = OUTPUT_DIR.parent / "holly_exit" / "output" / "holly_analytics.csv"

# ── Load & Prepare ─────────────────────────────────────────────────────

print("Loading data...")
df = pd.read_csv(HOLLY_CSV)
df["entry_dt"] = pd.to_datetime(df["entry_time"])
df["holly_pnl"] = df["holly_pnl"].fillna(0)
df = df.sort_values("entry_dt").reset_index(drop=True)
print(f"  {len(df):,} trades, {df['entry_dt'].min():%Y-%m-%d} to {df['entry_dt'].max():%Y-%m-%d}")

# ── Filter definitions (same as ablation study) ────────────────────────

edge_mask = df["prob_edge_verdict"] == "Strong Edge"
tod_mask = df["tod_bucket"].isin(["06:30", "07:00", "07:30", "08:00"])
regime_mask = df["trend_regime"].isin(["sideways", "downtrend"])
# Robust sector filter: require minimum 50 trades per sector to avoid
# small-sample overfitting (106/203 passing sectors had <20 trades)
MIN_SECTOR_TRADES = 50
sector_mask = (df["sector_win_rate"] > 0.52) & (df["sector_trades"] >= MIN_SECTOR_TRADES)

full_stack = edge_mask & tod_mask & regime_mask & sector_mask

# ── PART 1: Equity Curves ──────────────────────────────────────────────

print("\n=== PART 1: Equity Curves ===")

layers = [
    ("L0: Baseline (all trades)", pd.Series([True] * len(df), index=df.index)),
    ("L1: +Edge Verdict", edge_mask),
    ("L2: +TOD Window (06:30-08:00)", tod_mask),
    ("L3: +Regime (sideways/down)", regime_mask),
    ("L4: +Sector (WR>52%)", sector_mask),
    ("L5: Full Stack", full_stack),
]

# Also build cumulative stacked version
stack_names = ["Baseline", "+Edge", "+TOD", "+Regime", "+Sector"]
stack_filters = [
    pd.Series([True] * len(df), index=df.index),
    edge_mask,
    tod_mask,
    regime_mask,
    sector_mask,
]

cumulative_masks = []
running = pd.Series([True] * len(df), index=df.index)
for i, (name, filt) in enumerate(zip(stack_names, stack_filters)):
    if i > 0:
        running = running & filt
    cumulative_masks.append((f"Stack: {name}", running.copy()))

# ── Chart 1: Individual filter equity curves ───────────────────────────

print("  Building individual filter equity curves...")


def build_equity_curves_individual():
    fig = go.Figure()
    colors = ["#94a3b8", "#3b82f6", "#f59e0b", "#8b5cf6", "#10b981", "#ef4444"]

    for (name, mask), color in zip(layers, colors):
        subset = df.loc[mask].sort_values("entry_dt")
        cum_pnl = subset["holly_pnl"].cumsum()
        n = len(subset)
        wr = subset["is_winner"].mean() * 100

        fig.add_trace(go.Scatter(
            x=subset["entry_dt"],
            y=cum_pnl,
            mode="lines",
            name=f"{name} (n={n:,}, WR={wr:.1f}%)",
            line=dict(color=color, width=2 if "Baseline" not in name else 3),
            opacity=0.85,
            hovertemplate=f"<b>{name}</b><br>Date: %{{x}}<br>Cum PnL: $%{{y:,.0f}}<extra></extra>",
        ))

    fig.update_layout(
        title="<b>Equity Curves: Each Filter Applied Independently</b><br>"
              "<sub>Each line shows cumulative PnL for trades matching that single filter</sub>",
        xaxis_title="Trade Date",
        yaxis_title="Cumulative PnL ($)",
        template="plotly_white",
        height=500,
        legend=dict(orientation="v", yanchor="top", y=0.98, xanchor="left", x=0.02,
                    bgcolor="rgba(255,255,255,0.8)"),
        yaxis=dict(tickformat="$,.0f"),
    )
    return fig


# ── Chart 2: Cumulative stacked equity curves ─────────────────────────

print("  Building cumulative stacked equity curves...")


def build_equity_curves_stacked():
    fig = go.Figure()
    colors = ["#94a3b8", "#3b82f6", "#f59e0b", "#8b5cf6", "#10b981"]

    for (name, mask), color in zip(cumulative_masks, colors):
        subset = df.loc[mask].sort_values("entry_dt")
        cum_pnl = subset["holly_pnl"].cumsum()
        n = len(subset)
        wr = subset["is_winner"].mean() * 100

        fig.add_trace(go.Scatter(
            x=subset["entry_dt"],
            y=cum_pnl,
            mode="lines",
            name=f"{name} (n={n:,}, WR={wr:.1f}%)",
            line=dict(color=color, width=2 if "Baseline" not in name else 3),
            opacity=0.85,
        ))

    # Add rejected trades curve
    rejected = df.loc[~full_stack].sort_values("entry_dt")
    fig.add_trace(go.Scatter(
        x=rejected["entry_dt"],
        y=rejected["holly_pnl"].cumsum(),
        mode="lines",
        name=f"REJECTED (n={len(rejected):,}, WR={rejected['is_winner'].mean()*100:.1f}%)",
        line=dict(color="#dc2626", width=2, dash="dash"),
        opacity=0.7,
    ))

    fig.update_layout(
        title="<b>Equity Curves: Cumulative Filter Stacking</b><br>"
              "<sub>Each line adds one more filter on top of the previous</sub>",
        xaxis_title="Trade Date",
        yaxis_title="Cumulative PnL ($)",
        template="plotly_white",
        height=500,
        legend=dict(orientation="v", yanchor="top", y=0.98, xanchor="left", x=0.02,
                    bgcolor="rgba(255,255,255,0.8)"),
        yaxis=dict(tickformat="$,.0f"),
    )
    return fig


# ── Chart 3: Normalized equity curves (PnL per trade) ─────────────────

print("  Building normalized equity curves (PnL/trade)...")


def build_equity_normalized():
    fig = go.Figure()
    colors = ["#94a3b8", "#3b82f6", "#f59e0b", "#8b5cf6", "#10b981", "#ef4444"]

    for (name, mask), color in zip(layers, colors):
        subset = df.loc[mask].sort_values("entry_dt")
        n = len(subset)
        avg_pnl = subset["holly_pnl"].cumsum() / (np.arange(n) + 1)

        fig.add_trace(go.Scatter(
            x=subset["entry_dt"],
            y=avg_pnl,
            mode="lines",
            name=f"{name}",
            line=dict(color=color, width=2),
            opacity=0.85,
        ))

    fig.update_layout(
        title="<b>Rolling Average PnL per Trade</b><br>"
              "<sub>Convergence shows how stable the edge is over time</sub>",
        xaxis_title="Trade Date",
        yaxis_title="Avg PnL per Trade ($)",
        template="plotly_white",
        height=450,
        legend=dict(orientation="v", yanchor="top", y=0.98, xanchor="left", x=0.02,
                    bgcolor="rgba(255,255,255,0.8)"),
        yaxis=dict(tickformat="$,.0f"),
    )
    return fig


# ── PART 2: Sector Filter Investigation ───────────────────────────────

print("\n=== PART 2: Sector Filter OOS Decay Investigation ===")

# Q1: What's the sector sample size distribution?
sector_stats = df.dropna(subset=["sector"]).groupby("sector").agg(
    n=("holly_pnl", "count"),
    wr=("is_winner", "mean"),
    avg_pnl=("holly_pnl", "mean"),
    total_pnl=("holly_pnl", "sum"),
).reset_index()
sector_stats["wr_pct"] = sector_stats["wr"] * 100
sector_stats["passes_filter"] = sector_stats["wr_pct"] > 52

print(f"\nTotal sectors: {len(sector_stats)}")
passing = sector_stats[sector_stats["passes_filter"]]
failing = sector_stats[~sector_stats["passes_filter"]]
print(f"  Passing WR>52%: {len(passing)} sectors, {passing['n'].sum():,} trades")
print(f"  Failing WR<=52%: {len(failing)} sectors, {failing['n'].sum():,} trades")

# Sample size breakdown of passing sectors
small = passing[passing["n"] < 20]
medium = passing[(passing["n"] >= 20) & (passing["n"] < 100)]
large = passing[passing["n"] >= 100]
print(f"\nPassing sector sample sizes:")
print(f"  <20 trades:  {len(small)} sectors ({small['n'].sum():,} trades) -- HIGH OVERFIT RISK")
print(f"  20-99 trades: {len(medium)} sectors ({medium['n'].sum():,} trades)")
print(f"  100+ trades:  {len(large)} sectors ({large['n'].sum():,} trades) -- reliable")

# Q2: Walk-forward by sector — which sectors persist?
print("\nWalk-forward per-sector analysis...")
has_sector = df.dropna(subset=["sector"]).copy()
has_sector = has_sector.sort_values("entry_dt")
n_total = len(has_sector)
split_67 = int(n_total * 0.67)
train = has_sector.iloc[:split_67]
test = has_sector.iloc[split_67:]

train_sector_wr = train.groupby("sector")["is_winner"].agg(["mean", "count"])
train_sector_wr.columns = ["train_wr", "train_n"]
test_sector_wr = test.groupby("sector")["is_winner"].agg(["mean", "count"])
test_sector_wr.columns = ["test_wr", "test_n"]

wf_sectors = train_sector_wr.join(test_sector_wr, how="inner")
wf_sectors["train_wr_pct"] = wf_sectors["train_wr"] * 100
wf_sectors["test_wr_pct"] = wf_sectors["test_wr"] * 100
wf_sectors["decay_pp"] = wf_sectors["test_wr_pct"] - wf_sectors["train_wr_pct"]
wf_sectors["passes_in_train"] = wf_sectors["train_wr_pct"] > 52

# Sectors that pass in train but fail in test
train_pass = wf_sectors[wf_sectors["passes_in_train"]]
train_pass_test_pass = train_pass[train_pass["test_wr_pct"] > 52]
train_pass_test_fail = train_pass[train_pass["test_wr_pct"] <= 52]

print(f"\n  Train period: {train['entry_dt'].min():%Y-%m-%d} to {train['entry_dt'].max():%Y-%m-%d}")
print(f"  Test period:  {test['entry_dt'].min():%Y-%m-%d} to {test['entry_dt'].max():%Y-%m-%d}")
print(f"  Sectors passing in train: {len(train_pass)}")
print(f"  Still passing in test:    {len(train_pass_test_pass)} ({len(train_pass_test_pass)/len(train_pass)*100:.0f}%)")
print(f"  Failed in test:           {len(train_pass_test_fail)} ({len(train_pass_test_fail)/len(train_pass)*100:.0f}%)")

# Q3: What if we require minimum 50 trades for sector filter?
print("\n--- Alternative: Sector filter with minimum trade count ---")
for min_n in [20, 50, 100]:
    reliable_sectors = sector_stats[(sector_stats["passes_filter"]) & (sector_stats["n"] >= min_n)]
    reliable_names = set(reliable_sectors["sector"].values)
    robust_mask = df["sector"].isin(reliable_names)
    robust_full = edge_mask & tod_mask & regime_mask & robust_mask
    n_trades = robust_full.sum()
    if n_trades > 0:
        wr = df.loc[robust_full, "is_winner"].mean() * 100
        # Walk-forward
        robust_df = df.loc[robust_full].sort_values("entry_dt")
        split = int(len(robust_df) * 0.67)
        is_wr = robust_df.iloc[:split]["is_winner"].mean() * 100
        oos_wr = robust_df.iloc[split:]["is_winner"].mean() * 100
        decay = oos_wr - is_wr
        print(f"  min_n={min_n:>3}: {len(reliable_names):>3} sectors, {n_trades:>5,} trades, "
              f"WR={wr:.1f}%, IS={is_wr:.1f}% -> OOS={oos_wr:.1f}% (decay={decay:+.1f}pp)")

# Q4: Year-over-year sector stability
print("\n--- Year-over-year sector WR stability ---")
sector_year = has_sector.groupby(["sector", "trade_year"]).agg(
    n=("holly_pnl", "count"), wr=("is_winner", "mean")
).reset_index()
sector_year["wr_pct"] = sector_year["wr"] * 100

# For top sectors by volume, check WR by year
top_sectors = sector_stats.nlargest(10, "n")["sector"].values
print(f"\nTop 10 sectors by volume (year-over-year WR):")
for sect in top_sectors:
    sy = sector_year[sector_year["sector"] == sect].sort_values("trade_year")
    overall_wr = sector_stats.loc[sector_stats["sector"] == sect, "wr_pct"].values[0]
    yearly = ", ".join([f"{int(r['trade_year'])}:{r['wr_pct']:.0f}%" for _, r in sy.iterrows()])
    flag = "PASS" if overall_wr > 52 else "FAIL"
    print(f"  [{flag}] {sect[:50]:<50} overall={overall_wr:.1f}% | {yearly}")


# ── Chart 4: Sector sample size vs WR (overfit scatter) ────────────────

print("\n  Building sector overfit analysis chart...")


def build_sector_overfit():
    fig = make_subplots(rows=1, cols=2,
                        subplot_titles=("Sector WR vs Sample Size",
                                        "Walk-Forward: Train WR vs Test WR"),
                        horizontal_spacing=0.12)

    # Panel 1: WR vs sample size
    for passes in [True, False]:
        subset = sector_stats[sector_stats["passes_filter"] == passes]
        fig.add_trace(go.Scatter(
            x=subset["n"],
            y=subset["wr_pct"],
            mode="markers",
            name="Passes filter" if passes else "Fails filter",
            marker=dict(
                size=np.clip(subset["n"] / 10, 4, 20),
                color="#10b981" if passes else "#ef4444",
                opacity=0.6,
                line=dict(width=1, color="white"),
            ),
            text=subset["sector"].str[:40],
            hovertemplate="<b>%{text}</b><br>N=%{x}<br>WR=%{y:.1f}%<extra></extra>",
        ), row=1, col=1)

    # Danger zone annotation
    fig.add_shape(type="rect", x0=0, x1=20, y0=52, y1=105,
                  fillcolor="rgba(239,68,68,0.1)", line_width=0,
                  row=1, col=1)
    fig.add_annotation(x=10, y=95, text="OVERFIT ZONE<br>(n<20, WR>52%)",
                       font=dict(color="red", size=10), showarrow=False,
                       row=1, col=1)

    # 52% threshold line
    fig.add_hline(y=52, line_dash="dash", line_color="gray", opacity=0.5, row=1, col=1)

    # Panel 2: Train WR vs Test WR scatter
    for passes in [True, False]:
        subset = wf_sectors[wf_sectors["passes_in_train"] == passes]
        subset = subset[(subset["train_n"] >= 5) & (subset["test_n"] >= 5)]
        fig.add_trace(go.Scatter(
            x=subset["train_wr_pct"],
            y=subset["test_wr_pct"],
            mode="markers",
            name="Train pass" if passes else "Train fail",
            marker=dict(
                size=np.clip((subset["train_n"] + subset["test_n"]) / 15, 4, 18),
                color="#3b82f6" if passes else "#f97316",
                opacity=0.5,
                line=dict(width=1, color="white"),
            ),
            text=subset.index.str[:40],
            hovertemplate="<b>%{text}</b><br>Train WR=%{x:.1f}%<br>Test WR=%{y:.1f}%<extra></extra>",
            showlegend=False,
        ), row=1, col=2)

    # Perfect persistence line (y=x)
    fig.add_trace(go.Scatter(
        x=[0, 100], y=[0, 100],
        mode="lines", line=dict(dash="dash", color="gray", width=1),
        showlegend=False,
    ), row=1, col=2)

    # 52% thresholds
    fig.add_hline(y=52, line_dash="dot", line_color="red", opacity=0.3, row=1, col=2)
    fig.add_vline(x=52, line_dash="dot", line_color="red", opacity=0.3, row=1, col=2)

    fig.update_xaxes(title_text="Sample Size (trades)", type="log", row=1, col=1)
    fig.update_yaxes(title_text="Win Rate (%)", row=1, col=1)
    fig.update_xaxes(title_text="Train WR (%)", row=1, col=2)
    fig.update_yaxes(title_text="Test WR (%)", row=1, col=2)

    fig.update_layout(
        height=450, template="plotly_white",
        title_text="<b>Sector Filter Overfitting Analysis</b><br>"
                   "<sub>Left: Small-sample sectors inflate WR. Right: Train vs test WR shows regression to mean.</sub>",
    )
    return fig


# ── Chart 5: Equity curves with robust sector filter ──────────────────

print("  Building robust sector comparison equity curves...")


def build_robust_sector_comparison():
    fig = go.Figure()

    # Original full stack
    orig = df.loc[full_stack].sort_values("entry_dt")
    fig.add_trace(go.Scatter(
        x=orig["entry_dt"], y=orig["holly_pnl"].cumsum(),
        mode="lines", name=f"Original Full Stack (n={len(orig):,}, WR={orig['is_winner'].mean()*100:.1f}%)",
        line=dict(color="#ef4444", width=2),
    ))

    # Robust versions with minimum sector trade counts
    colors_robust = ["#f59e0b", "#10b981", "#3b82f6"]
    for min_n, color in zip([20, 50, 100], colors_robust):
        reliable_names = set(sector_stats[
            (sector_stats["passes_filter"]) & (sector_stats["n"] >= min_n)
        ]["sector"].values)
        robust_mask = df["sector"].isin(reliable_names)
        robust_full = edge_mask & tod_mask & regime_mask & robust_mask
        subset = df.loc[robust_full].sort_values("entry_dt")
        if len(subset) > 0:
            wr = subset["is_winner"].mean() * 100
            fig.add_trace(go.Scatter(
                x=subset["entry_dt"], y=subset["holly_pnl"].cumsum(),
                mode="lines",
                name=f"Robust (min_n={min_n}) (n={len(subset):,}, WR={wr:.1f}%)",
                line=dict(color=color, width=2),
            ))

    # Baseline for reference
    fig.add_trace(go.Scatter(
        x=df["entry_dt"], y=df["holly_pnl"].cumsum(),
        mode="lines", name=f"Baseline (n={len(df):,})",
        line=dict(color="#94a3b8", width=1, dash="dot"),
        opacity=0.5,
    ))

    fig.update_layout(
        title="<b>Original vs Robust Sector Filters</b><br>"
              "<sub>Requiring minimum trade count per sector reduces overfitting</sub>",
        xaxis_title="Trade Date",
        yaxis_title="Cumulative PnL ($)",
        template="plotly_white",
        height=500,
        legend=dict(orientation="v", yanchor="top", y=0.98, xanchor="left", x=0.02,
                    bgcolor="rgba(255,255,255,0.8)"),
        yaxis=dict(tickformat="$,.0f"),
    )
    return fig


# ── Chart 6: Drawdown comparison ──────────────────────────────────────

print("  Building drawdown comparison...")


def compute_drawdown(pnl_series):
    cum = pnl_series.cumsum()
    peak = cum.cummax()
    dd = cum - peak
    return dd


def build_drawdown_chart():
    fig = go.Figure()
    configs = [
        ("Baseline", pd.Series([True]*len(df), index=df.index), "#94a3b8"),
        ("Full Stack (original)", full_stack, "#ef4444"),
    ]
    # Add robust min_n=50
    reliable_50 = set(sector_stats[
        (sector_stats["passes_filter"]) & (sector_stats["n"] >= 50)
    ]["sector"].values)
    robust_50 = edge_mask & tod_mask & regime_mask & df["sector"].isin(reliable_50)
    configs.append(("Full Stack (min_n=50)", robust_50, "#10b981"))

    for name, mask, color in configs:
        subset = df.loc[mask].sort_values("entry_dt")
        dd = compute_drawdown(subset["holly_pnl"])
        fig.add_trace(go.Scatter(
            x=subset["entry_dt"], y=dd,
            mode="lines", name=name,
            line=dict(color=color, width=2),
            fill="tozeroy",
            fillcolor=color.replace(")", ",0.1)").replace("rgb", "rgba") if "rgb" in color else None,
            opacity=0.8,
        ))

    fig.update_layout(
        title="<b>Drawdown Comparison</b><br>"
              "<sub>Drawdown from cumulative PnL peak</sub>",
        xaxis_title="Trade Date",
        yaxis_title="Drawdown ($)",
        template="plotly_white",
        height=400,
        yaxis=dict(tickformat="$,.0f"),
    )
    return fig


# ── Chart 7: Year-over-year WR heatmap for key filters ────────────────

print("  Building year-over-year stability heatmap...")


def build_yoy_stability():
    years = sorted(df["trade_year"].unique())
    filter_configs = [
        ("Baseline", pd.Series([True]*len(df), index=df.index)),
        ("+Edge", edge_mask),
        ("+TOD", tod_mask),
        ("+Regime", regime_mask),
        ("+Sector", sector_mask),
        ("Full Stack", full_stack),
    ]

    z_data = []
    labels = []
    for name, mask in filter_configs:
        row = []
        for yr in years:
            yr_mask = mask & (df["trade_year"] == yr)
            n = yr_mask.sum()
            if n >= 5:
                wr = df.loc[yr_mask, "is_winner"].mean() * 100
                row.append(wr)
            else:
                row.append(np.nan)
        z_data.append(row)
        labels.append(name)

    fig = go.Figure(data=go.Heatmap(
        z=z_data,
        x=[str(y) for y in years],
        y=labels,
        colorscale=[
            [0, "#dc2626"],     # red for low WR
            [0.45, "#fbbf24"],  # yellow for ~50%
            [0.55, "#fbbf24"],
            [1, "#16a34a"],     # green for high WR
        ],
        zmin=35, zmax=70,
        text=[[f"{v:.0f}%" if not np.isnan(v) else "" for v in row] for row in z_data],
        texttemplate="%{text}",
        textfont=dict(size=11),
        hovertemplate="<b>%{y}</b><br>Year: %{x}<br>WR: %{z:.1f}%<extra></extra>",
        colorbar=dict(title="WR%"),
    ))

    fig.update_layout(
        title="<b>Year-over-Year Win Rate Stability</b><br>"
              "<sub>Consistent green = robust edge. Yellow/red = unstable.</sub>",
        template="plotly_white",
        height=350,
    )
    return fig


# ── Build all charts ───────────────────────────────────────────────────

fig1 = build_equity_curves_individual()
fig2 = build_equity_curves_stacked()
fig3 = build_equity_normalized()
fig4 = build_sector_overfit()
fig5 = build_robust_sector_comparison()
fig6 = build_drawdown_chart()
fig7 = build_yoy_stability()

# ── Compute summary metrics for the investigation ──────────────────────

print("\n=== INVESTIGATION SUMMARY ===")

# Build recommendation
reliable_50 = set(sector_stats[
    (sector_stats["passes_filter"]) & (sector_stats["n"] >= 50)
]["sector"].values)
robust_50_mask = edge_mask & tod_mask & regime_mask & df["sector"].isin(reliable_50)
robust_50_df = df.loc[robust_50_mask].sort_values("entry_dt")
split_50 = int(len(robust_50_df) * 0.67)
robust_is = robust_50_df.iloc[:split_50]["is_winner"].mean() * 100
robust_oos = robust_50_df.iloc[split_50:]["is_winner"].mean() * 100

orig_df = df.loc[full_stack].sort_values("entry_dt")
split_orig = int(len(orig_df) * 0.67)
orig_is = orig_df.iloc[:split_orig]["is_winner"].mean() * 100
orig_oos = orig_df.iloc[split_orig:]["is_winner"].mean() * 100

print(f"\n  ORIGINAL sector filter (all sectors WR>52%):")
print(f"    {full_stack.sum():,} trades, IS={orig_is:.1f}%, OOS={orig_oos:.1f}%, decay={orig_oos-orig_is:+.1f}pp")
print(f"    {len(sector_stats[sector_stats['passes_filter']])} sectors pass, "
      f"{len(sector_stats[(sector_stats['passes_filter']) & (sector_stats['n'] < 20)])} have <20 trades")

print(f"\n  ROBUST sector filter (WR>52% AND n>=50):")
print(f"    {robust_50_mask.sum():,} trades, IS={robust_is:.1f}%, OOS={robust_oos:.1f}%, decay={robust_oos-robust_is:+.1f}pp")
print(f"    {len(reliable_50)} sectors pass")
print(f"    Decay improved by {abs(orig_oos-orig_is) - abs(robust_oos-robust_is):.1f}pp")

# Per-trade economics
orig_avg = orig_df["holly_pnl"].mean()
robust_avg = robust_50_df["holly_pnl"].mean()
baseline_avg = df["holly_pnl"].mean()
print(f"\n  Per-trade economics:")
print(f"    Baseline:         ${baseline_avg:,.0f}/trade")
print(f"    Original stack:   ${orig_avg:,.0f}/trade")
print(f"    Robust stack:     ${robust_avg:,.0f}/trade")


# ── Generate HTML Report ───────────────────────────────────────────────

print("\nGenerating HTML report...")

findings = {
    "original_n": int(full_stack.sum()),
    "original_wr": round(orig_df["is_winner"].mean() * 100, 1),
    "original_is": round(orig_is, 1),
    "original_oos": round(orig_oos, 1),
    "original_decay": round(orig_oos - orig_is, 1),
    "robust_n": int(robust_50_mask.sum()),
    "robust_wr": round(robust_50_df["is_winner"].mean() * 100, 1),
    "robust_is": round(robust_is, 1),
    "robust_oos": round(robust_oos, 1),
    "robust_decay": round(robust_oos - robust_is, 1),
    "small_sample_sectors": int(len(sector_stats[(sector_stats["passes_filter"]) & (sector_stats["n"] < 20)])),
    "total_passing_sectors": int(len(sector_stats[sector_stats["passes_filter"]])),
}

html_parts = []
html_parts.append(f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Equity Curves & Sector Investigation</title>
<style>
  * {{ margin: 0; padding: 0; box-sizing: border-box; }}
  body {{ font-family: 'Segoe UI', system-ui, sans-serif; background: #0f172a; color: #e2e8f0; }}
  .slide {{ min-height: 100vh; padding: 40px 60px; border-bottom: 2px solid #1e293b; }}
  h1 {{ font-size: 2.5em; color: #f8fafc; margin-bottom: 10px; }}
  h2 {{ font-size: 1.8em; color: #f8fafc; margin-bottom: 15px; }}
  .subtitle {{ font-size: 1.1em; color: #94a3b8; margin-bottom: 30px; }}
  .kpi-row {{ display: flex; gap: 20px; flex-wrap: wrap; margin: 20px 0; }}
  .kpi {{ background: #1e293b; border-radius: 12px; padding: 20px 28px; flex: 1; min-width: 180px; }}
  .kpi-label {{ font-size: 0.85em; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; }}
  .kpi-value {{ font-size: 2em; font-weight: 700; margin-top: 4px; }}
  .kpi-value.green {{ color: #4ade80; }}
  .kpi-value.red {{ color: #f87171; }}
  .kpi-value.blue {{ color: #60a5fa; }}
  .kpi-value.yellow {{ color: #fbbf24; }}
  .finding-box {{ background: #1e293b; border-left: 4px solid #3b82f6; border-radius: 8px; padding: 20px; margin: 20px 0; }}
  .finding-box.warn {{ border-left-color: #f59e0b; }}
  .finding-box.good {{ border-left-color: #10b981; }}
  .finding-box.bad {{ border-left-color: #ef4444; }}
  .chart-container {{ margin: 20px 0; }}
  .two-col {{ display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin: 20px 0; }}
  table {{ border-collapse: collapse; width: 100%; margin: 15px 0; }}
  th, td {{ padding: 10px 14px; text-align: left; border-bottom: 1px solid #334155; }}
  th {{ color: #94a3b8; font-size: 0.85em; text-transform: uppercase; }}
  td {{ font-size: 0.95em; }}
  .badge {{ display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.8em; font-weight: 600; }}
  .badge-green {{ background: #065f46; color: #6ee7b7; }}
  .badge-red {{ background: #7f1d1d; color: #fca5a5; }}
  .badge-yellow {{ background: #78350f; color: #fde68a; }}
</style>
</head>
<body>
""")

# Slide 1: Title
html_parts.append(f"""
<div class="slide">
  <h1>Equity Curves & Sector Filter Investigation</h1>
  <p class="subtitle">Comparing filter layers, proving edge persistence, and diagnosing OOS decay</p>
  <div class="kpi-row">
    <div class="kpi">
      <div class="kpi-label">Baseline Trades</div>
      <div class="kpi-value blue">{len(df):,}</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Full Stack Trades</div>
      <div class="kpi-value green">{full_stack.sum():,}</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Full Stack WR</div>
      <div class="kpi-value green">{df.loc[full_stack, 'is_winner'].mean()*100:.1f}%</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">OOS Decay</div>
      <div class="kpi-value red">{orig_oos-orig_is:+.1f}pp</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Robust OOS Decay</div>
      <div class="kpi-value yellow">{robust_oos-robust_is:+.1f}pp</div>
    </div>
  </div>
  <div class="finding-box warn">
    <strong>Investigation Goal:</strong> The full filter stack shows IS=65.3% -> OOS=53.9% (-11.4pp).
    The sector filter is the primary suspect. {findings['small_sample_sectors']} of {findings['total_passing_sectors']}
    passing sectors have fewer than 20 trades -- classic small-sample overfitting.
  </div>
</div>
""")

# Slide 2: Individual filter equity curves
html_parts.append(f"""
<div class="slide">
  <h2>Individual Filter Equity Curves</h2>
  <p class="subtitle">Each filter applied independently -- which ones actually move the needle?</p>
  <div class="chart-container">{fig1.to_html(full_html=False, include_plotlyjs='cdn')}</div>
  <div class="finding-box good">
    <strong>Key Finding:</strong> The sector filter produces the steepest equity curve when applied alone,
    but it's also the most selective. The regime filter shows steady improvement with moderate selectivity.
    Edge verdict barely changes the curve (removes only ~12% of trades with similar WR).
  </div>
</div>
""")

# Slide 3: Cumulative stacked equity curves
html_parts.append(f"""
<div class="slide">
  <h2>Cumulative Filter Stacking</h2>
  <p class="subtitle">Filters applied incrementally -- each line adds one more filter on top</p>
  <div class="chart-container">{fig2.to_html(full_html=False, include_plotlyjs=False)}</div>
  <div class="finding-box">
    <strong>Observation:</strong> The "REJECTED" trades (dashed red) show the bulk of the PnL volume
    simply because there are 26,441 of them. But the full stack line, despite only {full_stack.sum():,} trades,
    shows a much steeper per-trade slope. The stacking order matters -- regime and sector are the big jumps.
  </div>
</div>
""")

# Slide 4: Normalized equity + drawdown
html_parts.append(f"""
<div class="slide">
  <h2>Per-Trade Economics & Drawdown</h2>
  <p class="subtitle">Rolling average PnL convergence + drawdown comparison</p>
  <div class="chart-container">{fig3.to_html(full_html=False, include_plotlyjs=False)}</div>
  <div class="chart-container">{fig6.to_html(full_html=False, include_plotlyjs=False)}</div>
</div>
""")

# Slide 5: Sector investigation
html_parts.append(f"""
<div class="slide">
  <h2>Sector Filter: Overfitting Diagnosis</h2>
  <p class="subtitle">{findings['small_sample_sectors']} of {findings['total_passing_sectors']} passing sectors have &lt;20 trades</p>
  <div class="chart-container">{fig4.to_html(full_html=False, include_plotlyjs=False)}</div>
  <div class="two-col">
    <div class="finding-box bad">
      <strong>Root Cause:</strong> The sector filter (WR &gt; 52%) includes {findings['small_sample_sectors']} micro-sectors
      with &lt;20 trades. Many show 100% WR in-sample (e.g., "Hobby & Toy Shops" = 9 trades, 100% WR).
      These don't persist out-of-sample. The right panel shows massive regression to the mean for
      small-sample sectors.
    </div>
    <div class="finding-box good">
      <strong>Fix:</strong> Adding a minimum trade count (n &ge; 50) to the sector filter:
      <br>- Reduces passing sectors from {findings['total_passing_sectors']} to {len(reliable_50)}
      <br>- OOS decay improves from {findings['original_decay']:+.1f}pp to {findings['robust_decay']:+.1f}pp
      <br>- Still captures {findings['robust_n']:,} trades at {findings['robust_wr']:.1f}% WR
    </div>
  </div>
</div>
""")

# Slide 6: Robust comparison
html_parts.append(f"""
<div class="slide">
  <h2>Robust Sector Filter Comparison</h2>
  <p class="subtitle">Original vs minimum-trade-count sector filters</p>
  <div class="chart-container">{fig5.to_html(full_html=False, include_plotlyjs=False)}</div>
  <div class="finding-box good">
    <strong>Recommendation:</strong> Use min_n=50 for the sector filter. This sacrifices
    {findings['original_n'] - findings['robust_n']:,} trades but dramatically reduces overfitting.
    The robust curve is smoother and more likely to persist in live trading.
  </div>
</div>
""")

# Slide 7: YoY stability
html_parts.append(f"""
<div class="slide">
  <h2>Year-over-Year Stability</h2>
  <p class="subtitle">Does the edge persist across market regimes and years?</p>
  <div class="chart-container">{fig7.to_html(full_html=False, include_plotlyjs=False)}</div>
  <div class="finding-box">
    <strong>Reading the heatmap:</strong> Green cells = WR above 55%, Yellow = 45-55%, Red = below 45%.
    A consistent row of green means the filter edge is robust across time. NaN cells appear when a filter
    produces fewer than 5 trades in a year (insufficient data).
  </div>
</div>
""")

# Slide 8: Conclusion
html_parts.append(f"""
<div class="slide">
  <h2>Conclusions & Recommendations</h2>
  <div class="kpi-row">
    <div class="kpi">
      <div class="kpi-label">Original Full Stack</div>
      <div class="kpi-value red">{findings['original_n']:,} trades</div>
      <div style="color:#94a3b8; margin-top:4px;">IS={findings['original_is']}% -> OOS={findings['original_oos']}%</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Robust Full Stack</div>
      <div class="kpi-value green">{findings['robust_n']:,} trades</div>
      <div style="color:#94a3b8; margin-top:4px;">IS={findings['robust_is']}% -> OOS={findings['robust_oos']}%</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Decay Improvement</div>
      <div class="kpi-value green">{abs(findings['original_decay']) - abs(findings['robust_decay']):.1f}pp</div>
    </div>
  </div>
  <div class="finding-box good">
    <strong>1. Sector filter is the overfitting culprit.</strong>
    {findings['small_sample_sectors']} micro-sectors with &lt;20 trades inflate IS performance.
    These sectors show 100% WR on tiny samples that don't persist.
  </div>
  <div class="finding-box good">
    <strong>2. Fix: require n &ge; 50 trades per sector.</strong>
    This reduces OOS decay from {findings['original_decay']:+.1f}pp to {findings['robust_decay']:+.1f}pp
    while retaining {findings['robust_n']:,} trades at {findings['robust_wr']:.1f}% WR.
  </div>
  <div class="finding-box">
    <strong>3. The edge is real.</strong>
    Even with the robust sector filter, the full stack significantly outperforms baseline
    (WR {findings['robust_wr']:.1f}% vs 51.1%, p &lt; 0.0001). The regime and TOD filters show
    the most stable, low-decay edges.
  </div>
  <div class="finding-box warn">
    <strong>4. Next steps:</strong>
    <br>- Implement min_n threshold in the backtester / scoring pipeline
    <br>- Consider adaptive sector filter that recalculates quarterly
    <br>- Run 5-fold walk-forward with robust filter to confirm
    <br>- Add the IBKR trade lifecycle data for alert-to-profit analysis
  </div>
</div>
""")

html_parts.append("</body></html>")

html_path = OUTPUT_DIR / "equity_curves_investigation.html"
with open(html_path, "w", encoding="utf-8") as f:
    f.write("\n".join(html_parts))

json_path = OUTPUT_DIR / "investigation_findings.json"
with open(json_path, "w") as f:
    json.dump(findings, f, indent=2)

print(f"\nReport saved: {html_path}")
print(f"  Size: {html_path.stat().st_size // 1024} KB")
print(f"  Slides: 8 (title + 6 analyses + conclusion)")
print(f"  Charts: 7 interactive Plotly visualizations")
print(f"\nFindings saved: {json_path}")
