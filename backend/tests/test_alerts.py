"""Comprehensive tests for Real-Time Alerting & Event Management Engine (Milestone 8)."""

from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

import pytest
from pydantic import ValidationError
from sqlalchemy import select

from app.models.alert import (
    Alert,
    AlertEvent,
    AlertRule,
    AlertRuleCondition,
    AlertStatus,
)
from app.models.identity import Membership, User, UserStatus, WorkspaceRole
from app.models.incident import Incident, IncidentSeverity, IncidentStatus
from app.models.log import LogRecord, LogSeverity
from app.models.service import Service, ServiceStatus
from app.schemas.alert import (
    AlertAcknowledgeRequest,
    AlertCreateIncidentRequest,
    AlertResolveRequest,
    AlertRuleCreate,
    AlertRulePatch,
    AlertSnoozeRequest,
)
from app.security.rbac import ROLE_PERMISSIONS, Permission
from app.services.alerts import (
    compute_alert_fingerprint,
    decode_alert_cursor,
    encode_alert_cursor,
    evaluate_alert_rules,
)


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


def _create_service(auth_environment, name="payment-gateway", key=None):
    key = key or f"svc-{uuid4().hex[:8]}"
    with auth_environment["factory"]() as db:
        service = Service(
            workspace_id=auth_environment["workspace_id"],
            name=name,
            service_key=key,
            status=ServiceStatus.ACTIVE,
        )
        db.add(service)
        db.commit()
        return service.id


# ============================================================================
# 1. Schemas & Cursor Unit Tests
# ============================================================================

def test_alert_rule_schema_validations():
    # Valid rule
    rule = AlertRuleCreate(
        name="High 5xx Error Rate",
        description="Triggers when 5xx errors exceed 10 in 5 minutes",
        threshold=10.0,
        window_minutes=5,
        cooldown_minutes=15,
        severity=IncidentSeverity.SEV2,
        condition_type=AlertRuleCondition.ERROR_COUNT,
    )
    assert rule.name == "High 5xx Error Rate"
    assert rule.threshold == 10.0

    # Reject empty name
    with pytest.raises(ValidationError):
        AlertRuleCreate(name="   ", threshold=5.0)

    # Reject non-positive threshold
    with pytest.raises(ValidationError):
        AlertRuleCreate(name="Rule 1", threshold=0)

    # Reject invalid window
    with pytest.raises(ValidationError):
        AlertRuleCreate(name="Rule 2", threshold=5, window_minutes=0)

    with pytest.raises(ValidationError):
        AlertRuleCreate(name="Rule 3", threshold=5, window_minutes=2000)

    # Empty patch is rejected
    with pytest.raises(ValidationError):
        AlertRulePatch()


def test_alert_cursor_encoding():
    alt_id = uuid4()
    now = datetime(2026, 11, 14, 22, 0, 0, tzinfo=timezone.utc)
    mock_alert = Alert(id=alt_id, last_seen_at=now)
    cursor = encode_alert_cursor(mock_alert)
    assert isinstance(cursor, str)

    decoded = decode_alert_cursor(cursor)
    assert decoded is not None
    ts, dec_id = decoded
    assert ts == now
    assert dec_id == alt_id
    assert decode_alert_cursor(None) is None


def test_alert_deterministic_fingerprint():
    w_id = uuid4()
    r_id = uuid4()
    s_id = uuid4()

    fp1 = compute_alert_fingerprint(w_id, r_id, s_id, "error_count")
    fp2 = compute_alert_fingerprint(w_id, r_id, s_id, "error_count")
    fp3 = compute_alert_fingerprint(w_id, r_id, None, "error_count")

    assert fp1 == fp2
    assert fp1 != fp3
    assert len(fp1) == 32


# ============================================================================
# 2. Alert Rules CRUD API Tests
# ============================================================================

