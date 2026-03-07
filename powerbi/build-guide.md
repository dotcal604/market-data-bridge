# Holly AI Dashboard — Power BI Build Guide

## Quick Start Checklist

1. **New Report**: File > New > Blank Report
2. **Import Theme**: View > Themes > Browse for themes > select `holly-dark-theme.json`
3. **Rebuild Silver** (if stale): `python analytics/build_silver.py` → produces `data/silver/holly_trades.parquet`
4. **Load Data**: Home > Get Data > Parquet > select `data/silver/holly_trades.parquet`
5. **Power Query**: Transform Data > open Advanced Editor > paste code from `data-prep.pq` (Query 1: main table)
6. **Date Table**: New blank query > paste Query 2 from `data-prep.pq` (uncomment the code)
7. **Measures Table**: New blank query > paste Query 3 from `data-prep.pq` (uncomment the code)
8. **Close & Apply**: Close Power Query editor
9. **Relationships**: Model view > drag `DateTable[Date]` to `holly_analytics[trade_date]`
10. **Mark Date Table**: Select DateTable > Table tools > Mark as date table > `Date` column
11. **Enter DAX Measures**: Select Measures table > New Measure > paste each measure from `dax-measures.dax`
12. **Build Pages**: Follow page-by-page instructions below

## Report Setup

- **Page size**: 16:9 (1280×720) — default
- **All pages**: Background = transparent (theme handles it)
- **Canvas settings**: View > Page view > Fit to page

---

## Navigation Bar (All Pages)

Add a horizontal strip at the top of every page (y=0, height=40px, full width):

1. Insert > Shapes > Rectangle: x=0, y=0, w=1280, h=40, fill=#1B1B2F, border=none
2. Add 8 Button visuals (Insert > Buttons > Blank) side by side:
   - Labels: "Executive Summary" | "Strategy" | "Time" | "Risk" | "Regime" | "Symbols" | "Quality" | "Optimization"
   - Each button: w=150, h=32, y=4
   - Action: Type=Page Navigation, Destination=corresponding page
   - Style: fill=#2A2A4A, border=#00D4FF 1px, text=#00D4FF, 10pt Segoe UI Semibold
   - Hover: fill=#3D3D6E
3. Add a "Reset Filters" button at far right (x=1200, w=70):
   - Create a bookmark "Reset All" with all slicers cleared
   - Button action: Type=Bookmark, Bookmark="Reset All"
   - Style: fill=#FF5252 20% opacity, text=#FF5252

**Copy this nav bar to every page** (select all nav elements > Ctrl+C > go to next page > Ctrl+V).

---

## Slicer Panel (All Pages)

Below the nav bar, add a slicer row (y=44, h=36, full width):

| Slicer | Type | Field | Width | Position |
|--------|------|-------|-------|----------|
| Date Range | Between (slider) | trade_date | 350px | x=10 |
| Strategy | Dropdown | strategy | 200px | x=370 |
| Direction | Buttons (single select) | direction | 150px | x=580 |
| Trend Regime | Dropdown | trend_regime | 160px | x=740 |
| Vol Regime | Dropdown | vol_regime | 160px | x=910 |

**Sync slicers**: View > Sync Slicers > check all pages for each slicer.

Content area starts at **y=84** on every page.

---

## Page 1: Executive Summary

### Row 1: KPI Cards (y=84, h=80)
Six card visuals, evenly spaced across the page:

| Card | Measure | Format | Width |
|------|---------|--------|-------|
| Total Trades | Total Trades Display | — | 190px |
| Win Rate | Win Rate Display | — | 190px |
| Total PnL | Total PnL Display | — | 190px |
| Avg PnL/Trade | Avg PnL Display | — | 190px |
| Profit Factor | Profit Factor Display | — | 190px |
| Avg R-Multiple | Avg R Display | — | 190px |

**Conditional formatting** on each card:
- Total PnL: Font color > Rules > if value >= 0 then #00E676, else #FF5252
- Win Rate: Font color > Rules > >=55% green, 45-55% gold, <45% red
- Profit Factor: Font color > Rules > >=1.5 green, 1.0-1.5 gold, <1.0 red

