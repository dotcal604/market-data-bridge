// ============================================================
// HOLLY_TRADES — Power Query M (Advanced Editor)
// ============================================================
// Source: holly_analytics.csv (28,875 trades, 51 columns, 2016–2026)
// Features: Explicit type detection, opt_params JSON parsing,
//           calculated columns, null replacement, logical sort order
// ============================================================

let
    // ── STEP 1: Load CSV with explicit types ──────────────────────
    Source = Csv.Document(
        File.Contents("C:\Users\dotca\source\market-data-bridge\analytics\holly_exit\output\holly_analytics.csv"),
        [Delimiter = ",", Columns = 51, Encoding = 65001, QuoteStyle = QuoteStyle.Csv]
    ),
    PromotedHeaders = Table.PromoteHeaders(Source, [PromoteAllScalars = true]),

    // ── STEP 2: Explicit type conversions ─────────────────────────
    TypedTable = Table.TransformColumnTypes(PromotedHeaders, {
        // Identifiers
        {"trade_id", Int64.Type},
        {"symbol", type text},
        {"strategy", type text},
        {"direction", type text},

        // Timestamps
        {"entry_time", type datetime},
        {"exit_time", type datetime},
        {"trade_date", type date},

        // Prices & P&L
        {"entry_price", type number},
        {"exit_price", type number},
        {"holly_pnl", type number},
        {"stop_price", type number},
        {"mfe", type number},
        {"mae", type number},
        {"stop_buffer_pct", type number},
        {"pnl_per_share", type number},
        {"risk_per_share", type number},
        {"r_multiple", type number},
        {"shares", Int64.Type},

        // Time dimensions
        {"trade_year", Int64.Type},
        {"trade_month", Int64.Type},
        {"trade_dow", Int64.Type},
        {"entry_hour", Int64.Type},
        {"hold_minutes", Int64.Type},

        // Technical indicators
        {"sma20", type number},
        {"sma5", type number},
        {"trend_slope", type number},
        {"atr14", type number},
        {"atr_pct", type number},
        {"daily_range_pct", type number},
        {"rsi14", type number},
        {"roc5", type number},
        {"roc20", type number},

        // Regime text
        {"trend_regime", type text},
        {"vol_regime", type text},
        {"momentum_regime", type text},

        // Optimizer metrics
        {"opt_avg_pnl", type number},
        {"opt_profit_factor", type number},
        {"opt_win_rate", type number},
        {"opt_sharpe", type number},
        {"opt_max_drawdown", type number},
        {"opt_total_trades", type number},
        {"opt_exit_rule", type text},
        {"opt_params", type text}
    }),

    // ── STEP 3: Convert boolean text columns to logical ───────────
    // is_winner, is_loser, has_minute_bars, has_regime_data use lowercase "true"/"false"
    // above_sma20 uses capitalized "True"/"False"
    ConvertBooleans = Table.TransformColumns(TypedTable, {
        {"is_winner", each if Text.Lower(Text.From(_ ?? "")) = "true" then true else false, type logical},
        {"is_loser", each if Text.Lower(Text.From(_ ?? "")) = "true" then true else false, type logical},
        {"has_minute_bars", each if Text.Lower(Text.From(_ ?? "")) = "true" then true else false, type logical},
        {"has_regime_data", each if Text.Lower(Text.From(_ ?? "")) = "true" then true else false, type logical},
        {"above_sma20", each if Text.Lower(Text.From(_ ?? "")) = "true" then true else false, type logical}
    }),

    // ── STEP 4: Replace null regime/exit text with "No Data" ──────
    ReplaceNulls = Table.ReplaceValue(
        Table.ReplaceValue(
            Table.ReplaceValue(
                Table.ReplaceValue(ConvertBooleans,
                    null, "No Data", Replacer.ReplaceValue, {"trend_regime"}),
                null, "No Data", Replacer.ReplaceValue, {"vol_regime"}),
            null, "No Data", Replacer.ReplaceValue, {"momentum_regime"}),
        null, "No Data", Replacer.ReplaceValue, {"opt_exit_rule"}),

    // ── STEP 5: Parse opt_params JSON into individual columns ─────
    // opt_params contains JSON like: {"trail_pct":0.5,"trigger_pct":0.3}
    // Different exit rules have different param schemas
    ParseOptParams = Table.AddColumn(ReplaceNulls, "_parsed_params", each
        try Json.Document([opt_params]) otherwise null
    ),

    // fixed_trail / breakeven_plus_trail params
    AddParamTrailPct = Table.AddColumn(ParseOptParams, "param_trail_pct", each
        try [_parsed_params][trail_pct] otherwise null, type number),
    AddParamTriggerPct = Table.AddColumn(AddParamTrailPct, "param_trigger_pct", each
        try [_parsed_params][trigger_pct] otherwise null, type number),
    AddParamTrailPctAfter = Table.AddColumn(AddParamTriggerPct, "param_trail_pct_after", each
        try [_parsed_params][trail_pct_after] otherwise null, type number),

    // atr_trail params
    AddParamAtrMult = Table.AddColumn(AddParamTrailPctAfter, "param_atr_multiplier", each
        try [_parsed_params][atr_multiplier] otherwise null, type number),
    AddParamAtrPeriod = Table.AddColumn(AddParamAtrMult, "param_atr_period", each
        try [_parsed_params][atr_period] otherwise null, type number),

    // volume_climax params
    AddParamVolMult = Table.AddColumn(AddParamAtrPeriod, "param_volume_multiplier", each
        try [_parsed_params][volume_multiplier] otherwise null, type number),
    AddParamLookback = Table.AddColumn(AddParamVolMult, "param_lookback_bars", each
        try [_parsed_params][lookback_bars] otherwise null, type number),

    // time_decay_trail params
    AddParamInitTrail = Table.AddColumn(AddParamLookback, "param_initial_trail_pct", each
        try [_parsed_params][initial_trail_pct] otherwise null, type number),
    AddParamDecayRate = Table.AddColumn(AddParamInitTrail, "param_decay_rate", each
        try [_parsed_params][decay_rate] otherwise null, type number),

    // time_exit params
    AddParamMaxHold = Table.AddColumn(AddParamDecayRate, "param_max_hold_minutes", each
        try [_parsed_params][max_hold_minutes] otherwise null, type number),

    // fixed_tp params
    AddParamTpPct = Table.AddColumn(AddParamMaxHold, "param_tp_pct", each
        try [_parsed_params][tp_pct] otherwise null, type number),

    // Remove temp parsed column
    RemoveParsed = Table.RemoveColumns(AddParamTpPct, {"_parsed_params"}),

    // ── STEP 6: Calculated columns ────────────────────────────────

    // Day names
    AddDayName = Table.AddColumn(RemoveParsed, "Day_Name", each
        {null, "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"}{
            [trade_dow] + 1
        }, type text),
    AddDayNameShort = Table.AddColumn(AddDayName, "Day_Name_Short", each
        {null, "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"}{
            [trade_dow] + 1
        }, type text),

    // Entry hour label
    AddEntryHourLabel = Table.AddColumn(AddDayNameShort, "Entry_Hour_Label", each
        Text.From([entry_hour]) & ":00 ET", type text),

    // Month names
    AddMonthName = Table.AddColumn(AddEntryHourLabel, "Month_Name", each
        {"January","February","March","April","May","June","July","August","September","October","November","December"}{
            [trade_month] - 1
        }, type text),
    AddMonthNameShort = Table.AddColumn(AddMonthName, "Month_Name_Short", each
        {"Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"}{
            [trade_month] - 1
        }, type text),

    // Trade outcome
    AddTradeOutcome = Table.AddColumn(AddMonthNameShort, "Trade_Outcome", each
        if [is_winner] then "Winner"
        else if [is_loser] then "Loser"
        else "Breakeven", type text),

    // PnL Bucket
    AddPnlBucket = Table.AddColumn(AddTradeOutcome, "PnL_Bucket", each
        if [holly_pnl] = null then "No Data"
        else if [holly_pnl] < -500 then "<-$500"
        else if [holly_pnl] < -100 then "-$500 to -$100"
        else if [holly_pnl] < 0 then "-$100 to $0"
        else if [holly_pnl] = 0 then "$0 (Breakeven)"
        else if [holly_pnl] <= 100 then "$0 to $100"
        else if [holly_pnl] <= 500 then "$100 to $500"
        else if [holly_pnl] <= 2000 then "$500 to $2K"
        else if [holly_pnl] <= 10000 then "$2K to $10K"
        else ">$10K", type text),

    // PnL Bucket sort order (for proper chart ordering)
    AddPnlBucketSort = Table.AddColumn(AddPnlBucket, "PnL_Bucket_Sort", each
        if [holly_pnl] = null then 99
        else if [holly_pnl] < -500 then 1
        else if [holly_pnl] < -100 then 2
        else if [holly_pnl] < 0 then 3
        else if [holly_pnl] = 0 then 4
        else if [holly_pnl] <= 100 then 5
        else if [holly_pnl] <= 500 then 6
        else if [holly_pnl] <= 2000 then 7
        else if [holly_pnl] <= 10000 then 8
        else 9, Int64.Type),

    // R-Multiple Bucket
    AddRBucket = Table.AddColumn(AddPnlBucketSort, "R_Multiple_Bucket", each
        if [r_multiple] = null then "No Data"
        else if [r_multiple] < -1 then "<-1R"
        else if [r_multiple] < 0 then "-1R to 0R"
        else if [r_multiple] <= 1 then "0R to 1R"
        else if [r_multiple] <= 5 then "1R to 5R"
        else if [r_multiple] <= 20 then "5R to 20R"
        else ">20R", type text),

    AddRBucketSort = Table.AddColumn(AddRBucket, "R_Multiple_Bucket_Sort", each
        if [r_multiple] = null then 99
        else if [r_multiple] < -1 then 1
        else if [r_multiple] < 0 then 2
        else if [r_multiple] <= 1 then 3
        else if [r_multiple] <= 5 then 4
        else if [r_multiple] <= 20 then 5
        else 6, Int64.Type),

    // Edge Capture % (winners only: what % of MFE was captured)
    AddEdgeCapture = Table.AddColumn(AddRBucketSort, "Edge_Capture_Pct", each
        if [is_winner] and [mfe] <> null and [mfe] > 0 and [pnl_per_share] <> null
        then ([pnl_per_share] / [mfe]) * 100
        else null, type number),

    // Left on Table (winners only: MFE minus actual PnL per share)
    AddLeftOnTable = Table.AddColumn(AddEdgeCapture, "Left_On_Table", each
        if [is_winner] and [mfe] <> null and [pnl_per_share] <> null
        then [mfe] - [pnl_per_share]
        else null, type number),

    // Winner MAE (how much pain did winners endure)
    AddWinnerMAE = Table.AddColumn(AddLeftOnTable, "Winner_MAE", each
        if [is_winner] and [mae] <> null then [mae] else null, type number),

    // Regime Combo
    AddRegimeCombo = Table.AddColumn(AddWinnerMAE, "Regime_Combo", each
        if [has_regime_data] then
            Text.From([trend_regime]) & " | " & Text.From([vol_regime]) & " | " & Text.From([momentum_regime])
        else "No Regime Data", type text),

    // Regime/Exit flags
    AddHasRegimeFlag = Table.AddColumn(AddRegimeCombo, "Has_Regime_Flag", each
        if [has_regime_data] then "With Regime Data" else "No Regime Data", type text),

    AddHasExitFlag = Table.AddColumn(AddHasRegimeFlag, "Has_Exit_Rule_Flag", each
        if [opt_exit_rule] <> "No Data" then "With Exit Rule" else "No Exit Rule", type text),

    // ── STEP 7: Reorder columns logically ─────────────────────────
    ReorderedColumns = Table.ReorderColumns(AddHasExitFlag, {
        // Identifiers
        "trade_id", "symbol", "strategy", "direction",
        // Timestamps
        "entry_time", "exit_time", "trade_date",
        // Prices
        "entry_price", "exit_price", "stop_price", "shares",
        // P&L
        "holly_pnl", "pnl_per_share", "risk_per_share", "r_multiple", "mfe", "mae", "stop_buffer_pct",
        // Booleans
        "is_winner", "is_loser",
        // Time dimensions
        "trade_year", "trade_month", "trade_dow", "entry_hour", "hold_minutes",
        // Technical indicators
        "sma20", "sma5", "above_sma20", "trend_slope", "atr14", "atr_pct",
        "daily_range_pct", "rsi14", "roc5", "roc20",
        // Regimes
        "trend_regime", "vol_regime", "momentum_regime",
        "has_minute_bars", "has_regime_data",
        // Exit optimization
        "opt_exit_rule", "opt_params", "opt_avg_pnl", "opt_profit_factor",
        "opt_win_rate", "opt_sharpe", "opt_max_drawdown", "opt_total_trades",
        // Parsed params
        "param_trail_pct", "param_trigger_pct", "param_trail_pct_after",
        "param_atr_multiplier", "param_atr_period",
        "param_volume_multiplier", "param_lookback_bars",
        "param_initial_trail_pct", "param_decay_rate",
        "param_max_hold_minutes", "param_tp_pct",
        // Calculated columns
        "Day_Name", "Day_Name_Short", "Entry_Hour_Label",
        "Month_Name", "Month_Name_Short",
        "Trade_Outcome", "PnL_Bucket", "PnL_Bucket_Sort",
        "R_Multiple_Bucket", "R_Multiple_Bucket_Sort",
        "Edge_Capture_Pct", "Left_On_Table", "Winner_MAE",
        "Regime_Combo", "Has_Regime_Flag", "Has_Exit_Rule_Flag"
    })
in
    ReorderedColumns
