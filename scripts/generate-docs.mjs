#!/usr/bin/env node
/**
 * generate-docs.mjs — Zero-dependency docs site generator for Market Data Bridge.
 *
 * Produces a static docs site in docs-site/ from:
 *   1. MCP tool definitions extracted from src/mcp/server.ts
 *   2. OpenAPI spec (openapi-chatgpt.json) rendered via Redoc CDN
 *   3. Guide pages from docs/01-*.md through docs/06-*.md
 *   4. Architecture diagram (architecture-diagram.html)
 *   5. Landing page with navigation
 *
 * Usage: node scripts/generate-docs.mjs
 * No dependencies beyond Node.js built-ins.
 */

import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT = join(ROOT, "docs-site");

// ── Helpers ──────────────────────────────────────────────────────

function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}

/** Minimal markdown-to-HTML: handles headers, tables, code blocks, bold, links, lists. */
function mdToHtml(md) {
  let html = "";
  const lines = md.split("\n");
  let inCodeBlock = false;
  let codeBlockLang = "";
  let codeLines = [];
  let inTable = false;
  let tableRows = [];
  let inList = false;
  let listType = "ul"; // ul or ol

  function flushList() {
    if (inList) {
      html += `</${listType}>\n`;
      inList = false;
    }
  }

  function flushTable() {
    if (inTable && tableRows.length > 0) {
      html += `<div class="table-wrap"><table>\n<thead><tr>`;
      const headerCells = tableRows[0];
      for (const cell of headerCells) {
        html += `<th>${inlineFormat(cell.trim())}</th>`;
      }
      html += `</tr></thead>\n<tbody>\n`;
      // Skip separator row (index 1), render data rows
      for (let i = 2; i < tableRows.length; i++) {
        html += `<tr>`;
        for (const cell of tableRows[i]) {
          html += `<td>${inlineFormat(cell.trim())}</td>`;
        }
        html += `</tr>\n`;
      }
      html += `</tbody></table></div>\n`;
      tableRows = [];
      inTable = false;
    }
  }

  function inlineFormat(text) {
    // Code spans
    text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
    // Bold
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // Italic
    text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    // Links
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
    return text;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Code blocks
    if (line.startsWith("```")) {
      if (!inCodeBlock) {
        flushList();
        flushTable();
        inCodeBlock = true;
        codeBlockLang = line.slice(3).trim();
        codeLines = [];
      } else {
        html += `<pre><code class="language-${codeBlockLang}">${codeLines.join("\n").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</code></pre>\n`;
        inCodeBlock = false;
      }
      continue;
    }
    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    // Table rows
    if (line.match(/^\|(.+)\|$/)) {
      flushList();
      if (!inTable) inTable = true;
      const cells = line.split("|").slice(1, -1);
      // Skip separator rows (---|---)
      if (cells.every(c => c.trim().match(/^[-:]+$/))) {
        tableRows.push(cells); // Keep as placeholder for header/body split
      } else {
        tableRows.push(cells);
      }
      continue;
    } else {
      flushTable();
    }

    // Headers
    const headerMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headerMatch) {
      flushList();
      const level = headerMatch[1].length;
      const text = inlineFormat(headerMatch[2]);
      const id = headerMatch[2].toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      html += `<h${level} id="${id}">${text}</h${level}>\n`;
      continue;
    }

    // Unordered list items
    if (line.match(/^[\s]*[-*]\s+/)) {
      flushTable();
      if (!inList) {
        inList = true;
        listType = "ul";
        html += `<ul>\n`;
      }
      const content = line.replace(/^[\s]*[-*]\s+/, "");
      html += `<li>${inlineFormat(content)}</li>\n`;
      continue;
    }

    // Ordered list items
    if (line.match(/^[\s]*\d+\.\s+/)) {
      flushTable();
      if (!inList) {
        inList = true;
        listType = "ol";
        html += `<ol>\n`;
      }
      const content = line.replace(/^[\s]*\d+\.\s+/, "");
      html += `<li>${inlineFormat(content)}</li>\n`;
      continue;
    }

    // End of list
    if (inList && line.trim() === "") {
      flushList();
      continue;
    }

    // Horizontal rules
    if (line.match(/^---+$/)) {
      flushList();
      html += `<hr>\n`;
      continue;
    }

    // Blank lines
    if (line.trim() === "") {
      flushList();
      continue;
    }

    // Paragraphs
    flushList();
    html += `<p>${inlineFormat(line)}</p>\n`;
  }

  flushList();
  flushTable();
  if (inCodeBlock) {
    html += `<pre><code>${codeLines.join("\n").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</code></pre>\n`;
  }

  return html;
}

