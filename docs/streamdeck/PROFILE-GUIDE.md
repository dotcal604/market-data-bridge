# market-data-bridge — StreamDeck Profile Guide

> Branded button layouts for StreamDeck MK2, StreamDeck+, and StreamDeck Pedal.
> All visual treatments follow the MDB brand identity ("The Bridge Grid").

## Brand Foundation

Every button uses the MDB dark-theme surface with a category accent bar:

- **Background:** Slate 800 `#1e293b` (dark surface)
- **Icon glyphs:** Slate 200 `#e2e8f0` (monochrome, stroke-based)
- **Accent bar:** 4px top strip in category color (see below)
- **Pressed state:** accent color at 20% opacity as background tint

### Category Accent Colors

| Category | Accent | Hex | Buttons |
|----------|--------|-----|---------|
| Connection / Status | Emerald | `#10b981` | status, session, ops-health, unlock |
| Market Data | Slate | `#64748b` | SPY, QQQ, IWM, trending, news, earnings, financials, options, search, indicators |
| Eval Engine | Purple | `#8b5cf6` | eval, drift, edge, daily, weights, holly, signals, regime, tradersync |
| Orders / Execution | Red | `#ef4444` | orders, flatten, cancel, lock, reset, open-orders, filled, executions, history |
| Portfolio | Amber | `#f59e0b` | account, P&L, positions, exposure, stress-test, risk-config, screeners, size-pos |
| Tools / Utility | Slate | `#64748b` | journal, collab, import, divoom, debug, ops-log |
| Navigation | Muted | `#94a3b8` | back, dashboard, folders |

### The 3-Column Progression

Where layout allows, buttons follow the Bridge Grid's visual language:

```
Source (filled/dark)  →  Bridge (outlined)  →  Output (emerald dot)
  Data retrieval           Processing             Active status
  slate accent             amber/purple            emerald accent
```

---

## Overview

| Device | Role | Layout |
|--------|------|--------|
| **StreamDeck Pedal** | Emergency actions (foot-accessible) | 3 pedals |
| **StreamDeck MK2** | Main dashboard + navigation | 15 buttons (3x5), 4 pages |
| **StreamDeck+** | Quick-access panel + dials | 8 buttons + 4 rotary dials |

**API Base:** `http://localhost:3000/api`
**Dashboard:** `http://localhost:3001`

---

## Prerequisites

### 1. Install API Ninja Plugin

1. Open the Stream Deck app → **Stream Deck Store**
2. Search **"API Ninja"** → Install
3. API Ninja sends HTTP requests directly to MDB and displays responses on buttons

### 2. Install SVG Icons

Run the icon generator to create all 57 branded SVG button icons:

```bash
node docs/streamdeck/icons/generate.js
```

Icons output to `docs/streamdeck/icons/svg/`. In the Stream Deck app, drag each SVG onto the button's icon field, or convert to PNG at 144×144.

### 3. Verify MDB is Running

```bash
bash docs/streamdeck/validate-endpoints.sh
```

---

## Device 1: StreamDeck Pedal — Emergency Actions

Three foot pedals for panic-button actions during live trading. No visual display — muscle memory only.

```
┌─────────────────┬─────────────────┬─────────────────┐
│   LEFT PEDAL    │  MIDDLE PEDAL   │  RIGHT PEDAL    │
│                 │                 │                 │
│  FLATTEN ALL    │  CANCEL ALL     │  SESSION LOCK   │
│  ▌red accent    │  ▌red accent    │  ▌red accent    │
│                 │                 │                 │
│  POST           │  DELETE         │  POST           │
│  /positions/    │  /orders/all    │  /session/lock  │
│  flatten        │                 │                 │
└─────────────────┴─────────────────┴─────────────────┘
```

| Pedal | Action | Method | URL | Icon |
|-------|--------|--------|-----|------|
| Left | Flatten All Positions | `POST` | `http://localhost:3000/api/positions/flatten` | `flatten.svg` |
| Middle | Cancel All Orders | `DELETE` | `http://localhost:3000/api/orders/all` | `cancel.svg` |
| Right | Lock Session | `POST` | `http://localhost:3000/api/session/lock` | `lock.svg` |

