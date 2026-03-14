# Holly Exit Optimizer — Scripts Manifest

115 numbered scripts across 3 phases. Some numbers are shared (fetch + analysis scripts developed in parallel).

## Phase A: Ingest & Data Collection (01-44)

### Core Pipeline (01-07)
| # | Script | Purpose |
|---|--------|---------|
| 01 | `ingest_trades` | Parse Holly CSV + TraderSync CSV into DuckDB |
| 02 | `audit_tickers` | Check which Holly tickers exist in Polygon |
| 03 | `fetch_bars` | Pull 1-min bars from Polygon for all trades |
| 04 | `load_bars_to_ddb` | Load Parquet bar files into DuckDB |
| 05 | `run_optimization` | VectorBT exit sweep across all strategies |
| 06 | `validate_topn` | Validate top parameter sets against tick data |
| 07 | `export_params` | Export optimal exit parameters to JSON |

### Analysis & Export (08-16)
| # | Script | Purpose |
|---|--------|---------|
| 08 | `deep_analysis` | Deep analysis of exit optimizer results |
| 09 | `export_for_chatgpt` | Export data for ChatGPT analysis |
| 10 | `holly_batch_assembler` | Assemble multiple Holly CSVs into deduplicated dataset |
| 11 | `walk_forward` | Walk-forward validation for exit optimizer |
| 12 | `fetch_regime_bars` | Fetch 20-day daily bars from Yahoo for regime tagging |
| 13 | `export_analytics` | **DEPRECATED** — Use `build_silver.py` instead |
| 14 | `audit_trades_vs_yahoo` | Audit Holly trade data against Yahoo daily bars |
| 15 | `fetch_benchmarks` | Fetch 5yr minute bars for benchmark/sector ETFs |
| 16 | `load_benchmarks_to_ddb` | Load ETF + grouped daily bars into DuckDB |

### Reference Data (17-26)
| # | Script | Purpose |
|---|--------|---------|
| 17 | `fetch_reference_data` | Stock splits, dividends, ticker details from Polygon |
| 18 | `fetch_financials` | Company financials from Polygon |
| 19 | `quantstats_tearsheets` | Generate QuantStats HTML tearsheets |
| 20 | `fetch_options_reference` | Options contract reference from Polygon |
| 21 | `fetch_news` | Historical news from Polygon |
| 22 | `fetch_small_reference` | Small reference datasets (conditions, markets) |
| 23 | `fetch_flat_files` | Download Polygon flat files (minute + daily) via S3 |
| 24 | `fetch_fred_macro` | FRED macro time series for regime analysis |
| 25 | `fetch_ticker_events` | Ticker lifecycle events from Polygon |
| 26 | `fetch_market_holidays` | Market holidays + historical calendar |

### Deep Analysis & Data Enrichment (27-44)
| # | Script | Purpose |
|---|--------|---------|
| 27 | `mae_mfe_analysis` | MAE/MFE path analysis & exit optimization |
| 28 | `mae_mfe_pipeline` | Normalized MAE/MFE analysis & exit simulation |
| 29 | `map_ibkr_trades` | Map IBKR executions to Holly trades |
| 30 | `sizing_simulation` | Holly sizing simulation engine |
| 31 | `fetch_snapshots` | Full-market stock snapshots from Polygon |
| 32 | `fetch_indicators` | Pre-computed technical indicators from Polygon |
| 33 | `fetch_economic_events` | Economic event calendar for trade analysis |
| 34 | `fetch_earnings_calendar` | Historical earnings dates for traded symbols |
| 35 | `fetch_sector_data` | Backfill missing sector/industry via yfinance |
| 36 | `fetch_polygon_bars` | Backfill missing 1-min bars from Polygon |
| 37 | `fetch_alpaca_bars` | Backfill missing 1-min bars from Alpaca (free) |
| 38 | `compute_daily_from_bars` | Compute daily OHLCV from 1-minute bars |
| 39 | `fetch_etf_bars_alpaca` | 1-minute bars for SPY + sector ETFs from Alpaca |
| 40 | `compute_indicators` | Compute SMA, EMA, RSI, MACD from daily bars |
| 41 | `compute_snapshots` | Reconstruct daily snapshots from bars |
| 42 | `backfill_real_entries` | Backfill real_entry_price into DuckDB trades |
| 43 | `fetch_benzinga_news` | Benzinga news via Massive.com API |
| 44 | `fetch_analyst_ratings` | Benzinga analyst ratings via Massive.com API |

