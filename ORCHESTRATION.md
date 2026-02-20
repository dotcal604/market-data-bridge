# Market Data Bridge — Agent Orchestration

> 15-agent fleet managed via **GitHub Agent HQ** + external tool-specific instruction files.
>
> Agent HQ provides unified Mission Control across GitHub, VS Code, and CLI. Custom agent profiles live in `.github/agents/`. File-based conditional instructions in `.github/instructions/`. See `AGENTS.md` for the full team roster, cost routing, and authority matrix.

## Agent Fleet

### Core Agents (GitHub Agent HQ)

| Agent | Role | Model | Interface | Reads AGENTS.md |
|-------|------|-------|-----------|-----------------|
| **Claude Code** | Staff Engineer / Tech Lead — execution-critical code, integration, planning, MCP tools | Claude Opus 4.6 | CLI (local) | Yes (via CLAUDE.md) |
| **GitHub Copilot** | Mid-Level Dev — ops, tests, features following existing patterns | GPT-4.1 / Claude 3.5 | GitHub Issues → Draft PRs, 5 custom agent modes | Via `.github/agents/` |
| **OpenAI Codex** | Junior Dev (spec executor) — single-file changes, schemas, docs | GPT-5.2-Codex | chatgpt.com/codex, @codex on issues | Yes (auto-discovery) |

### Extended Fleet (External Tools)

| Agent | Role | Interface | Instructions File |
|-------|------|-----------|-------------------|
| **Claude Desktop** | Senior Dev (pair programming) | Chat UI / Cowork | `HANDSHAKE.md` card |
| **ChatGPT** | Senior Consultant / Architect | Chat UI | `HANDSHAKE.md` card |
| **Google Jules** | Junior Dev (probationary) | jules.google | `HANDSHAKE.md` card |
| **Qodo Gen** | QA Automation Engineer | IDE Extension | Reads codebase |
| **Windsurf** | Senior Dev (IDE-native) | Windsurf IDE | `WINDSURF.md` |
| **v0 by Vercel** | UI/UX Designer | v0.dev | Component specs |
| **GHAS** | Security Auditor | CI/CD | Auto-configured |
| **NotebookLM** | Internal Librarian | notebooklm.google.com | `GEMINI.md` |
| **Google Antigravity** | Senior Dev / 2nd Staff Engineer | Antigravity IDE | `GEMINI.md` |
| **Amazon Q** | CI/CD & Infra Engineer | IDE Extension / CLI | `AMAZON_Q.md` |
| **Mintlify AI** | Technical Writer / Docs Owner | mintlify.com | `docs/` directory |

### Instruction Files Architecture

```
.github/
├── copilot-instructions.md          ← Always-on (all chat requests)
├── agents/
│   ├── backend-dev.agent.md         ← @copilot/backend-dev
│   ├── frontend-dev.agent.md        ← @copilot/frontend-dev
│   ├── test-writer.agent.md         ← @copilot/test-writer
│   ├── ops-engineer.agent.md        ← @copilot/ops-engineer
│   └── docs-writer.agent.md         ← @copilot/docs-writer
├── instructions/
│   ├── typescript.instructions.md   ← Applies to src/**/*.ts
│   ├── frontend.instructions.md     ← Applies to frontend/**/*.tsx,*.ts
│   ├── tests.instructions.md        ← Applies to **/*.test.ts
│   └── docs.instructions.md         ← Applies to docs/**/*.mdx
└── workflows/
    ├── ci.yml
    ├── api-audit.yml
    └── agent-auto-merge.yml

AGENTS.md          ← Always-on (multi-agent, read by all AI tools)
CLAUDE.md          ← Always-on (Claude compatibility)
GEMINI.md          ← Antigravity + NotebookLM
WINDSURF.md        ← Windsurf IDE / Cascade
AMAZON_Q.md        ← Amazon Q Developer
HANDSHAKE.md       ← Agent cards for manual paste (Claude Desktop, ChatGPT, Jules, etc.)
```

## Decision Tree