**Setup:** API Ninja → set Method, URL, Content-Type: `application/json`, empty body.

---

## Device 2: StreamDeck MK2 — Main Dashboard

15 buttons (3×5 grid). 4 pages via folders.

### Page 1: Home

The home screen uses the Bridge Grid progression across columns where practical:
- **Col 1:** Status/connection (emerald accent)
- **Col 2–4:** Data retrieval (slate/amber accents)
- **Col 5:** Active state / output (emerald or navigation)

```
┌──────────┬──────────┬──────────┬──────────┬──────────┐
│ STATUS   │   SPY    │   QQQ    │   IWM    │ ACCOUNT  │
│ ▌emerald │ ▌slate   │ ▌slate   │ ▌slate   │ ▌amber   │
├──────────┼──────────┼──────────┼──────────┼──────────┤
│   P&L    │POSITIONS │  ORDERS  │ EXPOSURE │ SESSION  │
│ ▌amber   │ ▌amber   │ ▌red     │ ▌amber   │ ▌emerald │
├──────────┼──────────┼──────────┼──────────┼──────────┤
│ 📂TRADE  │📂ANALYTICS│ 📂DATA  │  HOLLY   │  DASH    │
│ ▌red     │ ▌purple  │ ▌slate   │ ▌purple  │ ▌muted   │
└──────────┴──────────┴──────────┴──────────┴──────────┘
  Source →              Bridge →              Output
```

| Pos | Label | Type | Method | URL / Action | Accent | Icon SVG |
|-----|-------|------|--------|-------------|--------|----------|
| 1,1 | STATUS | API Ninja | `GET` | `/api/status` | emerald | `status.svg` |
| 1,2 | SPY | API Ninja | `GET` | `/api/quote/SPY` | slate | `spy.svg` |
| 1,3 | QQQ | API Ninja | `GET` | `/api/quote/QQQ` | slate | `qqq.svg` |
| 1,4 | IWM | API Ninja | `GET` | `/api/quote/IWM` | slate | `iwm.svg` |
| 1,5 | ACCOUNT | API Ninja | `GET` | `/api/account/summary` | amber | `account.svg` |
| 2,1 | P&L | API Ninja | `GET` | `/api/account/pnl` | amber | `pnl.svg` |
| 2,2 | POSITIONS | API Ninja | `GET` | `/api/account/positions` | amber | `positions.svg` |
| 2,3 | ORDERS | API Ninja | `GET` | `/api/account/orders` | red | `orders.svg` |
| 2,4 | EXPOSURE | API Ninja | `GET` | `/api/portfolio/exposure` | amber | `exposure.svg` |
| 2,5 | SESSION | API Ninja | `GET` | `/api/session` | emerald | `session.svg` |
| 3,1 | TRADE | Folder | — | Opens Page 2 | red | `folder-trade.svg` |
| 3,2 | ANALYTICS | Folder | — | Opens Page 3 | purple | `folder-analytics.svg` |
| 3,3 | DATA | Folder | — | Opens Page 4 | slate | `folder-data.svg` |
| 3,4 | HOLLY | Website | — | `http://localhost:3001/holly` | purple | `holly.svg` |
| 3,5 | DASH | Website | — | `http://localhost:3001` | muted | `dashboard.svg` |

> **Tip:** Configure API Ninja on SPY/QQQ/IWM to display `lastPrice` from the response as the button title for a live price glance.

---

### Page 2: Trade Controls (folder)

Order management and session controls. All red-accent category with emerald for "safe" actions.