## Phase B: Feature Engineering (45-78)

### Lift Analysis (45-51)
| # | Script | Purpose |
|---|--------|---------|
| 45 | `compute_benzinga_features` | 8 news-derived features per trade |
| 45 | `fetch_corporate_guidance` | Corporate guidance via Massive.com |
| 46 | `benzinga_lift_analysis` | Benzinga news feature lift analysis |
| 47 | `regime_lift_analysis` | Technical regime lift analysis |
| 48 | `earnings_proximity_lift` | Earnings proximity lift analysis |
| 48 | `fetch_quotes_nbbo` | NBBO quotes at entry times via Massive.com |
| 49 | `economic_events_lift` | Economic events lift analysis |
| 50 | `ticker_fundamentals_lift` | Ticker fundamentals lift analysis |
| 51 | `temporal_lift` | Temporal (time-of-day, day-of-week) lift |
| 51 | `fetch_short_volume` | Short volume data via Massive.com |

### Composite Scores v1-v3 (52-59)
| # | Script | Purpose |
|---|--------|---------|
| 52 | `composite_edge_score` | Composite edge score v1 combining all features |
| 52 | `fetch_earnings` | Benzinga earnings via Massive.com |
| 53 | `direction_aware_score` | Direction-aware composite edge score |
| 54 | `intraday_context_lift` | Intraday context lift from minute bars |
| 55 | `composite_v2` | Composite edge score v2 |
| 55 | `fetch_ipos` | IPO listings via Massive.com |
| 56 | `prior_day_context_lift` | Prior-day context from daily bars |
| 56 | `fetch_financials` | Financial statements via Massive.com |
| 57 | `fundamentals_lift` | Financial fundamentals & industry lift |
| 58 | `news_dividends_lift` | News/dividends/related companies lift |
| 59 | `composite_v3` | Composite v3 with 14 features |
| 59 | `fetch_treasury_yields` | Treasury yield data via Massive.com |

### GBT Models & Composites v4-v7 (60-78)
| # | Script | Purpose |
|---|--------|---------|
| 60 | `gradient_boosting_model` | GBT model for trade quality prediction |
| 61 | `multiday_patterns_lift` | Multi-day pattern lift analysis |
| 62 | `relative_strength_lift` | Relative strength lift analysis |
| 63 | `volume_microstructure_lift` | Volume microstructure lift |
| 64 | `enhanced_gbt_model` | Enhanced GBT with new features |
| 64 | `fetch_risk_categories` | Risk factor taxonomy via Massive.com |
| 65 | `per_strategy_gbt` | Per-strategy GBT models |
| 65 | `fetch_exchanges` | Exchange reference via Massive.com |
| 66 | `ticker_historical_lift` | Ticker historical lift analysis |
| 66 | `fetch_ticker_types` | Ticker type reference via Massive.com |
| 67 | `strategy_regime_lift` | Strategy x regime interaction lift |
| 67 | `fetch_condition_codes` | Trade/quote condition codes via Massive.com |
| 68 | `composite_v4_gbt` | Composite v4 with GBT |
| 68 | `fetch_trades_tick` | Tick-level trade data via Massive.com |
| 69 | `regime_momentum_lift` | Regime momentum lift analysis |
| 69 | `fetch_intraday_bars` | 5-min intraday bars via Massive.com |
| 70 | `news_volume_lift` | News volume lift analysis |
| 70 | `fetch_1min_bars` | 1-min bars + microstructure via Massive.com |
| 71 | `sector_etf_lift` | Sector ETF lift analysis |
| 72 | `multiday_volume_lift` | Multi-day volume lift |
| 73 | `composite_v5_gbt` | Composite v5 with GBT |
| 74 | `intraday_microstructure_lift` | Intraday microstructure lift |
| 75 | `composite_v6_pruned` | Composite v6 — pruned feature set |
| 76 | `benzinga_structured_lift` | Benzinga structured data lift |
| 77 | `fetch_benzinga_broad` | Broad Benzinga news fetch (all tickers) |
| 78 | `fetch_benzinga_ratings_earnings` | Benzinga ratings + earnings fetch |
| 79 | `composite_v7_benzinga` | Composite v7 with Benzinga features |

