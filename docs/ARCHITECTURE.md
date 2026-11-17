# NEXUS — System Architecture & Engineering Design

NEXUS is an enterprise-grade, agentic AI operations and autonomous incident management platform. It unites real-time telemetry, structured log analysis, rule-based alert correlation, on-call escalation, automated operational playbooks, and an autonomous multi-node AI investigation engine.

This document details the architectural design, component topologies, security boundaries, and engineering decisions underpinning NEXUS.

---

## 1. System Overview & High-Level Architecture

NEXUS employs a modern, three-tier micro-modular architecture designed for horizontal scalability, zero-trust tenant isolation, and deterministic operational execution:

```
+-----------------------------------------------------------------------+
|                             CLIENT TIER                               |
|       React 19 SPA · TypeScript · Vite · Tailwind CSS v4 · Radix UI   |
+-----------------------------------+-----------------------------------+
                                    | HTTPS / REST
                                    v
+-----------------------------------------------------------------------+
|                           EDGE & REVERSE PROXY                        |
|        Nginx · SSL Termination · Rate Limiting · Asset Caching        |
+-----------------------------------+-----------------------------------+
                                    | Reverse Proxy (/api/v1)
                                    v
+-----------------------------------------------------------------------+
|                          APPLICATION SERVICES                         |
|   FastAPI (Python 3.10+) · Async SQLAlchemy 2.0 (psycopg 3) · LangGraph|
|                                                                       |
|  +------------------+  +-------------------+  +--------------------+  |
|  | Auth & RBAC Guard|  | Service Registry  |  | Logs Ingestion     |  |
|  +------------------+  +-------------------+  +--------------------+  |
|  | Alerting Engine  |  | Incident Manager  |  | On-Call Escalation |  |
|  +------------------+  +-------------------+  +--------------------+  |
|  | Playbook Runner  |  | Notification Hub  |  | System Health / SRE|  |
|  +------------------+  +-------------------+  +--------------------+  |
|                                                                       |
|             +--------------------------------------+                  |
|             | 8-Node LangGraph Investigation Graph |                  |
|             | 1. Planner -> 2. Collector           |                  |
|             | -> 3. Analyzer -> 4. Hypo Gen        |                  |
|             | -> 5. Hypo Eval -> 6. Impact         |                  |
|             | -> 7. Recommendations -> 8. Summary  |                  |
|             +--------------------------------------+                  |
+-------------------+-------------------------------+-------------------+
                    |                               |
                    v                               v
+-----------------------------+   +-------------------------------------+
|        STORAGE TIER         |   |         IN-MEMORY STATE TIER        |
| PostgreSQL 16 (psycopg 3)   |   | Redis 7 (In-Memory Engine)          |
|  - Workspace Isolation      |   |  - Token Blocklist / Session Cache  |
|  - Services & Logs          |   |  - Sliding-Window Rate Limiting     |
|  - Incidents & Timelines    |   |  - Alert Deduplication Hashes       |
|  - Playbooks & Executions   |   |  - Distributed Locks                |
|  - Audit Trails & RBAC      |   |  - Health Pulse Tracking            |
+-----------------------------+   +-------------------------------------+
```

> **Diagram Reference**: See [`docs/architecture/system-overview.mmd`](./architecture/system-overview.mmd) for the complete Mermaid topology.

---

## 2. Technology Stack & Key Choices

| Tier | Technology | Purpose & Selection Rationale |
| :--- | :--- | :--- |
| **Frontend** | React 19.3.1, TypeScript, Vite | Strict type safety, sub-millisecond HMR, concurrent mode rendering, and optimal production bundle performance. |
| **Styling** | Tailwind CSS v4, Radix UI Primitives | Accessible UI primitives styled with an enterprise dark theme optimized for mission-critical NOC environments. |
| **Data Viz** | Recharts, Lucide Icons | Responsive SVG telemetry charts, latency distributions, and standardized enterprise iconography. |
| **Backend API** | FastAPI 0.115, Python 3.10+, Uvicorn | High-performance asynchronous execution, automatic OpenAPI schema generation, and native Pydantic v2 validation. |
| **ORM & DB** | SQLAlchemy 2.0 (Async), Alembic | Database access via `psycopg 3` (`psycopg[binary]`), robust connection pooling, and strictly versioned migrations. |
| **Database** | PostgreSQL 16 | ACID-compliant relational store with JSONB support, B-tree/GIN indexing for high-frequency structured log queries. |
| **Cache & Bus** | Redis 7 | Sub-millisecond sliding-window rate limiting, token revocation checking, and atomic deduplication locks. |
| **AI Engine** | LangGraph (8-Node Workflow) | Deterministic 8-node directed acyclic state graph orchestrating planning, evidence gathering, log analysis, hypothesis generation & evaluation, impact analysis, recommendations, and executive summary via Ollama, OpenAI-compatible APIs, or deterministic mock. |
| **Containers** | Docker, Docker Compose, Nginx | Multi-stage unprivileged containers, secure internal networking, and automated container health checks. |

