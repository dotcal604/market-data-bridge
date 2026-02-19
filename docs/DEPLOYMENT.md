# Market Data Bridge — Production Deployment Guide

This guide covers production deployment of Market Data Bridge using Docker across multiple cloud platforms.

## Table of Contents

1. [Quick Start](#quick-start)
2. [Docker Build](#docker-build)
3. [DigitalOcean Deployment](#digitalocean-deployment)
4. [AWS Lambda Deployment](#aws-lambda-deployment)
5. [Environment Configuration](#environment-configuration)
6. [Health Checks & Monitoring](#health-checks--monitoring)
7. [Troubleshooting](#troubleshooting)

---

## Quick Start

### Local Docker Run

1. **Build the production image:**
   ```bash
   docker build -f Dockerfile.prod -t market-data-bridge:latest .
   ```

2. **Run the container:**
   ```bash
   docker run -d \
     -p 3000:3000 \
     -e IBKR_PORT=7497 \
     -e NODE_ENV=production \
     --name market-bridge \
     market-data-bridge:latest
   ```

3. **Verify health:**
   ```bash
   curl http://localhost:3000/health
   ```

### With Docker Compose

Create `docker-compose.prod.yml`:

```yaml
version: '3.8'

services:
  market-bridge:
    build:
      context: .
      dockerfile: Dockerfile.prod
    ports:
      - "3000:3000"
    environment:
      NODE_ENV: production
      IBKR_PORT: 7497
      IBKR_HOST: 127.0.0.1
      REST_PORT: 3000
      # Add API keys from secrets or .env
      # ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}
      # OPENAI_API_KEY: ${OPENAI_API_KEY}
      # GOOGLE_AI_API_KEY: ${GOOGLE_AI_API_KEY}
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s
    restart: unless-stopped
    volumes:
      # Optional: persist database
      - ./data:/app/data
      # Optional: persist logs
      - ./logs:/app/logs
```

Run:
```bash
docker-compose -f docker-compose.prod.yml up -d
```

---

## Docker Build

### Build Script

The production build is controlled by `scripts/build-production.mjs`, which:

1. Compiles TypeScript with `tsc`
2. Builds the Next.js frontend as static export
3. Creates a version file with git commit info and timestamp
4. Verifies output directories

### Multi-Stage Build

The `Dockerfile.prod` uses a two-stage build:

**Stage 1: Builder**
- Node 22 Alpine with build tools (Python, make, g++, cairo-dev)
- Installs all dependencies (dev + prod)
- Compiles TypeScript and frontend
- Outputs to `/build/build` and `/build/frontend/out`

**Stage 2: Runtime**
- Minimal Alpine image with node:22-alpine
- Only installs production dependencies (`--omit=dev`)
- Copies compiled assets from builder
- Non-root user for security
- Health check enabled

### Build Performance

- **Build time**: ~3-5 minutes (depends on npm install)
- **Final image size**: ~400-500 MB (node:22-alpine + dependencies)
- **Optimizations**: Two-stage build removes build tools from final image

### Build Arguments

No custom build args are used (defaults only). To customize:

```bash
docker build -f Dockerfile.prod \
  --build-arg NODE_VERSION=22 \
  -t market-data-bridge:1.0.0 .
```

---

## DigitalOcean Deployment

### Option A: App Platform (Recommended)

1. **Connect GitHub repo to DigitalOcean App Platform**
2. **Create app with:**
   - Runtime: Docker (build from Dockerfile.prod)
   - Port: 3000
   - Health check: GET /health (30s interval, 5s timeout)

3. **Set environment variables** in App Platform:
   ```
   NODE_ENV=production
   IBKR_PORT=7497
   REST_PORT=3000
   ```

4. **Add secrets** (use DigitalOcean Apps Secrets):
   ```
   ANTHROPIC_API_KEY
   OPENAI_API_KEY
   GOOGLE_AI_API_KEY
   REST_API_KEY
   ```

5. **Configure networking:**
   - Expose via HTTPS (automatic Let's Encrypt)
   - Optional: Restrict to API key auth (REST_API_KEY env var)

### Option B: DigitalOcean Droplet

1. **Create Droplet:**
   - OS: Ubuntu 22.04 LTS
   - Size: Basic ($4-6/month) for testing, Standard ($12+) for production
   - Region: Closest to IBKR gateway

2. **Install Docker:**
   ```bash
   curl -fsSL https://get.docker.com | sh
   sudo usermod -aG docker $USER
   ```

3. **Clone repo and build:**
   ```bash
   git clone https://github.com/yourusername/market-data-bridge.git
   cd market-data-bridge
   docker build -f Dockerfile.prod -t market-data-bridge .
   ```

4. **Run with systemd service** (`/etc/systemd/system/market-bridge.service`):
   ```ini
   [Unit]
   Description=Market Data Bridge
   After=docker.service
   Requires=docker.service

   [Service]
   Type=simple
   User=root
   ExecStart=/usr/bin/docker run --rm \
     -p 3000:3000 \
     -e NODE_ENV=production \
     -e IBKR_PORT=7497 \
     --name market-bridge \
     market-data-bridge
   Restart=on-failure
   RestartSec=10

   [Install]
   WantedBy=multi-user.target
   ```

5. **Enable and start:**
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable market-bridge
   sudo systemctl start market-bridge
   ```

6. **Reverse proxy with Nginx:**
   ```nginx
   upstream market_bridge {
     server 127.0.0.1:3000;
   }

   server {
     listen 80;
     server_name market.example.com;
     client_max_body_size 10M;

     location / {
       proxy_pass http://market_bridge;
       proxy_set_header Host $host;
       proxy_set_header X-Real-IP $remote_addr;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       proxy_set_header X-Forwarded-Proto $scheme;
       proxy_buffering off;
     }
   }
   ```

7. **Set up HTTPS with Certbot:**
   ```bash
   sudo apt install certbot python3-certbot-nginx
   sudo certbot --nginx -d market.example.com
   ```

---

## AWS Lambda Deployment

### Using AWS Lambda with Docker Container Image

Market Data Bridge can run on AWS Lambda by containerizing the Express server.

#### Prerequisites

- AWS Account with ECR (Elastic Container Registry) access
- AWS CLI configured
- Docker installed locally

#### Deployment Steps

1. **Create ECR repository:**
   ```bash
   aws ecr create-repository --repository-name market-data-bridge --region us-east-1
   ```

2. **Build and push to ECR:**
   ```bash
   # Login to ECR
   aws ecr get-login-password --region us-east-1 | \
     docker login --username AWS --password-stdin \
     123456789.dkr.ecr.us-east-1.amazonaws.com

   # Build image
   docker build -f Dockerfile.prod -t market-data-bridge:latest .

   # Tag for ECR
   docker tag market-data-bridge:latest \
     123456789.dkr.ecr.us-east-1.amazonaws.com/market-data-bridge:latest

   # Push
   docker push 123456789.dkr.ecr.us-east-1.amazonaws.com/market-data-bridge:latest
   ```

3. **Create Lambda function:**
   ```bash
   aws lambda create-function \
     --function-name market-data-bridge \
     --role arn:aws:iam::123456789:role/lambda-role \
     --code ImageUri=123456789.dkr.ecr.us-east-1.amazonaws.com/market-data-bridge:latest \
     --package-type Image \
     --timeout 300 \
     --memory-size 512 \
     --environment Variables="{NODE_ENV=production,IBKR_PORT=7497,REST_PORT=3000}" \
     --region us-east-1
   ```

4. **Create API Gateway integration:**
   - Create REST API
   - Create proxy resource (/{proxy+})
   - Create ANY method pointing to Lambda function
   - Deploy stage

5. **Enable provisioned concurrency** (optional, reduces cold start):
   ```bash
   aws lambda put-provisioned-concurrency-config \
     --function-name market-data-bridge \
     --provisioned-concurrent-executions 2 \
     --region us-east-1
   ```

#### Lambda Limitations

- **Cold start**: ~10-15s (first request after idle)
- **Execution timeout**: Max 15 minutes (configured to 5 min)
- **Memory**: 128MB-10GB (recommend 512MB minimum)
- **IBKR connection**: Requires VPC setup or NAT gateway for outbound connectivity
- **Database**: Use RDS for persistence instead of local SQLite, or use EFS

#### Lambda + RDS Setup (Production)

1. **Create RDS PostgreSQL instance**
2. **Update connection string**:
   ```bash
   DATABASE_URL=postgresql://user:pass@rds-instance.amazonaws.com/market_bridge
   ```
3. **Update Lambda to use database**:
   - Place in VPC with RDS subnet
   - Configure security group to allow Lambda → RDS traffic

---

## Environment Configuration

### Production Recommended Variables

```bash
# Application
NODE_ENV=production
REST_PORT=3000

# IBKR Connection (live trading)
IBKR_PORT=7496
IBKR_HOST=127.0.0.1

# Security
REST_API_KEY=your-secure-random-32-char-key

# LLM Ensemble (optional)
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GOOGLE_AI_API_KEY=...

# Optional: Model overrides
# CLAUDE_MODEL=claude-opus-4-6
# OPENAI_MODEL=gpt-4o
# GEMINI_MODEL=gemini-2.5-flash

# Optional: Drift detection
# DRIFT_ALERTS_ENABLED=true
```

### Secrets Management

**DigitalOcean Apps:**
```bash
# Use DigitalOcean Secrets manager
# Reference: ${REST_API_KEY}
```

**AWS Secrets Manager:**
```bash
# Store secrets and reference in Lambda environment
aws secretsmanager create-secret --name market-bridge-secrets \
  --secret-string '{"ANTHROPIC_API_KEY":"...","OPENAI_API_KEY":"..."}'
```

**Docker Compose with `.env`:**
```bash
# Create .env (gitignore'd)
cp .env.production.example .env
# Edit .env with actual values
docker-compose -f docker-compose.prod.yml up
```

---

## Health Checks & Monitoring

### Health Endpoint

GET `/health` returns:

```json
{
  "status": "ok|degraded",
  "uptime_seconds": 3600,
  "ibkr_connected": true,
  "db_writable": true,
  "rest_server": true,
  "mcp_sessions": 0,
  "timestamp": "2026-02-19T12:00:00.000Z"
}
```

- **status**: `ok` if all systems healthy, `degraded` if IBKR or DB unavailable
- **uptime_seconds**: Process uptime in seconds

### Monitoring Setup

**DigitalOcean:**
- Alerts configured via App Platform dashboard
- Automatic restart on unhealthy status

**AWS CloudWatch:**
```bash
# Monitor Lambda invocations
aws cloudwatch put-metric-alarm \
  --alarm-name market-bridge-errors \
  --alarm-description "Alert if Lambda has errors" \
  --metric-name Errors \
  --namespace AWS/Lambda \
  --statistic Sum \
  --period 300 \
  --threshold 5 \
  --comparison-operator GreaterThanThreshold
```

**Manual monitoring:**
```bash
# Check health every 30s
watch -n 30 curl http://localhost:3000/health
```

---

## Troubleshooting

### Container won't start

**Check logs:**
```bash
docker logs market-bridge
```

**Common issues:**
- `EADDRINUSE: port 3000 already in use` → Change REST_PORT or kill process
- `Cannot find module` → Rebuild image (node_modules issue)
- `IBKR connection failed` → Set IBKR_PORT=7497 (paper trading) to test without TWS

### Health check failing

```bash
# Check endpoint manually
curl -v http://localhost:3000/health

# Common issues:
# - Port mismatch (container exposed 3000, mapped to different port)
# - Database not writable (check /app/data permissions)
# - IBKR not connected (expected, not a blocker)
```

### High memory usage

```bash
# Monitor container memory
docker stats market-bridge

# Reduce if needed:
docker run -m 512m market-data-bridge  # Limit to 512MB
```

### Database corruption

```bash
# Backup and reset
docker exec market-bridge cp /app/data/market-bridge.db /app/data/backup-$(date +%s).db
docker exec market-bridge rm /app/data/market-bridge.db
docker restart market-bridge
```

### API key authentication

```bash
# Test with API key header
curl -H "X-API-Key: your-key" http://localhost:3000/api/status

# If 401, check key:
docker logs market-bridge | grep "API key"
```

---

## Performance Tuning

### Memory

- **Default**: Node.js auto-detects from container limits
- **Explicit**: `node --max-old-space-size=512`
- **Recommendation**: 256MB-512MB for production

### Concurrency

- **Default**: Single process (no PM2)
- **For clustering**: Use PM2 with cluster mode (update Dockerfile)

### Database

- **Default**: SQLite (local file)
- **Production**: Consider PostgreSQL via RDS for:
  - Concurrent access
  - Backup/restore
  - Durability

---

## Version Management

Each build embeds version info in `/build/version.json`:

```json
{
  "version": "3.0.0",
  "commit": "a1b2c3d",
  "branch": "main",
  "timestamp": "2026-02-19T12:00:00.000Z",
  "buildDate": "2026-02-19",
  "node": "v22.5.0",
  "platform": "linux"
}
```

Retrieve via:
```bash
curl http://localhost:3000/api/status  # Returns version in response
# Or access directly from filesystem:
cat /app/build/version.json
```

---

## Rollback & Updates

### Rollback to previous image

```bash
# Tag and keep old images
docker tag market-data-bridge:latest market-data-bridge:1.0.0-prod
docker tag market-data-bridge:1.0.0-prod market-data-bridge:latest

# Switch back
docker run market-data-bridge:1.0.0-prod  # Run old version
```

### Zero-downtime updates

With Docker Compose or orchestration (K8s):
```bash
docker-compose -f docker-compose.prod.yml up -d --no-deps --build
```

---

## Additional Resources

- [Docker Docs: Building Images](https://docs.docker.com/build/)
- [DigitalOcean App Platform Docs](https://docs.digitalocean.com/products/app-platform/)
- [AWS Lambda Container Images](https://docs.aws.amazon.com/lambda/latest/dg/images-create.html)
- [IBKR API Reference](https://www.interactivebrokers.com/en/index.php?f=5988)

---

**Last Updated:** 2026-02-19
**Maintained by:** Market Data Bridge Team
