"""
Holly Exit Optimizer — Interactive Analytics Dashboard (Streamlit)

Run:  streamlit run analytics/output/holly_dashboard.py
"""

import numpy as np
import pandas as pd
import streamlit as st
import plotly.graph_objects as go
from plotly.subplots import make_subplots
from pathlib import Path

# ── Config ─────────────────────────────────────────────────────────────

st.set_page_config(
    page_title="Holly Analytics Dashboard",
    page_icon="📊",
    layout="wide",
    initial_sidebar_state="expanded",
)

DATA_PATH = Path(__file__).parent.parent / "holly_exit" / "output" / "holly_analytics.csv"
MIN_SECTOR_TRADES = 50


# ── Load Data ──────────────────────────────────────────────────────────

@st.cache_data
def load_data():
    df = pd.read_csv(DATA_PATH)
    df["entry_dt"] = pd.to_datetime(df["entry_time"])
    df["holly_pnl"] = df["holly_pnl"].fillna(0)
    df = df.sort_values("entry_dt").reset_index(drop=True)
    return df


df = load_data()

# ── Sidebar Filters ───────────────────────────────────────────────────

st.sidebar.title("🎯 Filter Stack")
st.sidebar.markdown("Toggle each filter layer on/off to see its effect")

# Filter toggles
use_edge = st.sidebar.checkbox("Edge Verdict (Strong Edge only)", value=True)
use_tod = st.sidebar.checkbox("Time-of-Day (06:30-08:00)", value=True)
use_regime = st.sidebar.checkbox("Regime (sideways + downtrend)", value=True)
use_sector = st.sidebar.checkbox(f"Sector (WR>52%, min {MIN_SECTOR_TRADES} trades)", value=True)

st.sidebar.markdown("---")
st.sidebar.subheader("🔧 Custom Filters")

# Strategy filter
strategies = sorted(df["strategy"].unique())
selected_strategies = st.sidebar.multiselect(
    "Strategies",
    strategies,
    default=[],
    placeholder="All strategies",
)

# Year range
years = sorted(df["trade_year"].unique())
year_range = st.sidebar.slider("Year Range", int(min(years)), int(max(years)), (int(min(years)), int(max(years))))

# Direction filter
directions = st.sidebar.multiselect(
    "Direction",
    sorted(df["direction"].unique()),
    default=[],
    placeholder="All directions",
)

# ── Apply Filters ─────────────────────────────────────────────────────

mask = pd.Series([True] * len(df), index=df.index)

if use_edge:
    mask = mask & (df["prob_edge_verdict"] == "Strong Edge")
if use_tod:
    mask = mask & df["tod_bucket"].isin(["06:30", "07:00", "07:30", "08:00"])
if use_regime:
    mask = mask & df["trend_regime"].isin(["sideways", "downtrend"])
if use_sector:
    mask = mask & (df["sector_win_rate"] > 0.52) & (df["sector_trades"] >= MIN_SECTOR_TRADES)
if selected_strategies:
    mask = mask & df["strategy"].isin(selected_strategies)
if directions:
    mask = mask & df["direction"].isin(directions)

mask = mask & (df["trade_year"] >= year_range[0]) & (df["trade_year"] <= year_range[1])

filtered = df.loc[mask].sort_values("entry_dt")
baseline = df[(df["trade_year"] >= year_range[0]) & (df["trade_year"] <= year_range[1])].sort_values("entry_dt")

# ── Header ─────────────────────────────────────────────────────────────

st.title("📊 Holly Exit Optimizer — Analytics Dashboard")

# ── KPI Row ────────────────────────────────────────────────────────────

col1, col2, col3, col4, col5, col6 = st.columns(6)

n_filtered = len(filtered)
n_baseline = len(baseline)
wr = filtered["is_winner"].mean() * 100 if n_filtered > 0 else 0
wr_baseline = baseline["is_winner"].mean() * 100
avg_pnl = filtered["holly_pnl"].mean() if n_filtered > 0 else 0
total_pnl = filtered["holly_pnl"].sum() if n_filtered > 0 else 0
sharpe = (filtered["holly_pnl"].mean() / filtered["holly_pnl"].std() * np.sqrt(252)) if n_filtered > 10 else 0

