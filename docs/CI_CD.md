# NEXUS — CI/CD Pipeline Documentation

NEXUS uses GitHub Actions for continuous integration, code quality, container validation, and release delivery.

---

## 1. CI Workflow (`.github/workflows/ci.yml`)

The Continuous Integration workflow triggers automatically on:
- **Pushes** to `main`, `master`, and `develop`.
- **Pull Requests** targeting `main`, `master`, and `develop`.

### Pipeline Jobs

```
┌────────────────────────────────────────────────────────┐
│                   GitHub Actions CI                    │
├────────────────────┬───────────────────┬───────────────┤
│    backend-test    │   frontend-build  │docker-validate│
│                    │                   │               │
│ • Python 3.10/3.11 │ • Node.js 22      │ • Compose Dev │
│ • Pip caching      │ • NPM caching     │ • Compose Prod│
│ • flake8 linting   │ • tsc -b check    │ • Buildx Test │
│ • pytest (109 tests│ • Vite build      │               │
│ • pip-audit scan   │ • npm audit       │               │
└────────────────────┴───────────────────┴───────────────┘
```

#### 1. Backend Test & Quality Matrix
- Runs across Python `3.10` and `3.11`.
- Utilizes `actions/setup-python` pip dependency caching keyed to `backend/requirements.txt`.
- Enforces strict code syntax and undefined-variable checks (`flake8 --select=E9,F63,F7,F82`).
- Runs the comprehensive 110-item pytest suite using an isolated in-memory SQLite database.
- Executes vulnerability scanning via `pip-audit`.

#### 2. Frontend TypeScript & Production Build
- Uses Node.js 22 with `actions/setup-node` npm dependency caching.
- Runs `npx tsc -b` to guarantee zero TypeScript compilation or typing errors.
- Executes `npm run build` to verify Vite bundle compilation and chunk integrity.
- Audits frontend dependencies with `npm audit`.

#### 3. Docker Configuration & Build Validation
- Validates development Compose config: `docker compose -f docker-compose.yml config --quiet`.
- Validates production Compose config: `docker compose --env-file .env.production.example -f docker-compose.prod.yml config --quiet`.
- Performs dry-run image builds for both `backend/Dockerfile` and `frontend/Dockerfile.prod` using Docker Buildx to catch container regressions prior to merging.

---

## 2. CD Workflow (`.github/workflows/cd.yml`)

The Continuous Delivery workflow automates building and publishing release container images to GitHub Container Registry (GHCR).

### Trigger Criteria
- **Release Published**: Whenever a GitHub Release is marked as published.
- **Git Version Tag**: Whenever a tag matching `v*.*.*` is pushed.
- **Manual Dispatch**: Operators can trigger builds on demand via `workflow_dispatch` with a custom version tag.

### Security Guarantees
- **No Third-Party Paid Infrastructure**: Uses native GitHub Container Registry (`ghcr.io`).
- **Scoped Permissions**: Grants only `packages: write` and `contents: read` to the job.
- **Pull Request Protection**: Never triggers image publication on pull requests.
- **Dual Tagging**: Pushes both the versioned tag (e.g. `v1.2.0`) and the `latest` tag.

### Published Artifacts
- `ghcr.io/<org-or-user>/nexus-backend:<tag>`
- `ghcr.io/<org-or-user>/nexus-backend:latest`
- `ghcr.io/<org-or-user>/nexus-frontend:<tag>`
- `ghcr.io/<org-or-user>/nexus-frontend:latest`

---

## 3. Local Verification of Workflows

Before pushing, developers can test workflow steps locally:

```bash
# 1. Run backend tests
cd backend
$env:PYTHONPATH="." ; pytest tests -v

# 2. Run frontend build
cd ../frontend
npm run build

# 3. Validate Docker Compose manifests
cd ..
docker compose -f docker-compose.yml config --quiet
docker compose --env-file .env.production.example -f docker-compose.prod.yml config --quiet
```
