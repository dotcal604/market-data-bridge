# IBKR Market Bridge — Deployment & Operations Guide

---

## 1. Prerequisites

| Requirement | Minimum | Notes |
|---|---|---|
| **Node.js** | 18.0+ | Verify: `node --version` |
| **npm** | 9.0+ | Ships with Node.js |
| **TWS or IB Gateway** | Latest stable | Download from [IBKR](https://www.interactivebrokers.com/en/trading/tws.php) |
| **IBKR Account** | Any (paper or live) | Paper accounts receive delayed data |
| **ngrok** (optional) | Free tier | Required only for ChatGPT integration |

---

## 2. TWS / IB Gateway Configuration

Before the bridge can connect, TWS (or IB Gateway) must have API access enabled.

### 2.1 Enable API Connections

1. Open TWS and log in
2. Navigate to **Edit** > **Global Configuration** (or **File** > **Global Configuration** on some versions)
3. Select **API** > **Settings**
4. Enable: **"Enable ActiveX and Socket Clients"**
5. Confirm the **Socket port** matches your `.env` configuration:
   - TWS Paper: `7497`
   - TWS Live: `7496`
   - IB Gateway Paper: `4002`
   - IB Gateway Live: `4001`
6. (Recommended) Check: **"Allow connections from localhost only"**
7. (Optional) Uncheck: **"Read-Only API"** — not required since the bridge is read-only by design, but won't cause issues either way
8. Click **Apply** then **OK**

### 2.2 Trusted IP Addresses

If TWS prompts to accept an incoming API connection:
- Accept the connection from `127.0.0.1`
- Check "Allow future connections from this IP" to avoid repeated prompts

---

## 3. Build & Install

```bash
# Clone or copy the project
cd "C:\Users\dotca\Downloads\Claude Code - Market API"

# Install dependencies
npm install

# Compile TypeScript
npm run build
```

The build output goes to `./build/`. The entry point is `build/index.js`.

### Verify Build

```bash
# Should list compiled .js and .d.ts files
ls build/
```

---

## 4. Environment Configuration

Copy the example and edit:

```bash
cp .env.example .env
```

### .env Reference

```ini
# TWS/Gateway connection
IBKR_HOST=127.0.0.1       # localhost unless running TWS remotely
IBKR_PORT=7496             # 7496=TWS live, 7497=TWS paper, 4001=GW live, 4002=GW paper
IBKR_CLIENT_ID=0           # Must be unique across all API connections to this TWS

# REST API
REST_PORT=3000             # Local HTTP port
```

### Port Quick Reference

| Application | Paper | Live |
|---|---|---|
| TWS | 7497 | 7496 |
| IB Gateway | 4002 | 4001 |

---

## 5. Run Modes

The bridge supports three operational modes selected via the `--mode` CLI flag:

| Mode | Command | Interfaces Started | Use Case |
|---|---|---|---|
| `both` (default) | `node build/index.js` | MCP + REST | Development, testing |
| `mcp` | `node build/index.js --mode mcp` | MCP only (stdio) | Claude Desktop/Code |
| `rest` | `node build/index.js --mode rest` | REST only (port 3000) | ChatGPT, curl, scripts |

### npm Script Shortcuts

```bash
npm start              # both mode
npm run start:mcp      # MCP only
npm run start:rest     # REST only
npm run dev            # tsc --watch (development)
```

---

## 6. Claude Desktop Integration

### 6.1 Configuration File

Edit the Claude Desktop config file:

**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`

Add the `mcpServers` key:

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

> **Important:** Use forward slashes in the path, even on Windows. Claude Desktop's MCP host requires this format.

### 6.2 Activation

1. Save the config file
2. Fully quit and relaunch Claude Desktop (not just close the window)
3. The `ibkr` tools should appear in Claude's tool picker (hammer icon)

### 6.3 Verification

Ask Claude: *"Check my IBKR connection status"* — it should invoke `connection_status` and return a JSON response.

---

## 7. Claude Code Integration

```bash
claude mcp add ibkr -- node "C:/Users/dotca/Downloads/Claude Code - Market API/build/index.js" --mode mcp
```

Or add manually to `.mcp.json` in any project:

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

---

## 8. ChatGPT Integration (via ngrok)

ChatGPT custom actions require a publicly reachable URL. The REST API runs on localhost, so a tunnel is needed.

### 8.1 Install ngrok

```bash
npm install -g ngrok
```

Or download from https://ngrok.com/download.

### 8.2 Authenticate ngrok

Sign up at https://dashboard.ngrok.com/signup, then:

```bash
ngrok config add-authtoken YOUR_AUTH_TOKEN
```

### 8.3 Start the Stack

Open two terminals:

**Terminal 1 — Bridge:**
```bash
cd "C:\Users\dotca\Downloads\Claude Code - Market API"
node build/index.js --mode rest
```

**Terminal 2 — Tunnel:**
```bash
ngrok http 3000
```

ngrok will display a public URL like:
```
Forwarding    https://abc123.ngrok-free.app -> http://localhost:3000
```

### 8.4 Create ChatGPT Custom GPT

1. Navigate to https://chatgpt.com/gpts/editor
2. Click **Configure** tab
3. Fill in:
   - **Name:** IBKR Market Data
   - **Description:** Access real-time market data, account info, and options chains from Interactive Brokers.
4. Scroll to **Actions** > **Create new action**
5. Click **Import from URL**
6. Enter: `https://YOUR-NGROK-URL/openapi.json`
7. After import, verify the **Server URL** in the schema reads `https://YOUR-NGROK-URL` (not `localhost:3000`). Edit the schema JSON if needed.
8. Save / Publish (visibility: "Only me" for private use)

### 8.5 URL Rotation (Free Tier)

The ngrok URL changes on every restart. When this happens:

1. Start a new ngrok tunnel
2. Edit the GPT > Actions > Schema
3. Replace the old URL with the new one in the `servers[0].url` field
4. Save

For a persistent URL, consider ngrok's paid plans or alternatives like Cloudflare Tunnel.

---

## 9. Verification Checklist

After deployment, verify each component:

| # | Check | Command / Action | Expected Result |
|---|---|---|---|
| 1 | TWS is running | Look for TWS window | TWS main screen visible, logged in |
| 2 | API port is listening | `netstat -an \| findstr 7496` (Windows) | `LISTENING` state on port |
| 3 | Bridge starts | `node build/index.js --mode rest` | `[IBKR Bridge] Connected to TWS/Gateway` |
| 4 | REST status | `curl http://localhost:3000/api/status` | `{"connected":true,...}` |
| 5 | REST quote | `curl http://localhost:3000/api/quote/AAPL` | Quote JSON with non-null close |
| 6 | ngrok tunnel (if used) | `curl https://YOUR-URL/api/status` | Same as step 4 |
| 7 | Claude MCP | Ask Claude "check connection status" | Tool invoked, JSON returned |
| 8 | ChatGPT actions | Ask GPT "what's the price of AAPL?" | Quote data returned |

---

## 10. Process Management

### Start as Background Process (Windows)

```powershell
Start-Process -NoNewWindow -FilePath "node" -ArgumentList "build/index.js","--mode","rest" -WorkingDirectory "C:\Users\dotca\Downloads\Claude Code - Market API"
```

### Check If Running

```powershell
Get-Process -Name "node" | Where-Object { $_.CommandLine -like "*ibkr*" -or $_.CommandLine -like "*index.js*" }
```

### Stop

```powershell
# Find PID
netstat -ano | findstr :3000

# Kill by PID
Stop-Process -Id <PID> -Force
```

### MCP Inspector (Testing)

```bash
npx @modelcontextprotocol/inspector node build/index.js --mode mcp
```

Opens a browser UI to interactively test all MCP tools.

---

## 11. Operational Notes

| Topic | Detail |
|---|---|
| **Startup order** | TWS should ideally be running before the bridge, but not required. Auto-reconnect handles late TWS starts. |
| **Market hours** | Real-time bid/ask/last data is only available during market hours. Outside hours, these fields will be `null`; `close` will contain the last closing price. |
| **Data subscriptions** | IBKR requires market data subscriptions for real-time quotes. Without subscriptions, you may get delayed data or errors. Paper accounts include delayed data by default. |
| **Rate limits** | TWS imposes a limit of ~50 simultaneous market data requests and ~60 historical data requests per 10 minutes. The bridge does not enforce client-side rate limiting. |
| **Memory** | The bridge holds no persistent state or cache. Memory usage is minimal (~50–80 MB). |
| **Logs** | All diagnostic output goes to `stderr`. REST responses go to `stdout` (or the TCP socket). MCP protocol messages go to `stdout`. |