col1.metric("Trades", f"{n_filtered:,}", f"{n_filtered/n_baseline*100:.0f}% of baseline" if n_baseline > 0 else "")
col2.metric("Win Rate", f"{wr:.1f}%", f"{wr - wr_baseline:+.1f}pp vs baseline")
col3.metric("Avg PnL", f"${avg_pnl:,.0f}", f"${avg_pnl - baseline['holly_pnl'].mean():+,.0f}")
col4.metric("Total PnL", f"${total_pnl:,.0f}")
col5.metric("Sharpe", f"{sharpe:.1f}")
col6.metric("Profit Factor",
            f"{filtered.loc[filtered['holly_pnl']>0,'holly_pnl'].sum() / max(abs(filtered.loc[filtered['holly_pnl']<=0,'holly_pnl'].sum()), 1):.2f}"
            if n_filtered > 0 else "N/A")

# ── Equity Curve ───────────────────────────────────────────────────────

st.subheader("Equity Curves")

fig_eq = go.Figure()
fig_eq.add_trace(go.Scatter(
    x=baseline["entry_dt"], y=baseline["holly_pnl"].cumsum(),
    mode="lines", name=f"Baseline (n={len(baseline):,})",
    line=dict(color="#94a3b8", width=1), opacity=0.5,
))
if n_filtered > 0:
    fig_eq.add_trace(go.Scatter(
        x=filtered["entry_dt"], y=filtered["holly_pnl"].cumsum(),
        mode="lines", name=f"Filtered (n={n_filtered:,})",
        line=dict(color="#10b981", width=2.5),
    ))
fig_eq.update_layout(
    template="plotly_white", height=400,
    yaxis=dict(tickformat="$,.0f"),
    xaxis_title="Trade Date", yaxis_title="Cumulative PnL ($)",
    legend=dict(orientation="h", yanchor="bottom", y=-0.15, xanchor="center", x=0.5),
)
st.plotly_chart(fig_eq, use_container_width=True)

# ── Conditional Probability Tree ───────────────────────────────────────

st.subheader("🌳 Conditional Probability Tree (IF → THEN)")
st.markdown("*Select dimensions to see conditional win rates*")

tree_cols = st.columns(4)
dim1 = tree_cols[0].selectbox("Dimension 1", ["strategy", "trend_regime", "tod_bucket", "sector", "direction", "trade_year", "vol_regime", "momentum_regime"], index=1)
dim2 = tree_cols[1].selectbox("Dimension 2", ["(none)", "strategy", "trend_regime", "tod_bucket", "sector", "direction", "trade_year", "vol_regime", "momentum_regime"], index=2)
min_n = tree_cols[2].number_input("Min trades per group", value=20, min_value=5, max_value=500, step=5)
sort_by = tree_cols[3].selectbox("Sort by", ["win_rate", "avg_pnl", "n_trades", "total_pnl"], index=0)

# Build the tree
tree_data = filtered.copy() if n_filtered > 0 else baseline.copy()

if dim2 == "(none)":
    group_cols = [dim1]
else:
    group_cols = [dim1, dim2]

if all(c in tree_data.columns for c in group_cols):
    tree_agg = tree_data.dropna(subset=group_cols).groupby(group_cols).agg(
        n_trades=("holly_pnl", "count"),
        win_rate=("is_winner", "mean"),
        avg_pnl=("holly_pnl", "mean"),
        total_pnl=("holly_pnl", "sum"),
        median_pnl=("holly_pnl", "median"),
    ).reset_index()
    tree_agg["win_rate"] = (tree_agg["win_rate"] * 100).round(1)
    tree_agg["avg_pnl"] = tree_agg["avg_pnl"].round(0)
    tree_agg["total_pnl"] = tree_agg["total_pnl"].round(0)
    tree_agg["median_pnl"] = tree_agg["median_pnl"].round(0)
    tree_agg = tree_agg[tree_agg["n_trades"] >= min_n]
    tree_agg = tree_agg.sort_values(sort_by, ascending=(sort_by == "n_trades"))

    # Truncate long sector names
    for col in group_cols:
        if tree_agg[col].dtype == object:
            tree_agg[col] = tree_agg[col].str[:50]

    st.dataframe(
        tree_agg.style.format({
            "win_rate": "{:.1f}%",
            "avg_pnl": "${:,.0f}",
            "total_pnl": "${:,.0f}",
            "median_pnl": "${:,.0f}",
            "n_trades": "{:,}",
        }).background_gradient(subset=["win_rate"], cmap="RdYlGn", vmin=35, vmax=70),
        use_container_width=True,
        height=400,
    )

# ── Per-Layer Breakdown ────────────────────────────────────────────────

st.subheader("📊 Filter Layer Impact")

layer_data = []
filters = [
    ("Baseline", pd.Series([True] * len(baseline), index=baseline.index)),
    ("+ Edge Verdict", baseline["prob_edge_verdict"] == "Strong Edge"),
    ("+ Time-of-Day", baseline["tod_bucket"].isin(["06:30", "07:00", "07:30", "08:00"])),
    ("+ Regime", baseline["trend_regime"].isin(["sideways", "downtrend"])),
    ("+ Sector (robust)", (baseline["sector_win_rate"] > 0.52) & (baseline["sector_trades"] >= MIN_SECTOR_TRADES)),
]

