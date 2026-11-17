"""Comprehensive tests for log explorer and ingestion."""

from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

import pytest
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.models.identity import AuditEvent, Membership, User, UserStatus, Workspace, WorkspaceRole
from app.models.log import LogRecord, LogSeverity
from app.models.service import Service, ServiceStatus
from app.schemas.log import LogBatchIngest, LogCreate
from app.services.logs import decode_log_cursor, encode_log_cursor


def _client(auth_environment, login):
    client = auth_environment["client"]
    response = login()
    client.headers.update(
        {
            "Origin": "http://localhost:5173",
            "X-CSRF-Token": response.json()["csrf_token"],
        }
    )
    return client


def _create_service(auth_environment, name="api-gateway", key=None, status=ServiceStatus.ACTIVE):
    key = key or f"service-{uuid4().hex[:8]}"
    with auth_environment["factory"]() as db:
        service = Service(
            workspace_id=auth_environment["workspace_id"],
            name=name,
            service_key=key,
            status=status,
        )
        db.add(service)
        db.commit()
        return service.id


# ============================================================================
# Schema and Helper Unit Tests
# ============================================================================

def test_log_schema_validation_and_normalization():
    s_id = uuid4()
    # Normalizes severity aliases and case
    log = LogCreate(
        service_id=s_id,
        severity="warning",
        message="Disk space low",
        trace_id="  trace-abc-123  ",
        attributes={"disk": "/dev/sda1", "usage_pct": 89},
    )
    assert log.severity == LogSeverity.WARN
    assert log.trace_id == "trace-abc-123"
    assert log.message == "Disk space low"
    assert log.attributes["usage_pct"] == 89

    # Rejects empty message
    with pytest.raises(ValidationError):
        LogCreate(service_id=s_id, message="   ")

    # Rejects timezone-naive timestamp
    with pytest.raises(ValidationError):
        LogCreate(service_id=s_id, message="Test", timestamp=datetime(2026, 11, 14, 12, 0, 0))

    # Rejects invalid severity
    with pytest.raises(ValidationError):
        LogCreate(service_id=s_id, message="Test", severity="UNKNOWN_SEVERITY")

    # Batch schema validates boundaries
    with pytest.raises(ValidationError):
        LogBatchIngest(items=[])


def test_log_cursor_encoding_and_decoding():
    log_id = uuid4()
    now = datetime(2026, 11, 14, 15, 30, 0, tzinfo=timezone.utc)
    mock_log = LogRecord(id=log_id, timestamp=now)
    cursor = encode_log_cursor(mock_log)
    assert isinstance(cursor, str)

    decoded = decode_log_cursor(cursor)
    assert decoded is not None
    ts, dec_id = decoded
    assert ts == now
    assert dec_id == log_id

    # None input returns None
    assert decode_log_cursor(None) is None

    # Invalid cursor raises 400
    with pytest.raises(Exception):
        decode_log_cursor("invalid-base64-not-json")


def test_log_record_database_constraints(auth_environment):
    workspace_id = auth_environment["workspace_id"]
    service_id = _create_service(auth_environment)

    with auth_environment["factory"]() as db:
        # Rejects empty message in DB
        with pytest.raises(IntegrityError):
            bad_log = LogRecord(
                workspace_id=workspace_id,
                service_id=service_id,
                message="",
            )
            db.add(bad_log)
            db.commit()
        db.rollback()


# ============================================================================
# API Ingestion Tests
# ============================================================================

def test_single_log_ingestion_and_detail(auth_environment, login):
    client = _client(auth_environment, login)
    workspace_id = auth_environment["workspace_id"]
    service_id = _create_service(auth_environment, name="payments-service", key="payments")

    # Ingest single log
    now_iso = datetime.now(timezone.utc).isoformat()
    response = client.post(
        f"/api/v1/workspaces/{workspace_id}/logs",
        json={
            "service_id": str(service_id),
            "timestamp": now_iso,
            "severity": "ERROR",
            "trace_id": "tr-98765",
            "message": "Payment gateway timeout after 5000ms",
            "attributes": {"attempt": 3, "gateway": "stripe"},
        },
    )
    assert response.status_code == 201, response.text
    data = response.json()
    assert data["severity"] == "ERROR"
    assert data["trace_id"] == "tr-98765"
    assert data["message"] == "Payment gateway timeout after 5000ms"
    assert data["attributes"]["attempt"] == 3
    assert data["service"]["name"] == "payments-service"
    assert data["service"]["service_key"] == "payments"
    log_id = data["id"]

    # Retrieve log by ID
    get_res = client.get(f"/api/v1/workspaces/{workspace_id}/logs/{log_id}")
    assert get_res.status_code == 200
    assert get_res.json()["id"] == log_id


