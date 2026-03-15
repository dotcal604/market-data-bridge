#!/usr/bin/env node

/**
 * generate-docs.mjs — End-to-end documentation generation script.
 *
 * Orchestrates the full docs pipeline:
 *   1. Clean previous generated output
 *   2. Run TypeDoc to generate Markdown API docs
 *   3. Run Mermaid CLI to render diagrams to SVG
 *   4. Run capture-ui.mjs to take frontend screenshots (optional)
 *   5. Build the Docusaurus site
 *
 * Usage:
 *   node scripts/generate-docs.mjs              # Full pipeline
 *   node scripts/generate-docs.mjs --skip-ui    # Skip Puppeteer screenshots
 *   node scripts/generate-docs.mjs --no-build   # Generate assets only, skip Docusaurus build
 *
 * Each step runs independently — a failure in one step does not block the others.
 * Exit code is 0 if at least the Docusaurus build succeeds, 1 otherwise.
 */

import { execSync } from 'node:child_process';
import { rmSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');

// ── Parse CLI flags ──────────────────────────────────────────────────────
const args = process.argv.slice(2);
const skipUi = args.includes('--skip-ui');
const noBuild = args.includes('--no-build');

// ── Helpers ──────────────────────────────────────────────────────────────

/** Run a shell command, logging output. Returns true on success. */
function run(label, cmd, opts = {}) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  ${label}`);
  console.log(`${'='.repeat(60)}\n`);

  try {
    execSync(cmd, {
      cwd: opts.cwd || ROOT,
      stdio: 'inherit',
      env: { ...process.env, ...opts.env },
    });
    console.log(`\n  [OK] ${label}\n`);
    return true;
  } catch (err) {
    console.error(`\n  [FAIL] ${label}: ${err.message}\n`);
    return false;
  }
}

/** Remove a directory if it exists, then recreate it. */
function cleanDir(dir) {
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
  mkdirSync(dir, { recursive: true });
}

// ── Step 1: Clean previous output ────────────────────────────────────────
console.log('\n  Cleaning previous generated output...\n');

const apiOut = resolve(ROOT, 'docs-site/docs/api');
const diagramOut = resolve(ROOT, 'docs-site/static/diagrams');
const previewOut = resolve(ROOT, 'docs-site/static/previews');

cleanDir(apiOut);
cleanDir(diagramOut);
cleanDir(previewOut);

// ── Step 2: TypeDoc — Generate API docs ──────────────────────────────────
// Generates Markdown files into docs-site/docs/api/ using typedoc-plugin-markdown.
// These are picked up by Docusaurus as regular doc pages.
const typedocOk = run(
  'TypeDoc — Generating API Reference',
  'npx typedoc'
);

// ── Step 3: Mermaid CLI — Render diagrams to SVG (optional) ──────────────
// Attempts to render .mmd files from diagrams/ to SVGs in docs-site/static/diagrams/.
// If mmdc is unavailable (no browser in CI), diagrams are still rendered client-side
// by the Docusaurus Mermaid theme plugin via inline ```mermaid blocks in the docs.
const diagramsDir = resolve(ROOT, 'diagrams');
let mermaidOk = true;

if (existsSync(diagramsDir)) {
  const mmdFiles = readdirSync(diagramsDir).filter(f => f.endsWith('.mmd'));

  if (mmdFiles.length === 0) {
    console.log('\n  No .mmd files found in diagrams/. Skipping Mermaid rendering.\n');
  } else {
    for (const file of mmdFiles) {
      const input = resolve(diagramsDir, file);
      const output = resolve(diagramOut, file.replace('.mmd', '.svg'));
      const ok = run(
        `Mermaid — Rendering ${file}`,
        `npx mmdc -i "${input}" -o "${output}" -t default -b transparent`
      );
      if (!ok) mermaidOk = false;
    }
  }

  if (!mermaidOk) {
    console.log('  Note: Mermaid CLI rendering failed (likely no browser available).');
    console.log('  Diagrams will still render client-side via Docusaurus Mermaid theme.\n');
    mermaidOk = true; // Don't treat as fatal — inline Mermaid is the primary approach
  }
} else {
  console.log('\n  diagrams/ directory not found. Skipping Mermaid rendering.\n');
}

// ── Step 4: Puppeteer — Capture frontend screenshots ─────────────────────
// Builds the Next.js frontend, serves it locally, and captures screenshots
// of key pages. Skipped with --skip-ui flag (useful in CI without Chrome).
let uiOk = true;

if (skipUi) {
  console.log('\n  Skipping UI screenshots (--skip-ui flag).\n');
} else {
  uiOk = run(
    'Puppeteer — Capturing frontend screenshots',
    'node scripts/capture-ui.mjs'
  );
}

// ── Step 5: Build Docusaurus site ────────────────────────────────────────
// Produces the final static site in docs-site/build/.
let buildOk = true;

if (noBuild) {
  console.log('\n  Skipping Docusaurus build (--no-build flag).\n');
} else {
  buildOk = run(
    'Docusaurus — Building documentation site',
    'npm run build',
    { cwd: resolve(ROOT, 'docs-site') }
  );
}

// ── Summary ──────────────────────────────────────────────────────────────
console.log(`\n${'='.repeat(60)}`);
console.log('  Documentation Generation Summary');
console.log(`${'='.repeat(60)}`);
console.log(`  TypeDoc API docs:    ${typedocOk ? 'OK' : 'FAILED'}`);
console.log(`  Mermaid diagrams:    ${mermaidOk ? 'OK' : 'FAILED'}`);
console.log(`  UI screenshots:      ${skipUi ? 'SKIPPED' : uiOk ? 'OK' : 'FAILED'}`);
console.log(`  Docusaurus build:    ${noBuild ? 'SKIPPED' : buildOk ? 'OK' : 'FAILED'}`);
console.log(`${'='.repeat(60)}\n`);

if (!noBuild && !buildOk) {
  process.exit(1);
}
