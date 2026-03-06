# Holly AI Dashboard v2 — Visual Specifications

## Data Model Diagram
```
┌─────────────────┐     ┌──────────────────────┐     ┌──────────────────┐
│   Date_Table    │     │    Holly_Trades       │     │ Strategy_Lookup  │
│─────────────────│     │──────────────────────│     │──────────────────│
│ Date (PK)    ◄──┼──*──┤ trade_date (FK)      │  *──┤► Strategy (PK)   │
│ Year            │     │ trade_id             │     └──────────────────┘
│ Quarter         │     │ symbol               │
│ Month           │     │ strategy (FK) ───────┼──*──►
│ MonthName       │     │ direction            │
│ MonthNameShort  │     │ entry_time           │
│ MonthYear       │     │ holly_pnl            │
│ YearMonth (sort)│     │ r_multiple           │
│ DayOfWeek       │     │ mfe, mae             │
│ DayName         │     │ is_winner, is_loser  │
│ IsWeekday       │     │ trend_regime         │
│ ...             │     │ vol_regime           │
└─────────────────┘     │ momentum_regime      │
                        │ opt_exit_rule        │
                        │ ... (77 cols total)  │
                        │ [95 measures]        │
                        └──────────────────────┘

Relationships:
  Date_Table[Date] → Holly_Trades[trade_date]  (many-to-one, single)
  Strategy_Lookup[Strategy] → Holly_Trades[strategy]  (many-to-one, single)
```

---

## Theme: Holly Dark v2
| Token | Hex | Usage |
|-------|-----|-------|
| Background | `#0E1117` | Page/report background |
| Visual BG | `#1A1F2E` | Card/visual containers |
| Visual BG Alt | `#232340` | Alternate cards |
| Border | `#2D2D5E` | Visual borders |
| Text Primary | `#FAFAFA` | Titles, values |
| Text Secondary | `#8892A0` | Labels, subtitles |
| Accent | `#00D4AA` | Primary accent, profit |
| Loss | `#FF4444` | Loss, negative |
| Warning | `#FFD700` | Caution, neutral |
| Cyan | `#00D4FF` | Charts, links |
| Purple | `#7C4DFF` | Secondary accent |

---

## Page 1: Executive Command Center

### Layout Grid
```
┌──────────────────────────────────────────────────────────────┐
│ KPI Banner (10 cards)                          100% × 15%    │
├──────────────────────────────────────────────────────────────┤
│ Equity Curve (combo chart)                     100% × 50%    │
├─────────────────────────────┬────────────────────────────────┤
│ Monthly Waterfall            │ Rolling Win Rate Line          │
│ 50% × 35%                   │ 50% × 35%                     │
└─────────────────────────────┴────────────────────────────────┘
```

### Visual 1.1: KPI Banner (10 Cards)
| # | Visual | Value Measure | Format | Cond Format | Subtitle |
|---|--------|---------------|--------|-------------|----------|
| 1 | Card | Total Trades Display | `#,0` | — | [Page Summary Text] |
| 2 | Card | Win Rate Display | `0.0%` | BG: Win Rate Color | vs PY: [Win Rate YoY Change] |
| 3 | Card | Total PnL Display | `$#,0` | BG: PnL Color | vs PY: [PnL vs Prior Year Delta] |
| 4 | Card | Avg PnL Display | `$#,0.00` | BG: PnL Color | — |
| 5 | Card | Profit Factor Display | `#,0.00` | BG: PF Color | — |
| 6 | Card | Sharpe Display | `#,0.00` | BG: Sharpe Color | — |
| 7 | Card | Best Trade | `$#,0` | — | — |
| 8 | Card | Worst Trade | `$#,0` | — | — |
| 9 | Card | Avg R Display | `#,0.00` | BG: R Multiple Color | — |
| 10 | Card | Consistency Display | `0.0%` | BG: Consistency Color | — |

**Card styling**: Background `#1A1F2E`, border radius 12px, border `#2D2D5E`. Title font 10pt `#8892A0`. Value font 24pt `#FAFAFA`. Use "new card" visual in PBI.

