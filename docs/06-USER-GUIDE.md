# IBKR Market Bridge — User Guide

*For traders, analysts, and information workers who want to ask AI assistants about their Interactive Brokers portfolio and market data.*

---

## What This Is

IBKR Market Bridge connects your Interactive Brokers account to AI assistants like **ChatGPT** and **Claude**. Once it's running, you can ask questions in plain English and get live answers pulled directly from your brokerage account and real-time market feeds.

**What you can do:**
- Get stock and option prices
- Pull historical price charts
- Check your portfolio positions and balances
- See your daily profit and loss
- Look up option chains (available strikes and expirations)
- Search for ticker symbols

**What it cannot do:**
- Place, modify, or cancel orders
- Change any account settings
- Access banking or funding information
- Stream prices continuously (each question is a fresh snapshot)

The bridge is **read-only by design**. It can look at data but it cannot touch anything.

---

## Before You Start

You need three things running on your computer:

1. **TWS (Trader Workstation)** — open and logged in to your IBKR account
2. **The bridge** — a small background program that someone on your team has already installed
3. **An AI assistant** — either Claude Desktop or a ChatGPT custom GPT that's been configured to talk to the bridge

If the bridge and TWS are already running (check with your tech team), you can skip straight to [Asking Questions](#asking-questions).

---

## Starting Up

### Step 1: Open TWS

Launch Trader Workstation and log in as you normally would. Wait until the main screen loads and you see market data.

### Step 2: Start the Bridge

Open a command prompt or terminal and run:

```
cd "C:\Users\dotca\Downloads\Claude Code - Market API"
node build/index.js --mode rest
```

You should see:
```
[IBKR Bridge] Starting in rest mode...
[IBKR Bridge] Connected to TWS/Gateway
[REST] Server listening on http://localhost:3000
```

> **If you see a warning** about not connecting — that's okay. Make sure TWS is fully loaded and logged in. The bridge retries automatically every few seconds.

Leave this window open. Minimizing it is fine.

### Step 3: Open Your AI Assistant

- **Claude Desktop:** Just open it. If it's been set up for you, the IBKR tools are already available.
- **ChatGPT:** Open the custom GPT named "IBKR Market Data" (or whatever your team named it). If you're using ChatGPT, someone also needs to start the ngrok tunnel — ask your tech team if you're not sure.

---

## Asking Questions

You don't need to learn any special commands. Just ask naturally. The AI figures out which data to pull.

### Stock Prices

> **"What's the current price of Apple?"**

The AI will return the bid, ask, last traded price, today's open/high/low, yesterday's close, and volume.

> **"Give me quotes for AAPL, MSFT, and GOOGL."**

It will look up each one. Some assistants do these in sequence; it takes a few seconds per ticker.

> **"How is SPY trading right now?"**

Works for ETFs exactly the same way.

**After hours note:** Outside of market hours (9:30 AM–4:00 PM ET on weekdays), the bid, ask, and last fields will be empty. You'll still see the closing price from the most recent session.

### Historical Prices

> **"Show me AAPL's price history for the last 30 days."**

Returns daily open/high/low/close/volume bars — similar to what you'd see on a chart.

> **"Get me 5-minute bars for TSLA from the last week."**

You can ask for different time intervals:
- **Bar sizes:** 1 minute, 5 minutes, 15 minutes, 1 hour, 1 day
- **Lookback periods:** days (e.g., "5 days"), weeks ("2 weeks"), months ("6 months"), or years ("1 year")

> **"What was MSFT's price action over the last 3 months in hourly bars?"**

The AI will translate your natural language into the right parameters.

**Tip:** Shorter bar sizes with longer lookback periods generate a lot of data. "1-minute bars for 1 year" would be enormous. Keep it reasonable — daily bars for months, or minute bars for a few days.

### Options

> **"What option expirations are available for AAPL?"**

Returns all available expiration dates and strike prices. This list can be long for popular stocks.

> **"What's the price of the AAPL March 2026 220 call?"**

Returns bid/ask/last for that specific option contract. You need to know (or ask for) the expiration date, strike, and whether it's a call or put.

> **"Show me the options chain for SPY, then get the quote on the closest at-the-money put expiring this Friday."**

You can chain requests. The AI will first pull the chain to find available strikes, then look up the specific contract.

### Account & Portfolio

> **"What's my account balance?"**

Returns your net liquidation value, cash, buying power, margin requirements, and excess liquidity.

> **"What positions do I have?"**

Lists every position — symbol, quantity, and average cost basis. Shows both long and short positions.

> **"How am I doing today?"**

Returns your daily P&L (profit and loss), broken into realized (closed trades) and unrealized (open positions).

> **"What's my buying power and margin usage?"**

The account summary includes both.

### Symbol Lookup

> **"Search for companies with 'solar' in the name."**

Returns matching ticker symbols, their exchanges, and what derivatives are available.

> **"What's the ticker for Berkshire Hathaway?"**

Useful when you know the company name but not the symbol.

> **"Look up contract details for NVDA."**

Returns the full contract specification: exchange, industry classification, minimum tick size, and trading hours.

---

## Understanding the Responses

### Quote Fields Explained

| Field | What It Means |
|---|---|
| **Bid** | The highest price someone is currently willing to pay |
| **Ask** | The lowest price someone is currently willing to sell at |
| **Last** | The most recent trade price |
| **Open** | The first trade of today's session |
| **High** | The highest trade today |
| **Low** | The lowest trade today |
| **Close** | Yesterday's closing price (or the most recent close if the market is shut) |
| **Volume** | Total shares traded today |

**Spread** = Ask minus Bid. A tighter spread generally means more liquid.

### Account Fields Explained

| Field | What It Means |
|---|---|
| **Net Liquidation** | What your account is worth right now if you closed everything |
| **Total Cash Value** | Cash in the account (not invested) |
| **Settled Cash** | Cash that has cleared (available for withdrawal) |
| **Buying Power** | How much you could spend on new positions (accounts for margin) |
| **Gross Position Value** | Total market value of all your holdings |
| **Maintenance Margin** | The minimum equity you must maintain to keep your positions |
| **Excess Liquidity** | How much cushion you have above maintenance margin |
| **Available Funds** | Funds available for new trades |

### P&L Fields Explained

| Field | What It Means |
|---|---|
| **Daily P&L** | Total profit or loss for today (realized + unrealized) |
| **Unrealized P&L** | Gain/loss on positions you still hold (paper profit) |
| **Realized P&L** | Gain/loss on positions you closed today |

---

## Tips and Best Practices

### Be Specific with Symbols

- Use standard ticker symbols: **AAPL**, **MSFT**, **SPY**, **QQQ**
- For options, specify all four parts: underlying, expiration, strike, and call/put
- If you're not sure of a ticker, use the search feature first

### Timing Matters

- **During market hours** (9:30 AM–4:00 PM ET): You get live bid/ask/last/volume
- **Pre-market / after hours**: Most fields will be null; only the previous close is available
- **Weekends and holidays**: Same as after hours — close prices only

### Multiple Questions

You can ask follow-up questions in the same conversation:

> "What's AAPL trading at?"
> *[gets quote]*
> "And what about its options chain?"
> *[gets chain]*
> "Get me the quote on the March 280 call."
> *[gets option quote]*

The AI remembers context within the conversation.

### When Things Say "null"

A `null` value means the data wasn't available at the time of the request. Common reasons:

- Market is closed (bid/ask/last will be null)
- No market data subscription for that exchange
- The symbol doesn't trade on the expected exchange

The `close` field is almost always populated, even after hours.

### Data Freshness

Every response is a **fresh snapshot** from TWS at the moment you ask. There's no caching — if you ask for AAPL twice in a row, it makes two separate requests and may return slightly different prices.

---

## What to Do If Something Goes Wrong

| What Happened | What to Do |
|---|---|
| AI says it can't connect or tools aren't available | Check that the bridge is still running (look for the terminal window). Restart it if needed. |
| All data comes back null | Check that TWS is open and logged in. The bridge may have lost its connection. |
| You get an error about a symbol not found | Double-check the ticker symbol. Use the search feature to find the right one. |
| ChatGPT says it can't reach the server | The ngrok tunnel probably stopped. Ask your tech team to restart it. |
| Claude doesn't show IBKR tools | Claude Desktop may need a restart. Quit fully (File > Quit) and relaunch. |
| Prices seem delayed | Paper trading accounts show 15–20 minute delayed data. This is an IBKR limitation, not a bug. |
| "Request timed out" error | TWS might be overloaded with requests. Wait a few seconds and try again. |
| Historical data request fails | Try a shorter time range or larger bar size. Very granular requests (1-minute bars over months) can hit IBKR's rate limits. |

If issues persist, contact whoever set up the bridge — they can check the technical logs.

---

## Quick Reference Card

| You Want To... | Say Something Like... |
|---|---|
| Get a stock price | "What's AAPL trading at?" |
| Compare prices | "Get me quotes for AAPL, MSFT, and GOOGL" |
| See a price chart | "Show me SPY's last 30 days of prices" |
| Get intraday data | "5-minute bars for TSLA from today" |
| Find option expirations | "What options are available for AAPL?" |
| Price an option | "AAPL March 2026 220 call — what's the bid/ask?" |
| Check your balance | "What's my account summary?" |
| See your positions | "What am I holding right now?" |
| Check today's P&L | "How's my P&L today?" |
| Look up a ticker | "Search for companies with 'energy' in the name" |
| Get contract info | "Tell me about the NVDA contract" |
| Check connection | "Is the IBKR connection working?" |

---

## Glossary

| Term | Definition |
|---|---|
| **TWS** | Trader Workstation — IBKR's desktop trading application |
| **IB Gateway** | A lightweight, headless alternative to TWS (same data, no GUI) |
| **Bridge** | This software — the middleman between TWS and your AI assistant |
| **MCP** | Model Context Protocol — the way Claude connects to external tools |
| **REST API** | The web interface ChatGPT uses to talk to the bridge |
| **ngrok** | A tunneling service that gives the bridge a public web address so ChatGPT can reach it |
| **Snapshot** | A one-time data pull (vs. streaming, which pushes updates continuously) |
| **Net Liquidation** | Your total account value — cash plus the market value of all positions |
| **Buying Power** | How much you can invest, accounting for margin rules |
| **OHLCV** | Open, High, Low, Close, Volume — the standard fields in a price bar |
| **conId** | IBKR's unique numeric identifier for a specific tradable instrument |
| **Bid/Ask Spread** | The gap between the best buy and best sell price; tighter = more liquid |
| **Paper Account** | A simulated IBKR account for practice; uses delayed market data |