def test_alert_rules_crud_lifecycle(auth_environment, login):
    client = _client(auth_environment, login)
    workspace_id = auth_environment["workspace_id"]
    service_id = _create_service(auth_environment, name="auth-service")

    # 1. Create rule
    create_res = client.post(
        f"/api/v1/workspaces/{workspace_id}/alerts/rules",
        json={
            "name": "Database Connection Saturation",
            "description": "Alerts when error logs exceed 5 in 10 minutes",
            "service_id": str(service_id),
            "severity": "SEV1",
            "condition_type": "error_count",
            "threshold": 5.0,
            "window_minutes": 10,
            "cooldown_minutes": 20,
        },
    )
    assert create_res.status_code == 201, create_res.text
    rule_data = create_res.json()
    rule_id = rule_data["id"]
    assert rule_data["name"] == "Database Connection Saturation"
    assert rule_data["service_name"] == "auth-service"

    # 2. Get rule
    get_res = client.get(f"/api/v1/workspaces/{workspace_id}/alerts/rules/{rule_id}")
    assert get_res.status_code == 200
    assert get_res.json()["id"] == rule_id

    # 3. List rules
    list_res = client.get(f"/api/v1/workspaces/{workspace_id}/alerts/rules")
    assert list_res.status_code == 200
    items = list_res.json()["items"]
    assert any(r["id"] == rule_id for r in items)

    # 4. Patch rule
    patch_res = client.patch(
        f"/api/v1/workspaces/{workspace_id}/alerts/rules/{rule_id}",
        json={"threshold": 8.0, "enabled": False},
    )
    assert patch_res.status_code == 200
    assert patch_res.json()["threshold"] == 8.0
    assert patch_res.json()["enabled"] is False

    # 5. Delete rule
    del_res = client.delete(f"/api/v1/workspaces/{workspace_id}/alerts/rules/{rule_id}")
    assert del_res.status_code == 204

    # Verify deleted
    get_again = client.get(f"/api/v1/workspaces/{workspace_id}/alerts/rules/{rule_id}")
    assert get_again.status_code == 404


# ============================================================================
# 3. Rule Evaluation, Alert Generation & Deduplication
# ============================================================================

def test_evaluation_and_deduplication(auth_environment, login):
    client = _client(auth_environment, login)
    workspace_id = auth_environment["workspace_id"]
    service_id = _create_service(auth_environment, name="checkout-api")

    # Create rule: error_count >= 3 in 10 minutes
    rule_res = client.post(
        f"/api/v1/workspaces/{workspace_id}/alerts/rules",
        json={
            "name": "Checkout Spike Failures",
            "service_id": str(service_id),
            "severity": "SEV2",
            "condition_type": "error_count",
            "threshold": 3.0,
            "window_minutes": 10,
            "cooldown_minutes": 15,
        },
    )
    assert rule_res.status_code == 201

    now = datetime.now(timezone.utc)

    # Seed 2 error logs (below threshold)
    with auth_environment["factory"]() as db:
        for _ in range(2):
            db.add(
                LogRecord(
                    workspace_id=workspace_id,
                    service_id=service_id,
                    timestamp=now,
                    severity=LogSeverity.ERROR,
                    message="Stripe API payment timeout",
                )
            )
        db.commit()

    # Evaluation: should not trigger alert yet
    eval_res = client.post(f"/api/v1/workspaces/{workspace_id}/alerts/evaluate?service_id={service_id}")
    assert eval_res.status_code == 200
    assert eval_res.json()["new_alerts_count"] == 0

    # Seed 2 more error logs (total 4 >= threshold 3)
    with auth_environment["factory"]() as db:
        for _ in range(2):
            db.add(
                LogRecord(
                    workspace_id=workspace_id,
                    service_id=service_id,
                    timestamp=now,
                    severity=LogSeverity.ERROR,
                    message="Stripe API payment timeout",
                )
            )
        db.commit()

    # Evaluation: should generate 1 alert
    eval_res2 = client.post(f"/api/v1/workspaces/{workspace_id}/alerts/evaluate?service_id={service_id}")
    assert eval_res2.status_code == 200
    assert eval_res2.json()["new_alerts_count"] == 1
    alert_id = eval_res2.json()["alerts"][0]["id"]

    # Verify alert state
    alert_detail = client.get(f"/api/v1/workspaces/{workspace_id}/alerts/{alert_id}").json()
    assert alert_detail["status"] == "open"
    assert alert_detail["occurrence_count"] == 1
    assert alert_detail["severity"] == "SEV2"

    # Evaluation again with further logs: should deduplicate and increment occurrence_count
    with auth_environment["factory"]() as db:
        db.add(
            LogRecord(
                workspace_id=workspace_id,
                service_id=service_id,
                timestamp=now,
                severity=LogSeverity.ERROR,
                message="Stripe API payment timeout",
            )
        )
        db.commit()

    eval_res3 = client.post(f"/api/v1/workspaces/{workspace_id}/alerts/evaluate?service_id={service_id}")
    assert eval_res3.status_code == 200
    # No new alert created; occurrence incremented
    assert eval_res3.json()["new_alerts_count"] == 0
    assert eval_res3.json()["updated_alerts_count"] == 1

    alert_detail2 = client.get(f"/api/v1/workspaces/{workspace_id}/alerts/{alert_id}").json()
    assert alert_detail2["occurrence_count"] >= 2


