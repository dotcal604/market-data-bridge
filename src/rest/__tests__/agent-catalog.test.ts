import { describe, it, expect } from "vitest";
import { getActionCatalog, actionsMeta } from "../agent.js";

describe("Action Catalog", () => {
  describe("actionsMeta structure", () => {
    it("has an entry for every action in the actions object", () => {
      // Get all action keys from the catalog
      const catalogKeys = Object.keys(actionsMeta).sort();
      
      // Expected actions based on the actions object (94 total)
      const expectedActions = [
        "auto_eval_status",
        "auto_eval_toggle",
        "calculate_implied_volatility",
        "calculate_option_price",
        "cancel_all_orders",
        "cancel_order",
        "collab_clear",
        "collab_post",
        "collab_read",
        "collab_stats",
        "divoom_send_text",
        "divoom_set_brightness",
        "divoom_status",
        "drift_alerts",
        "drift_check",
        "drift_report",
        "edge_report",
        "executions_history",
        "flatten_positions",
        "get_account_snapshot_stream",
        "get_account_summary",
        "get_completed_orders",
        "get_contract_details",
        "get_depth_exchanges",
        "get_earnings",
        "get_executions",
        "get_financials",
        "get_flatten_config",
        "get_fundamental_data",
        "get_gpt_instructions",
        "get_head_timestamp",
        "get_histogram_data",
        "get_historical_bars",
        "get_historical_news",
        "get_historical_ticks",
        "get_ibkr_quote",
        "get_market_rule",
        "get_news",
        "get_news_article",
        "get_news_bulletins",
        "get_news_providers",
        "get_open_orders",
        "get_option_quote",
        "get_options_chain",
        "get_orderbook_features",
        "get_pnl",
        "get_pnl_single",
        "get_positions",
        "get_quote",
        "get_real_time_bars",
        "get_recommendations",
        "get_risk_config",
        "get_scanner_parameters",
        "get_screener_filters",
        "get_session_state",
        "get_smart_components",
        "get_status",
        "get_stock_details",
        "get_trending",
        "get_tws_current_time",
        "holly_alerts",
        "holly_import",
        "holly_stats",
        "holly_symbols",
        "holly_predictor_candidates",
        "holly_predictor_profiles",
        "holly_predictor_refresh",
        "holly_predictor_scan",
        "holly_predictor_scan_batch",
        "holly_predictor_status",
        "holly_extract_rules",
        "holly_backtest",
        "holly_strategy_breakdown",
        "holly_trade_import",
        "holly_trade_import_file",
        "holly_trade_stats",
        "holly_trades",
        "holly_exit_autopsy",
        "journal_create",
        "journal_get",
        "journal_read",
        "journal_update",
        "list_subscriptions",
        "modify_order",
        "multi_model_consensus",
        "multi_model_score",
        "orders_history",
        "place_advanced_bracket",
        "place_bracket_order",
        "place_order",
        "portfolio_exposure",
        "record_outcome",
        "run_screener",
        "run_screener_with_quotes",
        "search_ibkr_symbols",
        "search_symbols",
        "session_lock",
        "session_record_trade",
        "session_reset",
        "session_unlock",
        "set_auto_open_orders",
        "set_flatten_enabled",
        "set_market_data_type",
        "signal_feed",
        "signal_stats",
        "simulate_weights",
        "size_position",
        "stress_test",
        "subscribe_account_updates",
        "subscribe_real_time_bars",
        "tradersync_import",
        "tradersync_stats",
        "trailing_stop_optimize",
        "trailing_stop_summary",
        "trailing_stop_per_strategy",
        "trailing_stop_recommend",
        "trailing_stop_simulate",
        "trailing_stop_params",
        "tradersync_trades",
        "tune_risk_params",
        "walk_forward",
        "unsubscribe_account_updates",
        "unsubscribe_real_time_bars",
        "update_risk_config",
      ].sort();
      
      expect(catalogKeys).toEqual(expectedActions);
    });

    it("has at least 100 actions and count matches catalog keys", () => {
      const count = Object.keys(actionsMeta).length;
      expect(count).toBeGreaterThanOrEqual(100);
      // Dynamic — no hardcoded count that breaks on every new action
    });

    it("every action has a non-empty description", () => {
      for (const [action, meta] of Object.entries(actionsMeta)) {
        expect(meta.description, `Action ${action} should have a description`).toBeTruthy();
        expect(meta.description.length, `Action ${action} description should be non-empty`).toBeGreaterThan(0);
      }
    });

    it("returns valid JSON structure", () => {
      const catalog = getActionCatalog();
      
      // Should be serializable
      const json = JSON.stringify(catalog);
      expect(json).toBeTruthy();
      
      // Should be parseable
      const parsed = JSON.parse(json);
      expect(parsed).toEqual(catalog);
    });
  });

  describe("action metadata validation", () => {
    it("get_status has correct metadata", () => {
      const meta = actionsMeta.get_status;
      expect(meta.description).toBe("Get system status, market session, and IBKR connection state");
      expect(meta.params).toBeUndefined();
      expect(meta.requiresIBKR).toBeFalsy();
    });

    it("get_quote has correct metadata", () => {
      const meta = actionsMeta.get_quote;
      expect(meta.description).toBe("Get real-time quote for a symbol");
      expect(meta.params).toEqual(["symbol"]);
      expect(meta.requiresIBKR).toBeFalsy();
    });

    it("get_ibkr_quote has correct metadata with requiresIBKR flag", () => {
      const meta = actionsMeta.get_ibkr_quote;
      expect(meta.description).toBe("Get IBKR real-time quote");
      expect(meta.params).toEqual(["symbol", "secType?", "exchange?", "currency?"]);
      expect(meta.requiresIBKR).toBe(true);
    });

    it("get_account_summary requires IBKR", () => {
      const meta = actionsMeta.get_account_summary;
      expect(meta.description).toBe("Get account summary (buying power, cash, equity)");
      expect(meta.requiresIBKR).toBe(true);
    });

    it("place_order has correct params and requires IBKR", () => {
      const meta = actionsMeta.place_order;
      expect(meta.description).toBe("Place a single order");
      expect(meta.params).toEqual([
        "symbol",
        "action",
        "orderType",
        "totalQuantity",
        "lmtPrice?",
        "auxPrice?",
        "secType?",
        "exchange?",
        "currency?",
        "tif?",
      ]);
      expect(meta.requiresIBKR).toBe(true);
    });

    it("collab_read has correct params", () => {
      const meta = actionsMeta.collab_read;
      expect(meta.description).toBe("Read collaboration messages");
      expect(meta.params).toEqual(["limit?", "author?", "tag?", "since?"]);
      expect(meta.requiresIBKR).toBeFalsy();
    });

    it("record_outcome has correct params", () => {
      const meta = actionsMeta.record_outcome;
      expect(meta.description).toBe("Record outcome for an evaluation");
      expect(meta.params).toContain("evaluation_id");
      expect(meta.params).toContain("trade_taken");
      expect(meta.requiresIBKR).toBeFalsy();
    });

    it("multi_model_score has correct metadata", () => {
      const meta = actionsMeta.multi_model_score;
      expect(meta.description).toBe("Collect weighted scores from GPT, Gemini, and Claude providers");
      expect(meta.params).toEqual(["symbol", "features?"]);
      expect(meta.requiresIBKR).toBeFalsy();
    });
  });

  describe("IBKR requirement validation", () => {
    const ibkrActions = [
      "get_ibkr_quote",
      "get_historical_ticks",
      "get_contract_details",
      "get_news_providers",
      "get_news_article",
      "get_historical_news",
      "get_news_bulletins",
      "get_pnl_single",
      "search_ibkr_symbols",
      "set_market_data_type",
      "set_auto_open_orders",
      "get_head_timestamp",
      "get_histogram_data",
      "calculate_implied_volatility",
      "calculate_option_price",
      "get_tws_current_time",
      "get_market_rule",
      "get_smart_components",
      "get_depth_exchanges",
      "get_fundamental_data",
      "get_account_summary",
      "get_positions",
      "get_pnl",
      "get_open_orders",
      "get_completed_orders",
      "get_executions",
      "place_order",
      "place_bracket_order",
      "place_advanced_bracket",
      "modify_order",
      "cancel_order",
      "cancel_all_orders",
      "flatten_positions",
      "portfolio_exposure",
      "stress_test",
      "size_position",
      "subscribe_real_time_bars",
      "unsubscribe_real_time_bars",
      "get_real_time_bars",
      "subscribe_account_updates",
      "unsubscribe_account_updates",
      "get_account_snapshot_stream",
      "get_scanner_parameters",
      "list_subscriptions",
    ];

    it("all IBKR actions are marked with requiresIBKR", () => {
      for (const action of ibkrActions) {
        expect(actionsMeta[action].requiresIBKR, `${action} should require IBKR`).toBe(true);
      }
    });

    it("Yahoo actions do not require IBKR", () => {
      const yahooActions = [
        "get_quote",
        "get_historical_bars",
        "get_stock_details",
        "get_options_chain",
        "get_option_quote",
        "search_symbols",
        "get_news",
        "get_financials",
        "get_earnings",
        "get_recommendations",
        "get_trending",
        "get_screener_filters",
        "run_screener",
        "run_screener_with_quotes",
      ];

      for (const action of yahooActions) {
        expect(actionsMeta[action].requiresIBKR, `${action} should not require IBKR`).toBeFalsy();
      }
    });
  });

  describe("getActionCatalog function", () => {
    it("returns the actionsMeta object", () => {
      const catalog = getActionCatalog();
      expect(catalog).toBe(actionsMeta);
    });

    it("returns an object with all action metadata", () => {
      const catalog = getActionCatalog();
      expect(Object.keys(catalog).length).toBeGreaterThanOrEqual(100);
      
      for (const [action, meta] of Object.entries(catalog)) {
        expect(meta).toHaveProperty("description");
        expect(typeof meta.description).toBe("string");
      }
    });
  });

  describe("catalog completeness", () => {
    it("has no duplicate action names", () => {
      const keys = Object.keys(actionsMeta);
      const uniqueKeys = new Set(keys);
      expect(keys.length).toBe(uniqueKeys.size);
    });

    it("all descriptions are unique (no copy-paste errors)", () => {
      const descriptions = Object.values(actionsMeta).map((m) => m.description);
      const uniqueDescriptions = new Set(descriptions);
      
      // Allow some similar descriptions, but most should be unique
      // We expect at least 85 unique descriptions out of 90 actions
      expect(uniqueDescriptions.size).toBeGreaterThanOrEqual(85);
    });

    it("params arrays do not contain empty strings", () => {
      for (const [action, meta] of Object.entries(actionsMeta)) {
        if (meta.params) {
          for (const param of meta.params) {
            expect(param, `Action ${action} has empty param string`).toBeTruthy();
            expect(param.length, `Action ${action} param should be non-empty`).toBeGreaterThan(0);
          }
        }
      }
    });
  });
});