/** Strip Mintlify/MDX frontmatter and component tags */
function stripMdx(content) {
  // Remove YAML frontmatter
  content = content.replace(/^---[\s\S]*?---\n*/, "");
  // Remove MDX component tags like <CardGroup>, <Card>, <Warning>, etc.
  content = content.replace(/<(CardGroup|Card|Warning|Tip|Note|Info|Accordion|AccordionGroup)[^>]*>/g, "");
  content = content.replace(/<\/(CardGroup|Card|Warning|Tip|Note|Info|Accordion|AccordionGroup)>/g, "");
  return content;
}

// ── HTML Template ────────────────────────────────────────────────

function htmlPage(title, content, { activeNav = "", breadcrumb = "" } = {}) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title} — Market Data Bridge</title>
<link rel="stylesheet" href="/market-data-bridge/style.css">
</head>
<body>
<nav class="topnav">
  <a href="/market-data-bridge/" class="logo">Market Data Bridge</a>
  <div class="nav-links">
    <a href="/market-data-bridge/guide/overview.html"${activeNav === "guide" ? ' class="active"' : ""}>Guide</a>
    <a href="/market-data-bridge/api/"${activeNav === "api" ? ' class="active"' : ""}>REST API</a>
    <a href="/market-data-bridge/mcp/"${activeNav === "mcp" ? ' class="active"' : ""}>MCP Tools</a>
    <a href="/market-data-bridge/architecture/"${activeNav === "arch" ? ' class="active"' : ""}>Architecture</a>
  </div>
</nav>
<main>
${breadcrumb ? `<div class="breadcrumb">${breadcrumb}</div>` : ""}
${content}
</main>
<footer>
  <p>Market Data Bridge docs — auto-generated from source. <a href="https://github.com/dotcal604/market-data-bridge">GitHub</a></p>
