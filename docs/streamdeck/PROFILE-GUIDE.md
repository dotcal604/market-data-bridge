# Stream Deck Profile Guide — Market Data Bridge

> One-touch trading controls, market monitoring, and emergency actions across three Stream Deck devices.

## Overview

| Device | Role | Layout |
|--------|------|--------|
| **StreamDeck Pedal** | Emergency actions (foot-accessible) | 3 pedals |
| **StreamDeck MK2** | Main dashboard + navigation | 15 buttons (3x5), 4 pages |
| **StreamDeck+** | Quick-access panel + dials | 8 buttons + 4 rotary dials |

**Base URL:** `http://localhost:3000/api`
**Dashboard:** `http://localhost:3001`

---

## Prerequisites

### 1. Install API Ninja Plugin

1. Open the Stream Deck app
2. Go to the **Stream Deck Store** (bottom-right icon)
3. Search for **"API Ninja"**
4. Click **Install**

API Ninja lets buttons make HTTP requests directly to the MDB REST API and display response data on the button.

### 2. Verify MDB is Running

Run the validation script (see `validate-endpoints.sh`) or manually check:

```bash
curl http://localhost:3000/api/status
```

You should get a JSON response with `easternTime`, `marketSession`, and `ibkr` connection info.

---

## Device 1: StreamDeck Pedal — Emergency Actions

Three foot pedals for panic-button actions during live trading. No looking down, no clicking — just stomp.

```
┌─────────────────┬─────────────────┬─────────────────┐
│   LEFT PEDAL    │  MIDDLE PEDAL   │  RIGHT PEDAL    │
│                 │                 │                 │
│  FLATTEN ALL    │  CANCEL ALL     │  SESSION LOCK   │
│                 │                 │                 │
│  POST           │  DELETE         │  POST           │
│  /positions/    │  /orders/all    │  /session/lock  │
│  flatten        │                 │                 │
└─────────────────┴─────────────────┴─────────────────┘
```

### Pedal Configuration

| Pedal | Action | Plugin | Method | URL | Notes |
|-------|--------|--------|--------|-----|-------|
| Left | **Flatten All Positions** | API Ninja | `POST` | `http://localhost:3000/api/positions/flatten` | Closes ALL open positions at market. Use in emergencies. |
| Middle | **Cancel All Orders** | API Ninja | `DELETE` | `http://localhost:3000/api/orders/all` | Cancels every open order immediately. |
| Right | **Lock Session** | API Ninja | `POST` | `http://localhost:3000/api/session/lock` | Prevents any new orders from being placed until unlocked. |

### API Ninja Settings for Each Pedal

For each pedal in the Stream Deck app:

