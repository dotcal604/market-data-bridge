# Market Data Bridge — Agent Roster & Authority Matrix

> Canonical reference for the multi-agent fleet. All agent instruction files (`CLAUDE.md`, `GEMINI.md`, `.github/agents/*.agent.md`, etc.) defer to this document for roster, authority, and cost routing.

**Engineering Manager:** dotcal604 (human, final authority on all merges and order operations)

---

## 1. Agent Roster

| # | Agent | Type | Trigger | Primary Workstream |
|---|-------|------|---------|--------------------|
| 1 | **Claude Code** | Staff Engineer / Tech Lead | CLI (`claude`), MCP stdio | Integration, planning, execution-critical code, PR review |
| 2 | **Copilot CLI** | Senior Dev (IDE) | VS Code inline, `gh copilot` | Backend routes, pattern-following features, autocomplete |
| 3 | **Gemini CLI** | Senior Dev (CLI) | `gemini` CLI, IDE plugin | Python analytics, data pipelines, research |
| 4 | **OpenAI Codex** | Junior Dev (async) | `@codex` on issues, chatgpt.com/codex | Long-running tasks, schemas, single-file changes, docs |
| 5 | **GitHub Copilot Agents** | Mid-Level Dev (5 profiles) | `@copilot/{profile}` on issues | Issue-driven PRs: frontend, backend, tests, ops, docs |
| 6 | **Jules** | Junior Dev (probationary) | jules.google task assignment | JSDoc, bulk formatting, Python scripts in `analytics/` |
| 7 | **v0.dev** | UI/UX Designer | v0.dev component spec paste | New UI components from design specs |
| 8 | **Qodo** | QA Automation Engineer | IDE extension (auto-reads codebase) | Edge case test generation, behavior-driven testing |
| 9 | **Amazon Q Developer** | DevOps / SRE | IDE plugin, AWS console | Docker, PM2, deploy scripts, infrastructure |
| 10 | **Cursor** | Senior Dev (IDE-native) | Cursor IDE, inline chat | Module-level dev, refactoring, flow-state coding |
| 11 | **Antigravity** | Senior Dev / 2nd Staff Engineer | Antigravity IDE | Multi-file TS/Python features, complex autonomous PRs |

### Agent #5 Sub-Profiles

GitHub Copilot Agents operate through five custom profiles in `.github/agents/`:

| Profile | File | Specialty |
|---------|------|-----------|
| `@copilot/backend-dev` | `backend-dev.agent.md` | Express routes, DB queries, eval features |
| `@copilot/frontend-dev` | `frontend-dev.agent.md` | Next.js components, shadcn/ui, TanStack |
| `@copilot/test-writer` | `test-writer.agent.md` | Vitest unit tests, edge cases |
| `@copilot/ops-engineer` | `ops-engineer.agent.md` | PM2, deploy scripts, log analysis, CI/CD |
| `@copilot/docs-writer` | `docs-writer.agent.md` | Mintlify docs, repo markdown, runbooks |

---

## 2. Workstream Assignments

