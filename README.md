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

## Available Tools / Endpoints

The MCP server currently exposes **56 tools** (from `src/mcp/server.ts`). They are grouped below by workflow area.

### Market Data & Discovery

| Tool | REST Endpoint | Description |
|------|--------------|-------------|
| `get_status` | `GET /api/status` | Bridge status, market session, and IBKR connection state |
| `get_quote` | `GET /api/quote/:symbol` | Smart quote (IBKR first, Yahoo fallback) |
| `get_historical_bars` | `GET /api/history/:symbol` | Historical OHLCV bars |
| `get_stock_details` | `GET /api/details/:symbol` | Company fundamentals/metadata snapshot |
| `get_options_chain` | `GET /api/options/:symbol` | Options expirations and chain data |
| `get_option_quote` | `GET /api/options/:symbol/quote` | Single option contract quote |
| `search_symbols` | `GET /api/search?q=...` | Symbol/company search |
| `get_news` | `GET /api/news/:query` | News by symbol/query |
| `get_financials` | `GET /api/financials/:symbol` | Financials + analyst data |
| `get_earnings` | `GET /api/earnings/:symbol` | Earnings history and charts |
| `get_trending` | `GET /api/trending` | Trending symbols by region |
| `get_screener_filters` | `GET /api/screener/filters` | Available screener IDs |
| `run_screener` | `POST /api/screener/run` | Screener run with ranked results |
| `run_screener_with_quotes` | `POST /api/screener/run-with-quotes` | Screener run with full quote payloads |

### Account, Portfolio & Exposure

| Tool | REST Endpoint | Description |
|------|--------------|-------------|
| `get_account_summary` | `GET /api/account/summary` | Account balances, buying power, margin |
| `get_positions` | `GET /api/account/positions` | Current positions |
| `get_pnl` | `GET /api/account/pnl` | Daily/unrealized/realized PnL |
| `stress_test` | `POST /api/portfolio/stress-test` | Shock-based portfolio stress testing |
| `portfolio_exposure` | `GET /api/portfolio/exposure` | Gross/net/beta/sector exposure analytics |
| `get_contract_details` | `GET /api/contract/:symbol` | IBKR contract metadata |
| `get_ibkr_quote` | `GET /api/ibkr/quote/:symbol` | Direct IBKR market data snapshot |

### Orders & Execution Controls

| Tool | REST Endpoint | Description |
|------|--------------|-------------|
| `get_open_orders` | `GET /api/account/orders` | Open orders |
| `get_completed_orders` | `GET /api/account/orders/completed` | Filled/canceled orders |
| `get_executions` | `GET /api/account/executions` | Execution/fill feed |
| `place_order` | `POST /api/order` | Place single order |
| `place_bracket_order` | `POST /api/order/bracket` | Standard bracket order |
| `place_advanced_bracket` | `POST /api/order/bracket-advanced` | Advanced bracket (trailing/OCA/etc.) |
| `cancel_order` | `DELETE /api/order/:orderId` | Cancel one order |
| `cancel_all_orders` | `DELETE /api/orders/all` | Cancel all open orders |
| `flatten_positions` | `POST /api/positions/flatten` | Flatten all positions |
| `flatten_config` | `GET /api/flatten/config`, `POST /api/flatten/enable` | View/update auto-flatten scheduler |

### Collaboration Channel

| Tool | REST Endpoint | Description |
|------|--------------|-------------|
| `collab_read` | `GET /api/collab/messages` | Read AI collaboration messages |
| `collab_post` | `POST /api/collab/message` | Post a channel message |
| `collab_clear` | `DELETE /api/collab/messages` | Clear message history |
| `collab_stats` | `GET /api/collab/stats` | Channel stats by author |

### Session Guardrails & Position Sizing

| Tool | REST Endpoint | Description |
|------|--------------|-------------|
| `session_state` | `GET /api/session` | Session limits, lock/cooldown/loss state |
| `session_record_trade` | `POST /api/session/trade` | Record closed-trade PnL |
| `session_lock` | `POST /api/session/lock` | Manual session lock |
| `session_unlock` | `POST /api/session/unlock` | Unlock session |
| `session_reset` | `POST /api/session/reset` | Reset session counters |
| `size_position` | `POST /api/risk/size-position` | Risk-based position size calculator |

### Journal & Historical Records

| Tool | REST Endpoint | Description |
|------|--------------|-------------|
| `trade_journal_read` | `GET /api/journal`, `GET /api/journal/:id` | Query journal entries |
| `trade_journal_write` | `POST /api/journal`, `PATCH /api/journal/:id` | Create/update journal entries |
| `orders_history` | `GET /api/orders/history` | Query persisted order history |
| `executions_history` | `GET /api/executions/history` | Query persisted execution history |
| `daily_summary` | `MCP only` | Daily trade summaries from DB |

### Eval, Outcomes, Drift & TraderSync (MCP-first)

| Tool | REST Endpoint | Description |
|------|--------------|-------------|
| `eval_stats` | `MCP only` | Evaluation statistics snapshot |
| `simulate_weights` | `MCP only` | Ensemble what-if simulation |
| `weight_history` | `MCP only` | Historical ensemble weight changes |
| `eval_outcomes` | `MCP only` | Eval outcomes and labels |
| `record_outcome` | `MCP only` | Write/attach outcome to eval |
| `eval_reasoning` | `MCP only` | Full model reasoning for eval ID |
| `drift_report` | `MCP only` | Feature/model drift analysis report |
| `tradersync_import` | `MCP only` | Import TraderSync CSV |
| `tradersync_stats` | `MCP only` | TraderSync aggregate stats |
| `tradersync_trades` | `MCP only` | TraderSync imported trade list |

---

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
4. It will import the full REST surface from the generated OpenAPI spec
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
curl "http://localhost:3000/api/history/AAPL?period=5d&interval=5m"

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