```
┌──────────┬──────────┬──────────┬──────────┬──────────┐
│ ← BACK   │ OPEN ORD │  FILLED  │  EXECS   │ HISTORY  │
│ ▌muted   │ ▌red     │ ▌red     │ ▌red     │ ▌red     │
├──────────┼──────────┼──────────┼──────────┼──────────┤
│ FLATTEN  │ CANCEL   │   LOCK   │  UNLOCK  │  RESET   │
│  ALL     │  ALL     │ SESSION  │ SESSION  │ SESSION  │
│ ▌red     │ ▌red     │ ▌red     │ ▌emerald │ ▌muted   │
├──────────┼──────────┼──────────┼──────────┼──────────┤
│ SIZE POS │ FLATTEN  │  STRESS  │ RISK CFG │ OPS      │
│          │ CONFIG   │   TEST   │          │ HEALTH   │
│ ▌amber   │ ▌amber   │ ▌amber   │ ▌amber   │ ▌emerald │
└──────────┴──────────┴──────────┴──────────┴──────────┘
```

| Pos | Label | Type | Method | URL / Action | Accent | Icon SVG |
|-----|-------|------|--------|-------------|--------|----------|
| 1,1 | ← BACK | Back | — | Returns to Page 1 | muted | `back.svg` |
| 1,2 | OPEN ORD | API Ninja | `GET` | `/api/account/orders` | red | `open-orders.svg` |
| 1,3 | FILLED | API Ninja | `GET` | `/api/account/orders/completed` | red | `filled.svg` |
| 1,4 | EXECS | API Ninja | `GET` | `/api/account/executions` | red | `executions.svg` |
| 1,5 | HISTORY | API Ninja | `GET` | `/api/orders/history` | red | `history.svg` |
| 2,1 | FLATTEN ALL | API Ninja | `POST` | `/api/positions/flatten` | red | `flatten.svg` |
| 2,2 | CANCEL ALL | API Ninja | `DELETE` | `/api/orders/all` | red | `cancel.svg` |
| 2,3 | LOCK | API Ninja | `POST` | `/api/session/lock` | red | `lock.svg` |
| 2,4 | UNLOCK | API Ninja | `POST` | `/api/session/unlock` | emerald | `unlock.svg` |
| 2,5 | RESET | API Ninja | `POST` | `/api/session/reset` | muted | `reset.svg` |
| 3,1 | SIZE POS | Website | — | `http://localhost:3001/sizing` | amber | `size-pos.svg` |
| 3,2 | FLATTEN CFG | API Ninja | `GET` | `/api/flatten/config` | amber | `flatten-config.svg` |
| 3,3 | STRESS TEST | Website | — | `http://localhost:3001/stress` | amber | `stress-test.svg` |
| 3,4 | RISK CFG | API Ninja | `GET` | `/api/risk/config` | amber | `risk-config.svg` |
| 3,5 | OPS HEALTH | API Ninja | `GET` | `/api/status` | emerald | `ops-health.svg` |

---

### Page 3: Analytics (folder)

Eval engine, Holly, and model analytics. Purple accent dominates.

```
┌──────────┬──────────┬──────────┬──────────┬──────────┐
│ ← BACK   │  EVAL    │  DRIFT   │   EDGE   │  DAILY   │
│ ▌muted   │ ▌purple  │ ▌purple  │ ▌purple  │ ▌purple  │
├──────────┼──────────┼──────────┼──────────┼──────────┤
│  WEIGHT  │  HOLLY   │  HOLLY   │   EXIT   │  TRADE   │
│ HISTORY  │  STATS   │  EXITS   │ AUTOPSY  │  SYNC    │
│ ▌purple  │ ▌purple  │ ▌purple  │ ▌purple  │ ▌purple  │
├──────────┼──────────┼──────────┼──────────┼──────────┤
│ SIGNALS  │  INDIC   │  REGIME  │ JOURNAL  │ OPS LOG  │
│ ▌purple  │ ▌slate   │ ▌purple  │ ▌slate   │ ▌slate   │
└──────────┴──────────┴──────────┴──────────┴──────────┘
```

