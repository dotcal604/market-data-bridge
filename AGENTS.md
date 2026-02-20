# Market Data Bridge — Agent Rules

## Team Roster

| # | Role | Agent | Cost Tier | Trigger | Scope |
|---|------|-------|-----------|---------|-------|
| 1 | **Engineering Manager** | Human (dotcal604) | — | — | All — priorities, approvals, risk decisions |
| 2 | **Staff Engineer / Tech Lead** | Claude Code | Expensive (Max 20x) | Terminal CLI | Execution-critical code, integration, planning, MCP tools |
| 3 | **Senior Dev (pair programming)** | Claude Desktop | Included in Max | Chat UI / Cowork | Reviews, trade-off discussions, brainstorming |
| 4 | **Senior Consultant / Architect** | ChatGPT | Included in Pro $200 | Chat UI | Architecture, strategy, eval engine design |
| 5 | **Mid-Level Dev** | GitHub Copilot | Flat $39/mo | IDE Extension / GitHub issue assign | Ops, tests, features following existing patterns |
| 6 | **Junior Dev (spec executor)** | OpenAI Codex | Included in Pro $200 | Codex UI / `@codex` | Single-file changes, schemas, docs, JSDoc |
| 7 | **Junior Dev (probationary)** | Google Jules | Included in Google AI Pro | [jules.google](https://jules.google) | Low-risk tasks until proven — JSDoc, docs, Python |
| 8 | **QA Automation Engineer** | Qodo Gen | Free tier | IDE Extension / PR Agent | Test generation, edge case discovery |
| 9 | **Senior Dev (IDE-native)** | Windsurf | Free/Pro tier | Windsurf IDE | Module-level development, refactoring in flow |
| 10 | **UI/UX Designer** | v0 by Vercel | Free tier | v0.dev | UI component generation from specs |
| 11 | **Security Auditor** | GitHub Advanced Security | Free | CI/CD / PR scan | Dependabot, code scanning, secret detection |
| 12 | **Internal Librarian** | NotebookLM | Included in Google AI Pro | notebooklm.google.com | Architecture docs, RAG, knowledge queries |
| 13 | **Senior Dev / 2nd Staff Engineer** | Google Antigravity | Included in Google AI Pro | Antigravity IDE | Multi-file features, autonomous execution |
| 14 | **CI/CD & Infra Engineer** | Amazon Q Developer | Free tier (50 agent chats/mo) | IDE Extension / CLI | GitHub Actions, deploy scripts, build diagnosis |
| 15 | **Technical Writer / Docs Owner** | Mintlify AI | Free (hobby tier) | mintlify.com + `docs/` directory | `docs/*.mdx`, `docs/docs.json`, API references |
| 16 | **Docs Writer** | GitHub Copilot | Flat $39/mo | GitHub issue assign (`@copilot/docs-writer`) | `docs/**/*.mdx`, `docs/docs.json`, repo docs (`*.md`) |

## Monthly Compute Budget

```
Total: ~$479/mo + Windsurf (free or Pro)
├── Claude Max 20x:  $200  →  Claude Code + Desktop + chat
├── ChatGPT Pro:     $200  →  ChatGPT + Codex (300–1500 msgs/5hr)
├── Copilot Pro+:     $39  →  IDE completions + agent mode
├── Google AI Pro:    ~$20  →  Antigravity + Jules + NotebookLM
├── Perplexity Max:   ~$20  →  Research (not coding roster)
├── Windsurf:      free/$10  →  IDE-native dev + Cascade context
├── Mintlify:        free/$0  →  Docs site hosting + AI writer (hobby tier)
└── Free tier:         $0  →  v0, Qodo, GHAS, Amazon Q (50 agent/mo)
```

### Assignment Guidelines

- **Execution-critical code** (orders, risk gate, connection, reconciliation): **Claude Code + Human review only**
- **New features with clear specs**: Copilot (if pattern exists) or Codex (if isolated) or Antigravity (if multi-file)
- **Tests and docs**: Codex, Copilot, or Qodo Gen — all handle these well
- **Cross-language work** (TS <-> Python): Claude Code — juniors struggle with multi-language coordination
- **Architecture decisions**: Claude Code proposes -> ChatGPT/Antigravity review -> Human approves
- **CI/CD, GH Actions, deploy scripts**: Amazon Q (mastery domain) or Copilot (fallback)
- **UI components from design**: v0 (free tier, 10/mo) or Antigravity (multi-file flows)
- **User-facing documentation** (`docs/*.mdx`): Mintlify AI + Codex for bulk content, or `@copilot/docs-writer` for evidence-backed updates
- **Unproven agents** (Jules): Start with low-risk tasks (JSDoc, docs). Promote after 3 clean PRs.

Route tasks to build agent mastery in their domain. When two agents can handle a task, prefer the one whose mastery domain it falls in, then the cheaper one. Reserve Claude Code Max tokens for judgment-intensive and execution-critical work.

Don't rotate agents through unfamiliar domains to save tokens — mastery compounds. 10 CI tasks to Amazon Q > 2 each to 5 agents.

## Cost-Aware Routing

**Routing principle:** every task goes to the cheapest agent that can handle it.

| Task Type | Route To | Cost | Why |
|-----------|----------|------|-----|
| Boilerplate/patterns | Copilot autocomplete | $39 flat | Inline, instant |
| Spec execution (isolated, clear spec) | Codex | $0 (in Pro) | Async, frees Claude window |
| Multi-file features (non-critical) | Antigravity | $0 (in Google AI Pro) | Free Gemini 3 compute |
| UI components from design | v0 | $0 (free tier) | 10/mo covers most needs |
| Test generation | Qodo Gen | $0 (free tier) | Behavior-driven |
| CI/CD, GH Actions, deploy scripts | Amazon Q | $0 (free tier) | 50 agent chats/mo |
| Mechanical work, JSDoc, docs | Jules | $0 (in Google AI Pro) | Probationary — low-risk only |
| User-facing documentation (`docs/*.mdx`) | Mintlify AI / docs-writer | $0 / $39 flat | AI suggestions / evidence-backed updates |
| Research/second opinions | ChatGPT | $0 (in Pro) | Already paying $200 |
| Architecture docs/RAG | NotebookLM | $0 (in Google AI Pro) | Free Gemini inference |
| Security scanning | GHAS | $0 (free) | Automated in CI |
| Module-level development, refactoring | Windsurf | Free/Pro | IDE flow state, Cascade context |
| Complex multi-system, judgment calls | Claude Code | Max tokens | Only for work that requires it |
| Execution-critical code | Claude Code + Human | Max tokens | Non-negotiable |

**Routing priorities (in order):**
1. **Mastery first** — Route tasks to build agent expertise in their domain. An agent doing 10 CI tasks learns GH Actions deeply vs. spreading across 5 agents
2. **Free second** — Antigravity, Codex, Qodo, v0, Amazon Q, Jules, NotebookLM, GHAS
3. **Cheap third** — Copilot ($39 flat), ChatGPT (included in $200)
4. **Expensive last** — Claude Code (Max 20x window is finite per 5hr/weekly)

### Tool Mastery Targets

Each agent — and the human — should develop deep expertise:

| Agent | Mastery Domain | Tools to Master |
|-------|---------------|-----------------|
| **Human (dotcal604)** | **Practitioner / orchestrator** | **Agent delegation, prompt engineering, issue writing, PR review, MCP tool vocabulary, reading agent output critically, knowing when to override** |
| Claude Code | Full-stack + MCP + IBKR | All 150+ MCP tools, TWS API, pino, better-sqlite3 |
| Claude Desktop | Pair review + strategy | Architecture trade-offs, code review, brainstorming |
| Antigravity | Multi-file TS features | Recharts, TanStack, Zustand, Next.js App Router |
| ChatGPT | Architecture + eval engine | Ensemble scorer, feature engine, model providers |
| Copilot | Patterns + ops | ecosystem.config, pm2, Express middleware, test utils |
| Codex | Spec execution + schemas | Zod schemas, JSDoc, TypeScript strict mode, single-file refactors |
| Jules | Mechanical + Python | analytics/ scripts, Python data processing, bulk JSDoc |
| Windsurf | IDE-native dev + context | Inline code generation, multi-file flows, Cascade context engine |
| Amazon Q | CI/CD + deploy | GitHub Actions, Docker, Fly.io, npm scripts |
| Qodo Gen | Test generation | Vitest, in-memory SQLite, edge case discovery |
| v0 | UI components | shadcn/ui, Tailwind v4, dark theme, Recharts |
| NotebookLM | Knowledge RAG | Architecture docs, whitepapers, codebase understanding |
| Mintlify AI | Documentation | MDX authoring, docs.json nav, API reference generation, search |
| **docs-writer** | **Evidence-backed docs** | **Mintlify MDX components, docs.json, citing code/endpoints/env vars** |
| GHAS | Security scanning | Dependabot, code scanning, secret detection |

**Your mastery as the human operator is the highest-leverage investment.** Every improvement in how you write specs, delegate tasks, review output, and route work multiplies across all 14 agents. The agents get better at their domains through repetition — you get better at the meta-skill of running the team.

Mastery = repeated exposure to the same tools/patterns -> fewer mistakes, faster execution, less review overhead. Don't rotate agents through unfamiliar domains just to save tokens.

### Communication

- All agents read this `AGENTS.md` on every task
- PRs must reference the issue number (`Fixes #N`)
- Claude Code reviews all agent PRs before human merge
- No agent merges their own PR — human approval required

## Orchestration Plan

### Task Routing by Complexity Tier

```
Tier 1 — Autonomous (no review needed)
├── Copilot: autocomplete, pattern-following boilerplate
├── GHAS: automated security scans in CI
├── Qodo Gen: test generation on PR
├── NotebookLM: knowledge queries
└── Mintlify AI: docs site hosting, search, AI suggestions

Tier 2 — Delegated (Claude Code reviews PR before human merge)
├── Codex: spec execution from detailed issues
├── Jules: mechanical refactors, JSDoc, docs
├── Amazon Q: CI/CD workflows, deploy scripts
├── v0: UI component generation
└── Windsurf: module-level inline development

Tier 3 — Collaborative (human actively involved)
├── Claude Code: complex multi-system work, architecture
├── Claude Desktop: pair programming, strategy sessions
├── Antigravity: multi-file features, deep context work
└── ChatGPT: architecture review, second opinions

Tier 4 — Human-only
└── Execution-critical code changes (orders, risk gate, connection)
    require human review + paper test before production
```

### Parallel Execution Model

On any given workday, the human can have up to 5 agents working simultaneously:
- **Claude Code:** active in terminal (interactive)
- **Codex:** async task queue (fire and forget, check back)
- **Copilot:** assigned to a GitHub issue (async PR)
- **Jules:** async task at jules.google (async PR)
- **Antigravity:** async in Antigravity IDE (async PR)

This gives a 1:5 effective parallelism ratio without context-switching overhead, because only Claude Code requires active human attention. The others produce PRs that get batch-reviewed.

### Viability Assessment

With 14 agents, the bottleneck is human review bandwidth, not compute. Mitigation:
1. Claude Code auto-reviews all agent PRs (catches 80% of issues)
2. Tier 1 agents need zero review (autonomous)
3. Tier 2 agents produce PRs reviewed in batch (Claude Code first pass, human final)
4. Tier 3 agents work interactively (already reviewed in real-time)
5. Effective span of control: ~5 active agents at once, human manages the queue

### Weekly Rhythm

- **Monday:** plan week, write detailed issues for Codex/Jules/Copilot/Amazon Q
- **Tue-Thu:** Claude Code + Antigravity on complex work, async agents on queue
- **Friday:** batch-review async PRs, merge, retro on agent performance

## Windsurf Architectural Positioning

Windsurf's key differentiator is **Cascade** — a multi-step agentic planner that:
- Reasons across files with full repository context (indexing engine, not just open tabs)
- Persists "Memories" of your coding patterns and APIs across sessions
- Chains model calls (SWE-1.5 as primary executor) with MCP tool integration
- Tracks dependency impact and iterates until tests converge

### Where Windsurf Fits

```
          ┌──────────────────────────────────────┐
          │          Human (orchestrator)          │
          └─────┬──────────┬──────────┬───────────┘
                │          │          │
     ┌──────────▼──┐ ┌────▼─────┐ ┌──▼──────────┐
     │ Claude Code  │ │ Windsurf │ │ Antigravity  │
     │ (terminal)   │ │ (IDE)    │ │ (IDE)        │
     │ Max context  │ │ Cascade  │ │ Gemini 3     │
     │ MCP tools    │ │ Memories │ │ Multi-agent  │
     │ Full repo    │ │ Full repo│ │ Full repo    │
     └──────────────┘ └──────────┘ └──────────────┘
       Staff Eng.      Sr. Dev       2nd Staff
       Judgment calls  Flow state    Big features
       Exec-critical   IDE-native    Async PRs
```

### Claude Code vs Windsurf vs Antigravity — When to Use Which

| Dimension | Claude Code | Windsurf | Antigravity |
|-----------|-------------|----------|-------------|
| Interface | Terminal CLI | IDE (VS Code fork) | Antigravity IDE |
| Context | Conversation + MCP | Cascade indexer + Memories | Gemini 3 long context |
| Strengths | Judgment, MCP tools, multi-system | Flow state, inline diffs, pattern learning | Autonomous multi-file, big features |
| Cost | Max 20x tokens (expensive) | Free/Pro (cheap) | Google AI Pro (cheap) |
| Best for | Complex debugging, architecture, exec-critical | Module-level development, refactoring in flow | Feature branches, autonomous execution |
| Weakness | Expensive per-token | Less autonomous than Claude Code | Can't access MCP tools |

Windsurf's niche: it's the "hands-on-keyboard in IDE" agent. When you're actively coding and want AI-assisted flow state (not async delegation), Windsurf's Cascade + Memories beats Copilot's autocomplete for larger changes. Positioned between Copilot (cheap autocomplete) and Claude Code (expensive full-context reasoning).

## Agent Handshakes — Capability Verification

**Industry context:** Google's [A2A (Agent-to-Agent) protocol](https://a2a-protocol.org/latest/specification/) defines a formal "Agent Card" — a JSON document at `/.well-known/agent.json` that advertises capabilities, supported modalities, and skills. We can't implement A2A literally (our agents are SaaS tools, not servers), but we borrow the concept.

### Agent Card Format

For each agent, a structured "job description" card. The agent's response (or its first PR against the spec) constitutes the "handshake" — proof it understood and can execute.

```
### Agent Card: [Agent Name]
**Role:** [Title]
**Capabilities:** [Languages, frameworks, tools]
**Scope:** [Files/areas it owns]
**Constraints:** [What it must NOT do]
**Acceptance Test:** [A specific small task to prove capability]
**Handshake Status:** ⏳ Pending | ✅ Verified | ❌ Failed
```

### Propagation Plan

| Agent | How to propagate JD | How to get handshake |
|-------|--------------------|-----------------------|
| Claude Code | Already reads AGENTS.md — self-aware | ✅ Already verified |
| Claude Desktop | Paste agent card in Cowork session | Ask it to summarize its role + constraints |
| ChatGPT | Paste in chat or custom GPT instructions | Ask it to critique its own card |
| Copilot | `.github/agents/copilot.md` (already exists) | Assign test issue, verify PR quality |
| Codex | AGENTS.md (reads at chatgpt.com/codex) | Assign test task, verify output |
| Jules | Paste at jules.google when assigning | Assign test task, verify PR |
| Windsurf | Open project in Windsurf, Cascade reads codebase | Assign test task in Cascade |
| Antigravity | Open project in Antigravity IDE | Assign test task, verify multi-file output |
| Amazon Q | Install extension, point at repo | Assign CI/CD test task |
| Qodo Gen | IDE extension reads codebase | Generate tests for a module, verify quality |
| v0 | Paste component spec at v0.dev | Generate a component, verify it matches patterns |
| NotebookLM | Upload AGENTS.md + CLAUDE.md as sources | Ask architecture question, verify accuracy |
| Mintlify AI | Already scaffolded in `docs/` | Connect repo at mintlify.com/start, verify deploy |
| GHAS | Already configured in GitHub | ✅ Already verified (runs in CI) |

### Acceptance Tests

| Agent | Test Task | Pass Criteria |
|-------|-----------|---------------|
| Antigravity | "Add a loading skeleton to the analytics page" | Correct file, dark theme, named export, shadcn skeleton |
| Amazon Q | "Add a GitHub Action that runs `npm run build` on PR" | Valid workflow YAML, triggers on PR, caches node_modules |
| Windsurf | "Extract the score color logic into a shared utility" | Correct refactor, no behavior change, tsc clean |
| Jules | "Add JSDoc to all exports in `src/eval/ensemble/scorer.ts`" | Accurate JSDoc, no code changes, clean PR |
| Codex | "Create a Zod schema for the Holly alert CSV format" | Correct types, handles optional fields, tests included |
| Copilot | "Write unit tests for `src/db/database.ts` getLatestNetLiquidation" | In-memory DB, edge cases (empty table, null), vitest |
| v0 | "Generate a trade journal entry card component" | shadcn/ui, dark theme, responsive, matches existing pattern |
| Qodo Gen | "Generate edge case tests for `src/ibkr/risk-gate.ts` checkRisk" | Covers boundary conditions, in-memory DB, no mocks of real logic |

Running these tests proves coordination is viable. If an agent fails its acceptance test, it gets demoted or its scope narrows.

## Task Orchestration Process

### Business Process: Issue -> Deliverable

```
 ┌──────────┐    ┌──────────────┐    ┌───────────────┐    ┌────────────┐
 │  INTAKE  │───>│   TRIAGE     │───>│   DELEGATE    │───>│  EXECUTE   │
 │          │    │              │    │               │    │            │
 │ GitHub   │    │ Human reads  │    │ Assign agent  │    │ Agent works│
 │ issue    │    │ issue, picks │    │ based on:     │    │ on branch  │
 │ created  │    │ complexity   │    │ 1. Mastery    │    │            │
 │          │    │ tier         │    │ 2. Cost       │    │            │
 │          │    │              │    │ 3. Capacity   │    │            │
 └──────────┘    └──────┬───────┘    └───────┬───────┘    └─────┬──────┘
                        │                    │                  │
                   FAIL:                FAIL:              FAIL:
                   Ambiguous spec →     Wrong agent for    Agent produces
                   agent guesses        task complexity → broken code,
                   wrong, wasted        rework needed     wrong files, or
                   tokens                                 misses context
                        │                    │                  │
                   MITIGATION:          MITIGATION:        MITIGATION:
                   Write detailed       Use mastery        Claude Code
                   specs with file      routing table,     auto-reviews
                   paths + acceptance   not gut feel       all PRs before
                   criteria                                human sees them

 ┌────────────┐    ┌──────────────┐    ┌───────────────┐    ┌────────────┐
 │  REVIEW    │───>│   FIX/REDO   │───>│    MERGE      │───>│  VERIFY    │
 │            │    │  (if needed) │    │               │    │            │
 │ Claude Code│    │ Same agent   │    │ Human final   │    │ CI passes  │
 │ first pass │    │ gets feedback│    │ approval      │    │ npm test   │
 │ + Human    │    │ + fixes      │    │ Squash merge  │    │ npm build  │
 │ final pass │    │              │    │               │    │ Deploy     │
 └─────┬──────┘    └──────┬───────┘    └───────┬───────┘    └─────┬──────┘
       │                  │                    │                  │
  FAIL:              FAIL:              FAIL:              FAIL:
  Claude Code        Agent can't fix   Human rubber-      CI catches
  misses issue →     its own mess →    stamps without     what review
  bug reaches        escalate to       reading → bugs     missed → good
  human review       higher-tier agent reach prod         (this is working)
       │                  │                    │                  │
  MITIGATION:        MITIGATION:        MITIGATION:       MITIGATION:
  Human reviews      Escalation path:   Batch review      GHAS + Qodo Gen
  exec-critical      Jules→Codex→       time on Fridays,  in CI pipeline,
  code ALWAYS,       Copilot→Windsurf→  dedicated focus   npm test required
  trust Claude Code  Claude Code→Human  not drive-by      before merge
  for non-critical
```

### Technical Process: Code Flow

```
 Agent gets task
       │
       v
 ┌──────────────┐     FAIL: Agent doesn't read AGENTS.md
 │ Read AGENTS.md│───> MITIGATION: Codex/Copilot auto-read it.
 │ Read CLAUDE.md│     Jules/Antigravity/Windsurf: paste in prompt.
 │               │     Amazon Q: include in workspace context.
 └──────┬───────┘
        │
        v
 ┌──────────────┐     FAIL: Agent creates branch with wrong naming
 │ Create branch │───> MITIGATION: Convention in AGENTS.md:
 │ feat/issue-N  │     feat/[issue-number]-[short-description]
 │ or fix/issue-N│     Agent-specific prefix not needed.
 └──────┬───────┘
        │
        v
 ┌──────────────┐     FAIL: Agent edits wrong files / breaks imports
 │ Write code    │───> MITIGATION: AGENTS.md scope column limits which
 │ (in scope     │     files each agent can touch. Authority matrix
 │  files only)  │     blocks junior agents from exec-critical files.
 └──────┬───────┘
        │
        v
 ┌──────────────┐     FAIL: Agent skips type check
 │ Verify locally│───> MITIGATION: Verification commands in AGENTS.md.
 │ tsc --noEmit  │     CI also runs these, so failure caught at PR.
 │ npm test      │
 └──────┬───────┘
        │
        v
 ┌──────────────┐     FAIL: Agent writes bad PR description
 │ Open PR       │───> MITIGATION: PR template in AGENTS.md:
 │ "Fixes #N"    │     "What changed" + "Fixes #N" + verification output.
 │ + description │     Claude Code adds review comments if missing.
 └──────┬───────┘
        │
        v
 ┌──────────────┐     FAIL: Claude Code review too permissive
 │ Claude Code   │───> MITIGATION: Exec-critical PRs ALWAYS get human
 │ auto-review   │     review regardless. Claude Code flags, not merges.
 └──────┬───────┘
        │
        v
 ┌──────────────┐     FAIL: Human merges without testing
 │ Human review  │───> MITIGATION: CI gates — can't merge if tests fail.
 │ + merge       │     Friday batch review with dedicated focus time.
 └──────┬───────┘
        │
        v
 ┌──────────────┐     FAIL: Deploy breaks production
 │ CI/CD + deploy│───> MITIGATION: Paper account test for exec-critical.
 │               │     pm2 graceful restart. Rollback plan in PR.
 └──────────────┘
```

### Failure Mode Summary

| # | Failure Mode | Probability | Impact | Mitigation | Owner |
|---|-------------|-------------|--------|------------|-------|
| 1 | Ambiguous spec -> wasted work | **High** | Medium | Detailed specs with file paths + acceptance criteria | Human |
| 2 | Wrong agent assigned | Medium | Medium | Mastery routing table + cost priority | Human |
| 3 | Agent misses cross-file context | **High** | Medium | Claude Code review catches; escalation path | Claude Code |
| 4 | Agent doesn't read AGENTS.md | Medium | Low | Auto-read (Codex/Copilot), paste (others) | Human |
| 5 | PR rubber-stamped by human | Medium | **High** | Batch review Fridays, exec-critical always manual | Human |
| 6 | Claude Code review too lenient | Low | **High** | Human reviews exec-critical regardless | Human |
| 7 | Agent can't fix its own PR | Medium | Low | Escalation: junior->mid->senior->Claude Code | Claude Code |
| 8 | CI misses a bug | Low | **High** | Qodo Gen edge cases + GHAS security scan | Qodo/GHAS |
| 9 | Token window exhausted mid-task | Medium | Medium | Route to free agents first, save Claude Code for last | Human |
| 10 | Agent creates duplicate/conflicting PRs | Low | Medium | Assign 1 issue = 1 agent, no overlap | Human |
| 11 | Context drift across long sessions | Medium | Medium | Windsurf Memories, Claude Code auto-memory, fresh context | All |
| 12 | Orchestration overhead > time saved | **High early** | Medium | Invest in spec quality now, compounds over time | Human |

**Biggest risks:**
- **#1 (ambiguous specs)** and **#12 (overhead)** are the human-side risks. Your spec-writing mastery is the highest-leverage skill to develop.
- **#5 (rubber-stamping)** is the most dangerous — a bad merge to exec-critical code can cause real financial harm. The authority matrix + paper testing mitigates this.
- **#3 (cross-file context)** is the most frequent agent-side failure. Claude Code as reviewer is the safety net.

---

## Project Overview

Single-process Node.js/TypeScript server (port 3000) + Next.js dashboard (port 3001 in dev):
- Real-time market data (Yahoo Finance always, IBKR when connected)
- Trade execution via IBKR TWS/Gateway
- Multi-model trade evaluation engine (Claude + GPT-4o + Gemini)
- AI-to-AI collaboration channel
- MCP server (Claude) + REST API (ChatGPT/external agents)
- Admin dashboard (Next.js 14, App Router) in `frontend/`

## Architecture Constraints

1. **Single process, single port** — everything runs in one `npm start` on port 3000
2. **No HTTP hops between subsystems** — eval engine imports Yahoo/IBKR providers directly as function calls, not HTTP requests
3. **better-sqlite3 only** — WAL mode, synchronous API. No sql.js, no async DB drivers
4. **ESM modules** — `"type": "module"` in package.json. All imports use `.js` extension in compiled output
5. **Pino logger** — use `import { logger } from "../logging.js"`. No console.log in production code
6. **Express 4** — with `@types/express` v5 (stricter `req.query` types). Use `qs()` helper for query params
7. **Zod for runtime validation** — all external inputs (API requests, model outputs) validated with Zod schemas

## Directory Structure

```
src/
  config.ts           — env vars, ports, API keys
  index.ts            — entry point, starts MCP + REST + IBKR
  logging.ts          — Pino logger setup
  scheduler.ts        — periodic account/position snapshots
  suppress-stdout.ts  — MCP stdout isolation

  ibkr/               — IBKR TWS client modules
    connection.ts     — IBApi connection manager
    account.ts        — account/positions/PnL
    orders.ts         — order placement + management
    marketdata.ts     — real-time quotes
    contracts.ts      — contract resolution
    risk-gate.ts      — pre-trade risk checks

  providers/
    yahoo.ts          — Yahoo Finance wrapper (getQuote, getHistoricalBars, getStockDetails)
    status.ts         — market session detection

  db/
    database.ts       — SQLite schema + prepared statements + query helpers
    reconcile.ts      — boot-time order reconciliation

  rest/
    server.ts         — Express server, middleware, route mounting
    routes.ts         — all REST endpoint handlers
    openapi.ts        — OpenAPI 3.1 spec generator

  mcp/
    server.ts         — MCP tool definitions (stdio transport)

  collab/
    store.ts          — AI-to-AI collaboration message store

  eval/               — Multi-model trade evaluation engine
    types.ts          — shared BarData/QuoteData/StockDetails interfaces
    config.ts         — eval-specific env config (API keys, model names, thresholds)
    retry.ts          — withTimeout() + withRetry()

    features/
      types.ts        — FeatureVector (27 fields), ModelFeatureVector, stripMetadata()
      compute.ts      — feature orchestrator (direct Yahoo provider calls)
      rvol.ts         — relative volume vs 20-day average
      vwap.ts         — VWAP deviation percentage
      spread.ts       — bid-ask spread percentage
      gap.ts          — gap from prior close
      range-position.ts — position within day's range
      atr.ts          — 14-period ATR + ATR as % of price
      extension.ts    — price extension in ATR units
      float-rotation.ts — volume / estimated float
      volume-acceleration.ts — last bar vol / prev bar vol
      liquidity.ts    — small/mid/large classification
      volatility-regime.ts — low/normal/high classification
      time-classification.ts — time of day + minutes since open (DST-aware)
      market-alignment.ts — SPY/QQQ alignment

    models/
      types.ts        — ModelId, ModelOutput, ModelEvaluation
      schema.ts       — Zod ModelOutputSchema for validating LLM responses
      prompt.ts       — system prompt + buildUserPrompt() + hashPrompt()
      runner.ts       — Promise.allSettled orchestrator for 3 models in parallel
      providers/
        claude.ts     — Anthropic SDK (@anthropic-ai/sdk)
        openai.ts     — OpenAI SDK (openai)
        gemini.ts     — Google GenAI SDK (@google/genai)

    ensemble/
      types.ts        — EnsembleWeights, EnsembleScore
      scorer.ts       — weighted mean + quadratic disagreement penalty
      weights.ts      — load data/weights.json + fs.watchFile hot-reload

    guardrails/
      prefilter.ts    — pre-trade structural filters (before model API calls)
      behavioral.ts   — post-ensemble checks (trading window, loss streak, disagreement)

    routes.ts         — Express router mounted at /api/eval

frontend/                 — Next.js 14 dashboard (App Router)
  next.config.ts          — proxy /api/* to backend on port 3000
  src/
    app/
      page.tsx            — dashboard home (stats cards + recent evals)
      evals/
        page.tsx          — eval history (TanStack Table, sortable)
        [id]/page.tsx     — eval detail (3-model comparison)
      weights/
        page.tsx          — ensemble weights display
    components/
      layout/             — app-shell.tsx, sidebar.tsx, top-bar.tsx
      dashboard/          — stats-cards.tsx, recent-evals-mini.tsx
      eval-table/         — eval-table.tsx, eval-table-columns.tsx, eval-filters.tsx
      eval-detail/        — model-card.tsx, model-comparison.tsx, ensemble-summary.tsx,
                            guardrail-badges.tsx, feature-table.tsx, outcome-panel.tsx, outcome-form.tsx
      model-stats/        — model-comparison.tsx, stats-summary.tsx
      shared/             — score-badge.tsx, direction-badge.tsx, model-avatar.tsx, export-button.tsx
      analytics/          — score-scatter.tsx, feature-radar.tsx, time-of-day-chart.tsx
      weights/            — weight-sliders.tsx
      ui/                 — shadcn/ui primitives (button, card, table, badge, etc.)
    lib/
      api/
        types.ts          — TypeScript interfaces mirroring backend schemas
        eval-client.ts    — typed fetch wrappers for /api/eval endpoints
      hooks/
        use-evals.ts      — React Query hooks (useEvalHistory, useEvalDetail, useEvalStats, etc.)
      stores/
        eval-filters.ts   — Zustand store for eval history filter state
      utils/
        formatters.ts     — formatScore, formatPrice, formatMs, formatTimestamp, etc.
        colors.ts         — scoreColor, scoreBg, modelColor, directionColor, etc.
        export.ts         — exportToCsv, exportToJson
      providers.tsx       — QueryClientProvider wrapper
      utils.ts            — cn() helper (clsx + tailwind-merge)

docs/                     — Mintlify documentation site
  docs.json               — navigation config (tabs, groups, pages)
  *.mdx                   — documentation pages (27 pages across Guide, Frontend, MCP Tools)
```

## Build & Dev

```bash
# Backend: build TypeScript
npm run build

# Frontend: install deps + build
cd frontend && npm install && npm run build

# Dev mode (both): backend on :3000, frontend on :3001
npm run dev

# Frontend type-check only (no build output)
cd frontend && npx tsc --noEmit

# Docs: preview locally
cd docs && npx mint dev
```

## Code Standards

### Frontend (frontend/src/)

#### Stack
- **Next.js 14+** — App Router, `"use client"` for interactive components
- **Tailwind CSS v4** — utility-first, dark theme via `.dark` class on `<html>`
- **shadcn/ui** — import from `@/components/ui/*` (already installed: button, card, table, badge, input, skeleton, tabs, tooltip, dialog, select, separator)
- **TanStack Table v8** — `useReactTable` + `getCoreRowModel` + `getSortedRowModel`
- **TanStack Query v5** — `useQuery` with `queryKey` arrays, `refetchInterval` for polling
- **Recharts v3** — `ResponsiveContainer` wrapper required, dark theme: transparent bg, `text-muted-foreground` for axis labels
- **Zustand v5** — lightweight client stores (filter state, etc.)
- **Lucide React** — icon library, import individual icons

#### Component Conventions
- Every interactive component starts with `"use client"` directive
- Named exports only (no default exports for components)
- Props interface defined in same file or imported from `@/lib/api/types`
- Use `cn()` from `@/lib/utils` for conditional class merging
- Font: `font-mono` for numeric/data values, default sans for labels

#### Dark Theme (mandatory)
- App is always in dark mode (`<html className="dark">`)
- CSS vars use oklch color space — defined in `globals.css` under `.dark {}`
- Use semantic Tailwind classes: `bg-background`, `text-foreground`, `bg-card`, `text-muted-foreground`, `border-border`
- For custom colors: `text-emerald-400` (positive/long), `text-red-400` (negative/short), `text-yellow-400` (neutral)
- Score colors: 8+->emerald, 6+->green, 4+->yellow, 2+->orange, <2->red (see `lib/utils/colors.ts`)

#### Color Constants
- Model colors: `gpt-4o=#10b981`, `claude-sonnet=#8b5cf6`, `gemini-flash=#f59e0b`
- Use `modelColor()` from `@/lib/utils/colors` — do not hardcode

#### Data Fetching
- All API calls go through `@/lib/api/eval-client.ts` (typed wrappers)
- React Query hooks in `@/lib/hooks/use-evals.ts`
- Proxy config in `next.config.ts` rewrites `/api/*` -> `http://localhost:3000/api/*`
- No direct `fetch()` in components — always use hooks or eval-client

#### New Component Checklist
1. Create file in appropriate `components/` subdirectory
2. Add `"use client"` if interactive
3. Define props interface with explicit types
4. Use shadcn primitives (Card, Badge, etc.) for structure
5. Use color utilities from `@/lib/utils/colors`
6. Use formatters from `@/lib/utils/formatters`
7. Verify: `cd frontend && npx tsc --noEmit`

### TypeScript (Backend)
- Strict mode enabled
- No `any` types — use `unknown` + narrowing or explicit interfaces
- Prefer `interface` over `type` for object shapes
- All function parameters and return types must be explicitly typed
- Use `readonly` for arrays/objects that shouldn't be mutated

### Feature Engine (src/eval/features/)
- **Pure functions only** — no side effects, no network calls, no DB access
- Deterministic math — no randomness, no ML
- Accept numeric/array inputs, return numeric/categorical outputs
- Include formula comments for non-obvious calculations
- Handle edge cases (division by zero, empty arrays, missing data) gracefully

### Model Providers (src/eval/models/providers/)
- Temperature 0 always — reproducible outputs
- Zod schema validation on every response
- Return structured ModelOutput — never raw text
- Timeout: 30s per model call
- Use withRetry() for transient failures only (network errors, rate limits)

### Database (src/db/)
- All new tables must have prepared statements defined at init time
- Use parameterized queries — never string interpolation for SQL
- WAL mode is set at connection time — don't change it
- Add indexes for any column used in WHERE clauses
- Eval tables: evaluations, model_outputs, outcomes, weight_history

### REST API (src/rest/)
- All endpoints require `X-API-Key` header (enforced by middleware)
- Rate limiting: 100 req/min global, 10/min for orders, 10/min for eval
- Return consistent JSON shape: `{ data }` on success, `{ error }` on failure
- Use Express Router for route groups

### Error Handling
- No silent fallbacks — if Yahoo fails, return an error, don't silently return stale data
- Explicit error handling required at every boundary
- IBKR disconnection is expected — check connection state before operations
- Log errors with Pino at appropriate levels (error for failures, warn for degraded, info for ops)

## Financial Constraints

- **Assist discretion mode** — the system produces scores and flags. The trader decides. No automated execution based on eval scores
- All time references use Eastern Time (ET), DST-aware
- Trading window: 9:30 AM - 3:55 PM ET (pre-filters block outside this)
- Pre-trade risk gate enforced for all orders (max size, max notional, penny stock rejection)
- Quote source must be included in every response (`source: "ibkr" | "yahoo"`)
- R-multiple, ATR context, VWAP context required in eval outputs

## Ensemble Rules

- Ceteris paribus: all 3 models receive identical inputs (same prompt, same features, same temperature)
- No model sees another model's output
- Weighted mean + quadratic disagreement penalty: `k * spread^2 / 10000`
- Majority voting + minimum score threshold (40)
- Weights loaded from `data/weights.json`, hot-reloaded via fs.watchFile
- Weight updates happen offline (Python analytics script after 50+ outcomes)

## Testing Requirements

- Every new endpoint requires: unit test, edge case test, error test
- Feature modules: test with known inputs/outputs, test edge cases (zero, negative, empty)
- Model providers: test Zod validation with malformed responses
- No mocking of SQLite — use in-memory DB for tests

## What NOT to Do

- Do not modify `src/ibkr/orders.ts` execution logic without explicit approval
- Do not add external runtime dependencies without justification
- Do not use `console.log` — use Pino logger
- Do not make HTTP calls between internal subsystems — use direct imports
- Do not allow schema drift — Zod schemas are the source of truth
- Do not auto-merge any PR — human review required
- Do not store API keys in code — `.env` only

## Authority Matrix — Change Control

| File / Area | Owner | Review Required | Paper Test Required |
|-------------|-------|----------------|-------------------|
| `src/ibkr/orders.ts`, `orders_impl/*` | Human + Claude Code | Always (human) | Yes |
| `src/ibkr/risk-gate.ts` | Human + Claude Code | Always (human) | Yes |
| `src/ibkr/connection.ts` | Claude Code | Always (human) | Yes |
| `src/db/reconcile.ts` | Claude Code | Always (human) | Yes |
| `src/rest/agent.ts` (new actions) | Claude Code | Yes | No |
| `src/ops/*`, `scripts/*`, `scheduler.ts` | Amazon Q / Copilot | Yes (Claude Code) | No |
| `src/eval/features/*` (new features) | Codex / Antigravity | Yes (Claude Code) | No |
| `src/__tests__/*` | Codex / Qodo Gen / Copilot | Yes | No |
| `frontend/src/components/*` (new) | Antigravity / Codex / v0 | Yes | No |
| `frontend/src/components/*` (existing) | Windsurf / Copilot | Yes (Claude Code) | No |
| `ecosystem.config.cjs`, `deploy/*` | Amazon Q / Copilot | Yes | No |
| `.github/workflows/*` | Amazon Q / Copilot | Yes (Claude Code) | No |
| `.github/agents/*` | Claude Code | Yes | No |
| `docs/*.mdx`, `docs/docs.json` | Mintlify AI / Codex | Yes (Claude Code) | No |
| `AGENTS.md`, `CLAUDE.md` | Claude Code | No (self-maintained) | No |

**Execution-critical files** (top 4 rows) always require:
1. Human review before merge
2. Paper account test before production deploy
3. Crash-mid-request scenario considered
4. Rollback plan documented in PR

## Definition of Ready / Done by Work Type

### Ops Work (Amazon Q / Copilot)
**Ready:** Clear problem statement, affected files listed, no execution-logic changes needed.
**Done:** Script runs clean, no regressions in `npm test`, PM2 restart succeeds.

### Feature Work (Codex / Antigravity / Copilot / Windsurf)
**Ready:** Issue spec with file paths, props/API defined, acceptance criteria listed.
**Done:** `tsc --noEmit` clean, tests pass, no `console.log`, dark theme verified (frontend).

### Documentation Work (Mintlify AI / Codex)
**Ready:** Topic identified, relevant source files listed, target audience clear.
**Done:** MDX renders clean in `npx mint dev`, links valid, navigation updated in `docs.json`.

### Execution-Critical Work (Claude Code + Human)
**Ready:** Risk assumptions documented, rollback plan, paper-only test plan, crash-mid-request scenario.
**Done:** Paper account test passes, reconciliation test passes, idempotency verified, human sign-off.

## Agent-Specific Notes

> All agents read this `AGENTS.md` file on every task. The conventions above apply to all.

### Key Points for All Agents

- **Two package.json files** — root is backend (Express/TypeScript), `frontend/` is Next.js. Install both with `npm install && cd frontend && npm install`.
- **ESM imports** — backend uses `.js` extensions in imports (`import { foo } from "./bar.js"`). Frontend uses bare paths.
- **Frontend paths** — components live in `frontend/src/components/`, not `src/components/`
- **shadcn/ui** — already installed. Import from `@/components/ui/*`. Don't re-install.
- **Recharts** — already installed in frontend. Import from `recharts`.
- **Dark theme always** — use `bg-card`, `text-muted-foreground`, semantic Tailwind classes. No white backgrounds.
- **Named exports only** — `export function Foo()`, not `export default function Foo()`

### OpenAI Codex — Junior Dev (spec executor)

Codex runs tasks in cloud sandboxes at [chatgpt.com/codex](https://chatgpt.com/codex). It reads this `AGENTS.md` file automatically via its discovery chain.

**Environment setup** (configured at chatgpt.com/codex/settings/environments):
```bash
npm install && cd frontend && npm install && cd ..
```

**Best for:** Single-file changes, docs, JSDoc, mechanical refactors, schema generation. Needs detailed specs with exact file paths.

**Strengths:** Long-running tasks (7+ hours), parallel task execution, GPT-5.2-Codex model, GitHub integration (@codex on issues/PRs).

**Limitations:** Struggles with multi-file coordination, can miss cross-file context. Don't assign complex integration work.

**Included in ChatGPT Pro $200** — 300-1500 messages per 5hr window.

### GitHub Copilot — Mid-Level Dev

Copilot creates draft PRs from assigned issues. Pattern-matches from existing code — best when there's a similar module to follow.

**Trigger:** Assign Copilot to an issue via GitHub web UI, or use custom agents via `@copilot/{agent-name}`.

**Best for:** Tests, boilerplate, features with clear patterns, ops work.

**Limitations:** Can be superficial on complex logic, sometimes ignores edge cases. Review carefully.

**Note:** Copilot's GitHub Actions firewall blocks `fonts.googleapis.com` — cosmetic only, builds succeed.

**Flat $39/mo** — unlimited completions + agent mode.

### Google Jules — Junior Dev (probationary)

Jules runs async tasks via [jules.google](https://jules.google). Connects to GitHub, creates branches and PRs.

**Best for:** Multi-file mechanical work (JSDoc, docs), Python tasks. Currently unproven on this repo.

**Limitations:** New agent — needs 3 clean PRs before promotion to mid-level tasks.

**Trigger:** Paste issue URL or description at [jules.google](https://jules.google), select repo, approve plan.

**Included in Google AI Pro** (~$20/mo).

### Google Antigravity — Senior Dev / 2nd Staff Engineer

Runs via Antigravity IDE (agentic multi-file execution). Gemini 3 model.

**Best for:** Complex features that don't touch execution-critical code. Autonomous multi-file TypeScript/Python work.

**Strengths:** Deep context understanding, multi-file coordination, autonomous execution with Git integration.

**Limitations:** Cannot access MCP tools directly — works through IDE + Git. 5hr context refresh — plan tasks to fit within windows.

**Included in Google AI Pro** (~$20/mo).

### Windsurf — Senior Dev (IDE-native)

Cascade context engine for multi-file awareness. Best for hands-on-keyboard generation, inline diffs, module-level changes.

**Best for:** Active coding sessions where you want AI-assisted flow state. Larger changes than Copilot autocomplete, but not full async delegation.

**Strengths:** Full-repo indexing (not just open tabs), persistent Memories across sessions, strong at following existing patterns.

**Limitations:** Less autonomous than Claude Code or Antigravity. Overlaps with Copilot on autocomplete — use Windsurf for larger flows, Copilot for quick completions.

**Free tier:** 25 prompt credits/mo, unlimited Tab completions. Pro ($10-15/mo) if usage warrants.

### Amazon Q Developer — CI/CD & Infra Engineer

Free tier: 50 agent chat interactions/mo. IDE extension (VS Code) + `q` CLI.

**Best for:** GitHub Actions workflows, deploy scripts, ecosystem.config, broken build diagnosis.

**Strengths:** Strong at GH Actions + Node.js tooling. Good at diagnosing CI failures.

**Limitations:** Not on AWS infra for this project, but CI/CD knowledge transfers. Don't waste the 50 free chats on tasks Copilot can handle.

### Mintlify AI — Technical Writer / Docs Owner

Hobby tier (free): hosts docs site, auto-deploys from `docs/` on push to main.

**Owns:** All `docs/*.mdx` files and `docs/docs.json` navigation config. Already scaffolded: 27 pages across Guide, Frontend, MCP Tools tabs.

**Workflow:** Human or Claude Code writes `.mdx` -> push -> Mintlify auto-deploys. For bulk docs updates: Codex writes the `.mdx` files, Mintlify hosts them.

**Preview locally:** `npx mint dev` from `docs/` directory.

**Connect:** Go to [mintlify.com/start](https://mintlify.com/start), connect GitHub repo, point at `docs/` directory.

### Qodo Gen — QA Automation Engineer

IDE extension (VS Code) + PR Agent. Generates behavior-driven tests from code analysis.

**Best for:** Edge case discovery, test generation for existing modules, PR test coverage checks.

**Strengths:** Identifies boundary conditions humans miss. In-memory SQLite test patterns.

**Free tier** — unlimited test generation.

### v0 by Vercel — UI/UX Designer

Component generation from natural language specs at [v0.dev](https://v0.dev).

**Best for:** New UI components from design specs. shadcn/ui + Tailwind output matches our stack.

**Limitations:** 10 generations/mo on free tier. Produces single components, not full pages. May need manual dark theme adjustment.

### Verification Commands

After writing code, verify with:

```bash
# Frontend components
cd frontend && npx tsc --noEmit

# Backend modules
npx tsc --noEmit
```

### PR Conventions

When creating PRs, include in the body:
- **What changed**: files created/modified
- **Fixes #N**: link to the issue being resolved
- **Verification**: output of `tsc --noEmit` showing clean compile