# ============================================================================
# 4. Alert Lifecycle Management (Ack, Snooze, Resolve, Reopen)
# ============================================================================

def test_alert_lifecycle_transitions(auth_environment, login):
    client = _client(auth_environment, login)
    workspace_id = auth_environment["workspace_id"]
    service_id = _create_service(auth_environment, name="worker-queue")

    # Manually create an open alert
    with auth_environment["factory"]() as db:
        alert = Alert(
            workspace_id=workspace_id,
            service_id=service_id,
            fingerprint="fp-lifecycle-test-01",
            title="High Latency Spike",
            severity=IncidentSeverity.SEV2,
            status=AlertStatus.OPEN,
            occurrence_count=1,
            first_seen_at=datetime.now(timezone.utc),
            last_seen_at=datetime.now(timezone.utc),
        )
        db.add(alert)
        db.commit()
        alert_id = str(alert.id)

    # 1. Acknowledge
    ack_res = client.post(
        f"/api/v1/workspaces/{workspace_id}/alerts/{alert_id}/acknowledge",
        json={"note": "Investigating worker saturation"},
    )
    assert ack_res.status_code == 200
    assert ack_res.json()["status"] == "acknowledged"
    assert ack_res.json()["acknowledged_at"] is not None

    # 2. Snooze
    snz_res = client.post(
        f"/api/v1/workspaces/{workspace_id}/alerts/{alert_id}/snooze",
        json={"duration_minutes": 120},
    )
    assert snz_res.status_code == 200
    assert snz_res.json()["status"] == "snoozed"
    assert snz_res.json()["snoozed_until"] is not None

    # 3. Resolve
    res_res = client.post(
        f"/api/v1/workspaces/{workspace_id}/alerts/{alert_id}/resolve",
        json={"resolution_note": "Scaled up worker pool to 10 instances"},
    )
    assert res_res.status_code == 200
    assert res_res.json()["status"] == "resolved"
    assert res_res.json()["resolution_note"] == "Scaled up worker pool to 10 instances"

    # 4. Reopen
    rep_res = client.post(f"/api/v1/workspaces/{workspace_id}/alerts/{alert_id}/reopen")
    assert rep_res.status_code == 200
    assert rep_res.json()["status"] == "open"
    assert rep_res.json()["resolved_at"] is None


# ============================================================================
# 5. Incident Escalation & Grouping
# ============================================================================

def test_incident_escalation_and_grouping(auth_environment, login):
    client = _client(auth_environment, login)
    workspace_id = auth_environment["workspace_id"]
    service_id = _create_service(auth_environment, name="api-gateway")

    # Create alert
    with auth_environment["factory"]() as db:
        alert = Alert(
            workspace_id=workspace_id,
            service_id=service_id,
            fingerprint="fp-escalation-01",
            title="Gateway Latency 504 Timeouts",
            description="Upstream gateway timed out after 30s",
            severity=IncidentSeverity.SEV1,
            status=AlertStatus.OPEN,
            occurrence_count=5,
            first_seen_at=datetime.now(timezone.utc),
            last_seen_at=datetime.now(timezone.utc),
        )
        db.add(alert)
        db.commit()
        alert_id = str(alert.id)

    # 1. Grouped alerts query
    group_res = client.get(f"/api/v1/workspaces/{workspace_id}/alerts/groups")
    assert group_res.status_code == 200
    groups = group_res.json()["groups"]
    assert len(groups) >= 1
    assert any(g["service_id"] == str(service_id) for g in groups)

    # 2. Stats query
    stats_res = client.get(f"/api/v1/workspaces/{workspace_id}/alerts/stats")
    assert stats_res.status_code == 200
    stats = stats_res.json()
    assert stats["total_open"] >= 1
    assert stats["total_critical"] >= 1

    # 3. Create incident from alert
    esc_res = client.post(
        f"/api/v1/workspaces/{workspace_id}/alerts/{alert_id}/create-incident",
        json={"title": "Severe Gateway Timeouts", "severity": "SEV1"},
    )
    assert esc_res.status_code == 201
    updated_alert = esc_res.json()
    assert updated_alert["incident_id"] is not None
    assert updated_alert["incident_reference"] is not None

    # Calling create-incident again returns the existing incident without duplicating
    esc_res_2 = client.post(
        f"/api/v1/workspaces/{workspace_id}/alerts/{alert_id}/create-incident",
        json={},
    )
    assert esc_res_2.status_code == 201
    assert esc_res_2.json()["incident_id"] == updated_alert["incident_id"]


