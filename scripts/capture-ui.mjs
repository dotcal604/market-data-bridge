#!/usr/bin/env node

/**
 * capture-ui.mjs — Puppeteer-based frontend screenshot capture.
 *
 * Workflow:
 *   1. Builds the Next.js frontend static export (frontend/out/)
 *   2. Starts a lightweight HTTP server on a random port
 *   3. Navigates to each page and captures a full-page PNG screenshot
 *   4. Saves screenshots to docs-site/static/previews/
 *   5. Shuts down the server
 *
 * Prerequisites:
 *   - Puppeteer installed (npm install puppeteer)
 *   - Frontend dependencies installed (cd frontend && npm install)
 *
 * Usage:
 *   node scripts/capture-ui.mjs
 *
 * The script is designed to be called by generate-docs.mjs but can run standalone.
 * Screenshots show UI shell/layout without live data (backend not required).
 */

import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');

// ── Configuration ────────────────────────────────────────────────────────

/** Pages to capture. Each entry maps a filename to a URL path. */
const PAGES = [
  { name: 'dashboard', path: '/' },
  { name: 'evals', path: '/evals' },
  { name: 'orders', path: '/orders' },
  { name: 'account', path: '/account' },
  { name: 'market', path: '/market' },
  { name: 'journal', path: '/journal' },
  { name: 'divoom', path: '/divoom' },
];

/** Viewport dimensions for screenshots. */
const VIEWPORT = { width: 1280, height: 800 };

/** Output directory for captured PNGs. */
const OUTPUT_DIR = resolve(ROOT, 'docs-site/static/previews');

/** Path to the Next.js static export output. */
const FRONTEND_OUT = resolve(ROOT, 'frontend/out');

// ── MIME type lookup ─────────────────────────────────────────────────────
const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

// ── Step 1: Build frontend ───────────────────────────────────────────────
console.log('  Building Next.js frontend for static export...\n');

try {
  execSync('npm run build', {
    cwd: resolve(ROOT, 'frontend'),
    stdio: 'inherit',
    env: { ...process.env, FRONTEND_STATIC_EXPORT: '1' },
  });
} catch (err) {
  console.error('  [FAIL] Frontend build failed. Skipping screenshot capture.');
  process.exit(1);
}

if (!existsSync(FRONTEND_OUT)) {
  console.error(`  [FAIL] Frontend output directory not found: ${FRONTEND_OUT}`);
  process.exit(1);
}

// ── Step 2: Start static file server ─────────────────────────────────────
/** Simple static file server for the exported Next.js site. */
function createStaticServer(root) {
  return createServer((req, res) => {
    let filePath = join(root, req.url === '/' ? 'index.html' : req.url);

    // Try adding .html extension for clean URLs
    if (!existsSync(filePath) && !extname(filePath)) {
      if (existsSync(filePath + '.html')) {
        filePath += '.html';
      } else if (existsSync(join(filePath, 'index.html'))) {
        filePath = join(filePath, 'index.html');
      }
    }

    if (!existsSync(filePath)) {
      // Fallback to index.html for client-side routing
      filePath = join(root, 'index.html');
    }

    try {
      const content = readFileSync(filePath);
      const ext = extname(filePath);
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
      res.end(content);
    } catch {
      res.writeHead(404);
      res.end('Not Found');
    }
  });
}

// ── Step 3: Capture screenshots ──────────────────────────────────────────
async function captureScreenshots() {
  // Dynamically import puppeteer (it may not be installed in all environments)
  let puppeteer;
  try {
    puppeteer = await import('puppeteer');
  } catch {
    console.error('  [FAIL] Puppeteer not installed. Run: npm install puppeteer');
    process.exit(1);
  }

  mkdirSync(OUTPUT_DIR, { recursive: true });

  // Start the static server on a random available port
  const server = createStaticServer(FRONTEND_OUT);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  console.log(`  Static server running on http://localhost:${port}\n`);

  let browser;
  try {
    browser = await puppeteer.default.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const page = await browser.newPage();
    await page.setViewport(VIEWPORT);

    for (const { name, path } of PAGES) {
      const url = `http://localhost:${port}${path}`;
      const outputPath = resolve(OUTPUT_DIR, `${name}.png`);

      try {
        console.log(`  Capturing ${name} (${path})...`);
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 });
        // Brief pause to let any CSS transitions settle
        await new Promise((r) => setTimeout(r, 500));
        await page.screenshot({ path: outputPath, fullPage: true });
        console.log(`    -> Saved ${outputPath}`);
      } catch (err) {
        console.error(`    -> [FAIL] ${name}: ${err.message}`);
      }
    }
  } finally {
    if (browser) await browser.close();
    server.close();
  }

  console.log('\n  Screenshot capture complete.\n');
}

await captureScreenshots();
