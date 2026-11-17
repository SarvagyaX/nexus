# NEXUS Changelog

All notable changes to the NEXUS platform are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0-rc1] - 2026-11-16

### Milestone 13: Final Product Polish & Portfolio Release
#### Added
- **Operational Reports & Analytics Page (`/reports`)**:
  - Live metric aggregations: MTTR (Mean Time to Resolution), MTTD (Mean Time to Detection), Resolution Rate, and SLA Conformance.
  - Severity distribution visualizer (SEV1–SEV4) with interactive percentage bars.
  - Monitored Services SLA tracking with availability targets.
  - Client-side export capabilities to CSV and structured JSON.
- **Enterprise Workspace Settings Page (`/settings`)**:
  - Tabbed management console: Workspace Profile, Roles & Granular Permissions, Security & Compliance, and Integration Hub.
  - Displays user role permissions matrix (`admin`, `responder`, `viewer`) and session isolation indicators.
- **Architecture Documentation & Mermaid Diagrams**:
  - Full system architecture guide: `docs/ARCHITECTURE.md`.
  - Topology diagram: `docs/architecture/system-overview.mmd`.
  - Agentic investigation state graph: `docs/architecture/agentic-investigation-flow.mmd`.
  - Incident state machine: `docs/architecture/incident-lifecycle.mmd`.
  - Playbook orchestration flow: `docs/architecture/playbook-execution-flow.mmd`.
- **Portfolio Showcase**: Comprehensive root `README.md` with detailed screenshot walk-through, architecture decision log, and roadmap.

#### Changed
- **Operations Command Center (`/`)**: Replaced static demo counters with dynamic live workspace bindings (`servicesApi.list`, `incidentsApi.list`) and direct navigation links.
- **Enterprise Shell Polish**: Updated sidebar, command palette (`⌘K`), and header breadcrumbs for complete deep-link recognition across services, incidents, alerts, investigations, and playbooks.
- **Removed Placeholders**: Cleaned up all remaining "Coming Soon" placeholder screens in production routes.

---

## [0.12.0] - 2026-11-16

### Milestone 12: Production Deployment, Docker Optimization & CI/CD
#### Added
- Multi-stage unprivileged Dockerfiles for frontend (`nginx:1.27-alpine`) and backend (`python:3.10-slim`).
- Production Docker Compose manifest (`docker-compose.prod.yml`) with 3-tier internal bridge networks (`nexus-frontend-net`, `nexus-backend-net`, `nexus-data-net`) and strict CPU/memory limits.
- Automated database backup (`scripts/backup_db.py`, `scripts/backup_db.sh`) and restore (`scripts/restore_db.py`, `scripts/restore_db.sh`) utilities with SHA-256 checksum verification.
- GitHub Actions CI/CD workflows (`.github/workflows/ci.yml`, `.github/workflows/cd.yml`).
- Operational deployment documentation (`PRODUCTION_DEPLOYMENT.md`, `CI_CD.md`, `BACKUP_AND_RESTORE.md`, `ENVIRONMENT_VARIABLES.md`).

---

## [0.11.0] - 2026-11-16

### Milestone 11: Workflow Automation & Playbook Engine
#### Added
- Automated operational playbook engine with DAG step execution.
- Human-in-the-loop approval gate (`require_approval`) for critical mitigation steps.
- Visual playbook builder and 4 pre-built industry standard operational templates.
- Execution history, real-time step progress streaming, and incident timeline linking.

---

## [0.10.0] - 2026-11-16

### Milestone 10: Notification & On-Call Management System
#### Added
- In-app notification center with real-time bell badges and mark-as-read actions.
- Multi-tier escalation policies with timeout-based auto-paging.
- On-call schedule manager supporting round-robin daily and weekly rotations.
- Notification dispatchers for Slack, Webhooks, and Email.

---

## [0.9.0] - 2026-11-16

### Milestone 9: Reliability, Observability & Platform Hardening
#### Added
- Prometheus `/metrics` endpoint with latency histograms, request counters, and DB pool gauges.
- Health probes: `/health/liveness` and `/health/readiness` with deep Redis and Postgres status checks.
- Sliding-window Redis token-bucket rate limiting middleware.
- Request payload size guard (max 10MB) and sensitive credential redaction filters.

---

## [0.8.0] - 2026-11-16

### Milestone 8: Real-Time Alerting & Event Management Engine
#### Added
- Alert rule evaluation engine matching metric deviations and log error spikes.
- Deterministic alert deduplication and fingerprint hashing.
- Alert lifecycle management (`firing`, `acknowledged`, `resolved`, `silenced`).
- Automated incident generation from clustered alerts.

---

## [0.7.0] - 2026-11-16

### Milestone 7: Agentic AI Investigation Engine
#### Added
- Multi-node LangGraph directed acyclic state graph: Planner, Evidence Collector, Log Analyzer, Hypothesis Generator, Hypothesis Evaluator, Impact Analyzer, Recommendation Engine, and Executive Summary Generator.
- Integration with Ollama, OpenAI-compatible APIs, and deterministic Mock provider.
- Interactive investigation reports with confidence ratings and 1-click remediation actions.

---

## [0.6.0] - 2026-11-16

### Milestone 6: Logs Explorer & Ingestion Pipeline
#### Added
- High-throughput asynchronous log ingestion API (`/api/v1/logs/ingest`).
- Multi-column database indexes for millisecond log queries across millions of rows.
- Structured filtering by severity, service key, time range, trace ID, and full-text search.
- Deterministic cursor-based pagination.

---

## [0.5.0] - 2026-11-15

### Milestone 5: Incident Management & Operations
#### Added
- Core incident command system with severity triage (SEV1–SEV4).
- State machine lifecycle transitions (`DETECTED`, `INVESTIGATING`, `IDENTIFIED`, `MONITORING`, `RESOLVED`).
- Append-only incident timeline and audit ledger.

---

## [0.4.0] - 2026-11-15

### Milestone 4: Service Registry & Dependency Topology
#### Added
- Microservice catalog with environment tracking and operational ownership.
- Bidirectional dependency mapping and upstream/downstream blast radius calculation.

---

## [0.3.0] - 2026-11-15

### Milestone 3: Authentication & Multi-Tenant Workspaces
#### Added
- Multi-tenant workspace isolation with strict foreign-key enforcement.
- Dual-token authentication (short-lived JWTs + HTTP-only refresh cookies).
- Double-Submit Cookie CSRF protection and Argon2id password hashing.
- Role-based access control (`admin`, `responder`, `viewer`).

---

## [0.2.0] - 2026-11-15

### Milestone 2: Backend Architecture & Database Foundation
#### Added
- FastAPI async application architecture with SQLAlchemy 2.0 and Alembic.
- PostgreSQL database integration with connection pooling and schema migrations.

---

## [0.1.0] - 2026-11-15

### Milestone 1: Frontend Shell & Enterprise Design System
#### Added
- Premium dark-themed React SPA with Tailwind CSS and Radix UI.
- Operations dashboard layout, command palette (`⌘K`), and accessible components.

---

## [0.0.1] - 2026-11-15

### Milestone 0: Foundation & Scaffolding
#### Added
- Project initialization, Git repository configuration, and Docker Compose base setup.