</footer>
</body>
</html>`;
}

// ── 1. Extract MCP tools from source ─────────────────────────────

function extractMcpTools() {
  const src = readFileSync(join(ROOT, "src/mcp/server.ts"), "utf8");
  const tools = [];

  // Match server.tool( "name", "description", { schema }, handler )
  // The pattern handles multi-line calls.
  // We find each server.tool( call and extract name + description + schema block.
  const toolCallRegex = /server\.tool\(\s*\n?\s*"([^"]+)",\s*\n?\s*"([^"]+)",\s*\n?\s*(\{[\s\S]*?\}),\s*\n/g;

  // Simpler approach: find all server.tool( lines and extract name + description
  // Then look for schema block between description and handler
  const lines = src.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // Match: server.tool(
    if (line.trim().startsWith("server.tool(")) {
      const tool = { name: "", description: "", params: [] };

      // Look for the name (first string arg)
      // Could be on same line or next line
      let searchBlock = "";
      for (let j = i; j < Math.min(i + 5, lines.length); j++) {
        searchBlock += lines[j] + "\n";
      }

      const nameMatch = searchBlock.match(/server\.tool\(\s*\n?\s*"([^"]+)"/);
      if (!nameMatch) { i++; continue; }
      tool.name = nameMatch[1];

      // Find description (second string arg)
      const descMatch = searchBlock.match(/server\.tool\(\s*\n?\s*"[^"]+",\s*\n?\s*"([^"]+)"/);
      if (descMatch) {
        tool.description = descMatch[1];
      }

      // Find schema block — look for z.* parameter definitions
      // Scan forward from tool call to find parameter definitions
      let schemaStart = -1;
      let braceDepth = 0;
      let foundSchema = false;

      for (let j = i; j < Math.min(i + 50, lines.length); j++) {
        const l = lines[j];

        // Look for parameter definitions like: symbol: z.string()...
        const paramMatch = l.match(/^\s+(\w+):\s*z\.(string|number|boolean|enum|object|array|any)/);
        if (paramMatch && !foundSchema) {
          foundSchema = true;
        }

        if (foundSchema && paramMatch) {
          const paramName = paramMatch[1];
          const paramType = paramMatch[2];
          let isOptional = l.includes(".optional()");
          let description = "";

          // Extract .describe("...")
          const describeMatch = l.match(/\.describe\(\s*['"]([^'"]+)['"]\s*\)/);
          if (!describeMatch) {
            // Multi-line describe — check next few lines
            let descBlock = l;
            for (let k = j + 1; k < Math.min(j + 5, lines.length); k++) {
              descBlock += " " + lines[k].trim();
              if (lines[k].includes(")")) break;
            }
            const multiDescMatch = descBlock.match(/\.describe\(\s*['"]([^'"]+)['"]/);
            if (multiDescMatch) description = multiDescMatch[1];
            // Check for optional in extended block
            if (descBlock.includes(".optional()")) isOptional = true;
          } else {
            description = describeMatch[1];
          }

          // Check for .default()
          const defaultMatch = l.match(/\.default\(([^)]+)\)/);
          let defaultVal = defaultMatch ? defaultMatch[1].replace(/['"]/g, "") : undefined;

          // Check for enum values
          const enumMatch = l.match(/z\.enum\(\[([^\]]+)\]\)/);
          let enumVals = enumMatch ? enumMatch[1].replace(/['"]/g, "").split(/,\s*/) : undefined;

          tool.params.push({
            name: paramName,
            type: paramType === "enum" ? "string" : paramType,
            required: !isOptional,
            description,
            default: defaultVal,
            enum: enumVals,
          });
        }

        // Detect handler function (async (...) =>) meaning schema is done
        if (foundSchema && (l.match(/^\s+async\s*\(/) || l.match(/^\s+withErrorHandling/))) {
          break;
        }
        // Also detect closing of schema block + handler on same line patterns
        if (foundSchema && l.match(/^\s*\},\s*\n?\s*(async|withError)/)) {
          break;
        }
      }

      tools.push(tool);
    }
    i++;
  }

  return tools;
}

/** Categorize MCP tools by prefix/function */
function categorizeTool(name) {
  if (name === "get_status" || name === "debug_runtime") return "System";
  if (name.startsWith("get_quote") || name.startsWith("get_historical") ||
      name.startsWith("get_stock") || name.startsWith("get_options") ||
      name.startsWith("get_option_") || name.startsWith("search_symbols") ||
      name.startsWith("get_news") || name.startsWith("get_financials") ||
      name.startsWith("get_earnings") || name.startsWith("get_recommend") ||
      name.startsWith("get_trending") || name.startsWith("get_screener") ||
      name.startsWith("run_screener")) return "Market Data";
  if (name.startsWith("get_ibkr") || name.startsWith("get_contract") ||
      name.startsWith("search_ibkr") || name.startsWith("set_market_data") ||
      name.startsWith("set_auto_open") || name.startsWith("get_head_timestamp") ||
      name.startsWith("get_histogram") || name.startsWith("calculate_") ||
      name.startsWith("get_tws") || name.startsWith("get_market_rule") ||
      name.startsWith("get_smart") || name.startsWith("get_depth") ||
      name.startsWith("get_fundamental") || name.startsWith("req_news") ||
      name.startsWith("get_historical_ticks")) return "IBKR Market Data";
  if (name.startsWith("get_account") || name.startsWith("get_positions") ||
      name.startsWith("get_pnl")) return "Account";
  if (name.startsWith("place_") || name.startsWith("modify_") ||
      name.startsWith("cancel_") || name.startsWith("flatten_") ||
      name.startsWith("get_open_orders") || name.startsWith("get_completed") ||
      name.startsWith("get_executions")) return "Orders";
  if (name.startsWith("portfolio_") || name.startsWith("stress_") ||
      name.startsWith("size_position")) return "Portfolio & Risk";
  if (name.startsWith("session_") || name.startsWith("get_session") ||
      name.startsWith("get_risk") || name.startsWith("update_risk") ||
      name.startsWith("tune_risk")) return "Session & Risk Gate";
  if (name.startsWith("eval_") || name.startsWith("record_outcome") ||
      name.startsWith("simulate_weights") || name.startsWith("weight_") ||
      name.startsWith("drift_") || name.startsWith("edge_") ||
      name.startsWith("walk_forward") || name.startsWith("multi_model") ||
      name.startsWith("recalibration")) return "Evaluation Engine";
  if (name.startsWith("holly_") || name.startsWith("signal_") ||
      name.startsWith("auto_eval") || name.startsWith("auto_link") ||
      name.startsWith("trailing_stop")) return "Holly & Signals";
  if (name.startsWith("exit_plan")) return "Exit Plans";
  if (name.startsWith("collab_")) return "Collaboration";
  if (name.startsWith("subscribe_") || name.startsWith("unsubscribe_") ||
      name.startsWith("get_real_time") || name.startsWith("get_scanner") ||
      name.startsWith("list_subscriptions")) return "Subscriptions & Streaming";
  if (name.startsWith("journal_") || name.startsWith("trade_journal") ||
      name.startsWith("orders_history") || name.startsWith("executions_history") ||
      name.startsWith("tradersync_") || name.startsWith("daily_summary")) return "Journal & History";
  if (name.startsWith("inbox_") || name.startsWith("check_inbox") ||
      name.startsWith("mark_inbox") || name.startsWith("clear_inbox")) return "Inbox";
  if (name.startsWith("import_")) return "Import";
  if (name.startsWith("divoom_")) return "Divoom";
  if (name.startsWith("ops_")) return "Operations";
  if (name.startsWith("get_flatten") || name.startsWith("set_flatten")) return "Scheduler";
  if (name.startsWith("indicator_") || name.startsWith("get_indicator")) return "Indicators";
  if (name.startsWith("volatility_")) return "Volatility";
  if (name.startsWith("suggest_exit") || name.startsWith("optimal_exit") ||
      name.startsWith("exit_params") || name.startsWith("strategy_exit")) return "Exit Optimization";
  return "Other";
}

function generateMcpPage(tools) {
  // Group by category
  const categories = {};
  for (const tool of tools) {
    const cat = categorizeTool(tool.name);
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(tool);
  }

  // Sort categories by a logical order
  const categoryOrder = [
    "System", "Market Data", "IBKR Market Data", "Account", "Orders",
    "Portfolio & Risk", "Session & Risk Gate", "Evaluation Engine",
    "Holly & Signals", "Exit Plans", "Exit Optimization",
    "Subscriptions & Streaming", "Journal & History", "Collaboration",
    "Inbox", "Import", "Indicators", "Volatility", "Scheduler",
    "Operations", "Divoom", "Other",
  ];

  let content = `<h1>MCP Tool Reference</h1>
