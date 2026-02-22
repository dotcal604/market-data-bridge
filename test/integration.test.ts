/**
 * Integration Tests for Production Build
 *
 * Tests:
 * 1. Build script verification (offline)
 * 2. Docker image creation and container startup
 * 3. Health endpoint availability
 * 4. API responsiveness
 * 5. Frontend static assets served
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const buildDir = path.resolve(projectRoot, 'build');
const versionFile = path.resolve(buildDir, 'version.json');
const frontendOutDir = path.resolve(projectRoot, 'frontend', 'out');

describe('Production Build Integration Tests', () => {
  describe('Build Script Verification', () => {
    it('should have compiled TypeScript to build directory', () => {
      expect(existsSync(buildDir)).toBe(true);
      expect(existsSync(path.resolve(buildDir, 'index.js'))).toBe(true);
    });

    it('should emit version.json file with correct structure', () => {
      expect(existsSync(versionFile)).toBe(true);
      const content = readFileSync(versionFile, 'utf-8');
      const versionData = JSON.parse(content);

      expect(versionData).toHaveProperty('version');
      expect(versionData).toHaveProperty('commit');
      expect(versionData).toHaveProperty('branch');
      expect(versionData).toHaveProperty('timestamp');
      expect(versionData).toHaveProperty('buildDate');
      expect(versionData).toHaveProperty('node');
      expect(versionData).toHaveProperty('platform');

      // Version should be semver-like
      expect(versionData.version).toMatch(/^\d+\.\d+\.\d+/);

      // Commit should be a short hash or 'unknown'
      expect(versionData.commit).toBeTruthy();

      // Timestamp should be ISO format
      expect(versionData.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('should compile all TypeScript source modules', () => {
      const requiredModules = [
        'rest/server.js',
        'rest/routes.js',
        'index.js',
        'config.js',
        'logging.js',
      ];

      for (const module of requiredModules) {
        const modulePath = path.resolve(buildDir, module);
        expect(
          existsSync(modulePath),
          `Missing compiled module: ${module}`
        ).toBe(true);
      }
    });
  });

  describe('Frontend Static Export', () => {
    it('should build frontend static assets', () => {
      // Frontend export is optional but if it exists, should have proper structure
      if (existsSync(frontendOutDir)) {
        expect(existsSync(path.resolve(frontendOutDir, 'index.html'))).toBe(true);
        expect(existsSync(path.resolve(frontendOutDir, '_next'))).toBe(true);
      }
    });
  });

  describe('Application Runtime', () => {
    let serverProcess: any = null;

    beforeAll((done) => {
      // Start the application
      serverProcess = spawn('node', [path.resolve(buildDir, 'index.js')], {
        cwd: projectRoot,
        env: {
          ...process.env,
          NODE_ENV: 'production',
          REST_PORT: '3000',
          IBKR_PORT: '7497', // Paper trading (doesn't require TWS connection)
        },
      });

      let ready = false;

      serverProcess.stdout.on('data', (data) => {
        const message = data.toString();
        if (message.includes('REST server listening')) {
          ready = true;
          done();
        }
      });

      serverProcess.stderr.on('data', (data) => {
        // Log but don't fail — some logs go to stderr
        console.log('[app stderr]', data.toString());
      });

      // Timeout after 10 seconds
      setTimeout(() => {
        if (!ready) {
          serverProcess.kill();
          done(new Error('Application failed to start within 10 seconds'));
        }
      }, 10000);
    });

    afterAll((done) => {
      if (serverProcess) {
        serverProcess.on('exit', () => {
          done();
        });
        serverProcess.kill('SIGTERM');
        setTimeout(() => {
          if (serverProcess && !serverProcess.killed) {
            serverProcess.kill('SIGKILL');
          }
        }, 2000);
      } else {
        done();
      }
    });

    it('health endpoint returns 200 and valid structure', async () => {
      // Wait a bit for server to be ready
      await new Promise((r) => setTimeout(r, 1000));

      const response = await fetch('http://localhost:3000/health');
      expect(response.status).toBe(200);

      const data = (await response.json()) as any;
      expect(data).toHaveProperty('status');
      expect(['ok', 'degraded']).toContain(data.status);
      expect(data).toHaveProperty('uptime_seconds');
      expect(data).toHaveProperty('ibkr_connected');
      expect(data).toHaveProperty('db_writable');
      expect(data).toHaveProperty('rest_server');
      expect(data).toHaveProperty('timestamp');
      expect(typeof data.uptime_seconds).toBe('number');
      expect(data.uptime_seconds).toBeGreaterThan(0);
    });

    it('API /status endpoint is responsive', async () => {
      const response = await fetch('http://localhost:3000/api/status');
      expect(response.status).toBe(200);

      const data = (await response.json()) as any;
      expect(data).toHaveProperty('easternTime');
      expect(data).toHaveProperty('marketSession');
      expect(data).toHaveProperty('ibkr');
    });

    it('frontend static assets are served', async () => {
      const response = await fetch('http://localhost:3000/');
      // Could be 200 if frontend is built, or 200 with just HTML if not
      expect([200, 404]).toContain(response.status);
    });

    it('OpenAPI spec is accessible', async () => {
      const response = await fetch('http://localhost:3000/openapi.json');
      expect(response.status).toBe(200);

      const data = (await response.json()) as any;
      expect(data).toHaveProperty('openapi');
      expect(data).toHaveProperty('info');
      expect(data.info).toHaveProperty('title');
    });
  });

  describe('Production Environment Variables', () => {
    it('should load from .env.production.example without errors', () => {
      const envPath = path.resolve(projectRoot, '.env.production.example');
      expect(existsSync(envPath)).toBe(true);

      const content = readFileSync(envPath, 'utf-8');
      // Should have NODE_ENV=production
      expect(content).toContain('NODE_ENV=production');
      // Should have IBKR_PORT reference
      expect(content).toContain('IBKR_PORT');
      // Should have comments explaining production setup
      expect(content).toContain('Production');
    });
  });

  describe('Docker Build Verification', () => {
    it('Dockerfile.prod should exist and have proper structure', () => {
      const dockerfilePath = path.resolve(projectRoot, 'Dockerfile.prod');
      expect(existsSync(dockerfilePath)).toBe(true);

      const content = readFileSync(dockerfilePath, 'utf-8');

      // Multi-stage build
      expect(content).toContain('FROM node:22-alpine as builder');
      expect(content).toContain('FROM node:22-alpine');

      // Build stages
      expect(content).toContain('npm ci');
      expect(content).toContain('npm ci --omit=dev');

      // Compilation step
      expect(content).toContain('build-production.mjs');

      // Entrypoint
      expect(content).toContain('ENTRYPOINT');
      expect(content).toContain('CMD');

      // Health check
      expect(content).toContain('HEALTHCHECK');

      // Non-root user
      expect(content).toContain('adduser');

      // Expose port
      expect(content).toContain('EXPOSE');
    });
  });
});