```
New task arrives
  │
  ├─ Touches 3+ files or wires subsystems together?
  │   └─ YES → Claude Code (orchestrator)
  │
  ├─ Self-contained UI component with clear props/API?
  │   └─ YES → GitHub Copilot (via issue + assign)
  │
  ├─ Long-running feature, complex refactor, or needs 7+ hours?
  │   └─ YES → OpenAI Codex (cloud sandbox, parallel tasks)
  │
  ├─ Backend route + frontend page + DB migration?
  │   └─ Claude Code builds backend, creates issue for Copilot/Codex
  │
  ├─ Want to compare agent outputs?
  │   └─ Assign multiple agents to same issue via Agent HQ
  │
  └─ Unsure?
      └─ Claude Code scopes the work, then delegates
```

## GitHub Agent HQ

Agent HQ is GitHub's unified control plane for managing multiple AI coding agents. Announced at Universe 2025, expanded Feb 2026.

### What It Provides

- **Mission Control** — single dashboard to see, steer, and approve work across all agents (GitHub web, VS Code, Mobile, CLI)
- **Multi-agent assignment** — assign Copilot, Codex, Claude, or multiple agents to the same issue
- **Custom agent profiles** — `.github/agents/*.agent.md` files for specialized roles (e.g. `@copilot/frontend-dev`, `@copilot/test-writer`)
- **Plan Mode** — agents ask clarifying questions before writing code, reducing wasted effort
- **Enterprise controls** — granular permissions, sandboxed execution, branch protection

### Custom Agent Profiles

Located in `.github/agents/`. Each file defines a specialized agent role:

```yaml
---
name: frontend-dev
description: Frontend component specialist for Next.js dashboard
tools: ["read", "edit", "search"]
---

{Behavioral instructions in markdown}
```

Invoke via `@copilot/frontend-dev` when assigning issues.

See `.github/agents/` for this repo's custom profiles:
- `frontend-dev.agent.md` — Next.js dashboard components
- `backend-dev.agent.md` — Express/TypeScript backend tasks
- `test-writer.agent.md` — Vitest unit test generation
- `ops-engineer.agent.md` — PM2, ecosystem.config, deploy scripts
- `docs-writer.agent.md` — Mintlify docs + repo documentation

### Setup

1. **Copilot Pro+ or Enterprise** subscription required for Agent HQ
2. Navigate to repo → Issues → assign agent (Copilot, Codex, or Claude)
3. Monitor via Mission Control in GitHub web UI or VS Code
4. Custom agents auto-discovered from `.github/agents/`

---

## Issue Template: Copilot

Copilot produces the best results when issues include **exact file paths, props interfaces, API endpoints, and acceptance criteria**. Derived from successful PRs #11, #12, #13.

```markdown
## Component: `frontend/src/components/{category}/{name}.tsx`

{One-sentence description of what this component does.}

### Props Interface
\`\`\`tsx
interface {Name}Props {
  // Exact TypeScript interface — Copilot will implement this verbatim
}
\`\`\`

### API Endpoints Used
- `GET /api/{endpoint}` — {what it returns}
- `POST /api/{endpoint}` — {what it accepts}

### Requirements
- {Specific UI library}: `recharts`, `@tanstack/react-table`, shadcn/ui primitives
- {Behavior}: sorting, filtering, auto-refresh interval, form validation rules
- {Styling}: dark theme, model colors from `@/lib/utils/colors`, `font-mono` for numbers
- `"use client"` directive at top
- Named export `{ComponentName}`
- Wrap in `Card` from `@/components/ui/card`

### Files to Create/Modify
- **Create**: `frontend/src/components/{category}/{name}.tsx`
- **Modify** (if needed): `frontend/src/app/{route}/page.tsx` — mount the component
- **Modify** (if needed): `frontend/src/lib/hooks/use-{domain}.ts` — add React Query hook

### Dependencies
Already in `frontend/package.json`: {list installed packages}
Need to install: {list if any — prefer avoiding new deps}

### Acceptance Criteria
- [ ] Component renders with sample/mock data
- [ ] {Specific behavior verified}
- [ ] Dark theme compatible (no white backgrounds, correct text colors)
- [ ] TypeScript compiles clean: `cd frontend && npx tsc --noEmit`
- [ ] No `console.log` in committed code

### Context
- Design reference: {link to comparable UI, screenshot, or description}
- Related issues: #{number}
- Backend endpoint source: `src/rest/routes.ts` lines {X-Y}
```

