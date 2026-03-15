# Market Data Bridge — Documentation

Welcome to the auto-generated documentation for **Market Data Bridge**.

This site is built automatically from source code and includes:

- **[API Reference](/docs/api/)** — TypeDoc-generated documentation for every module, class, and function in the backend
- **[Architecture](/docs/architecture/)** — System diagrams showing how components interact
- **[UI Previews](/docs/previews/)** — Screenshots of the Next.js frontend dashboard pages

## What is Market Data Bridge?

Market Data Bridge is a TypeScript/Node.js application that serves as an intelligent bridge between AI assistants (Claude, ChatGPT) and financial market data. It provides:

- **56 MCP tools** for Claude Desktop/Code integration
- **REST API** with OpenAPI schema for ChatGPT Actions
- **Interactive Brokers (IBKR)** real-time data and order execution
- **Yahoo Finance** quotes, screeners, and fundamentals
- **3-model ensemble evaluation engine** (Claude, GPT, Gemini)
- **Next.js 16 dashboard** with 26+ pages for monitoring and management
- **Divoom LED display** integration for visual market dashboards

## Quick Links

| Section | Description |
|---------|-------------|
| [MCP Server](docs/api/mcp/server) | 56 tools for AI assistant integration |
| [REST API](docs/api/rest/server) | Express server with OpenAPI spec |
| [IBKR Integration](docs/api/ibkr/connection) | TWS/Gateway connection management |
| [Eval Engine](docs/api/eval/ensemble/scorer) | Multi-model consensus scoring |
| [System Architecture](docs/architecture/) | High-level system diagrams |
