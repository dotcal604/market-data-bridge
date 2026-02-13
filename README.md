# IBKR Market Bridge

Connect Interactive Brokers to ChatGPT, Claude, and other AI assistants.

A TypeScript server that bridges IBKR TWS/Gateway to AI tools via:
- **MCP Server** (stdio) — native Claude Desktop/Code integration
- **REST API** (Express) — ChatGPT custom actions, or any HTTP client

## Prerequisites

- **Node.js 18+**
- **TWS** or **IB Gateway** running with API connections enabled
  - TWS: Edit > Global Configuration > API > Settings > Enable ActiveX and Socket Clients
  - Default ports: TWS `7497` (paper) / `7496` (live), Gateway `4002` (paper) / `4001` (live)

## Quick Start

```bash
npm install
npm run build
cp .env.example .env   # adjust port if needed
```

### Run modes

```bash
# Both MCP + REST (default)
node build/index.js

# REST API only (for ChatGPT)
node build/index.js --mode rest

# MCP server only (for Claude)
node build/index.js --mode mcp
```

The server starts even if TWS isn't running yet — auto-reconnect retries every 5 seconds.

## Available Tools / Endpoints (56 MCP Tools)

The system provides **56 MCP tools** and **47 REST endpoints** across 11 functional categories:

### Market Data & Research (14 tools)

| Tool | REST Endpoint | Description |
|------|--------------|-------------|
| `get_status` | `GET /api/status` | Bridge status, market session, IBKR connection state |
| `get_quote` | `GET /api/quote/:symbol` | Real-time quote (IBKR → Yahoo fallback) |
| `get_historical_bars` | `GET /api/history/:symbol` | Historical OHLCV bars |
| `get_stock_details` | `GET /api/details/:symbol` | Company info, sector, market cap, PE ratio |
| `get_options_chain` | `GET /api/options/:symbol` | Option expirations, strikes, full chain |
| `get_option_quote` | `GET /api/options/:symbol/quote` | Specific option contract quote |
| `search_symbols` | `GET /api/search` | Search stocks/ETFs by name or symbol |
| `get_news` | `GET /api/news/:query` | Recent news articles |
| `get_financials` | `GET /api/financials/:symbol` | Revenue, margins, debt, analyst targets |
| `get_earnings` | `GET /api/earnings/:symbol` | Earnings history, actual vs estimate |
| `get_trending` | `GET /api/trending` | Currently trending symbols |
| `get_screener_filters` | `GET /api/screener/filters` | Available screener IDs |
| `run_screener` | `POST /api/screener/run` | Run stock screener (gainers, losers, etc.) |
| `run_screener_with_quotes` | `POST /api/screener/run-with-quotes` | Screener with full quote data |

### Account & Positions (4 tools)

| Tool | REST Endpoint | Description |
|------|--------------|-------------|
| `get_account_summary` | `GET /api/account/summary` | Net liquidation, cash, buying power, margin |
| `get_positions` | `GET /api/account/positions` | All current positions with P&L |
| `get_pnl` | `GET /api/account/pnl` | Daily profit and loss breakdown |
| `get_ibkr_quote` | `GET /api/ibkr/quote/:symbol` | Direct IBKR real-time quote snapshot |

### Order Management (8 tools)

| Tool | REST Endpoint | Description |
|------|--------------|-------------|
| `get_open_orders` | `GET /api/account/orders` | All open orders across clients |
| `get_completed_orders` | `GET /api/account/orders/completed` | Filled/cancelled order history |
| `get_executions` | `GET /api/account/executions` | Today's executions with commission |
| `place_order` | `POST /api/order` | Single order (MKT, LMT, STP, TRAIL, etc.) |
| `place_bracket_order` | `POST /api/order/bracket` | Simple bracket (entry + TP + SL) |
| `place_advanced_bracket` | `POST /api/order/bracket-advanced` | Advanced bracket with OCA, trailing stops |
| `cancel_order` | `DELETE /api/order/:orderId` | Cancel specific order by ID |
| `cancel_all_orders` | `DELETE /api/orders/all` | Cancel ALL open orders globally |