### What Makes a Good Copilot Issue

From PRs #11 (score scatter), #12 (weight sliders), #13 (time-of-day chart):

**Worked well:**
- Exact props interface in the issue body — Copilot implements it verbatim
- Specific file paths (`frontend/src/components/analytics/score-scatter.tsx`)
- Library imports spelled out (`ScatterChart`, `Scatter`, `XAxis`, `YAxis`)
- Color values hardcoded (`emerald-400`, `#10b981`)
- Acceptance criteria as checkbox list
- Screenshots in PR descriptions (Copilot generates these automatically)

**Watch out for:**
- Copilot's firewall blocks `fonts.googleapis.com` — cosmetic, builds succeed
- Copilot creates demo pages (e.g. `/weights/demo`) — review whether to keep or remove
- Put all conventions in the issue itself — don't assume Copilot knows the data shape

## Issue Template: Codex

Codex excels at **long-running, complex tasks** that benefit from parallel cloud execution. Tag `@codex` on issues/PRs, or start tasks at chatgpt.com/codex.

```markdown
## Task: {description}

{What needs to be built or changed.}

### Files Involved
- `{path/to/file.ts}` — {what to change}
- `{path/to/new-file.ts}` — {what to create}

### Requirements
- {Specific behavior, edge cases, error handling}
- Read AGENTS.md for project conventions
- Two package.json files: root (backend) + frontend/

### Verification
\`\`\`bash
# Backend
npx tsc --noEmit

# Frontend
cd frontend && npx tsc --noEmit
\`\`\`

### Acceptance Criteria
- [ ] {Specific testable outcomes}
- [ ] TypeScript compiles clean
- [ ] No `console.log` — use Pino logger for backend
```

## Issue Template: Docs Writer

Documentation PRs must be evidence-backed. No vibes-based claims.

```markdown
## Doc Change: `docs/{path}.mdx` or `{path}.md`

{One-sentence description of the documentation update.}

### Requirements
- **Evidence-backed claims**: all runtime descriptions must link to code or config.
- **Cite code path**: `src/{path}/{file}.ts` lines {X-Y}
- **Cite endpoint**: `GET /api/{endpoint}` (if applicable)
- **Cite env var**: `{ENV_VAR_NAME}` (if applicable)

### Files to Modify
- **Modify**: `docs/{path}.mdx`
- **Modify** (if new page): `docs/docs.json` (update navigation)

### Style Guidelines
- Use Mintlify `<Warning>`, `<Info>`, or `<Steps>` if appropriate
- Keep tone professional and direct
- If behavior is uncertain, use: **"TBD (verify in code)"**

### Acceptance Criteria
- [ ] Claims verified against current codebase
- [ ] Links and anchors are correct
- [ ] No hallucinations about future or unreleased features
- [ ] Mintlify dev preview looks clean: `cd docs && npx mint dev`
```

### Codex Cloud Environment