<p class="subtitle">Auto-generated from <code>src/mcp/server.ts</code> — ${tools.length} tools across ${Object.keys(categories).length} categories.</p>
<p class="note">These tools are available via the Model Context Protocol for Claude Code and Claude Desktop.</p>\n`;

  // Table of contents
  content += `<div class="toc"><h2>Categories</h2><ul>\n`;
  for (const cat of categoryOrder) {
    if (!categories[cat]) continue;
    const id = cat.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    content += `<li><a href="#${id}">${cat}</a> <span class="count">(${categories[cat].length})</span></li>\n`;
  }
  content += `</ul></div>\n`;

  // Each category
  for (const cat of categoryOrder) {
    if (!categories[cat]) continue;
    const id = cat.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    content += `<h2 id="${id}">${cat}</h2>\n`;

    for (const tool of categories[cat]) {
      content += `<div class="tool-card">
<h3 id="tool-${tool.name}"><code>${tool.name}</code></h3>
<p>${escapeHtml(tool.description)}</p>\n`;

      if (tool.params.length > 0) {
        content += `<div class="params"><h4>Parameters</h4>
<div class="table-wrap"><table>
<thead><tr><th>Name</th><th>Type</th><th>Required</th><th>Description</th></tr></thead>
<tbody>\n`;
        for (const p of tool.params) {
          const reqBadge = p.required
            ? '<span class="badge required">required</span>'
            : '<span class="badge optional">optional</span>';
          let desc = escapeHtml(p.description);
          if (p.default) desc += ` <em>(default: ${escapeHtml(p.default)})</em>`;
          if (p.enum) desc += ` <br>Values: ${p.enum.map(v => `<code>${escapeHtml(v)}</code>`).join(", ")}`;
          content += `<tr><td><code>${p.name}</code></td><td>${p.type}</td><td>${reqBadge}</td><td>${desc}</td></tr>\n`;
        }
        content += `</tbody></table></div></div>\n`;
      } else {
        content += `<p class="no-params">No parameters</p>\n`;
      }

      content += `</div>\n`;
    }
  }

  return content;
}

function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ── 2. Generate Redoc API page ───────────────────────────────────

function generateApiPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>REST API Reference — Market Data Bridge</title>
<link rel="stylesheet" href="/market-data-bridge/style.css">
<style>
  /* Override Redoc container to fit within our layout */
  main { padding: 0; max-width: 100%; }
  .redoc-wrap { margin-top: 0; }
  nav.topnav + main { padding-top: 0; }
</style>
</head>
<body>
<nav class="topnav">
  <a href="/market-data-bridge/" class="logo">Market Data Bridge</a>
  <div class="nav-links">
    <a href="/market-data-bridge/guide/overview.html">Guide</a>
    <a href="/market-data-bridge/api/" class="active">REST API</a>
    <a href="/market-data-bridge/mcp/">MCP Tools</a>
    <a href="/market-data-bridge/architecture/">Architecture</a>
  </div>
</nav>
<main>
  <redoc spec-url="/market-data-bridge/openapi.json"
         hide-download-button
         theme='{
           "colors": { "primary": { "main": "#10b981" } },
           "typography": { "fontFamily": "system-ui, -apple-system, sans-serif" },
           "sidebar": { "backgroundColor": "#0f172a", "textColor": "#e2e8f0" },
           "rightPanel": { "backgroundColor": "#1e293b" }
         }'></redoc>
  <script src="https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js"></script>
</main>
</body>
</html>`;
}