---

## 3. Core Subsystems

### 3.1 Multi-Tenant Workspace Isolation & RBAC
- **Workspace Scoping**: Every operational record (`Service`, `LogRecord`, `AlertRule`, `Alert`, `Incident`, `Playbook`, `EscalationPolicy`, `Notification`) enforces foreign-key binding to a `workspace_id`.
- **Query Interceptors**: Database queries inject workspace scoping filters at the ORM layer, preventing cross-tenant data leaks.
- **Role Hierarchy**:
  - `Admin`: Full configuration control, user/role management, playbook authoring, secret management.
  - `Responder`: Incident triage, alert acknowledgment, playbook execution, mitigation approval.
  - `Viewer`: Read-only access to dashboards, service catalogs, incident timelines, and reports.

### 3.2 Service Registry & Dependency Graph
- Tracks microservices, databases, gateways, and third-party dependencies.
- Captures upstream and downstream topology edges to compute blast radius during outages.
- Tracks live operational health statuses (`active`, `archived`) and environments (`production`, `staging`, `development`).

### 3.3 Logs Ingestion Pipeline & Explorer
- **Batch Ingestion**: High-throughput ingestion API (`/api/v1/logs/ingest`) with workspace-scoped authentication.
- **Structured Fields**: Ingests `timestamp`, `service_key`, `severity` (DEBUG, INFO, WARN, ERROR, CRITICAL), `trace_id`, `message`, and flexible `metadata` (JSONB).
- **Indexing Strategy**: Multi-column indexes on `(workspace_id, timestamp DESC)` and `(workspace_id, service_key)` ensure sub-10ms queries across millions of rows.
- **Cursor-Based Pagination**: Guarantees deterministic ordering and zero row-skipping during high-frequency writes.

### 3.4 Alerting Engine & Deduplication
- **Rule Engine**: Evaluates metric and log error thresholds over sliding time windows.
- **Fingerprinting & Deduplication**: Generates deterministic SHA-256 deduplication keys based on `(workspace_id, rule_id, service_key, fingerprint)`.
- **State Lifecycle**: Tracks alert states (`firing`, `acknowledged`, `resolved`, `silenced`) with automated correlation into active incidents.

### 3.5 Incident Command & Timeline Management
- **State Machine**: Orchestrates transitions across `DETECTED -> INVESTIGATING -> IDENTIFIED -> MONITORING -> RESOLVED`.
- **Automated Paging**: Escalates unacknowledged SEV1/SEV2 incidents to on-call engineers via escalation policies.
- **Timeline Ledger**: Records all manual notes, automated playbook executions, AI investigation findings, and status transitions in an append-only audit trail.

> **Diagram Reference**: See [`docs/architecture/incident-lifecycle.mmd`](./architecture/incident-lifecycle.mmd) for the incident state transition diagram.