| Pos | Label | Type | Method | URL / Action | Accent | Icon SVG |
|-----|-------|------|--------|-------------|--------|----------|
| 1,1 | ← BACK | Back | — | Returns to Page 1 | muted | `back.svg` |
| 1,2 | EVAL | Website | — | `http://localhost:3001/eval` | purple | `eval.svg` |
| 1,3 | DRIFT | Website | — | `http://localhost:3001/drift` | purple | `drift.svg` |
| 1,4 | EDGE | Website | — | `http://localhost:3001/edge` | purple | `edge.svg` |
| 1,5 | DAILY | Website | — | `http://localhost:3001/daily` | purple | `daily.svg` |
| 2,1 | WEIGHT HIST | Website | — | `http://localhost:3001/weights` | purple | `weights.svg` |
| 2,2 | HOLLY STATS | Website | — | `http://localhost:3001/holly` | purple | `holly.svg` |
| 2,3 | HOLLY EXITS | Website | — | `http://localhost:3001/holly/exits` | purple | `holly-exits.svg` |
| 2,4 | EXIT AUTOPSY | Website | — | `http://localhost:3001/holly/autopsy` | purple | `exit-autopsy.svg` |
| 2,5 | TRADE SYNC | Website | — | `http://localhost:3001/tradersync` | purple | `tradersync.svg` |
| 3,1 | SIGNALS | Website | — | `http://localhost:3001/signals` | purple | `signals.svg` |
| 3,2 | INDICATORS | API Ninja | `GET` | `/api/indicators` | slate | `indicators.svg` |
| 3,3 | REGIME | Website | — | `http://localhost:3001/regime` | purple | `regime.svg` |
| 3,4 | JOURNAL | Website | — | `http://localhost:3001/journal` | slate | `journal.svg` |
| 3,5 | OPS LOG | Website | — | `http://localhost:3001/ops` | slate | `ops-log.svg` |

---

### Page 4: Data & Research (folder)

Market data retrieval and screeners. Slate accent for data, amber for screeners.

```
┌──────────┬──────────┬──────────┬──────────┬──────────┐
│ ← BACK   │ TRENDING │   NEWS   │ EARNINGS │ FINANC   │
│ ▌muted   │ ▌slate   │ ▌slate   │ ▌slate   │ ▌slate   │
├──────────┼──────────┼──────────┼──────────┼──────────┤
│ SCREEN   │ SCREEN   │ OPTIONS  │  SEARCH  │ COLLAB   │
│ GAINERS  │ ACTIVES  │          │ SYMBOLS  │ CHANNEL  │
│ ▌amber   │ ▌amber   │ ▌slate   │ ▌slate   │ ▌slate   │
├──────────┼──────────┼──────────┼──────────┼──────────┤
│ IMPORT   │ IMPORT   │  DIVOOM  │  DIVOOM  │  DEBUG   │
│ HISTORY  │  FILE    │ REFRESH  │ BRIGHT   │ RUNTIME  │
│ ▌slate   │ ▌slate   │ ▌slate   │ ▌slate   │ ▌slate   │
└──────────┴──────────┴──────────┴──────────┴──────────┘
```

| Pos | Label | Type | Method | URL / Action | Accent | Icon SVG |
|-----|-------|------|--------|-------------|--------|----------|
| 1,1 | ← BACK | Back | — | Returns to Page 1 | muted | `back.svg` |
| 1,2 | TRENDING | API Ninja | `GET` | `/api/trending` | slate | `trending.svg` |
| 1,3 | NEWS | Website | — | `http://localhost:3001/news` | slate | `news.svg` |
| 1,4 | EARNINGS | Website | — | `http://localhost:3001/earnings` | slate | `earnings.svg` |
| 1,5 | FINANCIALS | Website | — | `http://localhost:3001/financials` | slate | `financials.svg` |
| 2,1 | SCREEN GAIN | API Ninja | `POST` | `/api/screener/run` | amber | `screener-gainers.svg` |
| | | | Body: | `{"screenerId": "day_gainers"}` | | |
| 2,2 | SCREEN ACT | API Ninja | `POST` | `/api/screener/run` | amber | `screener-actives.svg` |
| | | | Body: | `{"screenerId": "most_actives"}` | | |
| 2,3 | OPTIONS | Website | — | `http://localhost:3001/options` | slate | `options.svg` |
| 2,4 | SEARCH | Website | — | `http://localhost:3001/search` | slate | `search.svg` |
| 2,5 | COLLAB | API Ninja | `GET` | `/api/collab/messages` | slate | `collab.svg` |
| 3,1 | IMPORT HIST | API Ninja | `GET` | `/api/import/history` | slate | `import-history.svg` |
| 3,2 | IMPORT FILE | Website | — | `http://localhost:3001/import` | slate | `import.svg` |
| 3,3 | DIVOOM RFRSH | API Ninja | `POST` | `/api/divoom/refresh` | slate | `divoom.svg` |
| 3,4 | DIVOOM BRT | API Ninja | `POST` | `/api/divoom/brightness` | slate | `divoom-bright.svg` |
| | | | Body: | `{"brightness": 50}` | | |
| 3,5 | DEBUG | API Ninja | `GET` | `/api/status` | slate | `debug.svg` |