// ── 3. Generate architecture page ────────────────────────────────

function generateArchPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Architecture — Market Data Bridge</title>
<link rel="stylesheet" href="/market-data-bridge/style.css">
<style>
  main { padding: 0; max-width: 100%; }
  iframe { width: 100%; height: calc(100vh - 60px); border: none; }
</style>
</head>
<body>
<nav class="topnav">
  <a href="/market-data-bridge/" class="logo">Market Data Bridge</a>
  <div class="nav-links">
    <a href="/market-data-bridge/guide/overview.html">Guide</a>
    <a href="/market-data-bridge/api/">REST API</a>
    <a href="/market-data-bridge/mcp/">MCP Tools</a>
    <a href="/market-data-bridge/architecture/" class="active">Architecture</a>
  </div>
</nav>
<main>
  <iframe src="/market-data-bridge/architecture/diagram.html" title="Architecture Diagram"></iframe>
</main>
</body>
</html>`;
}

// ── 4. Generate landing page ─────────────────────────────────────

function generateLandingPage(toolCount) {
  return `<div class="hero">
  <h1>Market Data Bridge</h1>
  <p class="hero-sub">IBKR trading bridge with MCP + REST interfaces, 3-model AI ensemble, and real-time dashboard.</p>
</div>

<div class="cards">
  <a href="/market-data-bridge/guide/overview.html" class="card">
    <h3>Guide</h3>
    <p>Project overview, architecture, deployment, runbook, and user guide.</p>
  </a>
  <a href="/market-data-bridge/api/" class="card">
    <h3>REST API</h3>
    <p>Interactive API reference with 135 agent actions. Powered by OpenAPI + Redoc.</p>
  </a>
  <a href="/market-data-bridge/mcp/" class="card">
    <h3>MCP Tools</h3>
    <p>${toolCount} tools for Claude Code and Claude Desktop. Auto-generated from source.</p>
  </a>
  <a href="/market-data-bridge/architecture/" class="card">
    <h3>Architecture</h3>
    <p>Interactive system diagram showing all components and data flows.</p>
  </a>
