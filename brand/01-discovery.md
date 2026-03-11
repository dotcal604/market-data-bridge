# Discovery Memo — market-data-bridge

## What the Product Does

market-data-bridge is a **protocol-level bridge** that connects brokerage infrastructure (Interactive Brokers TWS/Gateway) and market data providers (Yahoo Finance, Finviz) to AI assistants (Claude via MCP, ChatGPT via REST/OpenAPI). It is not a trading app or a dashboard — it is **infrastructure plumbing** that makes structured financial data available to language models through standardized tool interfaces.

### Core data flows:

```
Yahoo Finance ──┐
IBKR TWS ───────┼──→ Bridge (normalize, enrich, route) ──→ MCP (Claude)
Finviz ─────────┘                                     ──→ REST (ChatGPT)
TraderSync CSV ─→ Import/Parse ──→ SQLite ──→ Journal/Analytics
```

### Key subsystems (from source):
- **56 MCP tools** exposed via `src/mcp/server.ts` — quotes, orders, positions, screeners, options, journal, eval
- **Multi-provider quote routing**: IBKR real-time → Yahoo fallback, with source disclosure
- **3-model ensemble eval engine**: GPT-4o + Claude + Gemini score trades in parallel with identical inputs, Bayesian weight updates, regime-aware overrides
- **14 deterministic features** computed from raw market data: ATR, RSI, RVOL, gap, spread, VWAP, range position, float rotation, tick velocity, volume acceleration, stochastic, liquidity, market alignment, volatility regime
- **Universal import system**: CSV, TSV, JSON, JSONL, XLSX, ZIP → unified `ParsedContent` rows → auto-detected broker format → normalized records
- **Session risk gate**: loss limits, trade counts, cooldowns, locks
- **Divoom pixel display**: renders portfolio/market data on physical pixel-art screens
- **AI-to-AI collaboration channel**: Claude and ChatGPT can message each other through the bridge
- **SQLite persistence**: orders, executions, journal, evals, collaboration — single `bridge.db`
- **Python analytics layer**: regime detection, calibration, backtesting, tearsheets

## Who It's For

- **Primary**: A solo active trader who uses AI assistants as analytical copilots
- **Secondary**: Quantitative-leaning retail traders who want structured data pipelines without building from scratch
- **Tertiary**: Developers building AI-powered trading tools who need a reference implementation of MCP + brokerage integration

The user is technically sophisticated — they run TWS, configure MCP servers, read TypeScript, understand R-multiples and regime models. They are NOT a casual fintech consumer.

## Visual Motifs Native to the Repo

These are concepts that actually exist in the code and architecture:

1. **Bridge / routing**: The core metaphor. Data flows FROM multiple sources THROUGH a single bridge TO multiple consumers. This is literally the product name and architecture.

2. **Schema alignment / normalization**: `ParsedContent` turns CSV/TSV/JSON/XLSX into uniform rows. Multiple broker formats → one canonical representation. This is the "joining" metaphor.

3. **Ensemble scoring**: Three models receive identical inputs, score independently, results are weighted and reconciled. This is convergence — parallel paths merging into consensus.

4. **Feature vectors**: 14 deterministic features computed from raw data (ATR, RSI, RVOL, gap, spread, VWAP...). Raw → structured → scored. This is the enrichment pipeline.

5. **Regime-aware weights**: `data/weights.json` shows equal-weight defaults with regime overrides (high vol → favor Claude, low vol → favor GPT). Adaptation to context.

6. **Dual protocol**: MCP (stdio, structured) + REST (HTTP, OpenAPI). Two interfaces to the same truth.

7. **Session state machine**: locked/unlocked/cooldown states with guardrails. Structured control flow.

8. **Grid/pixel rendering**: The Divoom subsystem renders market data into constrained pixel grids. Information density in minimal space.

## Clichés to Avoid

1. **Candlestick charts as identity**: Every fintech startup uses these. Unless integrated into the mark structurally (not decoratively), skip.
2. **Bull/bear iconography**: Generic, overused, not specific to this product.
3. **Gradient blobs / mesh backgrounds**: "AI company" aesthetic circa 2023. This is infrastructure, not a consumer app.
4. **Circuit board / network graph**: Overused "tech" metaphor with no specificity.
5. **Dollar signs or money imagery**: This is a data bridge, not a payment processor.
6. **Dark-mode-only neon**: The existing dashboard uses emerald/purple/amber on dark, but the brand should work independently.
7. **Bridges (literal)**: The Golden Gate Bridge, Brooklyn Bridge, etc. Too literal, too generic.
8. **Lock/shield icons**: This has risk controls but isn't a security product.