## Phase C: Research & Validation (80-101)

### Modern-Era Composites (80-87)
| # | Script | Purpose |
|---|--------|---------|
| 80 | `composite_v8_modern_era` | Modern-era (2024+) composite |
| 81 | `economic_breadth_splits_lift` | Economic + breadth + splits lift |
| 82 | `composite_v9_direction_split` | Direction-split composite |
| 83 | `fred_macro_earnings_lift` | FRED macro + earnings proximity lift |
| 84 | `composite_v10_macro` | Composite v10 with macro features |
| 85 | `sector_temporal_lift` | Sector x temporal interaction lift |
| 86 | `composite_v11_sector` | Composite v11 with sector features |
| 87 | `composite_v12_gapfill_tuning` | Composite v12 — gap-fill tuning |

### Extended Data Fetches (88-92)
| # | Script | Purpose |
|---|--------|---------|
| 88 | `fetch_fred_extended` | Extended FRED macro data |
| 89 | `fetch_polygon_shorts` | Short interest/volume from Polygon |
| 90 | `fetch_sec_insider` | SEC insider trading filings |
| 91 | `new_features_lift` | Lift from newly fetched features |
| 92 | `fetch_polygon_indicators` | Technical indicators from Polygon |

### Final Research (93-101)
| # | Script | Purpose |
|---|--------|---------|
| 93 | `indicator_lift` | Technical indicator feature lift |
| 94 | `composite_v14_indicators` | Composite v14 with indicators |
| 95 | `benzinga_broad_features` | Broad Benzinga features (2.7M articles) |
| 96 | `remaining_datasets_lift` | Float, IPO, dividend, SEC, yield features |
| 97 | `composite_v15_fundamentals` | Composite v15 — final model |
| 98 | `fetch_everything` | **Mega-fetch**: hoard all API data before cancel |
| 99 | `shrunk_sector_overlay` | **SSP overlay**: hierarchical Bayes shrinkage |
| 100 | `adversarial_ssp_test` | **Adversarial validation**: 5/5 PASS |
| 101 | `build_workbook` | **Workbook v1**: 6-sheet analytical Excel |

## Utility Scripts (unnumbered)

| Script | Purpose |
|--------|---------|
| `_case_studies.py` | Trade case study analysis |
| `_check_anomalies.py` | Anomaly detection in trade data |
| `_compare_holly_vs_you.py` | Compare Holly vs manual trades |
| `_consolidated_report.py` | Consolidated analytics report |
| `_deep_analysis.py` | Extended deep analysis |
| `_deep_analysis_2.py` | Deep analysis variant |
| `_tmp_macro_analysis.py` | Temporary macro analysis |
| `_tmp_regime_kelly.py` | Temporary regime/Kelly criterion analysis |
| `historical_scraper.py` | Historical data scraper |

## Notes

- Scripts with **duplicate numbers** (e.g., two `45_*`, two `48_*`) are fetch + analysis pairs developed in parallel
- **DEPRECATED**: Script 13 (`export_analytics`) — replaced by `analytics/build_silver.py`
- **API keys required**: Polygon (scripts 03, 17-25, 31-32, 36, 88-92), Massive.com (43-44, 45-70, 77-78, 98), FRED (24, 88)
- **Composite evolution**: v1 (52) → v2 (55) → v3 (59) → v4 (68) → v5 (73) → v6 (75) → v7 (79) → v8 (80) → v9 (82) → v10 (84) → v11 (86) → v12 (87) → v14 (94) → v15 (97)
- v13 was skipped in numbering