running_mask = pd.Series([True] * len(baseline), index=baseline.index)
for name, filt in filters:
    if name != "Baseline":
        running_mask = running_mask & filt
    sub = baseline.loc[running_mask]
    n = len(sub)
    if n > 0:
        layer_data.append({
            "Layer": name,
            "Trades": n,
            "WR%": round(sub["is_winner"].mean() * 100, 1),
            "Avg PnL": round(sub["holly_pnl"].mean(), 0),
            "Total PnL": round(sub["holly_pnl"].sum(), 0),
            "Sharpe": round(sub["holly_pnl"].mean() / sub["holly_pnl"].std() * np.sqrt(252), 1) if n > 10 else 0,
        })

layer_df = pd.DataFrame(layer_data)
st.dataframe(
    layer_df.style.format({
        "Trades": "{:,}",
        "WR%": "{:.1f}%",
        "Avg PnL": "${:,.0f}",
        "Total PnL": "${:,.0f}",
        "Sharpe": "{:.1f}",
    }).background_gradient(subset=["WR%"], cmap="RdYlGn", vmin=48, vmax=65),
    use_container_width=True,
)

# ── Charts Row ─────────────────────────────────────────────────────────

chart_col1, chart_col2 = st.columns(2)

# WR by Time-of-Day
with chart_col1:
    st.subheader("Win Rate by Time-of-Day")
    tod_agg = filtered.groupby("tod_bucket").agg(
        n=("holly_pnl", "count"), wr=("is_winner", "mean"), avg_pnl=("holly_pnl", "mean")
    ).reset_index() if n_filtered > 0 else pd.DataFrame()

    if len(tod_agg) > 0:
        tod_agg["wr_pct"] = tod_agg["wr"] * 100
        tod_agg = tod_agg.sort_values("tod_bucket")
        colors = ["#10b981" if wr > 52 else "#f59e0b" if wr > 48 else "#ef4444" for wr in tod_agg["wr_pct"]]
        fig_tod = go.Figure(go.Bar(
            x=tod_agg["tod_bucket"], y=tod_agg["wr_pct"],
            marker_color=colors,
            text=[f"{wr:.0f}%<br>n={n:,}" for wr, n in zip(tod_agg["wr_pct"], tod_agg["n"])],
            textposition="outside",
        ))
        fig_tod.add_hline(y=50, line_dash="dash", line_color="gray", opacity=0.5)
        fig_tod.update_layout(template="plotly_white", height=350, yaxis_title="Win Rate (%)")
        st.plotly_chart(fig_tod, use_container_width=True)

# WR by Regime
with chart_col2:
    st.subheader("Win Rate by Regime")
    regime_agg = filtered.dropna(subset=["trend_regime"]).groupby("trend_regime").agg(
        n=("holly_pnl", "count"), wr=("is_winner", "mean"), avg_pnl=("holly_pnl", "mean")
    ).reset_index() if n_filtered > 0 else pd.DataFrame()

    if len(regime_agg) > 0:
        regime_agg["wr_pct"] = regime_agg["wr"] * 100
        colors = ["#10b981" if wr > 52 else "#f59e0b" if wr > 48 else "#ef4444" for wr in regime_agg["wr_pct"]]
        fig_regime = go.Figure(go.Bar(
            x=regime_agg["trend_regime"], y=regime_agg["wr_pct"],
            marker_color=colors,
            text=[f"{wr:.0f}%<br>n={n:,}" for wr, n in zip(regime_agg["wr_pct"], regime_agg["n"])],
            textposition="outside",
        ))
        fig_regime.add_hline(y=50, line_dash="dash", line_color="gray", opacity=0.5)
        fig_regime.update_layout(template="plotly_white", height=350, yaxis_title="Win Rate (%)")
        st.plotly_chart(fig_regime, use_container_width=True)

# ── Year-over-Year ─────────────────────────────────────────────────────

st.subheader("📅 Year-over-Year Performance")

yoy_col1, yoy_col2 = st.columns(2)