Configure at [chatgpt.com/codex/settings/environments](https://chatgpt.com/codex/settings/environments):

**Setup script:**
```bash
npm install && cd frontend && npm install && cd ..
```

**Key capabilities:**
- Tasks run in cloud sandboxes (container state cached 12 hours)
- Parallel task execution across issues
- GPT-5.2-Codex model (optimized for agentic coding)
- Internet access configurable per task
- Reads AGENTS.md via auto-discovery chain

**Historical note:** Early Codex (PRs #3, #23) had broken PR bodies and no env setup. Current Codex (GPT-5.2) resolves all previous issues — reads AGENTS.md, supports setup scripts, generates proper PR descriptions.

## Agent Comparison

| Scenario | Copilot | Codex |
|----------|---------|-------|
| Self-contained UI component | Best | Good |
| Multi-file component + page wiring | Proved (PRs #11-13) | Good |
| Long-running complex feature (7+ hours) | No | Best |
| Parallel tasks across issues | Via separate issues | Native (cloud) |
| Python scripts / analytics | Possible | Good |
| Needs exact issue spec | Yes (verbatim) | Natural language OK |
| Reads AGENTS.md | Via issue body | Auto-discovery |
| Build verification | GitHub Actions sandbox | Cloud sandbox |
| Cost | Copilot Pro+ | ChatGPT Pro/Plus |

---

## Phase Orchestration Pattern

Each roadmap phase uses a **parent meta-issue** that tracks child issues:

```markdown
## Phase {N}: {Name}

Tracking issue for all {Phase Name} work.

### Issues
- [ ] #{id} — {title} (assigned: @copilot)
- [ ] #{id} — {title} (assigned: @codex)

### Dependencies
- Blocked by: Phase {N-1} completion
- Blocks: Phase {N+1}

### Definition of Done
- All child issues closed
- `cd frontend && npx tsc --noEmit` passes
- New pages accessible from sidebar nav
- No regressions in existing pages
```

## Review Workflow

```
1. Agent creates draft PR from issue (Copilot/Codex)
2. Claude Code reviews (or human reviews):
   - Does it follow AGENTS.md conventions?
   - Does TypeScript compile clean?
   - Is the component wired into the page layout?
   - Are there unnecessary files (demo pages, test fixtures)?
3. Request changes or approve
4. Human merges (no auto-merge)
5. Close the linked issue
```

## Labels

| Label | Purpose |
|-------|---------|
| `agent-task` | Any agent-delegated work |
| `phase-0` through `phase-8` | Roadmap phase tracking |
| `copilot` | Assigned to GitHub Copilot |
| `codex` | Assigned to OpenAI Codex |
| `claude-code` | Done by Claude Code directly |
| `api-migration` | API dependency migration tasks |
| `api-audit` | Automated API audit findings |
| `blocked` | Waiting on dependency |
| `needs-review` | PR ready for review |

## Backend Additions (Claude Code)

Some frontend work requires new or modified backend endpoints. Claude Code handles these directly before creating agent issues:

| Phase | Backend Work | Then Agent Builds |
|-------|-------------|-------------------|
| Phase 2 | `GET /api/eval/outcomes` (evals + outcomes joined) | Score scatter with real data |
| Phase 2 | `POST /api/eval/weights/simulate` (re-score with custom weights) | Weight slider "what if" preview |
| Phase 3 | None — all endpoints exist | Account, positions, orders pages |
| Phase 4 | None — all endpoints exist | Journal + collab feed |
| Phase 5 | None — all endpoints exist | Market data tools |

## Firewall Configuration

Copilot's GitHub Actions environment blocks external network by default. To allow:

1. Go to repo Settings → Copilot → Coding Agent
2. Add to custom allowlist:
   - `fonts.googleapis.com` (if using Google Fonts)
   - `registry.npmjs.org` (already allowed for npm install)

Currently not blocking builds — the `fonts.googleapis.com` warning in PRs #11-13 is cosmetic.

## Agent Setup Checklist

### OpenAI Codex
1. Go to [chatgpt.com/codex](https://chatgpt.com/codex) → connect GitHub account
2. Select `dotcal604/market-data-bridge` repository
3. Configure environment setup script: `npm install && cd frontend && npm install && cd ..`
4. AGENTS.md auto-discovered — no additional config needed
5. Test: create a task from chatgpt.com/codex or tag `@codex` on an issue

### GitHub Copilot (Agent HQ)
1. Copilot Pro+ or Enterprise subscription required
2. Assign Copilot to issues via GitHub web UI (cannot be done via CLI)
3. Custom agent profiles in `.github/agents/` auto-discovered
4. Monitor via Mission Control in GitHub web UI or VS Code

### Custom Agent Profiles
Located in `.github/agents/`. See files for specialized roles:
- `frontend-dev.agent.md` — Next.js dashboard components
- `backend-dev.agent.md` — Express/TypeScript backend tasks
- `test-writer.agent.md` — Vitest unit test generation
- `ops-engineer.agent.md` — PM2, ecosystem.config, deploy scripts
- `docs-writer.agent.md` — Mintlify docs + repo documentation