</div>

<div class="quick-start">
  <h2>Quick start</h2>
  <pre><code>git clone https://github.com/dotcal604/market-data-bridge.git
cd market-data-bridge
cp .env.example .env     # configure TWS host/port
npm install
npm run build
npm start                # REST + MCP + WebSocket</code></pre>
</div>

<div class="source-info">
  <h2>About these docs</h2>
  <p>This site is auto-generated from the Market Data Bridge source code. MCP tool documentation is extracted directly from <code>src/mcp/server.ts</code> tool registrations. REST API docs are rendered from the OpenAPI spec generated by <code>src/rest/openapi-gen.ts</code>.</p>
  <p>To regenerate: <code>npm run docs:generate</code></p>
</div>`;
}

// ── 5. CSS ───────────────────────────────────────────────────────

function generateCSS() {
  return `/* Market Data Bridge — docs site styles */
* { margin: 0; padding: 0; box-sizing: border-box; }

:root {
  --bg: #0a0e17;
  --bg-surface: #111827;
  --bg-card: #1e293b;
  --text: #e2e8f0;
  --text-muted: #94a3b8;
  --accent: #10b981;
  --accent-light: #34d399;
  --border: #1e293b;
  --code-bg: #0f172a;
}

body {
  background: var(--bg);
  color: var(--text);
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
  line-height: 1.6;
  min-height: 100vh;
}

/* Navigation */
.topnav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  height: 56px;
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
  z-index: 100;
}
.topnav .logo {
  font-weight: 700;
  font-size: 1.1rem;
  color: var(--accent);
  text-decoration: none;
}
.nav-links { display: flex; gap: 4px; }
.nav-links a {
  color: var(--text-muted);
  text-decoration: none;
  padding: 6px 14px;
  border-radius: 6px;
  font-size: 0.9rem;
  transition: background 0.15s, color 0.15s;
}
.nav-links a:hover { background: var(--bg-card); color: var(--text); }
.nav-links a.active { background: var(--bg-card); color: var(--accent); }

/* Main content */
main {
  max-width: 960px;
  margin: 0 auto;
  padding: 40px 24px;
}

/* Landing page */
.hero {
  text-align: center;
  padding: 60px 0 40px;
}
.hero h1 {
  font-size: 2.5rem;
  font-weight: 800;
  background: linear-gradient(135deg, var(--accent), var(--accent-light));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}
.hero-sub {
  color: var(--text-muted);
  font-size: 1.15rem;
  margin-top: 12px;
  max-width: 600px;
  margin-left: auto;
  margin-right: auto;
}

.cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 16px;
  margin: 32px 0;
}
.card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 24px;
  text-decoration: none;
  color: var(--text);
  transition: border-color 0.2s, transform 0.15s;
}
.card:hover { border-color: var(--accent); transform: translateY(-2px); }
.card h3 { color: var(--accent); margin-bottom: 8px; }
.card p { color: var(--text-muted); font-size: 0.9rem; }

.quick-start, .source-info {
  margin: 40px 0;
}
.quick-start h2, .source-info h2 {
  font-size: 1.3rem;
  margin-bottom: 12px;
}
.source-info p { color: var(--text-muted); margin-bottom: 8px; }