with yoy_col1:
    yoy = filtered.groupby("trade_year").agg(
        n=("holly_pnl", "count"),
        wr=("is_winner", "mean"),
        avg_pnl=("holly_pnl", "mean"),
        total_pnl=("holly_pnl", "sum"),
    ).reset_index() if n_filtered > 0 else pd.DataFrame()

    if len(yoy) > 0:
        yoy["wr_pct"] = yoy["wr"] * 100
        fig_yoy = make_subplots(specs=[[{"secondary_y": True}]])
        fig_yoy.add_trace(go.Bar(
            x=yoy["trade_year"], y=yoy["total_pnl"],
            name="Total PnL", marker_color="#3b82f6", opacity=0.6,
        ), secondary_y=False)
        fig_yoy.add_trace(go.Scatter(
            x=yoy["trade_year"], y=yoy["wr_pct"],
            mode="lines+markers", name="Win Rate %",
            line=dict(color="#10b981", width=2),
            marker=dict(size=8),
        ), secondary_y=True)
        fig_yoy.add_hline(y=50, line_dash="dash", line_color="gray", opacity=0.3, secondary_y=True)
        fig_yoy.update_layout(template="plotly_white", height=350)
        fig_yoy.update_yaxes(title_text="Total PnL ($)", tickformat="$,.0f", secondary_y=False)
        fig_yoy.update_yaxes(title_text="Win Rate (%)", secondary_y=True)
        st.plotly_chart(fig_yoy, use_container_width=True)

with yoy_col2:
    if len(yoy) > 0:
        st.dataframe(
            yoy[["trade_year", "n", "wr_pct", "avg_pnl", "total_pnl"]].rename(columns={
                "trade_year": "Year", "n": "Trades", "wr_pct": "WR%",
                "avg_pnl": "Avg PnL", "total_pnl": "Total PnL",
            }).style.format({
                "Trades": "{:,}", "WR%": "{:.1f}%",
                "Avg PnL": "${:,.0f}", "Total PnL": "${:,.0f}",
            }).background_gradient(subset=["WR%"], cmap="RdYlGn", vmin=40, vmax=65),
            use_container_width=True,
            height=350,
        )

# ── Strategy Leaderboard ───────────────────────────────────────────────

st.subheader("🏆 Strategy Leaderboard")

strat_agg = filtered.groupby("strategy").agg(
    n=("holly_pnl", "count"),
    wr=("is_winner", "mean"),
    avg_pnl=("holly_pnl", "mean"),
    total_pnl=("holly_pnl", "sum"),
).reset_index() if n_filtered > 0 else pd.DataFrame()

if len(strat_agg) > 0:
    strat_agg["wr_pct"] = (strat_agg["wr"] * 100).round(1)
    strat_agg["avg_pnl"] = strat_agg["avg_pnl"].round(0)
    strat_agg["total_pnl"] = strat_agg["total_pnl"].round(0)
    strat_agg = strat_agg[strat_agg["n"] >= 10].sort_values("total_pnl", ascending=False)

    st.dataframe(
        strat_agg[["strategy", "n", "wr_pct", "avg_pnl", "total_pnl"]].rename(columns={
            "strategy": "Strategy", "n": "Trades", "wr_pct": "WR%",
            "avg_pnl": "Avg PnL", "total_pnl": "Total PnL",
        }).style.format({
            "Trades": "{:,}", "WR%": "{:.1f}%",
            "Avg PnL": "${:,.0f}", "Total PnL": "${:,.0f}",
        }).background_gradient(subset=["WR%"], cmap="RdYlGn", vmin=35, vmax=70),
        use_container_width=True,
        height=400,
    )

# ── Drawdown ───────────────────────────────────────────────────────────

st.subheader("📉 Drawdown")
if n_filtered > 0:
    cum_pnl = filtered["holly_pnl"].cumsum()
    peak = cum_pnl.cummax()
    dd = cum_pnl - peak
    max_dd = dd.min()

    fig_dd = go.Figure()
    fig_dd.add_trace(go.Scatter(
        x=filtered["entry_dt"], y=dd,
        mode="lines", fill="tozeroy",
        line=dict(color="#ef4444", width=1),
        fillcolor="rgba(239,68,68,0.2)",
        name="Drawdown",
    ))
    fig_dd.update_layout(
        template="plotly_white", height=300,
        yaxis=dict(tickformat="$,.0f"),
        annotations=[dict(
            x=filtered.iloc[dd.values.argmin()]["entry_dt"],
            y=max_dd, text=f"Max DD: ${max_dd:,.0f}",
            showarrow=True, arrowhead=2,
        )],
    )
    st.plotly_chart(fig_dd, use_container_width=True)

# ── Footer ─────────────────────────────────────────────────────────────

st.markdown("---")
st.caption(f"Data: {len(df):,} trades | {df['entry_dt'].min():%Y-%m-%d} to {df['entry_dt'].max():%Y-%m-%d} | "
           f"96 columns | Source: holly_analytics.csv")