def test_batch_log_ingestion_and_audit(auth_environment, login):
    client = _client(auth_environment, login)
    workspace_id = auth_environment["workspace_id"]
    s1 = _create_service(auth_environment, name="auth-service", key="auth")
    s2 = _create_service(auth_environment, name="billing-service", key="billing")

    items = [
        {"service_id": str(s1), "severity": "INFO", "message": "User login succeeded", "trace_id": "tr-1"},
        {"service_id": str(s1), "severity": "WARN", "message": "Failed login attempt", "trace_id": "tr-2"},
        {"service_id": str(s2), "severity": "ERROR", "message": "Invoice generation failed", "trace_id": "tr-3"},
    ]

    response = client.post(
        f"/api/v1/workspaces/{workspace_id}/logs/batch",
        json={"items": items},
    )
    assert response.status_code == 201, response.text
    data = response.json()
    assert data["ingested_count"] == 3
    assert len(data["ids"]) == 3

    # Verify domain audit event was recorded
    with auth_environment["factory"]() as db:
        audit = db.scalar(
            select(AuditEvent).where(
                AuditEvent.workspace_id == workspace_id,
                AuditEvent.action == "log.batch_ingested",
            )
        )
        assert audit is not None
        assert audit.details["count"] == 3


def test_ingestion_rejects_archived_or_foreign_service(auth_environment, login):
    client = _client(auth_environment, login)
    workspace_id = auth_environment["workspace_id"]
    archived_id = _create_service(auth_environment, name="old-svc", status=ServiceStatus.ARCHIVED)

    # Rejects archived service
    res = client.post(
        f"/api/v1/workspaces/{workspace_id}/logs",
        json={"service_id": str(archived_id), "message": "Test"},
    )
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "service_archived"

    # Rejects nonexistent service
    missing_id = uuid4()
    res2 = client.post(
        f"/api/v1/workspaces/{workspace_id}/logs",
        json={"service_id": str(missing_id), "message": "Test"},
    )
    assert res2.status_code == 404
    assert res2.json()["error"]["code"] == "service_not_found"


# ============================================================================
# API Filtering, Search, and Pagination Tests
# ============================================================================

def test_log_list_filtering_and_pagination(auth_environment, login):
    client = _client(auth_environment, login)
    workspace_id = auth_environment["workspace_id"]
    s1 = _create_service(auth_environment, name="web-frontend", key="web")
    s2 = _create_service(auth_environment, name="worker-node", key="worker")

    base_time = datetime(2026, 11, 14, 10, 0, 0, tzinfo=timezone.utc)
    batch_items = [
        {"service_id": str(s1), "severity": "DEBUG", "message": "Rendering button", "trace_id": "tr-web-1", "timestamp": (base_time + timedelta(minutes=1)).isoformat()},
        {"service_id": str(s1), "severity": "INFO", "message": "Page viewed", "trace_id": "tr-web-2", "timestamp": (base_time + timedelta(minutes=2)).isoformat()},
        {"service_id": str(s1), "severity": "ERROR", "message": "Failed to load bundle", "trace_id": "tr-web-3", "timestamp": (base_time + timedelta(minutes=3)).isoformat()},
        {"service_id": str(s2), "severity": "WARN", "message": "Queue depth high", "trace_id": "tr-worker-1", "timestamp": (base_time + timedelta(minutes=4)).isoformat()},
        {"service_id": str(s2), "severity": "ERROR", "message": "Job timed out", "trace_id": "tr-worker-2", "timestamp": (base_time + timedelta(minutes=5)).isoformat()},
        {"service_id": str(s2), "severity": "FATAL", "message": "Worker crashed OOM", "trace_id": "tr-worker-3", "timestamp": (base_time + timedelta(minutes=6)).isoformat()},
    ]
    client.post(f"/api/v1/workspaces/{workspace_id}/logs/batch", json={"items": batch_items})

    # 1. Severity filter
    err_res = client.get(f"/api/v1/workspaces/{workspace_id}/logs?severity=ERROR")
    assert err_res.status_code == 200
    err_items = err_res.json()["items"]
    assert len(err_items) == 2
    assert all(item["severity"] == "ERROR" for item in err_items)

    # 2. Service filter
    s2_res = client.get(f"/api/v1/workspaces/{workspace_id}/logs?service_id={s2}")
    assert s2_res.status_code == 200
    assert len(s2_res.json()["items"]) == 3

    # 3. Trace ID filter
    trace_res = client.get(f"/api/v1/workspaces/{workspace_id}/logs?trace_id=tr-worker-1")
    assert trace_res.status_code == 200
    assert len(trace_res.json()["items"]) == 1
    assert trace_res.json()["items"][0]["message"] == "Queue depth high"

    # 4. Text search
    search_res = client.get(f"/api/v1/workspaces/{workspace_id}/logs?q=OOM")
    assert search_res.status_code == 200
    assert len(search_res.json()["items"]) == 1
    assert search_res.json()["items"][0]["severity"] == "FATAL"

    # 5. Keyset cursor pagination
    page1 = client.get(f"/api/v1/workspaces/{workspace_id}/logs?limit=3")
    assert page1.status_code == 200
    p1_data = page1.json()
    assert len(p1_data["items"]) == 3
    assert p1_data["page"]["has_more"] is True
    next_cursor = p1_data["page"]["next_cursor"]
    assert next_cursor is not None

    page2 = client.get(f"/api/v1/workspaces/{workspace_id}/logs?limit=3&cursor={next_cursor}")
    assert page2.status_code == 200
    p2_data = page2.json()
    assert len(p2_data["items"]) == 3
    # No duplicate IDs across pages
    p1_ids = {item["id"] for item in p1_data["items"]}
    p2_ids = {item["id"] for item in p2_data["items"]}
    assert p1_ids.isdisjoint(p2_ids)