### 3.6 Agentic AI Investigation Engine (LangGraph)
NEXUS implements an autonomous 8-node AI investigation engine modeled as a LangGraph state graph (`backend/app/ai/workflow.py`). Unlike naive single-prompt AI wrappers, NEXUS executes an orchestrated investigation pipeline using real operational telemetry:
1. **Planner (`planner`)**: Evaluates incident severity, determines investigation strategy, defines focus areas, and establishes the log search window.
2. **Evidence Collector (`collector`)**: Structures observed facts across incident context, service topology, recent error logs, timeline audit transitions, and concurrent incidents.
3. **Log Analyzer (`log_analyzer`)**: Clusters error patterns, computes severity distributions, extracts correlated trace IDs, and detects anomaly spikes.
4. **Hypothesis Generator (`hypothesis_generator`)**: Formulates candidate root-cause hypotheses using the configured LLM provider (local Ollama or OpenAI-compatible endpoint) or deterministic analytical engine.
5. **Hypothesis Evaluator (`hypothesis_evaluator`)**: Scores hypotheses against supporting and contradicting evidence, identifies the primary root cause, and computes an overall confidence rating.
6. **Impact Analyzer (`impact_analyzer`)**: Traverses service dependency tiers and concurrent incident records to calculate blast radius, affected services, and business impact.
7. **Recommendation Engine (`recommendation_engine`)**: Formulates prioritized remediation runbooks spanning immediate P1 mitigations, P2 diagnostic inspections, and P3 architectural prevention.
8. **Executive Summary Generator (`summary_generator`)**: Compiles a structured incident report detailing primary root cause, confidence score, evidence count, blast radius, and approval-queued recommendations.

> **Diagram Reference**: See [`docs/architecture/agentic-investigation-flow.mmd`](./architecture/agentic-investigation-flow.mmd) for the complete sequence flow.

### 3.7 Workflow Automation & Playbook Engine
- **Automated Runbooks**: Playbooks execute predefined DAGs of operational steps upon alert/incident triggers.
- **Step Types**:
  - `action`: Executes automated HTTP calls, webhooks, or diagnostic queries.
  - `ai_investigation`: Automatically triggers LangGraph analysis.
  - `human_approval`: Halts execution and notifies responders; requires explicit approval before executing high-risk actions (e.g., service restarts or database failovers).
- **Audit Integration**: Every playbook step execution is captured in both the incident timeline and workspace audit logs.

> **Diagram Reference**: See [`docs/architecture/playbook-execution-flow.mmd`](./architecture/playbook-execution-flow.mmd) for the playbook orchestration diagram.

### 3.8 On-Call Management & Escalations
- **Rotation Schedules**: Daily, weekly, and custom round-robin shift rotations.
- **Multi-Level Escalation Policies**: Configurable timeout-based escalation chains (e.g., Tier 1 On-Call -> Tier 2 Lead -> Engineering Director) to guarantee SLA response times.

---

## 4. Security Architecture & Controls

| Security Domain | Implementation Details |
| :--- | :--- |
| **Authentication** | Dual-token model: short-lived access JWTs and secure HTTP-only refresh tokens. |
| **CSRF Defense** | Strict Double-Submit Cookie pattern for state-changing endpoints (`POST`, `PUT`, `DELETE`). |
| **Rate Limiting** | Sliding-window rate limiter powered by Redis with IP and user token buckets. |
| **SQL Injection** | 100% parameterized queries via SQLAlchemy 2.0 ORM; zero raw string interpolation. |
| **Security Headers** | Comprehensive middleware enforcing `Content-Security-Policy`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, and `Strict-Transport-Security`. |
| **Sensitive Data** | Password hashing using BCrypt with salt rounds; secrets stripped from API logs and audit outputs. |

---

## 5. Storage & Database Schema

The database schema is managed via Alembic migrations under `backend/alembic/versions/`. Key models include:
- `workspaces`, `workspace_memberships`, `users`
- `services`, `service_dependencies`
- `log_records`
- `alert_rules`, `alerts`, `alert_history`
- `incidents`, `incident_timeline_events`, `incident_investigations`
- `on_call_schedules`, `on_call_shifts`, `escalation_policies`, `escalation_rules`
- `playbooks`, `playbook_steps`, `playbook_executions`, `step_executions`
- `notifications`, `audit_logs`

---

## 6. Production Deployment Topology

The platform provides dual deployment targets:
1. **Development Environment**: Hot-reloading Vite frontend, Uvicorn backend, local Postgres and Redis via `docker-compose.yml`.
2. **Production Hardened Environment**: Multi-stage unprivileged Docker containers, Nginx reverse proxy, 3-tier internal bridge network (`nexus-frontend-net`, `nexus-backend-net`, `nexus-data-net`), strict memory/CPU limits, and non-root user execution (`nexus:nexus`) via `docker-compose.prod.yml`.

Automated backup and point-in-time restore utilities are provided under `scripts/backup_db.py` and `scripts/restore_db.py` to ensure enterprise data recovery.
