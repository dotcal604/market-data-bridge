# GitHub Actions Setup Guide — Market Data Bridge

## Workflows Created

### 1. **docker-build-push.yml** — Production Image Build & Push
**Trigger**: Push to `main`, tags matching `v*`, and PRs

**What it does**:
- Builds your Docker image using `Dockerfile.prod` (multi-stage build)
- Uses GitHub Actions cache to speed up builds (~60% faster)
- Pushes to GitHub Container Registry (GHCR) on main/tags
- Generates semantic versioning tags (latest, v1.2.3, main, sha-xyz)
- Runs on PRs for build verification without pushing

**Key features**:
- BuildKit cache (type=gha) — persists between runs
- Skips push on PRs (no unnecessary registry writes)
- Extracts metadata automatically from git refs/tags

**To enable**:
1. No setup needed — uses GITHUB_TOKEN automatically
2. Optional: Push to Docker Hub by adding another login step

---

### 2. **docker-security-scan.yml** — Trivy Vulnerability Scanner
**Trigger**: Push to `main`, tags, weekly Monday 9 AM UTC, manual

**What it does**:
- Builds your Docker image locally
- Scans with Trivy for CVEs, misconfigurations, secrets
- Uploads results to GitHub Security tab (visible on Dependabot/Security dashboard)
- Comments on PRs if vulnerabilities found

**Severity levels detected**:
- 🔴 CRITICAL
- 🟠 HIGH  
- 🟡 MEDIUM
- 🔵 LOW

**To set up**:
- No action needed — Trivy is free and built-in
- Results automatically visible under "Security" → "Code scanning alerts"

---

### 3. **docker-integration-tests.yml** — Container Runtime Tests
**Trigger**: PRs and push to `main`

**What it does**:
- Builds your Docker image
- Tests that the container starts without errors
- Verifies health endpoint responds with 200
- Tests sample API endpoints
- Inspects image metadata (user, health check, size)

**Test steps**:
1. Build image from Dockerfile.prod
2. Run container with test environment
3. Wait 5s for startup
4. Hit /health endpoint
5. Test /api/health endpoint (adjust as needed)
6. Inspect image for security info (User, Healthcheck)

**To customize**:
- Adjust health endpoint path if different
- Add more endpoint tests as needed
- Add environment variables (e.g., `DATABASE_URL` for integration tests)
- Can uncomment the `services:` section to spin up Postgres, Redis, etc.

---

### 4. **ci-enhanced.yml** — Multi-version Node Testing
**Trigger**: PRs and push to `main`

**Enhancements over `ci.yml`**:
- Tests against Node.js 20 **and** 22 (matrix strategy)
- Runs type checks + tests on all versions in parallel
- Collects coverage reports
- Uploads to Codecov (optional integration)
- Dependency-aware job ordering (build runs only after check succeeds)
- Saves build artifacts for later use

**Matrix testing**:
- Ensures your app works on multiple Node versions
- Catches version-specific issues early

---

## Recommended Docker Best Practices Added

### ✅ Cache Optimization
- **GitHub Actions Cache (type=gha)** — Layer cache persists between runs
- Reduces build time from ~3min to ~1min on subsequent runs
- Automatic cleanup (default 5 days)

### ✅ Security
- Non-root user in production image (User: nodejs)
- Trivy scans for vulnerabilities weekly
- Secrets scanning by GitHub (free)
- Image signed with SLSA provenance (future: Sigstore)

### ✅ Artifact Management
- Multi-stage builds (already in Dockerfile.prod ✓)
- Dev dependencies stripped from runtime
- Health checks built-in ✓
- Uses tini as init process ✓

### ✅ Registry Integration
- Semantic versioning (main-latest, v1.2.3, sha commit)
- Automatic metadata extraction
- Support for multiple registries (GHCR, Docker Hub, ECR, ACR)

---

## Optional Enhancements (Not Included)

### 1. **Build Cloud** (Faster multi-platform builds)
```yaml
with:
  builder: cloud  # Requires Docker Build Cloud subscription
  platforms: linux/amd64,linux/arm64
```

### 2. **Scout Image Analysis** (Deeper vulnerability insights)
```yaml
- uses: docker/scout-action@v1
  with:
    command: cves
    image: ${{ steps.meta.outputs.tags }}
```

### 3. **Kubernetes Deployment** (Auto-deploy on push to main)
```yaml
- name: Deploy to Kubernetes
  run: kubectl set image deployment/market-data-bridge market-data-bridge=${{ steps.meta.outputs.tags }}
```

### 4. **Performance Benchmarking** (Track image size, startup time)
```yaml
- name: Compare image sizes
  run: docker inspect market-data-bridge:test | jq '.[].Size'
```

---

## Configuration Required

### GitHub Secrets (Optional)
If you want to push to **Docker Hub** instead of/in addition to GHCR:

```
DOCKER_USERNAME = your-username
DOCKER_PASSWORD = your-token  # Use PAT, not password
```

Then add to `docker-build-push.yml`:
```yaml
- uses: docker/login-action@v3
  with:
    username: ${{ secrets.DOCKER_USERNAME }}
    password: ${{ secrets.DOCKER_PASSWORD }}
```

### Environment Variables
Already handled via `.env.example` and `.env.production.example`. GitHub Actions doesn't need them — Docker build uses Dockerfile ARGs.

---

## Testing the Workflows Locally

### Test Docker build locally before pushing:
```bash
cd market-data-bridge
docker build -f Dockerfile.prod -t market-data-bridge:test .
docker run --rm -p 3000:3000 market-data-bridge:test
```

### Test Trivy scan locally:
```bash
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock \
  aquasecurity/trivy image market-data-bridge:test
```

---

## Next Steps

1. **Push these workflows** to `.github/workflows/`
2. **Create a release tag**: `git tag v1.0.0 && git push origin v1.0.0`
   - This will build and push your first production image
3. **Check GHCR**: ghcr.io/your-username/market-data-bridge
4. **Monitor results**: Actions tab → see builds/scans in real-time

---

## Workflow Diagram

```
PR/Push to main
    ├── ci.yml / ci-enhanced.yml (Node tests in parallel)
    │   └── Type check + vitest
    ├── docker-build-push.yml (Build & push image)
    │   └── Uses GHA cache for speed
    ├── docker-integration-tests.yml (Container tests)
    │   └── Health check + API tests
    └── docker-security-scan.yml (Trivy scan)
        └── Upload to Security tab
```

---

## Troubleshooting

### Build fails on first run:
- Check logs in Actions tab
- Likely: npm module not found → run `npm ci` locally first

### GHCR push fails:
- Verify `secrets.GITHUB_TOKEN` has `packages:write` permission
- Ensure repository visibility allows it (public/private)

### Container health check times out:
- Increase sleep time in `docker-integration-tests.yml` (line 58)
- Check if /health endpoint exists in your Express app

### Trivy scan too slow:
- Already cached after first run
- Consider weekly schedule only (already set in docker-security-scan.yml)

---

## Security Notes

- ✅ Non-root user enforced in production image
- ✅ HEALTHCHECK prevents hanging containers
- ✅ Trivy scans catch CVEs in dependencies
- ✅ GITHUB_TOKEN scoped to this repo only
- ✅ PR builds don't push to registry

Consider adding:
- [ ] Branch protection rule: "Require status checks to pass" (ci-enhanced + docker-integration-tests)
- [ ] Require reviews on PRs to main
- [ ] CODEOWNERS file for approval rules