| Workstream | Primary | Secondary | Notes |
|------------|---------|-----------|-------|
| **Frontend** (Next.js + shadcn/ui) | v0.dev (#7) | Antigravity (#11) | v0 generates from specs; Antigravity wires multi-file features |
| **Backend** (Express/TypeScript) | Copilot CLI (#2) | Codex (#4, async) | Pattern-following routes and middleware |
| **Python analytics** (39 scripts) | Gemini CLI (#3) | Codex (#4) / Jules (#6) | `analytics/*.py` — data enrichment, tearsheets, stats |
| **IBKR trading integration** | Copilot CLI (#2) / Cursor (#10) | -- | **Human-in-the-loop required for all changes** |
| **Docker / PM2 / Deploy** | Amazon Q (#9) | Copilot CLI (#2) | `ecosystem.config.cjs`, `deploy/*`, Dockerfiles |
| **CI/CD pipeline** | Jules (#6, API) | Qodo (#8) | `.github/workflows/*`, automated checks |
| **Code quality / testing** | Qodo (#8) | Jules (#6) | Edge case discovery, coverage audits |
| **Docs / runbooks** | Codex (#4) | Gemini CLI (#3) | `docs/*.mdx`, `*.md`, Mintlify site |
| **Eval engine** | Claude Code (#1) | Antigravity (#11) | Ensemble scorer, feature engine, model providers |
| **MCP tools** | Claude Code (#1) | -- | `src/mcp/*` — Claude Code exclusive |

---

## 3. Authority Matrix

### NEVER (no agent, no exception)

| Action | Reason |
|--------|--------|
| Submit, modify, or cancel orders | Human-only via IBKR TWS |
| Modify risk gate parameters (`src/ibkr/risk-gate.ts`) | Safety-critical |
| Delete production data without backup | Irreversible |
| Touch IBKR connection manager (`src/ibkr/connection.ts`) | Stability-critical |
| Modify order execution logic (`src/ibkr/orders.ts`, `src/ibkr/orders_impl/*`) | Safety-critical |
| Merge own PR | Human merges all PRs |

### RESTRICTED (requires human approval)

| Action | Approval Required |
|--------|-------------------|
| Database schema changes (`src/db/*`) | Human approval before merge |
| Reconciliation logic (`src/db/reconcile.ts`) | Claude Code (#1) review + human approval |
| MCP tool definitions (`src/mcp/*`) | Claude Code (#1) only, human approval |
| Environment variable changes (`.env*`) | Human approval |
| Package dependency additions | Human approval |
| Deploy script changes (`deploy/*`) | Human approval |

### OPEN (any authorized agent within their workstream)

| Action | Who Can Do It |
|--------|---------------|
| Write/update tests | Qodo (#8), Jules (#6), Copilot test-writer (#5) |
| Write/update docs | Codex (#4), Gemini CLI (#3), Copilot docs-writer (#5) |
| CI/CD config (`.github/workflows/*`) | Jules (#6), Copilot ops-engineer (#5), Amazon Q (#9) |
| Frontend components (`frontend/src/components/*`) | v0 (#7), Antigravity (#11), Copilot frontend-dev (#5), Cursor (#10) |
| Eval feature modules (`src/eval/features/*`) | Any agent within scope |
| REST route handlers (`src/rest/routes.ts`) | Copilot backend-dev (#5), Antigravity (#11), Cursor (#10) |
| Python analytics scripts (`analytics/*.py`) | Gemini CLI (#3), Jules (#6), Codex (#4) |

### PR Review Chain

```
Agent creates PR --> Claude Code (#1) reviews --> Human merges
```

No agent merges its own PR. Claude Code acts as Staff Engineer reviewer for all agent-generated PRs.

---

## 4. Cost Routing

| # | Agent | Cost Model | Monthly Estimate | Billing |
|---|-------|-----------|------------------|---------|
| 1 | Claude Code | Anthropic API / Max subscription | $20-100/mo | Anthropic |
| 2 | Copilot CLI | GitHub Copilot Pro+ | $10-39/mo | GitHub |
| 3 | Gemini CLI | Google AI Free tier / Pro | Free | Google |
| 4 | Codex | ChatGPT Plus / Pro | $20/mo | OpenAI |
| 5 | Copilot Agents | Included in Copilot Pro+ | (see #2) | GitHub |
| 6 | Jules | Google AI Free / Pro | Free-$42/mo | Google |
| 7 | v0.dev | Vercel Free / Pro | Free-$20/mo | Vercel |
| 8 | Qodo | Free / Teams | Free-$38/mo | Qodo |
| 9 | Amazon Q | Free / Pro | Free-$19/mo | AWS |
| 10 | Cursor | Free / Pro | Free-$20/mo | Cursor |
| 11 | Antigravity | Free (preview) | Free | Google |

**Shared subscriptions:**
- Google AI Pro (~$42/mo) covers Jules (#6) + Antigravity (#11) + Gemini CLI (#3)
- GitHub Copilot Pro+ ($39/mo) covers Copilot CLI (#2) + Copilot Agents (#5)
- ChatGPT Plus/Pro ($20/mo) covers Codex (#4)

---

## 5. Concurrent Work Rules

**Never assign two agents to the same module/surface at the same time.** One repo can support parallel work, but two agents editing the same files produces merge conflicts and wasted tokens.

- One task, one owner, one branch, one PR.
- Use worktrees or isolated branches per task — never share a working copy between agents.
- If follow-up work is needed (e.g., tests after a feature), create a new issue after the first PR merges.

### Escalation Protocol

| Situation | Action |
|-----------|--------|
| Agent stuck > 30 min | Escalate to Claude Code (#1) |
| Security concern (secrets, auth, injection) | **Stop immediately** + alert human |
| Order / risk gate / execution operations | **ALWAYS human-only** -- no agent touches these |
| Multi-agent conflict (two agents editing same file) | Claude Code (#1) arbitrates |
| Agent produces failing PR (3+ attempts) | Reassign to Claude Code (#1) or Antigravity (#11) |
| Database migration needed | Claude Code (#1) writes migration, human approves |
| Unknown scope (task doesn't fit any agent) | Claude Code (#1) scopes the work, then delegates |

### Decision Tree

```
New task arrives
  |
  +-- Touches execution-critical files (orders, risk gate, connection)?
  |     YES --> Human only (no agent)
  |
  +-- Touches 3+ files or wires subsystems together?
  |     YES --> Claude Code (#1)
  |
  +-- Self-contained UI component with clear props/API?
  |     YES --> v0 (#7) generates, Copilot/Antigravity wires
  |
  +-- Python analytics script?
  |     YES --> Gemini CLI (#3)
  |
  +-- Long-running, async-friendly (7+ hours)?
  |     YES --> Codex (#4)
  |
  +-- Tests needed?
  |     YES --> Qodo (#8) for edge cases, Copilot test-writer (#5) for structured suites
  |
  +-- Docs / runbook update?
  |     YES --> Codex (#4) or Copilot docs-writer (#5)
  |
  +-- CI/CD or deploy config?
  |     YES --> Amazon Q (#9) or Jules (#6)
  |
  +-- Unsure?
        --> Claude Code (#1) scopes the work, then delegates
```

---

## 6. Collaboration Channel (Session Log)

The collab channel is a persistent decision/context log used by Claude Code and ChatGPT. It is **not** reachable from GitHub-hosted agents (Copilot, Codex, Jules).

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/collab/messages` | GET | Read messages (params: `limit`, `author`, `type`) |
| `/api/collab/message` | POST | Post message (body: `{ author, content, type?, metadata? }`) |

**Message types:** `info` (status update, FYI), `decision` (architectural or implementation choice)

**Who uses it:**
- **Claude Code** — via MCP tools (`collab_read`/`collab_post`). Primary user for cross-session context.
- **ChatGPT** — via REST action catalog. Posts analysis summaries and decisions.
- **Copilot / others** — cannot reach localhost. Human relays context via issue descriptions.

---

## 7. Code Standards (All Agents)

| Rule | Detail |
|------|--------|
| Logger | Pino (`import { logger } from "../logging.js"`) -- never `console.log` |
| Imports | ESM with `.js` extensions (backend), bare paths (frontend) |
| Exports | Named exports only -- no `export default` |
| DB | better-sqlite3, WAL mode, prepared statements, parameterized queries |
| Validation | Zod for all external inputs |
| Frontend theme | Dark always (`bg-background`, `text-foreground`, `bg-card`) |
| Frontend UI | shadcn/ui primitives, `cn()` for class merging |
| Frontend numbers | `font-mono` for numeric/data values |
| TypeScript | Strict mode, `npx tsc --noEmit` must pass |
| Tests | Vitest, in-memory SQLite, `describe`/`it` pattern |
| Branches | `feat/[issue-number]-[short-description]` |
| PR body | "What changed" + "Why" + "How verified" |