/* Content pages */
h1 { font-size: 2rem; margin-bottom: 16px; }
h2 { font-size: 1.5rem; margin-top: 40px; margin-bottom: 12px; border-bottom: 1px solid var(--border); padding-bottom: 8px; }
h3 { font-size: 1.2rem; margin-top: 24px; margin-bottom: 8px; }
h4 { font-size: 1rem; margin-top: 16px; margin-bottom: 4px; color: var(--text-muted); }
p { margin-bottom: 12px; }
a { color: var(--accent); }

code {
  background: var(--code-bg);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.88em;
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
}
pre {
  background: var(--code-bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 16px;
  overflow-x: auto;
  margin: 12px 0;
}
pre code { background: none; padding: 0; }

/* Tables */
.table-wrap { overflow-x: auto; margin: 12px 0; }
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
}
th, td {
  padding: 8px 12px;
  text-align: left;
  border-bottom: 1px solid var(--border);
}
th { background: var(--bg-surface); color: var(--text-muted); font-weight: 600; }
tr:hover { background: var(--bg-surface); }

/* MCP tool cards */
.tool-card {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 20px;
  margin: 16px 0;
}
.tool-card h3 { margin-top: 0; color: var(--accent-light); }
.tool-card h3 code { font-size: 1.05rem; background: none; color: var(--accent-light); }
.no-params { color: var(--text-muted); font-style: italic; font-size: 0.9rem; }

