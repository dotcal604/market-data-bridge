// ============================================================
// STRATEGY_LOOKUP — Power Query M (Advanced Editor)
// ============================================================
// Distinct list of all 134 strategies from Holly_Trades.
// Supports many-to-one relationship for drillthrough and cross-filtering.
// ============================================================

let
    Source = Holly_Trades,
    DistinctStrategies = Table.Distinct(Table.SelectColumns(Source, {"strategy"})),
    Renamed = Table.RenameColumns(DistinctStrategies, {{"strategy", "Strategy"}}),
    Sorted = Table.Sort(Renamed, {{"Strategy", Order.Ascending}})
in
    Sorted
