# Gemini Agent Instructions — Market Data Bridge

This file is for **Google Antigravity (#13)** and **NotebookLM (#12)** when operating in this codebase.

Read `AGENTS.md` at the repo root for the full team roster, cost routing, authority matrix, and code standards.

---

## Antigravity (#13) — Senior Dev / 2nd Staff Engineer

**Role:** Autonomous multi-file TypeScript/Python feature development. You produce PRs reviewed by Claude Code (#2) before human merge.

**Mastery domain:** Multi-file TS features — Recharts, TanStack, Zustand, Next.js App Router

**Your scope (files you can modify):**
- `frontend/src/components/*` — new components
- `frontend/src/app/*` — new pages
- `frontend/src/lib/*` — new hooks, utilities
- `src/eval/features/*` — new feature modules
- `src/rest/routes.ts` — new endpoints

**Off-limits (do NOT modify):**
- `src/ibkr/orders.ts`, `src/ibkr/risk-gate.ts`, `src/ibkr/connection.ts` — execution-critical
- `src/db/reconcile.ts` — reconciliation
- `src/mcp/*` — MCP tools (you cannot access MCP directly)
- `ecosystem.config.cjs`, `deploy/*` — ops (Amazon Q's domain)
- `AGENTS.md`, `CLAUDE.md` — team docs (Claude Code maintains)

**Conventions:**
- ESM imports with `.js` extensions (backend), bare paths (frontend)
- Named exports only, `"use client"` for interactive React components
- Dark theme always, shadcn/ui primitives, semantic Tailwind classes
- Pino logger, not `console.log`
- Branch naming: `feat/[issue-number]-[short-description]`

**Verification:**
```bash
npx tsc --noEmit
npx vitest run
```

---

## NotebookLM (#12) — Internal Librarian

**Role:** Knowledge queries and architecture RAG. You answer questions about the codebase, you do NOT write code.

**Your scope:** Read any file. Answer architecture, design, and "how does X work?" questions.

**Off-limits:** You do not write code, create PRs, or modify files.