/* Badges */
.badge {
  font-size: 0.75rem;
  padding: 2px 8px;
  border-radius: 4px;
  font-weight: 600;
  text-transform: uppercase;
}
.badge.required { background: #7c3aed33; color: #a78bfa; }
.badge.optional { background: #06b6d433; color: #67e8f9; }

/* TOC */
.toc {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 20px;
  margin-bottom: 32px;
}
.toc h2 { margin-top: 0; border: none; padding: 0; font-size: 1.1rem; }
.toc ul { list-style: none; display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 4px; }
.toc li a { text-decoration: none; }
.toc .count { color: var(--text-muted); font-size: 0.85rem; }

/* Subtitle and notes */
.subtitle { color: var(--text-muted); margin-bottom: 8px; }
.note {
  background: #10b98115;
  border-left: 3px solid var(--accent);
  padding: 12px 16px;
  border-radius: 0 6px 6px 0;
  margin-bottom: 24px;
  color: var(--text-muted);
}

/* Breadcrumb */
.breadcrumb {
  color: var(--text-muted);
  font-size: 0.85rem;
  margin-bottom: 24px;
}
.breadcrumb a { color: var(--accent); text-decoration: none; }

/* Guide sidebar nav */
.guide-nav {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 16px;
  margin-bottom: 24px;
}
.guide-nav ul { list-style: none; display: flex; flex-wrap: wrap; gap: 8px; }
.guide-nav a {
  display: block;
  padding: 6px 12px;
  border-radius: 6px;
  text-decoration: none;
  font-size: 0.85rem;
  color: var(--text-muted);
  background: var(--bg-card);
}
.guide-nav a:hover, .guide-nav a.active { color: var(--accent); background: var(--bg); }

/* Lists */
ul, ol { margin: 8px 0 12px 24px; }
li { margin-bottom: 4px; }

hr { border: none; border-top: 1px solid var(--border); margin: 24px 0; }

/* Footer */
footer {
  text-align: center;
  padding: 32px 24px;
  color: var(--text-muted);
  font-size: 0.85rem;
  border-top: 1px solid var(--border);
  margin-top: 60px;
}

/* Responsive */
@media (max-width: 640px) {
  .topnav { padding: 0 12px; }
  .nav-links a { padding: 6px 8px; font-size: 0.8rem; }
  main { padding: 20px 12px; }
  .hero h1 { font-size: 1.8rem; }
  .cards { grid-template-columns: 1fr; }
}
`;
}

// ── Main ─────────────────────────────────────────────────────────

function main() {
  console.log("Generating docs site...\n");

  // Clean and create output directory
  ensureDir(OUT);
  ensureDir(join(OUT, "api"));
  ensureDir(join(OUT, "mcp"));
  ensureDir(join(OUT, "guide"));
  ensureDir(join(OUT, "architecture"));

  // 1. Extract MCP tools
  console.log("1. Extracting MCP tools from src/mcp/server.ts...");
  const tools = extractMcpTools();
  console.log(`   Found ${tools.length} tools`);
  const mcpContent = generateMcpPage(tools);
  writeFileSync(
    join(OUT, "mcp/index.html"),
    htmlPage("MCP Tool Reference", mcpContent, { activeNav: "mcp" })
  );

  // 2. Copy OpenAPI spec
  console.log("2. Copying OpenAPI spec...");
  const openapiSrc = join(ROOT, "openapi-chatgpt.json");
  if (existsSync(openapiSrc)) {
    copyFileSync(openapiSrc, join(OUT, "openapi.json"));
  } else {
    console.warn("   WARNING: openapi-chatgpt.json not found");
  }

  // 3. Generate Redoc API page
  console.log("3. Generating REST API page (Redoc)...");
  writeFileSync(join(OUT, "api/index.html"), generateApiPage());

  // 4. Convert guide pages from markdown
  console.log("4. Converting guide pages...");
  const guidePages = [
    { src: "docs/01-PROJECT-OVERVIEW.md", out: "overview.html", title: "Project Overview" },
    { src: "docs/02-ARCHITECTURE.md", out: "architecture.html", title: "Architecture" },
    { src: "docs/03-API-REFERENCE.md", out: "api-reference.html", title: "API Reference" },
    { src: "docs/04-DEPLOYMENT-GUIDE.md", out: "deployment.html", title: "Deployment Guide" },
    { src: "docs/05-RUNBOOK.md", out: "runbook.html", title: "Runbook" },
    { src: "docs/06-USER-GUIDE.md", out: "user-guide.html", title: "User Guide" },
  ];

  const guideNav = `<div class="guide-nav"><ul>
${guidePages.map(p => `<li><a href="/market-data-bridge/guide/${p.out}">${p.title}</a></li>`).join("\n")}
</ul></div>`;

  for (const page of guidePages) {
    const srcPath = join(ROOT, page.src);
    if (!existsSync(srcPath)) {
      console.warn(`   WARNING: ${page.src} not found, skipping`);
      continue;
    }
    const md = readFileSync(srcPath, "utf8");
    const html = mdToHtml(stripMdx(md));
    const breadcrumb = `<a href="/market-data-bridge/">Home</a> / <a href="/market-data-bridge/guide/overview.html">Guide</a> / ${page.title}`;
    writeFileSync(
      join(OUT, "guide", page.out),
      htmlPage(page.title, guideNav + html, { activeNav: "guide", breadcrumb })
    );
    console.log(`   ${page.src} -> guide/${page.out}`);
  }

  // 5. Architecture diagram
  console.log("5. Embedding architecture diagram...");
  const archSrc = join(ROOT, "architecture-diagram.html");
  if (existsSync(archSrc)) {
    copyFileSync(archSrc, join(OUT, "architecture/diagram.html"));
    writeFileSync(join(OUT, "architecture/index.html"), generateArchPage());
  } else {
    console.warn("   WARNING: architecture-diagram.html not found");
  }

  // 6. Landing page
  console.log("6. Generating landing page...");
  const landingContent = generateLandingPage(tools.length);
  writeFileSync(join(OUT, "index.html"), htmlPage("Documentation", landingContent));

  // 7. CSS
  console.log("7. Writing styles...");
  writeFileSync(join(OUT, "style.css"), generateCSS());

  // 8. .nojekyll (disable GitHub Pages Jekyll processing)
  writeFileSync(join(OUT, ".nojekyll"), "");

  console.log(`\nDone! Generated ${tools.length}-tool MCP reference + API docs + ${guidePages.length} guide pages.`);
  console.log(`Output: docs-site/`);
  console.log(`To preview locally: npx serve docs-site`);
}

main();