### Visual 1.2: Equity Curve (Combo Chart)
- **Type**: Line and Stacked Area Chart
- **X-axis**: `Date_Table[Date]` (continuous, monthly granularity)
- **Line**: `[Cumulative PnL]` — color `#00D4AA`, weight 3px
- **Area**: `[Drawdown]` — color `#FF4444`, 50% opacity
- **Constant line**: Y = 0, dashed, color `#8892A0`
- **Title**: `[Equity Curve Title]` (dynamic measure)
- **Y-axis label color**: `#8892A0`
- **Gridlines**: `#2D2D5E`, horizontal only
- **Tooltip**: Date, Cumulative PnL, Drawdown, Total Trades (that day)

### Visual 1.3: Monthly Waterfall
- **Type**: Waterfall Chart
- **Category**: `Date_Table[MonthYear]` (sorted by `YearMonth`)
- **Y Values**: `[Total PnL]`
- **Sentiment colors**: Increase `#00D4AA`, Decrease `#FF4444`, Total `#00D4FF`
- **Title**: "Monthly P&L Waterfall"
- **Data labels**: On, font 8pt, abbreviated ($1.2K)

### Visual 1.4: Rolling Win Rate
- **Type**: Line Chart
- **X-axis**: `Date_Table[Date]` (monthly)
- **Line 1**: `[Running Win Rate]` — color `#00D4AA`
- **Reference line**: Y = 0.50, dashed `#FFD700`, label "50%"
- **Title**: "Running Win Rate Over Time"
- **Y-axis**: 0% to 70%, format as percentage

---

## Page 2: Strategy Scorecard

### Layout Grid
```
┌───────────┬──────────────────────────────────────────────────┐
│ Strategy  │ Strategy Matrix                   80% × 55%      │
│ Slicer    ├──────────────────────┬───────────────────────────┤
│ 20% × 100%│ Strategy Equity     │ Strategy Monthly PnL      │
│           │ Curve               │ Bar Chart                 │
│           │ 40% × 45%           │ 40% × 45%                │
└───────────┴──────────────────────┴───────────────────────────┘
```

### Visual 2.1: Strategy Slicer
- **Type**: Slicer (vertical list)
- **Field**: `Strategy_Lookup[Strategy]`
- **Settings**: Single select, search enabled, "Select all" off
- **Background**: `#1A1F2E`
- **Font**: 10pt `#FAFAFA`

### Visual 2.2: Strategy Matrix
- **Type**: Matrix
- **Rows**: `Holly_Trades[strategy]`
- **Values** (in order):

| Column | Measure | Format | Cond Format |
|--------|---------|--------|-------------|
| Trades | [Total Trades] | `#,0` | — |
| Win Rate | [Win Rate] | `0.0%` | BG: gradient Red→Yellow→Green, min 0.3, mid 0.5, max 0.7 |
| Avg PnL | [Avg PnL] | `$#,0.00` | Data bars: green pos, red neg |
| Total PnL | [Total PnL] | `$#,0` | Data bars: green pos, red neg |
| PF | [Profit Factor] | `#,0.00` | BG: gradient Red→Yellow→Green, min 0.5, mid 1.0, max 2.0 |
| Sharpe | [Sharpe Proxy] | `#,0.00` | BG: gradient, min 0, mid 1, max 3 |
| Consistency | [Consistency Score] | `0.0%` | BG: gradient, min 0.3, mid 0.5, max 0.7 |
| Hold Min | [Avg Hold Minutes] | `#,0` | — |
| Edge | [Edge Score] | `#,0.00` | BG: gradient, min 0.5, mid 1.0, max 2.0 |

- **Sort**: Total PnL descending
- **Row headers**: font 9pt `#FAFAFA`
- **Column headers**: font 9pt bold `#FAFAFA`, background `#0E1117`
- **Grid**: horizontal `#2D2D5E`
- **Drillthrough**: Right-click → Drillthrough → Strategy Drillthrough (Page 3)