Card styling: background=#2A2A4A, border=#3D3D6E, border-radius=12, callout font=24pt

### Row 2 Left: Equity Curve (y=170, h=220, w=620)
**Line chart**:
- X-axis: `trade_date`
- Y-axis: `Cumulative PnL` (measure)
- Line color: #00D4FF, width=2
- Title: "Cumulative P&L (Equity Curve)"

**NOTE**: If Cumulative PnL measure is too slow (28K rows), use this alternative:
1. In Power Query, the data is sorted by entry_time with Trade Index
2. Add a calculated column: `Cum PnL = CALCULATE(SUM(holly_analytics[holly_pnl]), FILTER(ALL(holly_analytics), holly_analytics[Trade Index] <= holly_analytics[Trade Index]))`
3. Use that column directly in the line chart Y-axis

### Row 2 Below Equity: Drawdown Area Chart (y=395, h=120, w=620)
**Area chart**:
- X-axis: `trade_date`
- Y-axis: `Drawdown` (measure)
- Area fill: #FF5252 at 40% transparency
- Line color: #FF5252
- Title: "Drawdown"

### Row 2 Right Top: Monthly PnL Heatmap (y=170, h=190, w=620)
**Matrix visual**:
- Rows: `trade_year`
- Columns: `trade_month` (or `Month Name` with `Month Sort` for sort order)
- Values: `Total PnL` (SUM of holly_pnl)
- Conditional formatting: Background color > Rules > diverging scale:
  - Minimum: #FF5252 (red)
  - Center: #1B1B2F (dark — zero point)
  - Maximum: #00E676 (green)
- Cell element > Background color > Based on: `Total PnL`
- Font size: 9pt
- Title: "Monthly P&L Heatmap (Year × Month)"

### Row 2 Right Bottom: Strategy Donut (y=365, h=150, w=620)
**Donut chart**:
- Legend: `strategy`
- Values: `Total Trades` (COUNTROWS)
- Sort: descending by count
- Show top 15 strategies, group rest as "Other"
- Title: "Trade Distribution by Strategy"
- Data labels: show category + percentage

### Row 3: Rolling Win Rate (y=520, h=160, full width)
**Line chart**:
- X-axis: `Trade Index`
- Y-axis: `Rolling 30 Win Rate` (measure)
- Line color: #FFD740
- Add constant line at 0.50 (50%), color=#808080, dashed
- Title: "Rolling 30-Trade Win Rate"
- Subtitle: "Smoothed trend of recent win rate"

---

## Page 2: Strategy Deep Dive

