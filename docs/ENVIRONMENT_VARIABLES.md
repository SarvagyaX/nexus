# NEXUS — Environment Variables Reference

This document provides a comprehensive reference of all environment variables supported by the NEXUS platform.

---

## 1. Reference Table

| Variable | Type | Default | Required in Prod | Description |
|---|---|---|---|---|
| `APP_ENV` | `string` | `development` | Yes | Application environment: `development`, `testing`, or `production`. |
| `SERVICE_NAME` | `string` | `nexus-api` | No | Service identifier emitted in structured JSON logs and metrics. |
| `BACKEND_HOST` | `string` | `0.0.0.0` | No | Host address the FastAPI API binds to. |
| `BACKEND_PORT` | `int` | `8000` | No | TCP port the FastAPI server listens on. |
| `PROD_PORT` | `int` | `8080` | No | Published ingress port for production frontend container. |
| `FRONTEND_ORIGIN` | `string` | `http://localhost:5173` | Yes | Exact HTTP(S) origin allowed by CORS and unsafe browser requests. |
| `FRONTEND_API_BASE_URL` | `string` | `http://localhost:8000` | No | API base URL passed to Vite build (empty string in prod for reverse-proxy). |
| `TRUSTED_HOSTS` | `string` | `*` | In Prod | Comma-delimited list of allowed `Host` headers enforced by middleware. |
| `POSTGRES_DB` | `string` | `nexus_dev` | Yes | PostgreSQL database name. |
| `POSTGRES_USER` | `string` | `nexus_dev` | Yes | PostgreSQL database username. |
| `POSTGRES_PASSWORD` | `string` | None | Yes | PostgreSQL user password. |
| `POSTGRES_URL` | `string` | None | Yes | SQLAlchemy database connection URL (e.g. `postgresql://user:pass@host:5432/db`). |
| `REDIS_URL` | `string` | None | Yes | Redis connection URL (e.g. `redis://redis:6379/0`). |
| `RUN_MIGRATIONS` | `bool` | `false` | In Prod | If `true`, container entrypoint automatically executes `alembic upgrade head`. |
| `SESSION_COOKIE_SECURE` | `bool` | `false` in dev | Yes (`true`) | Sets `Secure` flag on session cookie. Must be `true` in production. |
| `SESSION_TTL_SECONDS` | `int` | `43200` | No | Absolute session lifetime in seconds (default: 12 hours). |
| `DEMO_AUTH_ENABLED` | `bool` | `false` | No | Enables local password login/seed. **Strictly rejected in production.** |
| `DEMO_ADMIN_EMAIL` | `string` | `admin@nexus.local` | No | Seed administrator email (development only). |
| `DEMO_ADMIN_PASSWORD` | `string` | None | No | Seed administrator password (development only). |
| `DEMO_ADMIN_DISPLAY_NAME`| `string` | `NEXUS Demo Administrator` | No | Seed administrator display name. |
| `DEMO_WORKSPACE_NAME` | `string` | `NEXUS Demo` | No | Seed workspace display name. |
| `DEMO_WORKSPACE_SLUG` | `string` | `nexus-demo` | No | Seed workspace unique slug. |
| `LLM_PROVIDER` | `string` | `mock` | No | AI Investigation engine provider: `mock`, `ollama`, or `openai`. |
| `LLM_MODEL` | `string` | `llama3.2` | No | Model name for AI investigation (e.g. `llama3.2`, `gpt-4o`). |
| `LLM_API_KEY` | `string` | None | If OpenAI | API key when `LLM_PROVIDER=openai`. |
| `OLLAMA_BASE_URL` | `string` | `http://localhost:11434` | If Ollama | Base URL of Ollama service instance. |
| `SMTP_HOST` | `string` | None | No | SMTP relay hostname for notification delivery. |
| `SMTP_PORT` | `int` | `587` | No | SMTP relay TCP port. |
| `SMTP_USER` | `string` | None | No | SMTP authentication username. |
| `SMTP_PASSWORD` | `string` | None | No | SMTP authentication password. |
| `SMTP_FROM_EMAIL` | `string` | `notifications@nexus.local` | No | From header email address for outbound emails. |
| `SMTP_USE_TLS` | `bool` | `true` | No | Whether to use STARTTLS for SMTP connections. |
| `DEFAULT_WEBHOOK_URL` | `string` | None | No | Fallback webhook URL for operational notifications. |

---

## 2. Production Startup Validation

The Pydantic settings model enforces strict validation on startup:

1. **Production Insecure Passwords**:
   In `APP_ENV=production`, startup fails immediately if `POSTGRES_PASSWORD` or `POSTGRES_URL` contains known default placeholders (e.g. `replace-with-a-local-development-password`, `nexus_local_dev_2026`, `changeme`).
2. **Demo Auth Rejection**:
   If `APP_ENV=production` and `DEMO_AUTH_ENABLED=true`, startup aborts with:
   `DEMO_AUTH_ENABLED cannot be enabled in production`.
3. **Session Cookie Security**:
   If `APP_ENV=production` and `SESSION_COOKIE_SECURE=false`, startup aborts with:
   `SESSION_COOKIE_SECURE must be enabled in production`.
4. **Origin Validation**:
   `FRONTEND_ORIGIN` must be an explicit, single HTTP(S) origin with no wildcard (`*`), path, query parameters, or trailing slashes.

---

## 3. Secret Generation Guidelines

To generate secure production secrets, use the system cryptographic random generator:

```bash
# 32-byte secret (PostgreSQL password, session keys)
openssl rand -hex 32

# 64-byte secret (high-entropy tokens)
openssl rand -hex 64
```