### Visual 2.3: Strategy Equity Curve
- **Type**: Line Chart
- **X-axis**: `Date_Table[Date]` (continuous)
- **Y-axis**: `[Cumulative PnL]`
- **Color**: `#00D4AA`
- **Title**: "Equity Curve — Selected Strategy"
- **Note**: Responds to strategy slicer. Shows flat line if no selection.

### Visual 2.4: Strategy Monthly PnL
- **Type**: Clustered Bar Chart
- **Axis**: `Holly_Trades[Month_Name_Short]` (sorted by `trade_month`)
- **Values**: `[Total PnL]`
- **Conditional format**: Bars colored by PnL Color (green/red)
- **Title**: "Monthly P&L — Selected Strategy"

---

## Page 3: Strategy Drillthrough (Hidden)

**Drillthrough field**: `Holly_Trades[strategy]`
**Page visibility**: Hidden (accessed only via drillthrough from Page 2)

### Layout Grid
```
┌──────────────────────────────────────────────────────────────┐
│ KPI Row (7 cards)                              100% × 12%    │
├──────────────────────────────────────────────────────────────┤
│ Strategy Equity Curve                          100% × 25%    │
├─────────────────────────────┬────────────────────────────────┤
│ PnL Distribution            │ Time × Day Heatmap            │
│ (bar chart)                 │ (matrix)                       │
│ 50% × 25%                   │ 50% × 25%                     │
├─────────────────────────────┬────────────────────────────────┤
│ Top 10 Symbols Table        │ Bottom 10 Symbols Table       │
│ 50% × 19%                   │ 50% × 19%                     │
├─────────────────────────────┬────────────────────────────────┤
│ R-Multiple Distribution     │ Monthly Heatmap (Year × Month) │
│ 50% × 19%                   │ 50% × 19%                     │
└─────────────────────────────┴────────────────────────────────┘
```

### Visual 3.1: KPI Row
Same 7 cards as Page 1 (Total Trades, Win Rate, Total PnL, Avg PnL, PF, Sharpe, Avg R) — auto-filtered to drillthrough strategy.

### Visual 3.2: Equity Curve
Line chart, `[Cumulative PnL]` over `Date_Table[Date]`, green line.

### Visual 3.3: PnL Distribution
- **Type**: Clustered Bar Chart
- **Axis**: `Holly_Trades[PnL_Bucket]` (sorted by `PnL_Bucket_Sort`)
- **Values**: `[Total Trades]`
- **Conditional format**: Bar color by `[PnL Color]`
- **Title**: "P&L Distribution"

### Visual 3.4: Entry Hour × Day Heatmap
- **Type**: Matrix
- **Rows**: `Holly_Trades[Entry_Hour_Label]`
- **Columns**: `Holly_Trades[Day_Name_Short]` (sorted Mon→Fri via `trade_dow`)
- **Values**: `[Avg PnL]`
- **Format**: `$#,0.00`
- **Conditional format**: Background, diverging Red→White→Green, centered at 0
- **Title**: "Avg PnL by Hour × Day"

### Visual 3.5: Top 10 Symbols
- **Type**: Table
- **Columns**: symbol, [Total Trades], [Win Rate], [Total PnL], [Avg PnL]
- **Filter**: Top N = 10, by [Total PnL] descending
- **Title**: "Top 10 Symbols by P&L"

### Visual 3.6: Bottom 10 Symbols
- **Type**: Table
- **Same columns**, Filter: Bottom N = 10, by [Total PnL] ascending
- **Title**: "Bottom 10 Symbols by P&L"

### Visual 3.7: R-Multiple Distribution
- **Type**: Clustered Bar Chart
- **Axis**: `Holly_Trades[R_Multiple_Bucket]` (sorted by `R_Multiple_Bucket_Sort`)
- **Values**: `[Total Trades]`
- **Color**: `#00D4FF`
- **Title**: "R-Multiple Distribution"

### Visual 3.8: Monthly Heatmap
- **Type**: Matrix
- **Rows**: `Holly_Trades[trade_year]`
- **Columns**: `Holly_Trades[Month_Name_Short]` (sorted by `trade_month`)
- **Values**: `[Total PnL]`
- **Conditional format**: Background, diverging Red→White→Green, center 0
- **Title**: "Monthly P&L by Year"

