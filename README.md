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

## Real-Time WebSocket Updates

The server includes WebSocket support for live data streaming. Connect to `ws://localhost:3000` and subscribe to channels:

- **`positions`** — Position updates when trades execute
- **`orders`** — Order status changes (Submitted, Filled, Cancelled, etc.)
- **`account`** — Account value updates
- **`executions`** — Execution details as fills occur

### WebSocket Protocol

```javascript
// Connect with API key (if configured)
const ws = new WebSocket('ws://localhost:3000?apiKey=YOUR_API_KEY');

// Subscribe to a channel
ws.send(JSON.stringify({ type: 'subscribe', channel: 'orders' }));

// Receive real-time updates
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.type === 'data') {
    console.log(`[${message.channel}]`, message.data);
  }
};

// Unsubscribe
ws.send(JSON.stringify({ type: 'unsubscribe', channel: 'orders' }));

// Heartbeat
ws.send(JSON.stringify({ type: 'ping' })); // Server responds with pong
```

The frontend dashboard uses WebSocket by default and falls back to polling if the connection is lost (auto-reconnect with exponential backoff).

## Available Tools / Endpoints

| Tool | REST Endpoint | Description |
|------|--------------|-------------|
| `get_quote` | `GET /api/quote/:symbol` | Real-time bid/ask/last/volume |
| `get_historical_bars` | `GET /api/history/:symbol` | OHLCV bars |
| `get_contract_details` | `GET /api/contract/:symbol` | Contract info |
| `get_options_chain` | `GET /api/options/:symbol` | Expirations & strikes |
| `get_option_quote` | `GET /api/options/:symbol/quote` | Option contract quote |
| `get_account_summary` | `GET /api/account/summary` | Net liq, cash, margin |
| `get_positions` | `GET /api/account/positions` | All positions |
| `get_pnl` | `GET /api/account/pnl` | Daily P&L |
| `search_contracts` | `GET /api/search?q=...` | Search by name/symbol |
| `connection_status` | `GET /api/status` | Check TWS connection |

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
4. It will import all 10 endpoints automatically
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
