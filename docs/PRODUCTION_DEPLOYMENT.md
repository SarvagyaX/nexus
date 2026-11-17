# NEXUS — Production Deployment Guide

This guide describes how to deploy the NEXUS Agentic AI Operations & Incident Management Platform in a hardened, production-ready environment.

---

## 1. Architecture Overview

NEXUS utilizes a three-tier containerized architecture designed for security, observability, and isolation:

```
[ Internet / Clients ]
          │
          │ HTTPS (443/80)
          ▼
┌────────────────────────────────────────────────────────┐
│ Ingress / Frontend Container (Nginx Unprivileged:8080) │
│ - Serves optimized SPA static assets                   │
│ - Enforces security headers (CSP, HSTS, X-Frame, etc.) │
│ - Reverse-proxies /api/ requests to Backend            │
└──────────────────────────┬─────────────────────────────┘
                           │ internal Docker network
                           ▼
┌────────────────────────────────────────────────────────┐
│ Backend API Container (FastAPI / Uvicorn:8000)         │
│ - Unprivileged system user (nexus:10001)               │
│ - Strict CORS & TrustedHost middleware                 │
│ - Automated Alembic migrations on startup              │
└──────────────┬──────────────────────────┬──────────────┘
               │                          │
   internal DB │ network      internal DB │ network
               ▼                          ▼
┌────────────────────────┐      ┌────────────────────────┐
│ PostgreSQL 16 (Alpine) │      │ Redis 7 (Alpine)       │
│ - Persistent volume    │      │ - Append-only file     │
│ - Zero public ports    │      │ - Zero public ports    │
└────────────────────────┘      └────────────────────────┘
```

### Key Hardening Features
- **Unprivileged Containers**: Application processes run as non-root users (`nexus` UID 10001 in backend, `nginx` in frontend).
- **Network Isolation**: PostgreSQL and Redis communicate exclusively over an internal Docker bridge network (`nexus-db-net` with `internal: true`) and expose no ports to the host or internet.
- **Reverse Proxy**: The frontend container handles API reverse proxying, eliminating cross-origin browser issues in production and shielding the backend.
- **Resource Constraints**: CPU and memory limits are defined on every service to prevent noisy-neighbor exhaustion.
- **Automatic Health Checks**: Active liveness/readiness probes monitor every container.

---

## 2. Prerequisites

- **Docker Engine**: Version 24.0 or higher.
- **Docker Compose**: Version 2.20 or higher.
- **Hardware Sizing**:
  - Minimum: 2 vCPUs, 4 GB RAM, 20 GB SSD storage.
  - Recommended: 4 vCPUs, 8 GB RAM, 50 GB SSD storage.
- **Domain & TLS Certificate**: Valid HTTPS domain (e.g. `nexus.yourcompany.com`) terminating at an external load balancer or reverse proxy.

---

## 3. Deployment Configuration

### Step 1: Clone Repository & Prepare Environment File
```bash
git clone https://github.com/your-org/nexus.git
cd nexus

# Copy production environment template
cp .env.production.example .env.production
```

### Step 2: Generate Cryptographic Secrets
Generate strong, unique secrets for database credentials and session tokens:
```bash
# Generate a 32-byte hexadecimal secret
openssl rand -hex 32
```

Configure `.env.production` with your generated values:
```env
APP_ENV=production
SERVICE_NAME=nexus-api
PROD_PORT=8080

# Exact HTTPS domain
FRONTEND_ORIGIN=https://nexus.yourcompany.com
TRUSTED_HOSTS=nexus.yourcompany.com,localhost

# Database Credentials
POSTGRES_DB=nexus_prod
POSTGRES_USER=nexus_app
POSTGRES_PASSWORD=<INSERT_GENERATED_PASSWORD_HERE>
POSTGRES_URL=postgresql://nexus_app:<INSERT_GENERATED_PASSWORD_HERE>@postgres:5432/nexus_prod

# Session Security (enforces HTTPS-only cookies)
SESSION_COOKIE_SECURE=true
SESSION_TTL_SECONDS=43200

# Strictly disable demo authentication in production
DEMO_AUTH_ENABLED=false
```

---

## 4. Launching the Production Stack

Launch all services using the production Docker Compose manifest:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

### Automatic Database Migration
When `RUN_MIGRATIONS=true` is set (default in `docker-compose.prod.yml`), the backend entrypoint automatically executes `alembic upgrade head` before starting the API server, ensuring the database schema is up-to-date with zero manual steps.

---

## 5. Health & Verification

Verify that all containers are healthy:
```bash
docker compose --env-file .env.production -f docker-compose.prod.yml ps
```

Expected output:
```
NAME                    STATUS                    PORTS
nexus-prod-frontend-1   Up (healthy)              0.0.0.0:8080->8080/tcp
nexus-prod-backend-1    Up (healthy)              8000/tcp (internal)
nexus-prod-postgres-1   Up (healthy)              5432/tcp (internal)
nexus-prod-redis-1      Up (healthy)              6379/tcp (internal)
```

Probe healthcheck endpoints:
```bash
# Frontend health
curl -f http://127.0.0.1:8080/healthz

# Backend liveness (via reverse proxy)
curl -f http://127.0.0.1:8080/api/v1/health/liveness

# Backend dependency readiness (Postgres & Redis)
curl -f http://127.0.0.1:8080/api/v1/health/readiness?full=true
```

---

## 6. Zero-Downtime Upgrade Procedure

To deploy an updated version with minimal interruption:
1. Pull new code or release images.
2. Build updated images:
   ```bash
   docker compose --env-file .env.production -f docker-compose.prod.yml build
   ```
3. Restart containers with sequential recreation:
   ```bash
   docker compose --env-file .env.production -f docker-compose.prod.yml up -d --no-deps backend
   docker compose --env-file .env.production -f docker-compose.prod.yml up -d --no-deps frontend
   ```
4. Verify health endpoints return `200 OK`.

---

## 7. Operational Best Practices

1. **Volume Backups**: Regularly execute `python scripts/backup_db.py` to maintain timestamped, checksummed database snapshots.
2. **Log Monitoring**: Backend JSON logs emit ISO 8601 timestamps, log levels, service tags, correlation IDs (`request_id`), and automatically redact passwords, tokens, and credentials.
3. **Metrics Collection**: Prometheus metrics are available at `GET /metrics` for scraping by Prometheus or Grafana Agent.
