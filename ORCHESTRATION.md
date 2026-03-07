# Market Data Bridge — Orchestration Guide

How agents collaborate, hand off work, and integrate with the CI/CD pipeline.

For the full team roster, cost routing, and authority matrix, see [AGENTS.md](AGENTS.md).
For MCP-specific instructions and session protocols, see [CLAUDE.md](CLAUDE.md).

---

## 1. Issue-to-Agent Pipeline

Every piece of work flows through this pipeline, from idea to merged code.

```
 IDEA                ISSUE               ASSIGN              EXECUTE
  │                   │                   │                    │
  │  Human writes     │  Pick template:   │  Route to agent    │  Agent creates
  │  a spec with      │  copilot-task     │  based on:         │  branch, writes
  │  file paths +     │  codex-task       │  1. Mastery domain │  code, verifies
  │  acceptance       │  bug-report       │  2. Cost tier      │  locally (tsc +
  │  criteria         │  feature-request  │  3. Capacity       │  vitest)
  │                   │                   │                    │
  v                   v                   v                    v

 REVIEW              FIX                 MERGE                VERIFY
  │                   │                   │                    │
  │  Qodo auto-       │  Same agent       │  Human gives       │  CI confirms:
  │  reviews PR       │  gets feedback    │  final approval    │  tsc --noEmit
  │  (quality gate)   │  and fixes        │  Squash merge      │  vitest run
  │  CI runs          │                   │  to main           │  npm run build
  │  (ci.yml +        │                   │                    │  (ci-build.yml)
  │  ci-build.yml)    │                   │                    │
  v                   v                   v                    v
```

### Step-by-step

1. **Create issue** using `copilot-task` or `codex-task` template. Include exact file paths, TypeScript interfaces, API endpoints used, and acceptance criteria. Vague specs waste tokens.
2. **Select agent profile** (for copilot-task): `@copilot` (default), `@copilot/frontend-dev`, `@copilot/backend-dev`, `@copilot/test-writer`, `@copilot/ops-engineer`, or `@copilot/docs-writer`.
3. **Agent picks up issue**, reads `AGENTS.md` + `CLAUDE.md`, creates a branch following naming conventions (see Section 3).
4. **Agent implements**, runs local verification (`npx tsc --noEmit`, `npx vitest run`), then pushes a PR with `Fixes #N` in the description.
5. **Qodo auto-reviews PR** — checks for bugs, logic gaps, missing tests, security issues.
6. **CI runs** two pipelines:
   - `ci.yml` — type-check (backend + frontend) + vitest (fast correctness gate, runs on PR and push to main)
   - `ci-build.yml` — full build verification: `npm run build` + `next build` + tests (PR only, confirms artifacts compile)
7. **Human reviews and approves** — exec-critical files (`orders.ts`, `risk-gate.ts`, `connection.ts`, `reconcile.ts`) always require human review regardless of agent tier.
8. **Squash merge to main** — one clean commit per feature.

### Template Selection Guide

| Template | When to Use | Best For |
|----------|------------|----------|
| `copilot-task` | Pattern-following features with clear specs | Frontend components, backend routes, ops scripts, tests, docs |
| `codex-task` | Isolated async work, single-file changes | Zod schemas, JSDoc, TypeScript refactors, docs |
| Bug Report | Runtime issues, unexpected behavior | Any agent based on file ownership |
| Feature Request | New capabilities, design discussions | Triage first, then delegate |

---

## 2. Handoff Protocol

When one agent needs to pass work to another, use the collaboration channel and GitHub handoff mechanisms.

### Collaboration Channel

All agents share context through the AI-to-AI collab channel:

```
Post:   POST /api/collab/message
Read:   GET  /api/collab/messages?type={type}&limit={n}&author={agent}
```

Claude Code agents use the MCP tools directly: `collab_read` / `collab_post`.
Copilot agents use the REST API with `X-API-Key` header.

**Message types:**
- `info` — status update, FYI
- `request` — asking another agent to act
- `decision` — recording an architectural or implementation choice
- `handoff` — transferring ownership of a task
- `blocker` — flagging something stuck and needing help

### Standard Handoff Chains

```
backend-dev ──(tests needed)──> test-writer
backend-dev ──(docs needed)───> docs-writer

frontend-dev ──(tests needed)──> test-writer
frontend-dev ──(docs needed)───> docs-writer

ops-engineer ──(code fix needed)──> backend-dev
ops-engineer ──(runbook update)───> docs-writer

test-writer ──(code bug found)──> backend-dev

docs-writer ──(code sample verify)──> backend-dev or frontend-dev
```

### Handoff Procedure

1. **Sending agent** completes its work, pushes PR.
2. **Sending agent** posts to collab channel:
   ```json
   {
     "author": "backend-dev",
     "type": "handoff",
     "content": "Implemented GET /api/eval/history. Tests needed for edge cases (empty DB, invalid params). See PR #42.",
     "metadata": { "pr": 42, "files": ["src/rest/routes.ts"], "target": "test-writer" }
   }
   ```
