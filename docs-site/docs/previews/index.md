---
sidebar_position: 1
title: Frontend Previews
---

# UI Preview Gallery

Auto-captured screenshots of the Market Data Bridge frontend dashboard (Next.js 16 + React 19 + shadcn/ui).

> **Note:** Screenshots are generated automatically by running `npm run docs:generate`. If images are missing below, run the full pipeline with Puppeteer available: `node scripts/capture-ui.mjs`

## Pages

The frontend includes 26+ pages organized by function:

| Page | Route | Description |
|------|-------|-------------|
| Dashboard | `/` | At-a-glance market status, positions, recent evaluations |
| Evaluations | `/evals` | Ensemble model results, consensus scores, drift indicators |
| Orders | `/orders` | Active and completed orders with bracket visualization |
| Account | `/account` | Positions, buying power, portfolio exposure |
| Market Research | `/market` | Quote lookup, historical charts, options chains |
| Trade Journal | `/journal` | Trade reasoning, outcome tracking, performance analytics |
| Divoom Settings | `/divoom` | LED display widget layout and live preview |
| Holly Analytics | `/holly` | Trade Ideas alert analysis and backtesting |
| Screener | `/screener` | Market screener with real-time quotes |
| Model Stats | `/model-stats` | Ensemble model performance statistics |
| Drift Detection | `/drift` | Model drift monitoring and alerts |
| Weight Tuning | `/weights` | Dynamic model weight management |
| Session | `/session` | Risk guardrails and session controls |

## Generating Screenshots

To capture fresh screenshots locally:

```bash
# Full pipeline (requires Chrome/Puppeteer)
npm run docs:generate

# Screenshots only
node scripts/capture-ui.mjs
```

Screenshots are saved to `docs-site/static/previews/` and embedded in this page automatically.
