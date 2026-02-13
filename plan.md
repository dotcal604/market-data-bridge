# Implementation Plan: Trading Execution + Collab Channel

## Part 1: Enable Trading Execution for ChatGPT

### Problem
The REST API only has read-only IBKR routes. The MCP tools have place_order, place_bracket_order, cancel_order, cancel_all_orders — but the REST API (and OpenAPI spec) doesn't expose them. ChatGPT can't execute trades.

### Changes

**`src/rest/routes.ts`** — Add 4 trading route handlers:
- `POST /api/order` — place single order (MKT/LMT/STP/STP LMT)
- `POST /api/order/bracket` — place bracket order (entry + TP + SL)
- `DELETE /api/order/:orderId` — cancel specific order
- `DELETE /api/orders/all` — cancel all orders

**`src/rest/openapi.ts`** — Add OpenAPI spec entries for all 4 trading endpoints so ChatGPT discovers them via Actions.

**Import** `placeOrder, placeBracketOrder, cancelOrder, cancelAllOrders` from `../ibkr/orders.js` in routes.ts.

---

## Part 2: Collab Channel (AI-to-AI Communication)

### Problem
User wants Claude and ChatGPT to talk to each other without copy-pasting — share analysis, critique code, debate approaches.

### Changes

**New file: `src/collab/store.ts`** — In-memory message store:
- `CollabMessage` interface: id, author, content, timestamp, replyTo, tags
- `readMessages(opts)` — filter by since/author/tag/limit
- `postMessage(input)` — add message with validation
- `clearMessages()` — reset channel
- `getStats()` — message counts by author
- Caps: 200 messages max, 8000 chars per message

**`src/rest/routes.ts`** — Add 4 collab routes:
- `GET /api/collab/messages` — read conversation
- `POST /api/collab/message` — post a message
- `DELETE /api/collab/messages` — clear conversation
- `GET /api/collab/stats` — channel statistics

**`src/mcp/server.ts`** — Add 4 MCP tools:
- `collab_read` — read messages (hardcodes nothing about author)
- `collab_post` — post message (hardcodes author: "claude")
- `collab_clear` — clear channel
- `collab_stats` — get statistics

**`src/rest/openapi.ts`** — Add OpenAPI entries + CollabMessage component schema

---

## Build & Test
- `npm run build`
- Restart REST server + tunnel
- Update ChatGPT GPT schema (Import from URL or manual refresh)
- Test: curl POST /api/order, GET /api/collab/messages