---

## Device 3: StreamDeck+ — Quick Access Panel

8 buttons across the top + 4 rotary dials with touch strip.

### 8 Buttons

The SD+ layout follows the Bridge Grid left-to-right: data sources → processing → output/action.

```
┌────────┬────────┬────────┬────────┬────────┬────────┬────────┬────────┐
│ STATUS │ACCOUNT │  P&L   │POSITNS │ ORDERS │EXPOSURE│FLATTEN │  LOCK  │
│▌emerald│▌amber  │▌amber  │▌amber  │▌red    │▌amber  │▌red    │▌red    │
└────────┴────────┴────────┴────────┴────────┴────────┴────────┴────────┘
 Source →               Bridge →                       Output / Action
```

| Pos | Label | Type | Method | URL | Accent | Icon SVG |
|-----|-------|------|--------|-----|--------|----------|
| 1 | STATUS | API Ninja | `GET` | `/api/status` | emerald | `status.svg` |
| 2 | ACCOUNT | API Ninja | `GET` | `/api/account/summary` | amber | `account.svg` |
| 3 | P&L | API Ninja | `GET` | `/api/account/pnl` | amber | `pnl.svg` |
| 4 | POSITIONS | API Ninja | `GET` | `/api/account/positions` | amber | `positions.svg` |
| 5 | ORDERS | API Ninja | `GET` | `/api/account/orders` | red | `orders.svg` |
| 6 | EXPOSURE | API Ninja | `GET` | `/api/portfolio/exposure` | amber | `exposure.svg` |
| 7 | FLATTEN | API Ninja | `POST` | `/api/positions/flatten` | red | `flatten.svg` |
| 8 | LOCK | API Ninja | `POST` | `/api/session/lock` | red | `lock.svg` |

### 4 Rotary Dials

```
┌──────────────┬──────────────┬──────────────┬──────────────┐
│   DIAL 1     │   DIAL 2     │   DIAL 3     │   DIAL 4     │
│   ▌slate     │   ▌amber     │   ▌muted     │   ▌slate     │
│              │              │              │              │
│  Watchlist   │  Screener    │  Dashboard   │  Brightness  │
│  Cycle       │  Presets     │  Pages       │  Control     │
│              │              │              │              │
│ Rotate: next │ Rotate: next │ Rotate: next │ Rotate: +/-  │
│  symbol      │  screener    │  page        │  brightness  │
│              │              │              │              │
│ Touch: SPY   │ Touch: run   │ Touch: home  │ Touch: 50%   │
│ Press: quote │ Press: scan  │ Press: open  │ Press: reset │
└──────────────┴──────────────┴──────────────┴──────────────┘
```

| Dial | Rotate CW | Rotate CCW | Press | Touch |
|------|-----------|------------|-------|-------|
| 1 - Watchlist | Next symbol quote URL | Prev symbol quote URL | Open current in dashboard | Show SPY quote |
| 2 - Screener | Cycle: gainers → actives → losers → tech | Cycle backwards | Run current screener | Run default screener |
| 3 - Dashboard | Next tab (Ctrl+Tab) | Prev tab (Ctrl+Shift+Tab) | Open dashboard home | Refresh (F5) |
| 4 - Brightness | Increase brightness | Decrease brightness | Set to 50% | Set to max |