---

## Page 4: Regime Analysis

### Layout Grid
```
┌──────────────────────────────────────────────────────────────┐
│ Slicers: trend_regime | vol_regime | momentum_regime  8%     │
├──────────┬───────────────────┬───────────────────────────────┤
│ Trend ×  │ Trend ×           │ Vol ×                         │
│ Vol      │ Momentum          │ Momentum                      │
│ Heatmap  │ Heatmap           │ Heatmap                       │
│ 33% × 45%│ 33% × 45%         │ 33% × 45%                    │
├──────────┴──────────┬────────┴───────────────────────────────┤
│ Regime Bar Charts   │ RSI Scatter                            │
│ (3 stacked)         │                                        │
│ 60% × 47%           │ 40% × 47%                              │
└─────────────────────┴────────────────────────────────────────┘
```

**Page-level filter**: `Has_Regime_Flag = "With Regime Data"`

### Visual 4.1: Slicer Row
Three dropdown slicers side by side:
- `Holly_Trades[trend_regime]` — multi-select
- `Holly_Trades[vol_regime]` — multi-select
- `Holly_Trades[momentum_regime]` — multi-select

### Visual 4.2–4.4: Regime Cross-Tab Heatmaps
Three matrix visuals:

| Visual | Rows | Columns | Values |
|--------|------|---------|--------|
| 4.2 | trend_regime | vol_regime | [Win Rate] |
| 4.3 | trend_regime | momentum_regime | [Win Rate] |
| 4.4 | vol_regime | momentum_regime | [Win Rate] |

All three:
- **Format**: `0.0%`
- **Conditional format**: Background gradient Red→Yellow→Green (0.30 → 0.50 → 0.70)
- **Tooltip**: Also show [Total Trades], [Avg PnL]

### Visual 4.5: Regime Bar Charts
Three clustered bar charts stacked vertically (each ~33% of the 60% width allocation):
1. **[Avg PnL] by trend_regime** (3 bars: uptrend/downtrend/sideways)
2. **[Avg PnL] by vol_regime** (3 bars: low_vol/normal_vol/high_vol)
3. **[Avg PnL] by momentum_regime** (3 bars)
- Conditional format: bars green if Avg PnL > 0, red if < 0
- **Alternative**: Use "Performance Metric" field parameter slicer to let user swap