### Main Table (y=84, h=280, full width)
**Table visual**:
- Columns (in order):
  1. `strategy` — text
  2. `Total Trades` — measure, data bars (#00D4FF)
  3. `Win Rate` — measure, format "0.0%", background color scale (red→green)
  4. `Avg PnL` — measure, format "$#,0.00", conditional font color
  5. `Total PnL` — measure, format "$#,0", conditional font color
  6. `Profit Factor` — measure, format "#.00", icon set (✓/✗/−)
  7. `Avg R-Multiple` — measure, format "#.00"
  8. `Sharpe Proxy` — measure, format "#.00"
  9. `Avg Hold Minutes` — measure, format "#,0"

- Conditional formatting:
  - Win Rate: background gradient red (#FF5252) → green (#00E676)
  - Avg PnL: font color green if >0, red if <0
  - Total PnL: font color green if >0, red if <0
  - Total Trades: data bars in #00D4FF
  - Profit Factor: icon set — ✓ if >1.5, − if >1.0, ✗ if <1.0
- Sort default: by Total PnL descending
- Title: "Strategy Performance Matrix"

### Left: Total PnL by Strategy (y=370, h=300, w=420)
**Clustered bar chart** (horizontal):
- Y-axis: `strategy`
- X-axis: `Total PnL`
- Sort: by Total PnL descending
- Show top 20
- Color: conditional — green (#00E676) if positive, red (#FF5252) if negative
- Title: "Strategies Ranked by Total P&L"

### Middle: Profit Factor by Strategy (y=370, h=300, w=420)
**Clustered bar chart** (horizontal):
- Y-axis: `strategy`
- X-axis: `Profit Factor`
- Sort: by Profit Factor descending
- Show top 20
- Add constant line at 1.0 (breakeven), dashed red
- Color: #00D4FF
- Title: "Strategies Ranked by Profit Factor"

### Right: Cumulative PnL by Strategy (y=370, h=300, w=420)
**Line chart** (small multiples or legend):
- X-axis: `trade_date`
- Y-axis: SUM(`holly_pnl`) running total
- Legend: `strategy` (top 8 by volume)
- Title: "Cumulative P&L by Strategy (Top 8)"
- Use the top 8 theme data colors

### Bottom: Strategy × Direction Matrix (full width, y=675, h=45)
**Matrix visual**:
- Rows: `strategy` (top 15)
- Columns: `direction`
- Values: `Avg PnL`
- Conditional formatting: diverging color scale
- Title: "Avg PnL: Strategy × Direction"

---

## Page 3: Time Analysis

### Top Left: PnL by Day of Week (y=84, h=250, w=600)
**Combo chart** (clustered column + line):
- X-axis: `Day Name` (sorted by `Day Sort`)
- Column Y-axis: `Avg PnL` — bars, conditional color (green/red)
- Line Y-axis (secondary): `Win Rate` — line, #FFD740
- Title: "Performance by Day of Week"
- Subtitle: "Bars = Avg PnL, Line = Win Rate"

### Top Right: PnL by Entry Hour (y=84, h=250, w=650)
**Combo chart** (clustered column + line):
- X-axis: `entry_hour` (9 through 16)
- Column Y-axis: `Avg PnL`
- Line Y-axis (secondary): `Win Rate`
- Conditional color on bars: green if Avg PnL > 0, red if < 0
- Highlight best hour with #00E676, worst with #FF5252
- Title: "Performance by Entry Hour (ET)"

### Middle Left: Hold Time Distribution (y=340, h=230, w=600)
**Histogram** (column chart with binned data):
- Create bins: Right-click `hold_minutes` in Fields > New Group > Bin size = 5
- X-axis: `hold_minutes (bins)`
- Y-axis: Count of trade_id
- Color: #00D4FF
- Add reference lines: Mean (dashed #FFD740), Median (solid #00E676)
- Title: "Hold Time Distribution (minutes)"

### Middle Right: Hold Time vs PnL Scatter (y=340, h=230, w=650)
**Scatter plot**:
- X-axis: `hold_minutes`
- Y-axis: `holly_pnl`
- Legend: `Trade Result` (Win/Loss/Scratch)
  - Win = #00E676, Loss = #FF5252, Scratch = #808080
- Size: `shares`
- Tooltips: symbol, strategy, r_multiple, entry_time
- Title: "Hold Time vs P&L"

### Bottom: Monthly Seasonality (y=576, h=140, full width)
**Line chart**:
- X-axis: `trade_month` (use `Month Name` with `Month Sort`)
- Y-axis: `Avg PnL` (average across all years)
- Legend: `trade_year` (separate line per year)
- Title: "Monthly Seasonality (Year-over-Year)"
- Subtitle: "Each line = one year, X-axis = month"

---

## Page 4: Risk & Execution Quality

### Top Left: R-Multiple Distribution (y=84, h=230, w=600)
**Histogram**:
- Create bins: Right-click `r_multiple` > New Group > Bin size = 0.5, range -5 to +5
- X-axis: `r_multiple (bins)`
- Y-axis: Count of trade_id
- Color: conditional — green bins (>0), red bins (<0)
- Add reference lines: 0 (solid white), Median (dashed #FFD740)
- Title: "R-Multiple Distribution"

### Top Right: MFE vs MAE Scatter (y=84, h=230, w=650)
**Scatter plot**:
- X-axis: `mfe` (Max Favorable Excursion)
- Y-axis: `mae` (Max Adverse Excursion — note: typically negative)
- Legend: `Trade Result`
  - Win = #00E676, Loss = #FF5252
- Tooltips: symbol, strategy, holly_pnl, r_multiple, entry_time
- Add constant lines at X=0 and Y=0 (white, dashed) to create quadrants
- Title: "MFE vs MAE (Trade Quality)"
- Subtitle: "Top-right = ideal (high MFE, low MAE)"

### Middle Left: Stop Buffer Distribution (y=320, h=200, w=600)
**Histogram**:
- Create bins: Right-click `stop_buffer_pct` > New Group > Bin size = 0.25
- X-axis: `stop_buffer_pct (bins)`
- Y-axis: Count
- Color: #7C4DFF
- Title: "Stop Buffer % Distribution"

### Middle Right: Left on Table by Strategy (y=320, h=200, w=650)
**Clustered bar chart** (horizontal):
- Y-axis: `strategy` (top 15)
- X-axis: `Avg Left on Table` (measure, or AVG of `Left on Table` column)
- Sort: descending
- Color: #FF6E40
- Title: "Avg 'Left on Table' by Strategy"
- Subtitle: "MFE minus actual PnL — unrealized profit given back"

### Bottom Left: Risk-Adjusted Return by Strategy (y=526, h=190, w=600)
**Clustered bar chart** (horizontal):
- Y-axis: `strategy` (top 15)
- X-axis: `Avg R-Multiple`
- Sort: descending
- Color: conditional (green >0, red <0)
- Add constant line at 0
- Title: "Avg R-Multiple by Strategy"

### Bottom Right: Position Size Distribution (y=526, h=190, w=650)
**Histogram**:
- Create bins: `shares` > New Group > Bin size = 50
- X-axis: `shares (bins)`
- Y-axis: Count
- Color: #448AFF
- Title: "Position Size Distribution (Shares)"

---

## Page 5: Regime Analysis

### Top: PnL Heatmap — Trend × Volatility (y=84, h=180, w=600)
**Matrix visual**:
- Rows: `trend_regime`
- Columns: `vol_regime`
- Values: `Avg PnL`
- Conditional formatting: diverging background color
  - Minimum: #FF5252, Center: #1B1B2F, Maximum: #00E676
- Title: "Avg P&L by Trend × Volatility Regime"

### Top Right: Win Rate Heatmap — Trend × Volatility (y=84, h=180, w=650)
**Matrix visual**:
- Rows: `trend_regime`
- Columns: `vol_regime`
- Values: `Win Rate` (format "0.0%")
- Conditional formatting: same diverging scale
- Title: "Win Rate by Trend × Volatility Regime"

### Middle: Regime Distribution Over Time (y=270, h=200, full width)
**Stacked area chart**:
- X-axis: `Year-Month`
- Y-axis: Count of trade_id
- Legend: `trend_regime`
- Colors: uptrend=#00E676, downtrend=#FF5252, sideways=#FFD740, No Data=#808080
- Title: "Regime Distribution Over Time"

### Bottom: Strategy × Trend Regime Matrix (y=476, h=200, full width)
**Matrix visual**:
- Rows: `strategy` (top 20 by trade count)
- Columns: `trend_regime`
- Values: `Profit Factor`
- Conditional formatting: background color diverging around 1.0
- Title: "Profit Factor: Strategy × Trend Regime"

### Slicer addition for this page:
- Add `momentum_regime` as **button slicer** across the top of the content area (y=84, before the other visuals shift down)
- Options: bullish | bearish | neutral | oversold | overbought | No Data

### Data Note (text box, bottom):
> "Note: ~9,985 pre-2020 trades lack regime data and appear as 'No Data'."
> Font: 9pt, #808080, italic

---

## Page 6: Symbol Analysis

### Top Left: Most Traded Symbols (y=84, h=280, w=400)
**Clustered bar chart** (horizontal):
- Y-axis: `symbol`
- X-axis: Count of trade_id
- Filter: Top N = 20, by Count of trade_id
- Sort: descending
- Color: #00D4FF
- Title: "Top 20 Most Traded Symbols"

### Top Middle: Most Profitable Symbols (y=84, h=280, w=400)
**Clustered bar chart** (horizontal):
- Y-axis: `symbol`
- X-axis: `Total PnL`
- Filter: Top N = 20, by Sum of holly_pnl, descending
- Color: #00E676
- Title: "Top 20 Most Profitable Symbols"

### Top Right: Biggest Losers (y=84, h=280, w=400)
**Clustered bar chart** (horizontal):
- Y-axis: `symbol`
- X-axis: `Total PnL`
- Filter: Bottom N = 20, by Sum of holly_pnl
- Sort: ascending (worst first)
- Color: #FF5252
- Title: "Top 20 Biggest Losing Symbols"

### Middle: Symbol Treemap (y=370, h=230, full width)
**Treemap**:
- Group: `symbol`
- Values (size): Count of trade_id
- Values (color saturation): `Avg PnL` — diverging color scale green/red
- Tooltips: Total PnL, Win Rate, Avg R-Multiple, Total Trades
- Title: "Symbol Landscape — Size = Trade Count, Color = Avg PnL"

### Bottom Left: Top 10 Concentration KPI (y=606, h=50, w=500)
**Card visual**:
- Value: `Top 10 Symbol PnL Pct` (format "0.0%")
- Title: "Top 10 Symbol Concentration (% of Total PnL)"

### Bottom Right: Diversity Trend (y=606, h=110, w=760)
**Line chart**:
- X-axis: `Year-Month`
- Y-axis: `Monthly Unique Symbols`
- Line color: #69F0AE
- Title: "Unique Symbols Traded Per Month"

---

## Page 7: Trade Quality Scorecard

### Top: Quality Tier Funnel (y=84, h=220, w=500)
**Funnel chart**:
- Group: `Quality Tier`
- Values: Count of trade_id
- Sort: by Quality Tier ascending (1-Elite at top, 5-Terrible at bottom)
- Colors: 1-Elite=#00E676, 2-Good=#69F0AE, 3-Marginal=#FFD740, 4-Bad=#FF6E40, 5-Terrible=#FF5252
- Title: "Trade Quality Distribution"

### Top Right: Quality KPI Cards (y=84, h=220, w=750)
Stack 5 small cards vertically:

| Tier | Measure | Color |
|------|---------|-------|
| Elite (R>2) | Count + % | #00E676 |
| Good (1<R≤2) | Count + % | #69F0AE |
| Marginal (0<R≤1) | Count + % | #FFD740 |
| Bad (-1<R≤0) | Count + % | #FF6E40 |
| Terrible (R<-1) | Count + % | #FF5252 |

Use multi-row card or individual cards.

### Middle Left: Quality Tier Over Time (y=310, h=200, w=620)
**Stacked bar chart**:
- X-axis: `Year-Quarter`
- Y-axis: Count of trade_id
- Legend: `Quality Tier`
- Stack: 100% stacked (to show proportion shift)
- Colors: match funnel colors above
- Title: "Quality Tier Distribution Over Time"

### Middle Right: Quality by Strategy (y=310, h=200, w=640)
**Stacked bar chart** (100%):
- Y-axis: `strategy` (top 15)
- X-axis: Count of trade_id (% of total)
- Legend: `Quality Tier`
- Horizontal orientation
- Title: "Quality Tier Breakdown by Strategy"

### Bottom: Rolling Profit Factor (y=516, h=200, full width)
**Line chart**:
- X-axis: `Trade Index`
- Y-axis: `Rolling 100 Profit Factor` (measure)
- Line color: #00D4FF, width=2
- Add constant line at 1.0 (breakeven), color=#FF5252, dashed
- Title: "Rolling 100-Trade Profit Factor (Edge Decay Analysis)"
- Subtitle: "Below 1.0 = losing edge"

---

## Page 8: Optimization Insights

### Top: Optimization Results Table (y=84, h=250, full width)
**Table visual**:
- Filter: `opt_exit_rule` is not "No Data"
- Columns:
  1. `strategy`
  2. `opt_exit_rule`
  3. `opt_avg_pnl` — format "$#,0.00", conditional font color
  4. `opt_profit_factor` — format "#.00", background color scale
  5. `opt_win_rate` — format "0.0%", background color scale
  6. `opt_sharpe` — format "#.00"
  7. `opt_max_drawdown` — format "$#,0", font color red
  8. `opt_total_trades` — format "#,0"
- Group by strategy (show first distinct value per strategy for opt_ columns)
- Sort: by opt_profit_factor descending
- Title: "Optimized Exit Strategy Results by Strategy"

### Middle Left: Default vs Optimized Comparison (y=340, h=220, w=620)
**Clustered bar chart** (grouped):
- Y-axis: `strategy` (top 15 with opt data)
- X-axis: Two measures side by side:
  - `Holly Default Avg PnL` (color: #808080)
  - `opt_avg_pnl` average (color: #00E676)
- Title: "Holly Default vs Optimized Avg PnL by Strategy"

**Implementation note**: Create two measures filtered to strategies with opt data:
```
Default PnL For Opt Strategies = CALCULATE(AVERAGE('holly_analytics'[holly_pnl]), 'holly_analytics'[opt_exit_rule] <> "No Data")
```
Then use a grouped bar chart with both measures.

### Middle Right: Optimizer Scatter (y=340, h=220, w=640)
**Scatter plot**:
- X-axis: AVG of `opt_profit_factor`
- Y-axis: AVG of `opt_sharpe`
- Details: `strategy`
- Size: SUM of `opt_total_trades`
- Data labels: show `strategy`
- Title: "Optimizer: Profit Factor vs Sharpe by Strategy"

### Bottom: Regime Filter Impact Card (y=566, h=80, full width)
**Card or text box**:
- Value: `Regime Improvement Text` (DAX measure)
- Background: #2A2A4A
- Font: 12pt, #E0E0E0
- Title: "Regime Filter Impact Estimate"

### Data Note (text box, bottom):
> "Note: ~10,813 trades lack optimization data. Only strategies with optimizer results are shown."
> Font: 9pt, #808080, italic

---

## Cross-Filtering Configuration

After building all pages, configure interactions:

### Per Page:
1. Select each visual one at a time
2. Format > Edit Interactions
3. Set each other visual to either **Filter** (funnel icon) or **None** (circle with line):

**General rule**:
- Bar charts, donut charts, matrices → Filter other visuals
- Scatter plots → set to "None" (cross-highlighting clutters scatter dots)
- Line charts (equity curve, rolling metrics) → Filter other visuals
- KPI cards → None (they're output-only)

### Scatter Plot Exceptions:
On pages 3, 4, 6 — for scatter plots, click the scatter visual, then click Edit Interactions and set all other visuals to "None" for filtering INTO the scatter. This prevents dot selection from creating confusing highlighting.

---

## Bookmark Setup

1. **Reset All**: Clear all slicers > View > Bookmarks > Add > name "Reset All" > uncheck "Data" (keep only "Current Page" unchecked, "All Visuals" checked)
2. **Page Bookmarks**: One per page with all slicers at default state (for nav buttons)

---

## Performance Tips

The dataset is 28,875 rows — moderate size for Power BI. Key optimizations:

1. **Cumulative PnL**: If the measure version is slow, use the calculated column approach (see note in dax-measures.dax)
2. **Rolling measures**: These use FILTER(ALL(...)) which can be slow. If any page loads slowly:
   - Replace rolling measures with calculated columns
   - Or reduce the visual to show only every 100th trade (filter Trade Index MOD 100 = 0)
3. **Top N filters**: Apply Top N visual-level filters on bar charts rather than showing all 134 strategies
4. **Disable auto-refresh**: File > Options > Current file > Data Load > uncheck "Auto detect new relationships"
5. **Column storage**: In Model view, hide columns not used in any visual (right-click > Hide) — reduces model size

---

## Final Checklist

- [ ] Theme applied (dark navy background on all pages)
- [ ] All 8 pages created with nav buttons
- [ ] Slicers synced across all pages
- [ ] All DAX measures entered without errors
- [ ] Conditional formatting on all tables and matrices
- [ ] Cross-filtering configured (scatter plots isolated)
- [ ] Reset Filters bookmark working
- [ ] Report title on Page 1: "Holly AI Signal Performance Analysis"
- [ ] Date range visible: 2016-01-14 to 2026-03-04
- [ ] Tooltip template includes: symbol, strategy, entry_time, holly_pnl, r_multiple