---

## API Ninja Configuration

### GET Request (data retrieval)

1. Drag **API Ninja → API Request** onto button
2. Title: button label (e.g., "STATUS")
3. Request Type: `GET`
4. URL: full endpoint (prepend `http://localhost:3000`)
5. Display Response: enable for data buttons
6. Set icon from `docs/streamdeck/icons/svg/`

### POST Request (actions)

1. Drag **API Ninja → API Request** onto button
2. Request Type: `POST`
3. URL: full endpoint
4. Content-Type: `application/json`
5. Body: as specified (or empty `{}`)

### DELETE Request (cancel)

1. Request Type: `DELETE`
2. URL: `http://localhost:3000/api/orders/all`
3. No body needed

### Website Action (dashboard)

1. Drag **System → Website** onto button
2. URL: dashboard page (e.g., `http://localhost:3001/holly`)

### Folder Navigation (MK2 sub-pages)

1. Right-click button → **Create Folder**
2. Enter folder → configure inner buttons
3. Back button auto-created at position 1,1

---

## Quick Reference: All Endpoints

### GET (safe, read-only)

| Endpoint | Returns |
|----------|---------|
| `/api/status` | Bridge status, market session, IBKR connection |
| `/api/quote/SPY` | SPY quote (IBKR real-time or Yahoo delayed) |
| `/api/quote/QQQ` | QQQ quote |
| `/api/quote/IWM` | IWM quote |
| `/api/account/summary` | Net liquidation, buying power, margin |
| `/api/account/positions` | Current open positions |
| `/api/account/pnl` | Daily P&L, unrealized, realized |
| `/api/account/orders` | Open orders |
| `/api/account/orders/completed` | Filled/cancelled orders |
| `/api/account/executions` | Today's fills with commissions |
| `/api/orders/history` | Historical order records |
| `/api/portfolio/exposure` | Gross/net exposure, sector breakdown |
| `/api/session` | Session state, limits, lock status |
| `/api/risk/config` | Risk parameters |
| `/api/flatten/config` | Auto-flatten schedule |
| `/api/trending` | Trending symbols |
| `/api/indicators` | All tracked indicator snapshots |
| `/api/collab/messages` | AI collaboration messages |
| `/api/import/history` | Import records |

### POST (actions)

| Endpoint | Action | Body |
|----------|--------|------|
| `/api/positions/flatten` | Flatten all positions | (none) |
| `/api/session/lock` | Lock session | (none) |
| `/api/session/unlock` | Unlock session | (none) |
| `/api/session/reset` | Reset session counters | (none) |
| `/api/screener/run` | Run screener | `{"screenerId": "day_gainers"}` |
| `/api/divoom/refresh` | Refresh Divoom display | (none) |
| `/api/divoom/brightness` | Set Divoom brightness | `{"brightness": 50}` |

### DELETE (destructive)

| Endpoint | Action |
|----------|--------|
| `/api/orders/all` | Cancel ALL open orders |

---

## Multi-Action: Full Emergency Sequence

Chain three actions into one button press:

1. `DELETE http://localhost:3000/api/orders/all` (cancel all)
2. `POST http://localhost:3000/api/positions/flatten` (flatten all)
3. `POST http://localhost:3000/api/session/lock` (lock session)

Set 500ms delay between actions. Use red accent, assign to a prominent position.

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Button shows error / no response | Check MDB is running: `curl http://localhost:3000/api/status` |
| IBKR data unavailable | TWS must be running. Status button shows `ibkr.connected: false` |
| Flatten/Cancel no effect | Requires active IBKR connection |
| Dashboard pages don't load | Start frontend: `cd frontend && npm run dev` (port 3001) |
| Screener returns empty | Some screeners only work during market hours |