def test_log_stats_aggregation(auth_environment, login):
    client = _client(auth_environment, login)
    workspace_id = auth_environment["workspace_id"]
    service_id = _create_service(auth_environment, name="telemetry-service")

    items = [
        {"service_id": str(service_id), "severity": "INFO", "message": "Info 1"},
        {"service_id": str(service_id), "severity": "INFO", "message": "Info 2"},
        {"service_id": str(service_id), "severity": "WARN", "message": "Warning 1"},
        {"service_id": str(service_id), "severity": "ERROR", "message": "Error 1"},
    ]
    client.post(f"/api/v1/workspaces/{workspace_id}/logs/batch", json={"items": items})

    stats_res = client.get(f"/api/v1/workspaces/{workspace_id}/logs/stats")
    assert stats_res.status_code == 200
    data = stats_res.json()
    assert data["total_count"] == 4
    assert data["severity_counts"]["INFO"] == 2
    assert data["severity_counts"]["WARN"] == 1
    assert data["severity_counts"]["ERROR"] == 1
    assert data["severity_counts"]["DEBUG"] == 0
    assert len(data["time_buckets"]) > 0


# ============================================================================
# Authorization and Workspace Isolation Tests
# ============================================================================

def test_log_permissions_and_isolation(auth_environment, login):
    client = _client(auth_environment, login)
    workspace_id = auth_environment["workspace_id"]
    service_id = _create_service(auth_environment)

    # 1. Non-member workspace access returns 404
    other_workspace_id = uuid4()
    isolated_res = client.get(f"/api/v1/workspaces/{other_workspace_id}/logs")
    assert isolated_res.status_code == 404

    # 2. Viewer role can read logs but cannot ingest logs
    with auth_environment["factory"]() as db:
        viewer_user = User(
            email="viewer@example.local",
            display_name="Viewer User",
            password_hash=User.password_hash,
            status=UserStatus.ACTIVE,
        )
        # Use existing password hash from operator
        existing_hash = db.scalar(select(User.password_hash).where(User.id == auth_environment["user_id"]))
        viewer_user.password_hash = existing_hash
        db.add(viewer_user)
        db.flush()
        db.add(Membership(workspace_id=workspace_id, user_id=viewer_user.id, role=WorkspaceRole.VIEWER))
        db.commit()

    # Login as viewer
    viewer_client = auth_environment["client"]
    viewer_client.cookies.clear()
    login_res = login(viewer_client, email="viewer@example.local")
    assert login_res.status_code == 200
    viewer_client.headers.update(
        {
            "Origin": "http://localhost:5173",
            "X-CSRF-Token": login_res.json()["csrf_token"],
        }
    )

    # Viewer can read
    view_res = viewer_client.get(f"/api/v1/workspaces/{workspace_id}/logs")
    assert view_res.status_code == 200

    # Viewer cannot ingest (403 forbidden)
    forbidden_res = viewer_client.post(
        f"/api/v1/workspaces/{workspace_id}/logs",
        json={"service_id": str(service_id), "message": "Attempt from viewer"},
    )
    assert forbidden_res.status_code == 403
    assert forbidden_res.json()["error"]["code"] == "permission_denied"