### Visual 4.6: RSI Scatter
- **Type**: Scatter Chart
- **X-axis**: `Holly_Trades[rsi14]` (Don't summarize)
- **Y-axis**: `Holly_Trades[pnl_per_share]` (Don't summarize)
- **Legend**: `Holly_Trades[trend_regime]`
- **Size**: Constant (small)
- **Trend line**: Per series, linear
- **Reference lines**: X = 30 (dashed `#FF4444`), X = 70 (dashed `#00D4AA`)
- **Title**: "RSI vs P&L by Trend Regime"

---

## Page 5: Time Analysis

### Layout Grid
```
┌──────────────────────────────────────────────────────────────┐
│ Hour × Day Heatmap (matrix)                    100% × 40%    │
├─────────────────────────────┬────────────────────────────────┤
│ PnL by Day × Direction      │ PnL by Hour + Trade Count     │
│ (grouped bar)               │ (bar + line combo)            │
│ 50% × 30%                   │ 50% × 30%                     │
├─────────────────────────────┬────────────────────────────────┤
│ Monthly Seasonality         │ Dynamic Chart                  │
│ (bar)                       │ (field param × field param)   │
│ 50% × 30%                   │ 50% × 30%                     │
└─────────────────────────────┴────────────────────────────────┘
```

### Visual 5.1: Master Heatmap
- **Type**: Matrix
- **Rows**: `Holly_Trades[Entry_Hour_Label]`
- **Columns**: `Holly_Trades[Day_Name_Short]` (sort by `trade_dow`)
- **Values**: `[Avg PnL]` (default — switchable via "Performance Metric" field parameter)
- **Conditional format**: Background, diverging Red `#FF4444` → White → Green `#00D4AA`, center 0
- **Title**: "Performance Heatmap: Entry Hour × Day of Week"
- **Slicer**: "Performance Metric" field parameter slicer above

### Visual 5.2: PnL by Day × Direction
- **Type**: Clustered Bar Chart
- **Axis**: `Holly_Trades[Day_Name_Short]` (sorted Mon→Fri)
- **Values**: `[Avg PnL]`
- **Legend**: `Holly_Trades[direction]` (Long=`#00D4AA`, Short=`#FF4444`)
- **Title**: "Avg PnL by Day of Week — Long vs Short"

### Visual 5.3: PnL by Hour + Trade Count
- **Type**: Line and Clustered Column Chart
- **Shared axis**: `Holly_Trades[Entry_Hour_Label]`
- **Column values**: `[Avg PnL]`
- **Line values**: `[Total Trades]` (secondary axis)
- **Column color**: Conditional by PnL Color
- **Line color**: `#00D4FF`
- **Title**: "Avg PnL by Entry Hour (bars) vs Trade Count (line)"

### Visual 5.4: Monthly Seasonality
- **Type**: Clustered Bar Chart
- **Axis**: `Holly_Trades[Month_Name_Short]` (sorted by `trade_month`)
- **Values**: `[Avg PnL]`
- **Conditional format**: Bars green/red by sign
- **Title**: "Monthly Seasonality — Avg PnL"

### Visual 5.5: Dynamic Chart
- **Type**: Line Chart (or clustered bar — user choice)
- **X-axis**: "Time Dimension" field parameter
- **Y-axis**: "Performance Metric" field parameter
- **Title**: "Dynamic Analysis — Use Slicers to Change Metric & Time"
- **Slicer 1**: "Performance Metric" dropdown
- **Slicer 2**: "Time Dimension" dropdown

---

## Page 6: MFE/MAE Risk Lab

### Layout Grid
```
┌──────────────────────────────────────────────────────────────┐
│ KPI Cards (4)                                  100% × 10%    │
├─────────────────────────────┬────────────────────────────────┤
│ MFE vs MAE Scatter          │ Edge Capture by Strategy       │
│ 50% × 45%                   │ 50% × 45%                     │
├─────────────────────────────┬────────────────────────────────┤
│ Left on Table by Strategy   │ Winner MAE by Strategy         │
│ 50% × 45%                   │ 50% × 45%                     │
└─────────────────────────────┴────────────────────────────────┘
```

### Visual 6.0: KPI Cards
4 cards in a row:
| Card | Measure | Format |
|------|---------|--------|
| Avg MFE | [Avg MFE] | `$#,0.00` |
| Avg MAE | [Avg MAE] | `$#,0.00` |
| Edge Capture | [Avg Edge Capture Pct] | `0.0%` |
| Left on Table | [Avg Left on Table] | `$#,0.00` |

### Visual 6.1: MFE vs MAE Scatter
- **Type**: Scatter Chart
- **X-axis**: `Holly_Trades[mfe]` (Don't summarize)
- **Y-axis**: `Holly_Trades[mae]` (Don't summarize)
- **Legend**: `Holly_Trades[Trade_Outcome]` (Winner=`#00D4AA`, Loser=`#FF4444`, Breakeven=`#FFD700`)
- **Size**: Constant small
- **Reference lines**: Median MFE (vertical), Median MAE (horizontal)
- **Title**: "MFE vs MAE — Winners (green) vs Losers (red)"

### Visual 6.2: Edge Capture by Strategy
- **Type**: Clustered Bar Chart
- **Axis**: `Holly_Trades[strategy]`
- **Values**: `[Avg Edge Capture Pct]`
- **Filter**: Top N = 25 by `[Total Trades]` descending (min sample size)
- **Reference line**: Y = 50% (dashed `#FFD700`)
- **Conditional format**: Gradient `#FF4444` (0%) → `#FFD700` (50%) → `#00D4AA` (100%)
- **Title**: "Edge Capture % by Strategy (Top 25 by Trade Count)"

### Visual 6.3: Left on Table
- **Type**: Clustered Bar Chart
- **Axis**: `Holly_Trades[strategy]`
- **Values**: `[Avg Left on Table]`
- **Filter**: Top N = 25 by `[Total Trades]`
- **Sort**: Descending by value
- **Color**: `#FFD700`
- **Title**: "Strategies Leaving the Most Profit — Exit Improvement Candidates"

### Visual 6.4: Winner MAE
- **Type**: Clustered Bar Chart
- **Axis**: `Holly_Trades[strategy]`
- **Values**: `[Avg Winner MAE]`
- **Filter**: Top N = 25 by `[Total Trades]`
- **Sort**: Descending by value
- **Color**: `#FF4444`
- **Title**: "How Much Pain Do Winners Endure? (MAE of Winning Trades)"

---

## Page 7: Exit Rule Optimizer

### Layout Grid
```
┌──────────────────────────────────────────────────────────────┐
│ Exit Rule Slicer (buttons, horizontal)         100% × 8%     │
├──────────────────────────────┬───────────────────────────────┤
│ Performance Comparison       │ Strategy × Rule Matrix        │
│ (clustered bar)              │                               │
│ 60% × 45%                   │ 40% × 45%                     │
├──────────────────────────────┬───────────────────────────────┤
│ WR vs PF Scatter             │ Best Combos Table             │
│ 60% × 45%                   │ 40% × 45%                     │
└──────────────────────────────┴───────────────────────────────┘
```

**Page-level filter**: `Has_Exit_Rule_Flag = "With Exit Rule"`

### Visual 7.1: Exit Rule Slicer
- **Type**: Slicer (horizontal buttons)
- **Field**: `Holly_Trades[opt_exit_rule]`
- **Multi-select**: Yes
- **Style**: Tile/button style

### Visual 7.2: Performance Comparison
- **Type**: Clustered Bar Chart
- **Axis**: `Holly_Trades[opt_exit_rule]`
- **Values**: `[Avg Opt Sharpe]` (default — use "Performance Metric" field parameter)
- **Conditional format**: Gradient bars
- **Title**: "Exit Rule Performance — Avg Sharpe by Rule"

### Visual 7.3: Strategy × Rule Matrix
- **Type**: Matrix
- **Rows**: `Holly_Trades[strategy]` (Top 30 by trade count)
- **Columns**: `Holly_Trades[opt_exit_rule]`
- **Values**: `[Avg Opt Sharpe]`
- **Format**: `#,0.00`
- **Conditional format**: Background gradient Green (high) → Red (low)
- **Title**: "Strategy × Exit Rule — Sharpe Matrix"

### Visual 7.4: Win Rate vs Profit Factor Scatter
- **Type**: Scatter Chart
- **X-axis**: `Holly_Trades[opt_win_rate]` (Don't summarize or Average)
- **Y-axis**: `Holly_Trades[opt_profit_factor]` (Don't summarize or Average)
- **Size**: `Holly_Trades[opt_total_trades]` (Sum)
- **Legend/Color**: `Holly_Trades[opt_exit_rule]`
- **Title**: "Win Rate vs Profit Factor — Optimal Exit Rule Clusters"
- **Reference lines**: X = 0.5, Y = 1.0

### Visual 7.5: Best Combos Table
- **Type**: Table
- **Columns**: strategy, opt_exit_rule, opt_avg_pnl, opt_profit_factor, opt_win_rate, opt_sharpe, opt_max_drawdown, opt_total_trades
- **Filter**: `opt_total_trades >= 50`
- **Sort**: `opt_sharpe` descending
- **Conditional format**: opt_sharpe background gradient
- **Title**: "Best Strategy × Exit Rule Combinations (≥50 trades)"

---

## Page 8: Strategy Comparison (Iteration 1)

### Layout Grid
```
┌──────────────────────────────────────────────────────────────┐
│ Multi-Select Strategy Slicer (2-5)             100% × 8%     │
├──────────────────────────────────────────────────────────────┤
│ Overlaid Equity Curves (multi-line chart)       100% × 45%   │
├─────────────────────────────┬────────────────────────────────┤
│ Side-by-Side Metrics Matrix │ Daily PnL Correlation Matrix   │
│ 60% × 47%                   │ 40% × 47%                     │
└─────────────────────────────┴────────────────────────────────┘
```

### Visual 8.1: Strategy Multi-Slicer
- **Type**: Slicer (vertical list)
- **Field**: `Strategy_Lookup[Strategy]`
- **Multi-select**: Yes (hold Ctrl)
- **Instruction text**: "Select 2–5 strategies to compare"

### Visual 8.2: Overlaid Equity Curves
- **Type**: Line Chart
- **X-axis**: `Date_Table[Date]`
- **Y-axis**: `[Cumulative PnL]`
- **Legend**: `Holly_Trades[strategy]`
- **Colors**: Auto from theme dataColors palette
- **Title**: "Equity Curve Comparison"

### Visual 8.3: Side-by-Side Metrics
- **Type**: Matrix
- **Rows**: `Holly_Trades[strategy]`
- **Values**: [Total Trades], [Win Rate], [Avg PnL], [Total PnL], [Profit Factor], [Sharpe Proxy], [Consistency Score], [Edge Score]
- **Conditional format**: Same as Page 2 matrix
- **Title**: "Head-to-Head Metrics"

### Visual 8.4: Correlation Note
- **Type**: Text Card (or Table)
- **Content**: PBI doesn't natively compute correlations. Use a Python/R visual or pre-compute in Power Query.
- **Alternative**: Matrix of daily PnL by strategy — users can visually compare patterns.

---

## Page 9: What-If Stop Buffer Lab (Iteration 1)

### Layout Grid
```
┌──────────────────────────────────────────────────────────────┐
│ What-If Slider: Min Stop Buffer %              100% × 10%    │
├─────────────────────────────┬────────────────────────────────┤
│ Filtered KPIs (4 cards)     │ Filtered vs Unfiltered Compare │
│ 50% × 15%                   │ 50% × 15%                     │
├──────────────────────────────────────────────────────────────┤
│ Filtered Equity Curve                          100% × 40%    │
├─────────────────────────────┬────────────────────────────────┤
│ Win Rate by Buffer Bucket   │ PF by Buffer Bucket            │
│ 50% × 35%                   │ 50% × 35%                     │
└─────────────────────────────┴────────────────────────────────┘
```

### Visual 9.1: What-If Slider
- **Type**: Slicer (slider)
- **Field**: `Min Stop Buffer[Min Stop Buffer]`
- **Range**: 0 to 3, step 0.05
- **Default**: 0
- **Title**: "Minimum Stop Buffer % Filter — Drag to See Impact"

### Visual 9.2: Filtered KPIs
| Card | Measure |
|------|---------|
| Filtered Trades | [Filtered Total Trades] |
| Filtered Win Rate | [Filtered Win Rate] |
| Filtered Avg PnL | [Filtered Avg PnL] |
| Filtered PF | [Filtered Profit Factor] |

### Visual 9.3: Comparison Cards
Show delta between filtered and unfiltered:
- "Win Rate: 52.1% → 58.3% (+6.2pp)"
- Use measures that compute the difference

### Visual 9.4: Filtered Equity Curve
- **Type**: Line Chart
- **X-axis**: `Date_Table[Date]`
- **Y-axis**: `[Filtered Cumulative PnL]`
- **Also show**: `[Cumulative PnL]` as faded reference line
- **Title**: "Equity Curve with Stop Buffer Filter Applied"

---

## Custom Tooltip Pages (Hidden)

### Tooltip 1: Strategy Tooltip
- **Page size**: 320 × 240 (tooltip size)
- **Page type**: Tooltip
- **Tooltip fields**: Holly_Trades[strategy]
- **Contents**:
  - 3 mini cards: Win Rate, Avg PnL, Profit Factor
  - Mini line chart: [Cumulative PnL] over Date_Table[Date] (sparkline, no axis labels)
  - Mini bar chart: [Total Trades] by [Trade_Outcome]

### Tooltip 2: Trade Detail Tooltip
- **Page size**: 320 × 240
- **Page type**: Tooltip
- **For**: Scatter charts (Page 4, 6, 7)
- **Contents**: Table with single-row detail:
  - Symbol, Direction, Entry Price, Exit Price, PnL, MFE, MAE, Hold Minutes, R-Multiple, Strategy, Regime_Combo

---

## Conditional Formatting Summary

| Visual | Property | Method | Rule |
|--------|----------|--------|------|
| KPI Cards | Background | Rules (DAX) | Use color measures (PnL Color, Win Rate Color, etc.) |
| Matrix Win Rate | Background | Gradient | Min 0.30 `#FF4444`, Mid 0.50 `#FFD700`, Max 0.70 `#00D4AA` |
| Matrix Total PnL | Data bars | Gradient | Negative `#FF4444`, Positive `#00D4AA` |
| Matrix Profit Factor | Background | Gradient | Min 0.50 `#FF4444`, Mid 1.0 `#FFD700`, Max 2.0 `#00D4AA` |
| Matrix Sharpe | Background | Gradient | Min 0 `#FF4444`, Mid 1.0 `#FFD700`, Max 3.0 `#00D4AA` |
| Heatmaps (Hour×Day) | Background | Gradient | Diverging, center 0, `#FF4444` → White → `#00D4AA` |
| Bar charts (PnL) | Bar color | Rules | >= 0: `#00D4AA`, < 0: `#FF4444` |
| Waterfall | Sentiment | Built-in | Increase `#00D4AA`, Decrease `#FF4444` |

---

## Bookmark Configuration

| # | Bookmark | Page | Filters | Use |
|---|----------|------|---------|-----|
| 1 | Overview | Page 1 | All filters reset | Default view |
| 2 | Best Strategies | Page 2 | PF > 1.5, Total Trades >= 50 | Quick elite filter |
| 3 | Regime Edge | Page 4 | Has_Regime_Flag = "With Regime Data" | Regime analysis |
| 4 | Long Only | (current) | direction = "Long" | Cross-page filter |
| 5 | Short Only | (current) | direction = "Short" | Cross-page filter |

**Navigator buttons**: Place on each page header. Use button shape with action = Bookmark.

---

## Slicer Sync Configuration

| Slicer | Sync Pages | Visible Pages |
|--------|------------|---------------|
| Date range (Date_Table[Date]) | All 7 main pages | Pages 1, 2, 4, 5 |
| Direction | All 7 main pages | Pages 1, 2, 4 |
| Strategy (from lookup) | Pages 2, 3 | Page 2 |
| Trend regime | Pages 4, 5 | Page 4 |
| Vol regime | Pages 4, 5 | Page 4 |
| Momentum regime | Pages 4, 5 | Page 4 |
| Performance Metric (field param) | Pages 4, 5 | Pages 4, 5 |
| Time Dimension (field param) | Page 5 | Page 5 |
| Min Stop Buffer (What-If) | Page 9 | Page 9 |

**To configure**: View tab > Sync slicers pane > Check sync/visible for each.

---

## Accessibility

Every visual must have alt-text. Pattern:
- Charts: "[Chart type] showing [measure] by [dimension]. Key insight: [dynamic text]."
- Tables/Matrices: "Table of [N] strategies with columns for [list measures]."
- Cards: "[Measure name]: [value]. Conditional: green if positive."

---

## Performance Notes

1. **Cumulative PnL / Running Max PnL** measures use ALLSELECTED + FILTER patterns that are O(n^2) on dates. For 28K trades across ~2,500 trading days, this is manageable but may lag on first render.

2. If equity curve is slow, add a **pre-computed calculated column** in Power Query:
   ```
   Trade_Index = Table.AddIndexColumn(sorted_table, "Trade_Index", 1, 1)
   ```
   Then use RANKX-based cumulative sum instead.

3. **Streak measures** (Max Consecutive Wins/Losses) are computationally expensive. Consider removing if not needed or computing in Power Query.

4. **Scatter charts** with 28K individual points may be slow. Use "High density sampling" in chart settings, or filter to recent years.
