#!/usr/bin/env node

/**
 * Production Build Script for Market Data Bridge
 *
 * This script:
 * 1. Compiles TypeScript with tsc
 * 2. Builds frontend static export (FRONTEND_STATIC_EXPORT=1)
 * 3. Verifies output directories exist
 * 4. Emits version file with build timestamp + git commit hash
 *
 * Usage: node scripts/build-production.mjs
 */

import { execSync } from 'child_process';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const projectRoot = resolve(__dirname, '..');

const BUILD_DIR = resolve(projectRoot, 'build');
const FRONTEND_OUT_DIR = resolve(projectRoot, 'frontend', 'out');
const VERSION_FILE = resolve(BUILD_DIR, 'version.json');

function log(msg) {
  console.log(`[build-production] ${msg}`);
}

function error(msg) {
  console.error(`[build-production] ERROR: ${msg}`);
  process.exit(1);
}

function runCommand(cmd, description) {
  try {
    log(`Running: ${description}`);
    log(`  > ${cmd}`);
    execSync(cmd, { stdio: 'inherit', cwd: projectRoot });
    log(`✓ ${description}`);
  } catch (err) {
    error(`${description} failed with exit code ${err.status}`);
  }
}

function getGitInfo() {
  try {
    const commit = execSync('git rev-parse --short HEAD', {
      cwd: projectRoot,
      encoding: 'utf-8'
    }).trim();

    const branch = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: projectRoot,
      encoding: 'utf-8'
    }).trim();

    return { commit, branch };
  } catch (err) {
    log('Warning: Could not get git info (not a git repo or git not available)');
    return { commit: 'unknown', branch: 'unknown' };
  }
}

function emitVersionFile(commit, branch) {
  const timestamp = new Date().toISOString();
  const version = require(resolve(projectRoot, 'package.json')).version;

  const versionData = {
    version,
    commit,
    branch,
    timestamp,
    buildDate: new Date().toISOString().split('T')[0],
    node: process.version,
    platform: process.platform,
  };

  // Ensure build directory exists
  if (!existsSync(BUILD_DIR)) {
    mkdirSync(BUILD_DIR, { recursive: true });
  }

  writeFileSync(VERSION_FILE, JSON.stringify(versionData, null, 2));
  log(`Version file emitted: ${VERSION_FILE}`);
  log(`  Version: ${version}`);
  log(`  Commit: ${commit}`);
  log(`  Branch: ${branch}`);
  log(`  Timestamp: ${timestamp}`);
}

function verifyOutputDirectories() {
  log('Verifying output directories...');

  if (!existsSync(BUILD_DIR)) {
    error(`Build directory not found: ${BUILD_DIR}`);
  }
  log(`✓ Build directory exists: ${BUILD_DIR}`);

  // Check for compiled JavaScript files
  try {
    execSync(`test -f "${resolve(BUILD_DIR, 'index.js')}"`, { stdio: 'pipe' });
    log(`✓ Main entrypoint compiled: ${resolve(BUILD_DIR, 'index.js')}`);
  } catch {
    error(`Main entrypoint not found: ${resolve(BUILD_DIR, 'index.js')}`);
  }

  // Frontend is optional
  if (existsSync(FRONTEND_OUT_DIR)) {
    log(`✓ Frontend static export exists: ${FRONTEND_OUT_DIR}`);
  } else {
    log(`⚠ Frontend static export not found (optional): ${FRONTEND_OUT_DIR}`);
  }
}

// Main execution
async function main() {
  log('Starting production build process...');
  log(`Project root: ${projectRoot}`);

  // Step 1: Compile TypeScript
  runCommand('npm run build', 'TypeScript compilation');

  // Step 2: Build frontend static export
  runCommand(
    'FRONTEND_STATIC_EXPORT=1 npm run build:frontend',
    'Frontend static export'
  );

  // Step 3: Get git info
  const { commit, branch } = getGitInfo();

  // Step 4: Emit version file
  emitVersionFile(commit, branch);

  // Step 5: Verify output
  verifyOutputDirectories();

  log('');
  log('='.repeat(60));
  log('Production build completed successfully!');
  log('='.repeat(60));
  log(`Build directory: ${BUILD_DIR}`);
  log(`Frontend export: ${FRONTEND_OUT_DIR}`);
  log(`Version file: ${VERSION_FILE}`);
  log('');
  log('Ready for Docker build. Run:');
  log(`  docker build -f Dockerfile.prod -t market-data-bridge .`);
  log('');
}

main().catch(err => {
  error(`Unexpected error: ${err.message}`);
});
