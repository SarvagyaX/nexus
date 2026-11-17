"""Milestone 10 - Notifications, Preferences, On-Call, and Escalation tests."""

from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from starlette.testclient import TestClient

from app.core.config import get_settings
from app.models.identity import Membership, User, UserStatus, Workspace, WorkspaceRole
from app.models.incident import Incident, IncidentSeverity, IncidentStatus
from app.models.service import Service, ServiceStatus
from app.models.notification import (
    EscalationExecution,
    EscalationExecutionStatus,
    EscalationPolicy,
    EscalationStep,
    EscalationTargetType,
    Notification,
    NotificationCategory,
    NotificationDeliveryChannel,
    NotificationDeliveryStatus,
    OnCallRotationType,
    OnCallSchedule,
    utc_now,
)
from app.services.escalation import (
    acknowledge_escalation_for_entity,
    create_policy,
    get_policy,
    list_executions,
    list_policies,
    process_due_escalations,
    resolve_escalation_for_entity,
    trigger_escalation,
)
from app.services.notifications import (
    dispatch_notification,
    get_or_create_user_preferences,
    get_unread_count,
    list_notifications,
    mark_all_read,
    mark_notification_read,
    update_user_preferences,
)
from app.services.on_call import (
    create_schedule,
    get_schedule,
    list_schedules,
    resolve_current_on_call,
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


def _create_service(db, workspace_id, name="core-api"):
    service = Service(
        workspace_id=workspace_id,
        name=name,
        service_key=f"svc-{uuid4().hex[:8]}",
        status=ServiceStatus.ACTIVE,
    )
    db.add(service)
    db.flush()
    return service


# ============================================================================
# 1. Notification Creation, Retrieval, and Read States
# ============================================================================

def test_notification_creation_and_retrieval(auth_environment, login):
    """Test dispatching and querying workspace-scoped in-app notifications."""
    client = _client(auth_environment, login)
    workspace_id = auth_environment["workspace_id"]
    user_id = auth_environment["user_id"]
    factory = auth_environment["factory"]

    with factory() as db:
        notif = dispatch_notification(
            db=db,
            workspace_id=workspace_id,
            user_id=user_id,
            category=NotificationCategory.ALERT,
            severity="SEV1",
            title="Database Connection Spike",
            message="Active connections exceeded 95% pool capacity.",
            link="/alerts/123",
            entity_type="alert",
            entity_id=uuid4(),
            force_in_app=True,
        )
        assert notif is not None
        assert notif.id is not None
        notif_id = str(notif.id)

    res = client.get(f"/api/v1/workspaces/{workspace_id}/notifications")
    assert res.status_code == 200
    data = res.json()
    assert "items" in data
    assert "total_unread" in data
    assert data["total_unread"] >= 1
    matching = [i for i in data["items"] if i["id"] == notif_id]
    assert len(matching) == 1
    assert matching[0]["title"] == "Database Connection Spike"
    assert matching[0]["severity"] == "SEV1"
    assert matching[0]["category"] == "alert"
    assert matching[0]["is_read"] is False


def test_notification_read_and_unread_operations(auth_environment, login):
    """Test marking notifications as read individually and in bulk."""
    client = _client(auth_environment, login)
    workspace_id = auth_environment["workspace_id"]
    user_id = auth_environment["user_id"]
    factory = auth_environment["factory"]

    with factory() as db:
        n1 = dispatch_notification(
            db=db,
            workspace_id=workspace_id,
            user_id=user_id,
            category=NotificationCategory.INCIDENT,
            severity="SEV2",
            title="Elevated API Latency",
            message="P95 latency exceeded threshold.",
            force_in_app=True,
        )
        n2 = dispatch_notification(
            db=db,
            workspace_id=workspace_id,
            user_id=user_id,
            category=NotificationCategory.SYSTEM,
            severity="info",
            title="System Maintenance Window",
            message="Scheduled maintenance starting soon.",
            force_in_app=True,
        )
        n1_id = str(n1.id)
        n2_id = str(n2.id)

    # Check unread count
    count_res = client.get(f"/api/v1/workspaces/{workspace_id}/notifications/unread-count")
    assert count_res.status_code == 200
    initial_unread = count_res.json()["unread_count"]
    assert initial_unread >= 2

    # Mark single as read
    mark_res = client.post(
        f"/api/v1/workspaces/{workspace_id}/notifications/{n1_id}/read",
    )
    assert mark_res.status_code == 200
    assert mark_res.json()["is_read"] is True

    # Mark all remaining as read
    read_all_res = client.post(
        f"/api/v1/workspaces/{workspace_id}/notifications/read-all",
        json={"notification_ids": [n2_id]},
    )
    assert read_all_res.status_code == 200
    assert read_all_res.json()["marked_read"] >= 1


# ============================================================================
# 2. Notification Preferences and Filtering
# ============================================================================

def test_notification_preferences_crud(auth_environment, login):
    """Test retrieving and updating notification preferences."""
    client = _client(auth_environment, login)
    workspace_id = auth_environment["workspace_id"]

    # 1. Get default preferences
    get_res = client.get(f"/api/v1/workspaces/{workspace_id}/notifications/preferences")
    assert get_res.status_code == 200
    prefs = get_res.json()
    assert prefs["alerts_enabled"] is True
    assert prefs["in_app_enabled"] is True

    # 2. Update preferences
    update_res = client.put(
        f"/api/v1/workspaces/{workspace_id}/notifications/preferences",
        json={
            "alerts_min_severity": "SEV1",
            "incidents_min_severity": "SEV1",
            "email_enabled": False,
            "webhook_enabled": True,
            "webhook_url": "https://example.com/alerts-hook",
        },
    )
    assert update_res.status_code == 200
    updated = update_res.json()
    assert updated["alerts_min_severity"] == "SEV1"
    assert updated["email_enabled"] is False
    assert updated["webhook_enabled"] is True
    assert updated["webhook_url"] == "https://example.com/alerts-hook"


def test_notification_preference_severity_filtering(auth_environment):
    """Test that notification dispatch respects severity thresholds."""
    workspace_id = auth_environment["workspace_id"]
    user_id = auth_environment["user_id"]
    factory = auth_environment["factory"]

    with factory() as db:
        update_user_preferences(
            db=db,
            workspace_id=workspace_id,
            user_id=user_id,
            updates={"alerts_enabled": True, "alerts_min_severity": "SEV1"},
        )

        # SEV3 alert should be filtered out
        n_low = dispatch_notification(
            db=db,
            workspace_id=workspace_id,
            user_id=user_id,
            category=NotificationCategory.ALERT,
            severity="SEV3",
            title="Minor CPU Jitter",
            message="CPU jitter detected on worker.",
        )
        assert n_low is None

        # SEV1 alert should pass through
        n_high = dispatch_notification(
            db=db,
            workspace_id=workspace_id,
            user_id=user_id,
            category=NotificationCategory.ALERT,
            severity="SEV1",
            title="Service Outage",
            message="Service is completely unavailable.",
        )
        assert n_high is not None
        assert n_high.severity == "SEV1"


def test_notification_dedup_idempotency(auth_environment):
    """Test that duplicate notifications with identical dedup_key are dropped."""
    workspace_id = auth_environment["workspace_id"]
    user_id = auth_environment["user_id"]
    factory = auth_environment["factory"]

    with factory() as db:
        key = f"alert-eval-12345-{uuid4()}"
        n1 = dispatch_notification(
            db=db,
            workspace_id=workspace_id,
            user_id=user_id,
            category=NotificationCategory.ALERT,
            severity="SEV2",
            title="Repeated Error Spike",
            message="Errors reached threshold.",
            dedup_key=key,
            force_in_app=True,
        )
        assert n1 is not None

        # Second dispatch with identical key should return n1 without creating duplicate
        n2 = dispatch_notification(
            db=db,
            workspace_id=workspace_id,
            user_id=user_id,
            category=NotificationCategory.ALERT,
            severity="SEV2",
            title="Repeated Error Spike",
            message="Errors reached threshold.",
            dedup_key=key,
            force_in_app=True,
        )
        assert n2 is not None
        assert n2.id == n1.id


# ============================================================================
# 3. Provider Status and Webhook Verification
# ============================================================================

def test_provider_status_and_webhook_test(auth_environment, login):
    """Test delivery provider status reporting and test webhook endpoint."""
    client = _client(auth_environment, login)
    workspace_id = auth_environment["workspace_id"]

    status_res = client.get(f"/api/v1/workspaces/{workspace_id}/notifications/providers/status")
    assert status_res.status_code == 200
    providers = status_res.json()["providers"]
    assert any(p["channel"] == "in_app" and p["is_available"] for p in providers)
    assert any(p["channel"] == "webhook" and p["is_available"] for p in providers)

    # Test webhook with unreachable URL reports failure without crashing
    webhook_res = client.post(
        f"/api/v1/workspaces/{workspace_id}/notifications/test-webhook",
        json={"webhook_url": "http://127.0.0.1:59999/test-webhook-dead"},
    )
    assert webhook_res.status_code == 200
    result = webhook_res.json()
    assert result["success"] is False
    assert "duration_ms" in result
    assert result["message"] is not None


# ============================================================================
# 4. On-Call Schedule Rotation and Resolution
# ============================================================================

def test_on_call_schedule_crud_and_rotation(auth_environment, login):
    """Test on-call schedule CRUD and deterministic user rotation resolution."""
    client = _client(auth_environment, login)
    workspace_id = auth_environment["workspace_id"]
    user_id = str(auth_environment["user_id"])

    # 1. Create schedule
    create_res = client.post(
        f"/api/v1/workspaces/{workspace_id}/on-call/schedules",
        json={
            "name": "Tier 1 SRE Rotation",
            "description": "Primary incident responders",
            "timezone": "UTC",
            "rotation_type": "weekly",
            "rotation_interval_days": 7,
            "handover_hour": 9,
            "members": [
                {"user_id": user_id, "name": "Primary SRE", "email": "sre1@nexus.local", "order": 0},
                {"user_id": str(uuid4()), "name": "Secondary SRE", "email": "sre2@nexus.local", "order": 1},
            ],
        },
    )
    assert create_res.status_code == 201
    schedule_data = create_res.json()
    schedule_id = schedule_data["id"]
    assert schedule_data["name"] == "Tier 1 SRE Rotation"
    assert len(schedule_data["members"]) == 2

    # 2. Resolve current on-call user
    current_res = client.get(f"/api/v1/workspaces/{workspace_id}/on-call/schedules/{schedule_id}/current")
    assert current_res.status_code == 200
    current_data = current_res.json()
    assert current_data["current_user"] is not None
    assert current_data["current_user"]["name"] == "Primary SRE"

    # 3. Test mathematical shift rotation in service
    factory = auth_environment["factory"]
    with factory() as db:
        schedule = get_schedule(db, workspace_id, schedule_id)
        # Advance 8 days (1 cycle ahead)
        future_time = schedule.shift_start_time + timedelta(days=8)
        next_member, shift_start, shift_end = resolve_current_on_call(schedule, at_time=future_time)
        assert next_member is not None
        assert next_member["name"] == "Secondary SRE"

    # 4. Delete schedule
    del_res = client.delete(
        f"/api/v1/workspaces/{workspace_id}/on-call/schedules/{schedule_id}",
    )
    assert del_res.status_code == 204


# ============================================================================
# 5. Escalation Policies and Due Execution Processing
# ============================================================================

def test_escalation_policy_lifecycle_and_execution(auth_environment, login):
    """Test escalation policy creation, execution, and due-step advancement."""
    client = _client(auth_environment, login)
    workspace_id = auth_environment["workspace_id"]
    user_id = auth_environment["user_id"]

    # 1. Create policy with 2 steps
    create_res = client.post(
        f"/api/v1/workspaces/{workspace_id}/escalation/policies",
        json={
            "name": "High Severity Incident Escalation",
            "description": "Escalates SEV1 and SEV2 incidents",
            "min_severity": "SEV2",
            "steps": [
                {
                    "step_number": 1,
                    "target_type": "user",
                    "target_user_id": str(user_id),
                    "delay_minutes": 15,
                },
                {
                    "step_number": 2,
                    "target_type": "user",
                    "target_user_id": str(user_id),
                    "delay_minutes": 30,
                },
            ],
        },
    )
    assert create_res.status_code == 201
    policy_data = create_res.json()
    policy_id = policy_data["id"]
    assert len(policy_data["steps"]) == 2

    # 2. Trigger escalation manually via service
    factory = auth_environment["factory"]
    with factory() as db:
        # Create a mock service and incident
        svc = _create_service(db, workspace_id, name="payment-svc")
        incident = Incident(
            workspace_id=workspace_id,
            service_id=svc.id,
            reference="INC-TEST-100",
            title="Payment Processing Failure",
            summary="Payment transactions are failing with gateway timeouts.",
            severity=IncidentSeverity.SEV1,
            status=IncidentStatus.INVESTIGATING,
            detected_at=utc_now(),
        )
        db.add(incident)
        db.commit()

        # Trigger escalation
        execution = trigger_escalation(db, workspace_id, incident=incident)
        assert execution is not None
        assert execution.current_step_number == 1
        assert execution.status == EscalationExecutionStatus.ACTIVE
        assert execution.next_escalation_at is not None
        assert len(execution.history) == 1
        ex_id = execution.id

        # Simulate due time reached by rewinding next_escalation_at
        execution.next_escalation_at = utc_now() - timedelta(minutes=1)
        db.commit()

        # 3. Process due escalations
        processed = process_due_escalations(db)
        assert len(processed) >= 1
        updated_ex = next(p for p in processed if p.id == ex_id)
        assert updated_ex.current_step_number == 2
        assert len(updated_ex.history) == 2


def test_acknowledgement_stops_escalation(auth_environment):
    """Test that acknowledging an incident or alert immediately halts further escalation."""
    workspace_id = auth_environment["workspace_id"]
    user_id = auth_environment["user_id"]
    factory = auth_environment["factory"]

    with factory() as db:
        policy = create_policy(
            db=db,
            workspace_id=workspace_id,
            name="Ack Test Policy",
            min_severity="SEV2",
            steps=[
                {"step_number": 1, "target_type": "user", "target_user_id": user_id, "delay_minutes": 10},
                {"step_number": 2, "target_type": "user", "target_user_id": user_id, "delay_minutes": 20},
            ],
        )

        svc = _create_service(db, workspace_id, name="db-svc")
        incident = Incident(
            workspace_id=workspace_id,
            service_id=svc.id,
            reference="INC-TEST-200",
            title="Database Connection Latency",
            severity=IncidentSeverity.SEV2,
            status=IncidentStatus.INVESTIGATING,
            detected_at=utc_now(),
        )
        db.add(incident)
        db.commit()

        execution = trigger_escalation(db, workspace_id, incident=incident)
        assert execution.status == EscalationExecutionStatus.ACTIVE

        # Acknowledge incident
        acknowledge_escalation_for_entity(db, workspace_id, "incident", incident.id, user_id)

        # Verify execution status transitioned
        db.refresh(execution)
        assert execution.status == EscalationExecutionStatus.ACKNOWLEDGED
        assert execution.acknowledged_at is not None
        assert execution.next_escalation_at is None

        # Further due-time processing should ignore acknowledged execution
        execution.next_escalation_at = utc_now() - timedelta(minutes=5)
        db.commit()
        processed = process_due_escalations(db)
        assert not any(p.id == execution.id and p.status == EscalationExecutionStatus.ACTIVE for p in processed)


def test_resolution_stops_escalation(auth_environment):
    """Test that resolving an incident or alert stops escalation."""
    workspace_id = auth_environment["workspace_id"]
    user_id = auth_environment["user_id"]
    factory = auth_environment["factory"]

    with factory() as db:
        policy = create_policy(
            db=db,
            workspace_id=workspace_id,
            name="Resolution Test Policy",
            min_severity="SEV2",
            steps=[
                {"step_number": 1, "target_type": "user", "target_user_id": user_id, "delay_minutes": 10},
                {"step_number": 2, "target_type": "user", "target_user_id": user_id, "delay_minutes": 20},
            ],
        )

        svc = _create_service(db, workspace_id, name="cache-svc")
        incident = Incident(
            workspace_id=workspace_id,
            service_id=svc.id,
            reference="INC-TEST-300",
            title="Cache Memory Saturation",
            severity=IncidentSeverity.SEV2,
            status=IncidentStatus.INVESTIGATING,
            detected_at=utc_now(),
        )
        db.add(incident)
        db.commit()

        execution = trigger_escalation(db, workspace_id, incident=incident)
        assert execution.status == EscalationExecutionStatus.ACTIVE

        # Resolve incident
        resolve_escalation_for_entity(db, workspace_id, "incident", incident.id, user_id)

        db.refresh(execution)
        assert execution.status == EscalationExecutionStatus.RESOLVED
        assert execution.resolved_at is not None
        assert execution.next_escalation_at is None