### Portfolio Analytics (3 tools)

| Tool | REST Endpoint | Description |
|------|--------------|-------------|
| `portfolio_exposure` | `GET /api/portfolio/exposure` | Gross/net exposure, sector breakdown, beta, portfolio heat |
| `stress_test` | `POST /api/portfolio/stress-test` | Portfolio stress test with beta-adjusted shocks |
| `size_position` | `POST /api/risk/size-position` | Calculate safe position size (risk/capital/margin constraints) |

### Flatten & EOD (2 tools)

| Tool | REST Endpoint | Description |
|------|--------------|-------------|
| `flatten_positions` | `POST /api/positions/flatten` | Close all positions immediately with MKT orders |
| `flatten_config` | `GET /api/flatten/config` | Get/set EOD auto-flatten schedule |

### Collaboration Channel (4 tools)

| Tool | REST Endpoint | Description |
|------|--------------|-------------|
| `collab_read` | `GET /api/collab/messages` | Read AI-to-AI collaboration messages |
| `collab_post` | `POST /api/collab/message` | Post message to collaboration channel |
| `collab_clear` | `DELETE /api/collab/messages` | Clear all collaboration messages |
| `collab_stats` | `GET /api/collab/stats` | Collaboration channel statistics |

### Risk & Session Management (5 tools)

| Tool | REST Endpoint | Description |
|------|--------------|-------------|
| `session_state` | `GET /api/session` | Daily P&L, trade count, consecutive losses, cooldown status |
| `session_record_trade` | `POST /api/session/trade` | Record completed trade for session tracking |
| `session_lock` | `POST /api/session/lock` | Manually lock session to prevent new trades |
| `session_unlock` | `POST /api/session/unlock` | Unlock session to resume trading |
| `session_reset` | `POST /api/session/reset` | Reset session state at start of day |

### Eval Engine (8 tools)

| Tool | REST Endpoint | Description |
|------|--------------|-------------|
| `eval_stats` | `GET /api/eval/stats` | Model performance statistics, win rate, accuracy |
| `simulate_weights` | `POST /api/eval/weights/simulate` | Re-score evaluations with custom weights |
| `weight_history` | `GET /api/eval/weights/history` | Audit trail of weight changes |
| `eval_outcomes` | `GET /api/eval/outcomes` | Evaluations with trade outcomes for calibration |
| `record_outcome` | `POST /api/eval/outcome` | Record trade outcome for evaluation |
| `eval_reasoning` | `GET /api/eval/:id/reasoning` | Per-model key drivers and conviction levels |
| `drift_report` | `GET /api/eval/drift-report` | Model calibration drift analysis |
| `daily_summary` | `GET /api/eval/daily-summary` | Daily session summaries with P&L and win rate |

### Trade Journal (2 tools)

| Tool | REST Endpoint | Description |
|------|--------------|-------------|
| `trade_journal_read` | `GET /api/journal` | Query journal entries by symbol or strategy |
| `trade_journal_write` | `POST /api/journal` | Add or update journal entry with tags and outcome |

### History & Reconciliation (2 tools)

| Tool | REST Endpoint | Description |
|------|--------------|-------------|
| `orders_history` | `GET /api/orders/history` | Historical orders from local database |
| `executions_history` | `GET /api/executions/history` | Historical executions from local database |

### TraderSync Integration (3 tools)

| Tool | REST Endpoint | Description |
|------|--------------|-------------|
| `tradersync_import` | `POST /api/eval/tradersync/import` | Import TraderSync CSV trade data |
| `tradersync_stats` | `GET /api/eval/tradersync/stats` | Aggregate stats from imported trades |
| `tradersync_trades` | `GET /api/eval/tradersync/trades` | Query imported TraderSync trades |

### Contract Details (1 tool)

| Tool | REST Endpoint | Description |
|------|--------------|-------------|
| `get_contract_details` | `GET /api/contract/:symbol` | IBKR contract metadata, trading hours, exchanges |