1. Drag **API Ninja → API Request** onto the pedal
2. Set **Method** to the value in the table above
3. Set **URL** to the full URL in the table above
4. Set **Content-Type** to `application/json`
5. Leave **Body** empty (these endpoints don't require a body)
6. Set **Title** to the action name (FLATTEN, CANCEL, LOCK)

---

## Device 2: StreamDeck MK2 — Main Dashboard

15 buttons in a 3x5 grid with 4 pages (Page 1 = Home, Pages 2-4 = folders).

### Page 1: Home

```
┌──────────┬──────────┬──────────┬──────────┬──────────┐
│ STATUS   │   SPY    │   QQQ    │   IWM    │ ACCOUNT  │
│ 🟢 green │ 🔵 blue  │ 🔵 blue  │ 🔵 blue  │ 🟣 purple│
├──────────┼──────────┼──────────┼──────────┼──────────┤
│   P&L    │POSITIONS │  ORDERS  │ EXPOSURE │ SESSION  │
│ 🔵 blue  │ 🔵 blue  │ 🟡 yellow│ 🟣 purple│ 🟢 green │
├──────────┼──────────┼──────────┼──────────┼──────────┤
│ 📂TRADE  │📂ANALYTICS│ 📂DATA  │  HOLLY   │  DASH    │
│ 🔴 red   │ 🟡 yellow│ 🔵 blue  │ 🟠 orange│ ⚪ white │
└──────────┴──────────┴──────────┴──────────┴──────────┘
```

#### Page 1 Button Mapping

| Pos | Label | Type | Method | URL / Action | Color |
|-----|-------|------|--------|-------------|-------|
| 1,1 | STATUS | API Ninja | `GET` | `http://localhost:3000/api/status` | Green |
| 1,2 | SPY | API Ninja | `GET` | `http://localhost:3000/api/quote/SPY` | Blue |
| 1,3 | QQQ | API Ninja | `GET` | `http://localhost:3000/api/quote/QQQ` | Blue |
| 1,4 | IWM | API Ninja | `GET` | `http://localhost:3000/api/quote/IWM` | Blue |
| 1,5 | ACCOUNT | API Ninja | `GET` | `http://localhost:3000/api/account/summary` | Purple |
| 2,1 | P&L | API Ninja | `GET` | `http://localhost:3000/api/account/pnl` | Blue |
| 2,2 | POSITIONS | API Ninja | `GET` | `http://localhost:3000/api/account/positions` | Blue |
| 2,3 | ORDERS | API Ninja | `GET` | `http://localhost:3000/api/account/orders` | Yellow |
| 2,4 | EXPOSURE | API Ninja | `GET` | `http://localhost:3000/api/portfolio/exposure` | Purple |
| 2,5 | SESSION | API Ninja | `GET` | `http://localhost:3000/api/session` | Green |
| 3,1 | TRADE | Folder | — | Opens Page 2 | Red |
| 3,2 | ANALYTICS | Folder | — | Opens Page 3 | Yellow |
| 3,3 | DATA | Folder | — | Opens Page 4 | Blue |
| 3,4 | HOLLY | Website | — | `http://localhost:3001/holly` | Orange |
| 3,5 | DASH | Website | — | `http://localhost:3001` | White |

> **Tip:** For quote buttons (SPY/QQQ/IWM), configure API Ninja to display the `lastPrice` field from the response on the button title. This gives you a live price glance.

---

### Page 2: Trade Controls (folder from TRADE button)

```
┌──────────┬──────────┬──────────┬──────────┬──────────┐
│ ← BACK   │ OPEN ORD │  FILLED  │  EXECS   │ HISTORY  │
│ ⚪ white │ 🟡 yellow│ 🟡 yellow│ 🟡 yellow│ 🟡 yellow│
├──────────┼──────────┼──────────┼──────────┼──────────┤
│ FLATTEN  │ CANCEL   │   LOCK   │  UNLOCK  │  RESET   │
│  ALL     │  ALL     │ SESSION  │ SESSION  │ SESSION  │
│ 🔴 red   │ 🔴 red   │ 🟡 yellow│ 🟢 green │ ⚪ white │
├──────────┼──────────┼──────────┼──────────┼──────────┤
│ SIZE POS │ FLATTEN  │  STRESS  │ RISK CFG │ OPS      │
│          │ CONFIG   │   TEST   │          │ HEALTH   │
│ 🟣 purple│ 🟡 yellow│ 🟣 purple│ 🟡 yellow│ 🟢 green │
└──────────┴──────────┴──────────┴──────────┴──────────┘
```

#### Page 2 Button Mapping

| Pos | Label | Type | Method | URL / Action | Color |
|-----|-------|------|--------|-------------|-------|
| 1,1 | ← BACK | Back | — | Returns to Page 1 (auto-created by SD) | White |
| 1,2 | OPEN ORD | API Ninja | `GET` | `http://localhost:3000/api/account/orders` | Yellow |
| 1,3 | FILLED | API Ninja | `GET` | `http://localhost:3000/api/account/orders/completed` | Yellow |
| 1,4 | EXECS | API Ninja | `GET` | `http://localhost:3000/api/account/executions` | Yellow |
| 1,5 | HISTORY | API Ninja | `GET` | `http://localhost:3000/api/orders/history` | Yellow |
| 2,1 | FLATTEN ALL | API Ninja | `POST` | `http://localhost:3000/api/positions/flatten` | Red |
| 2,2 | CANCEL ALL | API Ninja | `DELETE` | `http://localhost:3000/api/orders/all` | Red |
| 2,3 | LOCK | API Ninja | `POST` | `http://localhost:3000/api/session/lock` | Yellow |
| 2,4 | UNLOCK | API Ninja | `POST` | `http://localhost:3000/api/session/unlock` | Green |
| 2,5 | RESET | API Ninja | `POST` | `http://localhost:3000/api/session/reset` | White |
| 3,1 | SIZE POS | Website | — | `http://localhost:3001/sizing` | Purple |
| 3,2 | FLATTEN CFG | API Ninja | `GET` | `http://localhost:3000/api/flatten/config` | Yellow |
| 3,3 | STRESS TEST | Website | — | `http://localhost:3001/stress` | Purple |
| 3,4 | RISK CFG | API Ninja | `GET` | `http://localhost:3000/api/risk/config` | Yellow |
| 3,5 | OPS HEALTH | API Ninja | `GET` | `http://localhost:3000/api/status` | Green |

---

### Page 3: Analytics (folder from ANALYTICS button)

```
┌──────────┬──────────┬──────────┬──────────┬──────────┐
│ ← BACK   │  EVAL    │  DRIFT   │   EDGE   │  DAILY   │
│ ⚪ white │ 🟠 orange│ 🟠 orange│ 🟠 orange│ 🟠 orange│
├──────────┼──────────┼──────────┼──────────┼──────────┤
│  WEIGHT  │  HOLLY   │  HOLLY   │   EXIT   │  TRADE   │
│ HISTORY  │  STATS   │  EXITS   │ AUTOPSY  │  SYNC    │
│ 🟣 purple│ 🟠 orange│ 🟠 orange│ 🟣 purple│ 🟣 purple│
├──────────┼──────────┼──────────┼──────────┼──────────┤
│ SIGNALS  │  INDIC   │  REGIME  │ JOURNAL  │ OPS LOG  │
│ 🔵 blue  │ 🔵 blue  │ 🔵 blue  │ 🟣 purple│ 🟢 green │
└──────────┴──────────┴──────────┴──────────┴──────────┘
```

#### Page 3 Button Mapping

| Pos | Label | Type | Method | URL / Action | Color |
|-----|-------|------|--------|-------------|-------|
| 1,1 | ← BACK | Back | — | Returns to Page 1 | White |
| 1,2 | EVAL | Website | — | `http://localhost:3001/eval` | Orange |
| 1,3 | DRIFT | Website | — | `http://localhost:3001/drift` | Orange |
| 1,4 | EDGE | Website | — | `http://localhost:3001/edge` | Orange |
| 1,5 | DAILY | Website | — | `http://localhost:3001/daily` | Orange |
| 2,1 | WEIGHT HIST | Website | — | `http://localhost:3001/weights` | Purple |
| 2,2 | HOLLY STATS | Website | — | `http://localhost:3001/holly` | Orange |
| 2,3 | HOLLY EXITS | Website | — | `http://localhost:3001/holly/exits` | Orange |
| 2,4 | EXIT AUTOPSY | Website | — | `http://localhost:3001/holly/autopsy` | Purple |
| 2,5 | TRADE SYNC | Website | — | `http://localhost:3001/tradersync` | Purple |
| 3,1 | SIGNALS | Website | — | `http://localhost:3001/signals` | Blue |
| 3,2 | INDICATORS | API Ninja | `GET` | `http://localhost:3000/api/indicators` | Blue |
| 3,3 | REGIME | Website | — | `http://localhost:3001/regime` | Blue |
| 3,4 | JOURNAL | Website | — | `http://localhost:3001/journal` | Purple |
| 3,5 | OPS LOG | Website | — | `http://localhost:3001/ops` | Green |

---

### Page 4: Data & Research (folder from DATA button)

```
┌──────────┬──────────┬──────────┬──────────┬──────────┐
│ ← BACK   │ TRENDING │   NEWS   │ EARNINGS │ FINANC   │
│ ⚪ white │ 🔵 blue  │ 🔵 blue  │ 🔵 blue  │ 🔵 blue  │
├──────────┼──────────┼──────────┼──────────┼──────────┤
│ SCREEN   │ SCREEN   │ OPTIONS  │  SEARCH  │ COLLAB   │
│ GAINERS  │ ACTIVES  │          │ SYMBOLS  │ CHANNEL  │
│ 🟠 orange│ 🟠 orange│ 🔵 blue  │ 🔵 blue  │ 🟢 green │
├──────────┼──────────┼──────────┼──────────┼──────────┤
│ IMPORT   │ IMPORT   │  DIVOOM  │  DIVOOM  │  DEBUG   │
│ HISTORY  │  FILE    │ REFRESH  │ BRIGHT   │ RUNTIME  │
│ 🟣 purple│ 🟣 purple│ 🟠 orange│ 🟠 orange│ ⚪ white │
└──────────┴──────────┴──────────┴──────────┴──────────┘
```

#### Page 4 Button Mapping

| Pos | Label | Type | Method | URL / Action | Color |
|-----|-------|------|--------|-------------|-------|
| 1,1 | ← BACK | Back | — | Returns to Page 1 | White |
| 1,2 | TRENDING | API Ninja | `GET` | `http://localhost:3000/api/trending` | Blue |
| 1,3 | NEWS | Website | — | `http://localhost:3001/news` | Blue |
| 1,4 | EARNINGS | Website | — | `http://localhost:3001/earnings` | Blue |
| 1,5 | FINANCIALS | Website | — | `http://localhost:3001/financials` | Blue |
| 2,1 | SCREEN GAIN | API Ninja | `POST` | `http://localhost:3000/api/screener/run` | Orange |
| | | | Body: | `{"screenerId": "day_gainers"}` | |
| 2,2 | SCREEN ACT | API Ninja | `POST` | `http://localhost:3000/api/screener/run` | Orange |
| | | | Body: | `{"screenerId": "most_actives"}` | |
| 2,3 | OPTIONS | Website | — | `http://localhost:3001/options` | Blue |
| 2,4 | SEARCH | Website | — | `http://localhost:3001/search` | Blue |
| 2,5 | COLLAB | API Ninja | `GET` | `http://localhost:3000/api/collab/messages` | Green |
| 3,1 | IMPORT HIST | API Ninja | `GET` | `http://localhost:3000/api/import/history` | Purple |
| 3,2 | IMPORT FILE | Website | — | `http://localhost:3001/import` | Purple |
| 3,3 | DIVOOM RFRSH | API Ninja | `POST` | `http://localhost:3000/api/divoom/refresh` | Orange |
| 3,4 | DIVOOM BRT | API Ninja | `POST` | `http://localhost:3000/api/divoom/brightness` | Orange |
| | | | Body: | `{"brightness": 50}` | |
| 3,5 | DEBUG | API Ninja | `GET` | `http://localhost:3000/api/status` | White |

> **Screener buttons** use POST with a JSON body. In API Ninja, set Content-Type to `application/json` and paste the body JSON.

---

## Device 3: StreamDeck+ — Quick Access Panel

8 buttons across the top + 4 rotary dials with integrated touch strip.

### 8 Buttons

```
┌────────┬────────┬────────┬────────┬────────┬────────┬────────┬────────┐
│ STATUS │ACCOUNT │  P&L   │POSITNS │ ORDERS │EXPOSURE│FLATTEN │  LOCK  │
│🟢 green│🔵 blue │🔵 blue │🔵 blue │🟡 ylow │🟣 purp │🔴 red  │🟡 ylow │
└────────┴────────┴────────┴────────┴────────┴────────┴────────┴────────┘
```

| Pos | Label | Type | Method | URL | Color |
|-----|-------|------|--------|-----|-------|
| 1 | STATUS | API Ninja | `GET` | `http://localhost:3000/api/status` | Green |
| 2 | ACCOUNT | API Ninja | `GET` | `http://localhost:3000/api/account/summary` | Blue |
| 3 | P&L | API Ninja | `GET` | `http://localhost:3000/api/account/pnl` | Blue |
| 4 | POSITIONS | API Ninja | `GET` | `http://localhost:3000/api/account/positions` | Blue |
| 5 | ORDERS | API Ninja | `GET` | `http://localhost:3000/api/account/orders` | Yellow |
| 6 | EXPOSURE | API Ninja | `GET` | `http://localhost:3000/api/portfolio/exposure` | Purple |
| 7 | FLATTEN | API Ninja | `POST` | `http://localhost:3000/api/positions/flatten` | Red |
| 8 | LOCK | API Ninja | `POST` | `http://localhost:3000/api/session/lock` | Yellow |

### 4 Rotary Dials

The dials on the StreamDeck+ are best used with the API Ninja dial support or as keyboard macro shortcuts.

```
┌──────────────┬──────────────┬──────────────┬──────────────┐
│   DIAL 1     │   DIAL 2     │   DIAL 3     │   DIAL 4     │
│              │              │              │              │
│  Watchlist   │  Screener    │  Dashboard   │  Brightness  │
│  Cycle       │  Presets     │  Pages       │  Control     │
│              │              │              │              │
│ Rotate: next │ Rotate: next │ Rotate: next │ Rotate: +/-  │
│  symbol      │  screener    │  page        │  brightness  │
│              │              │              │              │
│ Touch: SPY   │ Touch: run   │ Touch: home  │ Touch: 50%   │
│ Press: open  │ Press: scan  │ Press: open  │ Press: reset │
└──────────────┴──────────────┴──────────────┴──────────────┘
```

#### Dial Setup (Keyboard Macro Approach)

Since API Ninja dial support may be limited, an alternative approach uses keyboard macros:

| Dial | Rotate CW | Rotate CCW | Press | Touch |
|------|-----------|------------|-------|-------|
| 1 - Watchlist | Open next symbol quote URL | Open prev symbol quote URL | Open current in dashboard | Show SPY quote |
| 2 - Screener | Cycle: gainers → actives → losers → tech | Cycle backwards | Run current screener | Run default screener |
| 3 - Dashboard | Next dashboard tab (Ctrl+Tab) | Prev tab (Ctrl+Shift+Tab) | Open dashboard home | Refresh page (F5) |
| 4 - Brightness | Increase brightness | Decrease brightness | Set to 50% | Set to max |

> **Note:** Dial rotation functionality requires either API Ninja's dial support or a custom Stream Deck plugin. If your version of API Ninja doesn't support dials, you can use the dials as simple press buttons and map them to the most frequently used actions.

---

## Color Coding Reference

| Color | Meaning | Used For |
|-------|---------|----------|
| 🟢 Green | Status / Health | System status, session state, health checks |
| 🔵 Blue | Data / Read-only | Quotes, positions, P&L, market data |
| 🟡 Yellow | Caution / Orders | Order management, session lock, risk config |
| 🔴 Red | Danger / Emergency | Flatten, cancel all, destructive actions |
| 🟣 Purple | Analytics / Deep | Portfolio analytics, eval, stress test, journal |
| 🟠 Orange | Holly / Screening | Holly analytics, screeners, Divoom |
| ⚪ White | Navigation / Misc | Back buttons, dashboard, reset, debug |

---

## API Ninja Configuration — Step by Step

### For GET Requests (data retrieval buttons)

1. Drag **API Ninja → API Request** onto the button
2. **Title:** Button label (e.g., "STATUS", "SPY")
3. **Request Type:** `GET`
4. **URL:** Full endpoint URL from the mapping table
5. **Headers:** Leave default
6. **Display Response:** Enable — shows JSON response on button press
7. Set background color per the color coding table

### For POST Requests (action buttons)

1. Drag **API Ninja → API Request** onto the button
2. **Title:** Button label (e.g., "FLATTEN", "LOCK")
3. **Request Type:** `POST`
4. **URL:** Full endpoint URL
5. **Content-Type:** `application/json`
6. **Body:** As specified in the mapping table (or leave empty)
7. Set background color (RED for destructive actions)

### For DELETE Requests (cancel buttons)

1. Drag **API Ninja → API Request** onto the button
2. **Title:** "CANCEL ALL"
3. **Request Type:** `DELETE`
4. **URL:** `http://localhost:3000/api/orders/all`
5. Set background to RED

### For Website Actions (dashboard pages)

1. Drag **System → Website** onto the button
2. **URL:** Dashboard page URL (e.g., `http://localhost:3001/holly`)
3. Set title and background color

### For Folder Navigation (MK2 sub-pages)

1. Right-click a button position → **Create Folder**
2. Name the folder (e.g., "Trade Controls")
3. Click into the folder to configure its buttons
4. The back button (top-left) is auto-created

---

## Quick Reference: All Endpoints Used

### GET Endpoints (read-only, safe to press anytime)

| Endpoint | Returns |
|----------|---------|
| `/api/status` | Bridge status, market session, IBKR connection |
| `/api/quote/SPY` | SPY real-time quote (IBKR) or delayed (Yahoo) |
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
| `/api/indicators` | All tracked indicators |
| `/api/collab/messages` | AI collaboration messages |
| `/api/import/history` | Import records |

### POST Endpoints (actions — use with care)

| Endpoint | Action | Body |
|----------|--------|------|
| `/api/positions/flatten` | Flatten all positions | (none) |
| `/api/session/lock` | Lock session | (none) |
| `/api/session/unlock` | Unlock session | (none) |
| `/api/session/reset` | Reset session counters | (none) |
| `/api/screener/run` | Run screener | `{"screenerId": "day_gainers"}` |

### DELETE Endpoints (destructive — use with care)

| Endpoint | Action |
|----------|--------|
| `/api/orders/all` | Cancel ALL open orders |

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Button shows error / no response | Check MDB is running: `curl http://localhost:3000/api/status` |
| IBKR data unavailable | Check TWS is running and connected. Status button will show `ibkr.connected: false` |
| Flatten/Cancel doesn't work | Verify IBKR connection. These require TWS to be connected |
| Dashboard pages don't load | Start frontend: `cd frontend && npm run dev` (port 3001) |
| API Ninja not showing responses | Check URL is correct, ensure Content-Type is set for POST requests |
| Screener returns empty | Some screeners only work during market hours |

---

## Optional Enhancements

### Multi-Action: Full Emergency Sequence

Create a **Multi-Action** that chains: Cancel All Orders → Flatten All Positions → Lock Session

1. Create a new Multi-Action button
2. Add 3 API Ninja requests in sequence:
   - `DELETE http://localhost:3000/api/orders/all`
   - `POST http://localhost:3000/api/positions/flatten`
   - `POST http://localhost:3000/api/session/lock`
3. Set delay between actions to 500ms
4. Assign to a prominent button or pedal

### Open TWS Button

Use **System → Open** action to launch TWS:
- **App/File:** Path to TWS executable (e.g., `C:\Jts\tws.exe` or TWS shortcut)

### Open MDB Bridge Button

Use **System → Open** action:
- **App/File:** Path to `start.bat` (paper) or `start-live.bat` (live)