# ============================================================================
# 6. RBAC & Workspace Isolation Tests
# ============================================================================

def test_alert_rbac_and_isolation(auth_environment, login):
    client = _client(auth_environment, login)
    workspace_id = auth_environment["workspace_id"]
    service_id = _create_service(auth_environment)

    # Verify RBAC mappings
    assert Permission.ALERT_READ in ROLE_PERMISSIONS[WorkspaceRole.VIEWER]
    assert Permission.ALERT_WRITE not in ROLE_PERMISSIONS[WorkspaceRole.VIEWER]
    assert Permission.ALERT_MANAGE not in ROLE_PERMISSIONS[WorkspaceRole.VIEWER]

    assert Permission.ALERT_READ in ROLE_PERMISSIONS[WorkspaceRole.RESPONDER]
    assert Permission.ALERT_WRITE in ROLE_PERMISSIONS[WorkspaceRole.RESPONDER]
    assert Permission.ALERT_MANAGE not in ROLE_PERMISSIONS[WorkspaceRole.RESPONDER]

    assert Permission.ALERT_MANAGE in ROLE_PERMISSIONS[WorkspaceRole.COMMANDER]
    assert Permission.ALERT_MANAGE in ROLE_PERMISSIONS[WorkspaceRole.ADMIN]

    # Create alert in workspace 1
    with auth_environment["factory"]() as db:
        alert = Alert(
            workspace_id=workspace_id,
            service_id=service_id,
            fingerprint="fp-iso-01",
            title="Isolated Alert",
            severity=IncidentSeverity.SEV3,
            status=AlertStatus.OPEN,
            occurrence_count=1,
            first_seen_at=datetime.now(timezone.utc),
            last_seen_at=datetime.now(timezone.utc),
        )
        db.add(alert)
        db.commit()
        alert_id = str(alert.id)

    # Request from different workspace: must deny
    other_workspace_id = uuid4()
    denied_res = client.get(f"/api/v1/workspaces/{other_workspace_id}/alerts/{alert_id}")
    assert denied_res.status_code in {403, 404}


# ============================================================================
# 7. Log Ingestion Evaluation Trigger
# ============================================================================

def test_log_ingestion_triggers_alert_evaluation(auth_environment, login):
    client = _client(auth_environment, login)
    workspace_id = auth_environment["workspace_id"]
    service_id = _create_service(auth_environment, name="identity-auth")

    # Create rule: error_count >= 2 in 5m
    client.post(
        f"/api/v1/workspaces/{workspace_id}/alerts/rules",
        json={
            "name": "Auth Failure Threshold",
            "service_id": str(service_id),
            "severity": "SEV1",
            "condition_type": "error_count",
            "threshold": 2.0,
            "window_minutes": 5,
            "cooldown_minutes": 10,
        },
    )

    # Ingest 2 error logs via batch endpoint
    ingest_res = client.post(
        f"/api/v1/workspaces/{workspace_id}/logs/batch",
        json={
            "items": [
                {
                    "service_id": str(service_id),
                    "severity": "ERROR",
                    "message": "Invalid JWT signature received",
                },
                {
                    "service_id": str(service_id),
                    "severity": "ERROR",
                    "message": "Auth token expired and refresh failed",
                },
            ]
        },
    )
    assert ingest_res.status_code == 201

    # Check that alert was automatically generated by log ingestion!
    alerts_res = client.get(f"/api/v1/workspaces/{workspace_id}/alerts?service_id={service_id}")
    assert alerts_res.status_code == 200
    items = alerts_res.json()["items"]
    assert len(items) >= 1
    assert any("Auth Failure Threshold" in item["title"] for item in items)
