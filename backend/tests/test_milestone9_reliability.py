"""Milestone 9 - Platform Reliability, Observability & Hardening tests."""

import pytest
from starlette.testclient import TestClient

from app.core.logging import sanitize_dict, sanitize_text
from app.core.metrics import metrics_collector
from app.core.resilience import with_retry
from app.main import app


@pytest.fixture
def client():
    return TestClient(app)


def test_health_liveness(client):
    """Test that /health returns 200 liveness check."""
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["service"] == "nexus-api"


def test_readiness_basic(auth_environment):
    """Test that default /ready maintains backward compatibility with test_health.py."""
    client = auth_environment["client"]
    response = client.get("/ready")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "nexus-api", "database": "ok"}


def test_readiness_full_dependencies(auth_environment):
    """Test that /ready?full=true returns detailed multi-dependency status."""
    client = auth_environment["client"]
    response = client.get("/ready?full=true")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] in ("ok", "degraded")
    assert data["service"] == "nexus-api"
    assert "dependencies" in data
    assert "database" in data["dependencies"]
    assert "redis" in data["dependencies"]
    assert data["dependencies"]["database"]["status"] == "healthy"


def test_readiness_hides_connection_errors():
    """Test that /ready hides database connection strings and passwords on error."""
    from sqlalchemy.exc import OperationalError
    from app.db.session import get_db

    class BrokenSession:
        def execute(self, _statement):
            raise OperationalError("SELECT 1", {}, RuntimeError("postgres://nexus_admin:super_secret_pw@db.internal:5432/nexus"))

        def close(self) -> None:
            pass

    def override_get_db():
        yield BrokenSession()

    app.dependency_overrides[get_db] = override_get_db
    try:
        test_client = TestClient(app)
        response = test_client.get("/ready")
    finally:
        app.dependency_overrides.pop(get_db, None)

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "database_unavailable"
    assert "super_secret_pw" not in response.text
    assert "postgres://" not in response.text


def test_metrics_prometheus_exposition(client):
    """Test that /metrics returns valid Prometheus exposition text format."""
    client.get("/health")
    response = client.get("/metrics")
    assert response.status_code == 200
    assert "text/plain" in response.headers["content-type"]
    content = response.text
    assert "nexus_http_requests_total" in content
    assert "nexus_http_active_requests" in content
    assert "nexus_uptime_seconds" in content
    assert "nexus_database_checks_total" in content


def test_security_headers_present(client):
    """Test that standard defensive security headers are attached to all responses."""
    response = client.get("/health")
    assert response.headers.get("X-Content-Type-Options") == "nosniff"
    assert response.headers.get("X-Frame-Options") == "DENY"
    assert response.headers.get("X-XSS-Protection") == "1; mode=block"
    assert response.headers.get("Referrer-Policy") == "strict-origin-when-cross-origin"
    assert "Permissions-Policy" in response.headers


def test_request_id_correlation(client):
    """Test that incoming X-Request-ID is preserved and echoed back."""
    custom_id = "req-custom-trace-12345"
    response = client.get("/health", headers={"X-Request-ID": custom_id})
    assert response.status_code == 200
    assert response.headers.get("X-Request-ID") == custom_id

    response_no_id = client.get("/health")
    assert "X-Request-ID" in response_no_id.headers
    assert len(response_no_id.headers["X-Request-ID"]) > 10


def test_request_size_limit_rejection(client):
    """Test that requests exceeding payload size limit receive HTTP 413."""
    oversized_length = 5 * 1024 * 1024  # 5MB > 2MB limit
    response = client.post(
        "/api/v1/workspaces",
        headers={"Content-Length": str(oversized_length), "Content-Type": "application/json"},
        content=b"{}",
    )
    assert response.status_code == 413
    data = response.json()
    assert "error" in data
    assert data["error"]["code"] == "payload_too_large"


def test_sanitization_helpers():
    """Test secret and credential redaction from log messages and dictionaries."""
    raw_text = "Connecting with postgresql://nexus_user:super_secret_password_123@localhost:5432/nexus_db"
    sanitized = sanitize_text(raw_text)
    assert "super_secret_password_123" not in sanitized
    assert "[REDACTED]" in sanitized

    sensitive_dict = {
        "user": "admin",
        "password": "mypassword",
        "token": "bearer-token-value",
        "nested": {"secret": "private-key-data", "normal": "safe-value"},
    }
    cleaned = sanitize_dict(sensitive_dict)
    assert cleaned["user"] == "admin"
    assert cleaned["password"] == "[REDACTED]"
    assert cleaned["token"] == "[REDACTED]"
    assert cleaned["nested"]["secret"] == "[REDACTED]"
    assert cleaned["nested"]["normal"] == "safe-value"


def test_resilience_with_retry():
    """Test with_retry bounded retry helper with transient failures."""
    attempts = 0

    def transient_operation():
        nonlocal attempts
        attempts += 1
        if attempts < 3:
            raise ConnectionError("Transient network timeout")
        return "success"

    result = with_retry(
        transient_operation,
        max_attempts=3,
        initial_delay_sec=0.01,
        retry_exceptions=(ConnectionError,),
    )
    assert result == "success"
    assert attempts == 3

    # Test failure when retries exhausted
    attempts_exhausted = 0

    def permanent_failure():
        nonlocal attempts_exhausted
        attempts_exhausted += 1
        raise ValueError("Non-recoverable configuration error")

    with pytest.raises(ValueError):
        with_retry(
            permanent_failure,
            max_attempts=2,
            initial_delay_sec=0.01,
            retry_exceptions=(ValueError,),
        )
    assert attempts_exhausted == 2


def test_system_status_and_metrics_auth(auth_environment, login):
    """Test GET /api/v1/system/status and /api/v1/system/metrics with authenticated session."""
    client = auth_environment["client"]
    login_resp = login(client)
    assert login_resp.status_code == 200

    status_resp = client.get("/api/v1/system/status")
    assert status_resp.status_code == 200
    status_data = status_resp.json()
    assert status_data["overall_status"] in ("operational", "degraded", "major_outage")
    assert "dependencies" in status_data
    assert "database" in status_data["dependencies"]
    assert "redis" in status_data["dependencies"]
    assert "llm" in status_data["dependencies"]
    assert "telemetry" in status_data

    metrics_resp = client.get("/api/v1/system/metrics")
    assert metrics_resp.status_code == 200
    metrics_data = metrics_resp.json()
    assert "total_requests" in metrics_data
    assert "percentiles_ms" in metrics_data


def test_system_diagnostics_ping(auth_environment, login):
    """Test POST /api/v1/system/diagnostics/ping actively probes dependencies."""
    client = auth_environment["client"]
    login_resp = login(client)
    assert login_resp.status_code == 200

    ping_resp = client.post("/api/v1/system/diagnostics/ping")
    assert ping_resp.status_code == 200
    ping_data = ping_resp.json()
    assert "total_duration_ms" in ping_data
    assert "probes" in ping_data
    assert "database" in ping_data["probes"]
    assert "redis" in ping_data["probes"]
    assert "llm" in ping_data["probes"]