---

## Claude Desktop Setup

Already configured. Restart Claude Desktop and the `ibkr` tools will appear.

Config location: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "ibkr": {
      "command": "node",
      "args": ["C:/Users/dotca/Downloads/Claude Code - Market API/build/index.js", "--mode", "mcp"]
    }
  }
}
```

## Claude Code Setup

Add to your project's `.mcp.json` or use the CLI:

```bash
claude mcp add ibkr -- node "C:/Users/dotca/Downloads/Claude Code - Market API/build/index.js" --mode mcp
```

---

## ChatGPT Setup (via ngrok)

ChatGPT custom actions need a public URL. Use ngrok to tunnel your local REST server:

### 1. Install ngrok

```bash
# Via npm
npm install -g ngrok

# Or download from https://ngrok.com/download
# Free tier works fine (sign up for an auth token)
ngrok config add-authtoken YOUR_TOKEN
```

### 2. Start the bridge + tunnel

```bash
# Terminal 1: Start the REST server
node build/index.js --mode rest

# Terminal 2: Expose it publicly
ngrok http 3000
```

ngrok will give you a URL like `https://abc123.ngrok-free.app`.

### 3. Create a ChatGPT custom GPT

1. Go to [ChatGPT](https://chat.openai.com) > Explore GPTs > Create
2. In the **Configure** tab, scroll to **Actions** > **Create new action**
3. Click **Import from URL** and enter: `https://abc123.ngrok-free.app/openapi.json`
4. It will import all 47 endpoints automatically
5. Set the **Server URL** to your ngrok URL if not auto-detected
6. Save and test

### 4. Example ChatGPT prompts

Once configured, you can ask ChatGPT things like:
- "What's the current price of AAPL?"
- "Show me SPY's last 30 days of price history"
- "What's my account balance and positions?"
- "Get the options chain for TSLA"
- "What's the bid/ask on the AAPL March 2026 220 call?"

> **Note:** The ngrok URL changes every time you restart (unless on a paid plan). You'll need to update the ChatGPT action URL when it changes. For a permanent URL, use ngrok's paid tier or deploy behind Cloudflare Tunnel.

---

## REST API Examples

```bash
# Check connection
curl http://localhost:3000/api/status

# Get AAPL quote
curl http://localhost:3000/api/quote/AAPL

# Get 30 days of daily bars
curl http://localhost:3000/api/history/SPY

# Get 5-minute bars for the last week
curl "http://localhost:3000/api/history/AAPL?duration=1%20W&bar_size=5%20mins"

# Get options chain
curl http://localhost:3000/api/options/AAPL

# Get specific option quote
curl "http://localhost:3000/api/options/AAPL/quote?expiry=20260320&strike=220&right=C"

# Account summary
curl http://localhost:3000/api/account/summary

# Positions
curl http://localhost:3000/api/account/positions

# Search
curl "http://localhost:3000/api/search?q=Apple"
```

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `IBKR_HOST` | `127.0.0.1` | TWS/Gateway host |
| `IBKR_PORT` | `7497` | TWS/Gateway port (7496 for live) |
| `IBKR_CLIENT_ID` | `0` | API client ID |
| `REST_PORT` | `3000` | REST API port |

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `ECONNREFUSED 127.0.0.1:7497` | TWS/Gateway isn't running, or API port is wrong. Check TWS is open and API enabled. |
| Tools return null data | TWS is connected but no market data subscription. Paper account has delayed data. |
| "Connection timed out" | TWS might be blocking the client ID. Try a different `IBKR_CLIENT_ID` in `.env`. |
| MCP tools not showing in Claude | Restart Claude Desktop after editing config. Check path in `claude_desktop_config.json`. |
| ChatGPT can't reach API | ngrok tunnel not running, or URL changed. Re-import the OpenAPI spec with new URL. |

## Testing with MCP Inspector

```bash
npx @modelcontextprotocol/inspector node build/index.js --mode mcp
```