3. **Receiving agent** checks collab channel on task start (`GET /api/collab/messages?type=handoff&limit=5`), acknowledges, and creates a follow-up PR.
4. **Receiving agent** posts completion summary back to collab channel with `type: "info"`.

### External Handoffs (Manual)

These agents are not on the GitHub collab channel. The human coordinates manually:

| Need | Target | Process |
|------|--------|---------|
| UI design from mockup | v0.dev (Agent #10) | Human pastes spec at v0.dev, exports code, creates issue for frontend-dev |
| Architecture review | ChatGPT (Agent #4) | Human opens chat, pastes context, records decision in collab channel |
| Knowledge query | NotebookLM (Agent #12) | Human queries at notebooklm.google.com, posts findings to collab channel |
| Multi-file feature | Antigravity (Agent #13) | Human assigns in Antigravity IDE, reviews PR |

### Collab Channel Reachability

Not all agents can reach the collab channel. This table shows actual reachability:

| Agent | Collab Access | Method | Notes |
|-------|--------------|--------|-------|
| Claude Code (#2) | **Direct** | MCP tools (`collab_read`/`collab_post`) | Full access, primary user |
| ChatGPT (#4) | **Direct** | REST API via action catalog | 3 mandatory startup steps |
| Copilot agents (#5) | **Indirect** | REST instructions in `.agent.md` | Runs in GitHub sandbox — can't reach localhost. Collab protocol is aspirational until Copilot gets network access or MCP support |
| Other agents | **None** | Human relays via collab channel | v0, Jules, Codex, NotebookLM — no programmatic access |

---

## 3. Branch Naming Conventions

```
Format: {type}/{agent-name}/{short-description}

Examples:
  feat/backend-dev/eval-history-endpoint
  fix/ops-engineer/ci-cache-invalidation
  docs/docs-writer/api-reference-update
  test/test-writer/risk-gate-edge-cases
```

### Prefixes

| Prefix | Use Case |
|--------|----------|
| `feat/` | New features, components, endpoints |
| `fix/` | Bug fixes, error handling corrections |
| `docs/` | Documentation changes only |
| `test/` | Test additions or modifications only |
| `chore/` | Dependency updates, config changes, cleanup |
| `refactor/` | Code restructuring without behavior change |

### Agent Name Slugs

| Agent | Slug |
|-------|------|
| GitHub Copilot (default) | `copilot` |
| Copilot backend-dev | `backend-dev` |
| Copilot frontend-dev | `frontend-dev` |
| Copilot test-writer | `test-writer` |
| Copilot ops-engineer | `ops-engineer` |
| Copilot docs-writer | `docs-writer` |
| OpenAI Codex | `codex` |
| Google Jules | `jules` |
| Claude Code | `claude` |
| Windsurf | `windsurf` |
| Antigravity | `antigravity` |

### Claude Code Worktrees

Claude Code uses git worktrees for isolated parallel work:

```
.claude/worktrees/{name}/       # Temporary worktree directory
```

These are ephemeral and cleaned up after the session. They do not follow the branch naming convention above — the worktree name is auto-generated.

---

## 4. PR Review Flow

```
 Agent pushes PR
       │
       v
 ┌─────────────────────┐
 │  Qodo Merge reviews  │  Automated quality gate:
 │  (PR Agent)           │  - Bug detection
 │                       │  - Logic gap analysis
 │                       │  - Missing test coverage
 │                       │  - Security flags
 └──────────┬────────────┘
            │
            v
 ┌─────────────────────┐
 │  CI pipeline runs    │  Two workflows triggered on PR:
 │                      │
 │  ci.yml:             │  ci-build.yml:
 │  ├─ npm ci           │  ├─ npm install
 │  ├─ tsc --noEmit     │  ├─ tsc --noEmit
 │  ├─ vitest run       │  ├─ npm run build
 │  ├─ frontend npm ci  │  ├─ npm test
 │  └─ frontend tsc     │  ├─ frontend tsc
 │                      │  └─ frontend next build
 └──────────┬───────────┘
            │
            ├── CI FAILS ──> Agent fixes and pushes again.
            │                On main: ci-auto-issue.yml creates
            │                a GitHub issue with failing test names
            │                and assigns to @copilot/test-writer.
            │
            v (CI PASSES)
 ┌─────────────────────┐
 │  Human final review  │  Required for ALL merges.
 │                      │  Exec-critical files require
 │                      │  paper account test before
 │                      │  production deployment.
 └──────────┬───────────┘
            │ APPROVED
            v
 ┌─────────────────────┐
 │  Squash merge        │  One commit per feature.
 │  to main             │  Branch auto-deleted.
 └──────────────────────┘
```

### Review Checklist

- PR description includes `Fixes #N`
- TypeScript compiles clean (backend + frontend)
- Tests pass and cover new code paths
- No `console.log` in committed code (use Pino logger for backend)
- Agent stayed within its file scope (check against AGENTS.md)
- Exec-critical files NOT modified without human approval
- Dark theme compliance (frontend PRs)
- Named exports, ESM `.js` extensions (backend PRs)

### CI Pipeline Details

| Workflow | Trigger | Steps | Purpose |
|----------|---------|-------|---------|
| `ci.yml` | PR to main + push to main | `tsc --noEmit` (backend + frontend) + `vitest run` | Fast correctness gate |
| `ci-build.yml` | PR to main only | `npm run build` + `npm test` + `next build` | Full build artifact verification |
| `ci-auto-issue.yml` | Push to main only | Same as ci.yml + auto-creates GitHub issue on failure | Catches regressions that slip through PR review |
| `api-audit.yml` | Weekly (Monday 9 AM ET) + manual | `npm audit` + endpoint coverage scan | Dependency + API quality gate |

Both `ci.yml` and `ci-build.yml` must pass green before merge is allowed.

---

## 5. Scheduled Task Integration

Scheduled tasks run on a recurring basis and feed issues into the agent pipeline when they detect problems.

### Active Scheduled Tasks

All tasks run via Claude Code scheduled tasks (`~/.claude/scheduled-tasks/`). Results post to the collab channel and create GitHub issues on failure.

| Scheduled Task | Schedule | What It Does | On Failure | Assigned To |
|---------------|----------|-------------|------------|-------------|
| `nightly-tests` | Daily 2 AM | `tsc --noEmit` + `vitest run` | Creates issue + collab blocker | `@copilot/test-writer` |
| `nightly-backup` | Daily 3 AM | Database backup with 7-day retention | Creates issue | `@copilot/ops-engineer` |
| `weekly-api-audit` | Monday 9 AM | Endpoint coverage + dependency audit | Creates issue | `@copilot/backend-dev` |
| `weekly-ops-check` | Monday 10 AM | DB integrity, log errors, npm audit, git status | Creates issue + collab blocker | `@copilot/ops-engineer` |
| `pre-market-scan` | Weekdays 8:30 AM | Gap scanner + watchlist builder | Writes to `.claude/memory/` | N/A (data only) |

### Flow

```
Scheduled task runs
       │
       ├── SUCCESS ──> Log result to collab channel (type: "info"), no issue created
       │
       └── FAILURE / WARNING
              │
              v
       Create GitHub issue with structured spec:
       ├─ What failed (test names, endpoint gaps, health warnings)
       ├─ Relevant logs or output
       ├─ Suggested fix (if deterministic)
       └─ Assign to responsible agent profile
              │
              v
       Issue enters normal pipeline (Section 1)
```

### Memory Integration

The `pre-market-scan` task and session activity write to `.claude/memory/` for cross-session continuity:

```
.claude/memory/
├── MEMORY.md          # Project overview, architecture decisions, current state
├── patterns.md        # Code conventions, calculation definitions, testing patterns
└── session-log.md     # Append-only log of session activity
```

All agents and Claude Code sessions read `.claude/memory/` on start to pick up context from previous sessions across machines. See CLAUDE.md for the session-log format.

---

## 6. Emergency Procedures

### Production Incident

```
INCIDENT DETECTED
       │
       v
  Human takes control immediately.
  All agent work PAUSED — do not assign new tasks.
       │
       v
  Assess severity:
  ├── Data issue       ──> Check data/bridge.db integrity (PRAGMA integrity_check)
  ├── Process crash    ──> Check logs/pm2-error.log, restart via PM2
  ├── TWS disconnect   ──> Restart TWS, verify connection via get_status
  └── Order issue      ──> STOP. Human-only resolution. No agent involvement.
       │
       v
  Fix applied by human (or Claude Code under direct human supervision).
  Post-incident: ops-engineer creates issue for preventive fix.
```

### Position Flattening

**ALWAYS human-only.** No agent may call `flatten_positions` or modify `flatten_config` autonomously.

The `flatten_positions` MCP tool flattens all positions to cash immediately. This is a last-resort action triggered only by the human operator via Claude Code in an interactive session. No scheduled task, no automation, no exception.

### Database Recovery

1. **Stop the bridge process** — `pm2 stop all` or kill the process
2. **Restore from backup** — nightly backups in `data/backups/`
3. **Verify integrity** — `PRAGMA integrity_check` on restored database
4. **Restart bridge** — `pm2 start ecosystem.config.cjs`
5. **ops-engineer investigates** — create issue with root cause analysis, assign to `@copilot/ops-engineer`

### Escalation Path

When an agent cannot resolve an issue, escalate up the seniority chain:

```
Jules/Codex ──> Copilot ──> Windsurf ──> Antigravity ──> Claude Code ──> Human
  (Junior)      (Mid)       (Senior)     (2nd Staff)     (Staff Eng)    (EM)
```

For exec-critical files (`orders.ts`, `risk-gate.ts`, `connection.ts`, `reconcile.ts`), skip directly to **Claude Code + Human**. No junior or mid-level agent touches these files.

### Exec-Critical File List

These files require **human review + paper account test** before any merge:

- `src/ibkr/orders.ts` / `src/ibkr/orders_impl/*`
- `src/ibkr/risk-gate.ts`
- `src/ibkr/connection.ts`
- `src/db/reconcile.ts`

No agent may modify these without explicit human approval in the PR.
