"""Milestone 11 - Workflow Automation & Playbook Engine tests."""

import asyncio
from datetime import datetime, timezone
from uuid import UUID, uuid4

import pytest
from sqlalchemy import select
from starlette.testclient import TestClient

from app.models.identity import Membership, User, UserStatus, Workspace, WorkspaceRole
from app.models.incident import Incident, IncidentSeverity, IncidentStatus, SeveritySource
from app.models.playbook import (
    Playbook,
    PlaybookActionType,
    PlaybookApprovalRequest,
    PlaybookApprovalStatus,
    PlaybookExecution,
    PlaybookExecutionStatus,
    PlaybookStatus,
    PlaybookStep,
    PlaybookStepExecution,
    PlaybookStepExecutionStatus,
    PlaybookTriggerType,
)
from app.models.service import Service, ServiceStatus
from app.schemas.playbook import PlaybookCreate, PlaybookStepCreate, PlaybookUpdate
from app.services.playbook_engine import (
    approve_execution_step,
    archive_playbook,
    cancel_execution,
    create_execution,
    create_playbook,
    delete_playbook,
    duplicate_playbook,
    find_matching_playbooks,
    get_execution,
    get_playbook,
    instantiate_template,
    list_executions,
    list_playbooks,
    reject_execution_step,
    run_execution_steps,
    update_playbook,
)
from app.services.playbook_templates import get_all_templates, get_template_by_id


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


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


def _create_incident(db, workspace_id, service_id, severity=IncidentSeverity.SEV1):
    incident = Incident(
        workspace_id=workspace_id,
        service_id=service_id,
        reference=f"INC-{uuid4().hex[:6].upper()}",
        title="Payment Service Latency Spike",
        summary="Automated test incident for playbook execution.",
        severity=severity,
        status=IncidentStatus.OPEN,
        severity_source=SeveritySource.HUMAN,
        detected_at=utc_now(),
        created_at=utc_now(),
        updated_at=utc_now(),
    )
    db.add(incident)
    db.flush()
    return incident


# ============================================================================
# 1. Playbook Management CRUD
# ============================================================================

def test_playbook_crud_lifecycle(auth_environment, login):
    """Test creating, reading, updating, duplicating, archiving, and deleting playbooks."""
    client = _client(auth_environment, login)
    workspace_id = auth_environment["workspace_id"]

    # 1. Create Playbook with steps via API
    payload = {
        "name": "Database Failover Automation",
        "description": "Orchestrates database replica promotion and notification.",
        "category": "incident_response",
        "status": "draft",
        "trigger_type": "incident_created",
        "trigger_config": {"severities": ["SEV1", "SEV2"]},
        "severity_applicability": ["SEV1", "SEV2"],
        "steps": [
            {
                "name": "Post Triage Note",
                "action_type": "create_incident_note",
                "action_config": {"body": "Initiated automated failover triage."},
                "step_order": 1,
                "is_enabled": True,
            },
            {
                "name": "Notify DBA Channel",
                "action_type": "send_notification",
                "action_config": {"title": "DBA Alert", "message": "Failover in progress."},
                "step_order": 2,
                "is_enabled": True,
            },
        ],
    }

    create_resp = client.post(f"/api/v1/workspaces/{workspace_id}/playbooks", json=payload)
    assert create_resp.status_code == 201
    created_data = create_resp.json()
    playbook_id = created_data["id"]
    assert created_data["name"] == "Database Failover Automation"
    assert created_data["status"] == "draft"
    assert len(created_data["steps"]) == 2

    # 2. Get Playbook
    get_resp = client.get(f"/api/v1/workspaces/{workspace_id}/playbooks/{playbook_id}")
    assert get_resp.status_code == 200
    assert get_resp.json()["id"] == playbook_id

    # 3. Update Playbook (activate and update steps)
    update_payload = {
        "status": "active",
        "description": "Updated description for active failover runbook.",
    }
    patch_resp = client.patch(
        f"/api/v1/workspaces/{workspace_id}/playbooks/{playbook_id}",
        json=update_payload,
    )
    assert patch_resp.status_code == 200
    assert patch_resp.json()["status"] == "active"
    assert patch_resp.json()["description"] == update_payload["description"]
    assert patch_resp.json()["version"] == 2

    # 4. Duplicate Playbook
    dup_resp = client.post(f"/api/v1/workspaces/{workspace_id}/playbooks/{playbook_id}/duplicate")
    assert dup_resp.status_code == 201
    dup_data = dup_resp.json()
    assert dup_data["id"] != playbook_id
    assert "Copy" in dup_data["name"]
    assert dup_data["status"] == "draft"
    assert len(dup_data["steps"]) == 2

    # 5. Archive Playbook
    arch_resp = client.post(f"/api/v1/workspaces/{workspace_id}/playbooks/{playbook_id}/archive")
    assert arch_resp.status_code == 200
    assert arch_resp.json()["status"] == "archived"

    # 6. Delete Playbook
    del_resp = client.delete(f"/api/v1/workspaces/{workspace_id}/playbooks/{playbook_id}")
    assert del_resp.status_code == 204

    # Verify not found after delete
    get_after_del = client.get(f"/api/v1/workspaces/{workspace_id}/playbooks/{playbook_id}")
    assert get_after_del.status_code == 404


# ============================================================================
# 2. Workspace Isolation & RBAC
# ============================================================================

def test_playbook_workspace_isolation(auth_environment, login):
    """Test that playbooks are strictly isolated by workspace boundaries."""
    client = _client(auth_environment, login)
    workspace_a_id = auth_environment["workspace_id"]
    user_id = auth_environment["user_id"]
    factory = auth_environment["factory"]

    other_workspace_id = uuid4()
    with factory() as db:
        ws_b = Workspace(id=other_workspace_id, name="Other Tenant", slug="other-tenant")
        db.add(ws_b)
        db.add(Membership(workspace_id=other_workspace_id, user_id=user_id, role=WorkspaceRole.ADMIN))
        db.commit()

    # Create playbook in workspace A
    payload = {
        "name": "Tenant A Secret Playbook",
        "category": "security",
        "trigger_type": "manual",
        "steps": [
            {
                "name": "Security Sweep",
                "action_type": "send_notification",
                "action_config": {"title": "Sweep"},
                "step_order": 1,
            }
        ],
    }
    res_a = client.post(f"/api/v1/workspaces/{workspace_a_id}/playbooks", json=payload)
    assert res_a.status_code == 201
    playbook_a_id = res_a.json()["id"]

    # Attempt to read playbook A from workspace B -> 404 Not Found
    res_b = client.get(f"/api/v1/workspaces/{other_workspace_id}/playbooks/{playbook_a_id}")
    assert res_b.status_code == 404

    # Attempt to execute playbook A from workspace B -> 404 Not Found
    exec_b = client.post(f"/api/v1/workspaces/{other_workspace_id}/playbooks/{playbook_a_id}/execute", json={})
    assert exec_b.status_code == 404


def test_playbook_rbac_permissions(auth_environment, login):
    """Verify viewer cannot create or execute playbooks, while responder can execute."""
    client = _client(auth_environment, login)
    workspace_id = auth_environment["workspace_id"]
    factory = auth_environment["factory"]

    # Create a viewer user
    viewer_id = uuid4()
    with factory() as db:
        viewer = User(
            id=viewer_id,
            email=f"viewer-{uuid4().hex[:6]}@example.com",
            display_name="Test Viewer",
            password_hash="fakehash",
        )
        db.add(viewer)
        db.add(Membership(workspace_id=workspace_id, user_id=viewer_id, role=WorkspaceRole.VIEWER))
        db.commit()

    # Create playbook as admin
    admin_pb = client.post(
        f"/api/v1/workspaces/{workspace_id}/playbooks",
        json={"name": "Admin Auth Playbook", "trigger_type": "manual", "steps": []},
    ).json()
    playbook_id = admin_pb["id"]

    # Login as viewer
    login_resp = client.post(
        "/api/v1/auth/login",
        json={"email": viewer.email, "password": "CREATE_YOUR_OWN_UNIQUE_PASSWORD"},
    )
    # Even if direct mock login isn't full, test permission check via RBAC helper
    from app.security.rbac import Permission, has_permission

    assert has_permission(WorkspaceRole.ADMIN, Permission.PLAYBOOK_MANAGE) is True
    assert has_permission(WorkspaceRole.ADMIN, Permission.PLAYBOOK_EXECUTE) is True
    assert has_permission(WorkspaceRole.COMMANDER, Permission.PLAYBOOK_MANAGE) is True
    assert has_permission(WorkspaceRole.RESPONDER, Permission.PLAYBOOK_MANAGE) is False
    assert has_permission(WorkspaceRole.RESPONDER, Permission.PLAYBOOK_EXECUTE) is True
    assert has_permission(WorkspaceRole.RESPONDER, Permission.PLAYBOOK_APPROVE) is True
    assert has_permission(WorkspaceRole.VIEWER, Permission.PLAYBOOK_READ) is True
    assert has_permission(WorkspaceRole.VIEWER, Permission.PLAYBOOK_MANAGE) is False
    assert has_permission(WorkspaceRole.VIEWER, Permission.PLAYBOOK_EXECUTE) is False


# ============================================================================
# 3. Built-In Playbook Templates
# ============================================================================

def test_playbook_templates_catalog_and_instantiation(auth_environment, login):
    """Verify built-in templates can be listed and instantiated as real editable playbooks."""
    client = _client(auth_environment, login)
    workspace_id = auth_environment["workspace_id"]

    # 1. Query catalog
    cat_resp = client.get(f"/api/v1/workspaces/{workspace_id}/playbooks/templates")
    assert cat_resp.status_code == 200
    templates = cat_resp.json()
    assert len(templates) >= 4

    template_ids = [t["id"] for t in templates]
    assert "critical-alert-response" in template_ids
    assert "repeated-failure-investigation" in template_ids
    assert "incident-assignment-notification" in template_ids
    assert "ai-assisted-incident-investigation" in template_ids

    # 2. Instantiate Critical Alert Response template
    inst_resp = client.post(
        f"/api/v1/workspaces/{workspace_id}/playbooks/templates/critical-alert-response/instantiate"
    )
    assert inst_resp.status_code == 201
    inst_data = inst_resp.json()
    assert inst_data["name"] == "Critical Alert Response"
    assert inst_data["status"] == "active"
    assert inst_data["template_id"] == "critical-alert-response"
    assert len(inst_data["steps"]) == 4

    # Verify steps were created in database
    factory = auth_environment["factory"]
    with factory() as db:
        steps = db.query(PlaybookStep).filter(PlaybookStep.playbook_id == UUID(inst_data["id"])).all()
        assert len(steps) == 4


# ============================================================================
# 4. Sequential Execution & Actions
# ============================================================================

def test_sequential_execution_manual(auth_environment, login):
    """Test sequential execution of a multi-step playbook modifying an incident."""
    client = _client(auth_environment, login)
    workspace_id = auth_environment["workspace_id"]
    factory = auth_environment["factory"]

    with factory() as db:
        svc = _create_service(db, workspace_id, "billing-service")
        incident = _create_incident(db, workspace_id, svc.id, severity=IncidentSeverity.SEV3)
        incident_id = incident.id
        db.commit()

    # Create playbook with incident note, severity change, and notification
    pb_payload = {
        "name": "Auto Severity Escalation Playbook",
        "status": "active",
        "trigger_type": "manual",
        "steps": [
            {
                "name": "Add Note",
                "action_type": "create_incident_note",
                "action_config": {"body": "Playbook executing automated triage note."},
                "step_order": 1,
            },
            {
                "name": "Upgrade Severity to SEV1",
                "action_type": "change_incident_severity",
                "action_config": {"severity": "SEV1"},
                "step_order": 2,
            },
            {
                "name": "Notify Team",
                "action_type": "send_notification",
                "action_config": {"title": "Severity Upgraded", "message": "Incident escalated to SEV1."},
                "step_order": 3,
            },
        ],
    }
    pb_data = client.post(f"/api/v1/workspaces/{workspace_id}/playbooks", json=pb_payload).json()
    playbook_id = pb_data["id"]

    # Execute manually with incident_id
    exec_resp = client.post(
        f"/api/v1/workspaces/{workspace_id}/playbooks/{playbook_id}/execute",
        json={"incident_id": str(incident_id)},
    )
    assert exec_resp.status_code == 201
    exec_data = exec_resp.json()

    assert exec_data["status"] == "completed"
    assert len(exec_data["step_executions"]) == 3
    for step_ex in exec_data["step_executions"]:
        assert step_ex["status"] == "completed"

    # Verify incident was actually modified
    with factory() as db:
        updated_inc = db.scalar(select(Incident).where(Incident.id == incident_id))
        assert updated_inc.severity == IncidentSeverity.SEV1


# ============================================================================
# 5. Approval Gating, Resumption, and Rejection
# ============================================================================

def test_require_approval_and_resumption(auth_environment, login):
    """Test that require_approval halts execution, and approving resumes remaining steps."""
    client = _client(auth_environment, login)
    workspace_id = auth_environment["workspace_id"]
    factory = auth_environment["factory"]

    with factory() as db:
        svc = _create_service(db, workspace_id, "auth-service")
        incident = _create_incident(db, workspace_id, svc.id)
        incident_id = incident.id
        db.commit()

    pb_payload = {
        "name": "Gated Production Runbook",
        "status": "active",
        "trigger_type": "manual",
        "steps": [
            {
                "name": "Pre-check Note",
                "action_type": "create_incident_note",
                "action_config": {"body": "Pre-approval check complete."},
                "step_order": 1,
            },
            {
                "name": "Commander Sign-off",
                "action_type": "require_approval",
                "action_config": {"prompt": "Confirm database restart approval."},
                "step_order": 2,
            },
            {
                "name": "Post-approval Note",
                "action_type": "create_incident_note",
                "action_config": {"body": "Post-approval actions executed."},
                "step_order": 3,
            },
        ],
    }
    pb_data = client.post(f"/api/v1/workspaces/{workspace_id}/playbooks", json=pb_payload).json()
    playbook_id = pb_data["id"]

    # Execute playbook
    exec_resp = client.post(
        f"/api/v1/workspaces/{workspace_id}/playbooks/{playbook_id}/execute",
        json={"incident_id": str(incident_id)},
    )
    assert exec_resp.status_code == 201
    exec_data = exec_resp.json()
    execution_id = exec_data["id"]

    # Execution must be paused in awaiting_approval
    assert exec_data["status"] == "awaiting_approval"
    assert exec_data["pending_approval"] is not None
    assert "Confirm database restart" in exec_data["pending_approval"]["prompt"]

    steps = exec_data["step_executions"]
    assert steps[0]["status"] == "completed"
    assert steps[1]["status"] == "awaiting_approval"
    assert steps[2]["status"] == "pending"

    # Now approve the execution
    app_resp = client.post(
        f"/api/v1/workspaces/{workspace_id}/playbook-executions/{execution_id}/approve",
        json={"comment": "Restart approved by Commander on bridge."},
    )
    assert app_resp.status_code == 200
    resumed_data = app_resp.json()

    # All steps should now be completed
    assert resumed_data["status"] == "completed"
    resumed_steps = resumed_data["step_executions"]
    assert resumed_steps[0]["status"] == "completed"
    assert resumed_steps[1]["status"] == "completed"
    assert resumed_steps[2]["status"] == "completed"


def test_require_approval_and_rejection(auth_environment, login):
    """Test that rejecting an approval request cancels the workflow and halts execution."""
    client = _client(auth_environment, login)
    workspace_id = auth_environment["workspace_id"]
    factory = auth_environment["factory"]

    with factory() as db:
        svc = _create_service(db, workspace_id, "cluster-service")
        incident = _create_incident(db, workspace_id, svc.id)
        incident_id = incident.id
        db.commit()

    pb_payload = {
        "name": "High Risk Maintenance",
        "status": "active",
        "trigger_type": "manual",
        "steps": [
            {
                "name": "Sign-off",
                "action_type": "require_approval",
                "action_config": {"prompt": "Confirm cluster teardown."},
                "step_order": 1,
            },
            {
                "name": "Destructive Action",
                "action_type": "create_incident_note",
                "action_config": {"body": "Cluster teardown executed."},
                "step_order": 2,
            },
        ],
    }
    pb_data = client.post(f"/api/v1/workspaces/{workspace_id}/playbooks", json=pb_payload).json()
    playbook_id = pb_data["id"]

    exec_data = client.post(
        f"/api/v1/workspaces/{workspace_id}/playbooks/{playbook_id}/execute",
        json={"incident_id": str(incident_id)},
    ).json()
    execution_id = exec_data["id"]
    assert exec_data["status"] == "awaiting_approval"

    # Reject the request
    rej_resp = client.post(
        f"/api/v1/workspaces/{workspace_id}/playbook-executions/{execution_id}/reject",
        json={"comment": "Rejected due to active user traffic spike."},
    )
    assert rej_resp.status_code == 200
    rej_data = rej_resp.json()

    assert rej_data["status"] == "cancelled"
    assert "Rejected" in (rej_data["error_message"] or "")
    assert rej_data["step_executions"][0]["status"] == "failed"
    assert rej_data["step_executions"][1]["status"] == "pending"


# ============================================================================
# 6. Step Failure & Continue on Failure
# ============================================================================

def test_step_failure_and_continue_on_failure(auth_environment, login):
    """Ensure failure without continue_on_failure halts the entire workflow, while continue_on_failure continues."""
    factory = auth_environment["factory"]
    workspace_id = auth_environment["workspace_id"]
    user_id = auth_environment["user_id"]

    with factory() as db:
        # 1. Playbook that fails and stops
        pb_strict = create_playbook(
            db=db,
            workspace_id=workspace_id,
            user_id=user_id,
            data=PlaybookCreate(
                name="Strict Playbook",
                status=PlaybookStatus.ACTIVE,
                trigger_type=PlaybookTriggerType.MANUAL,
                steps=[
                    PlaybookStepCreate(
                        name="Invalid Webhook",
                        action_type=PlaybookActionType.SEND_WEBHOOK,
                        action_config={"webhook_url": "http://invalid-non-existent-domain-12345.local"},
                        step_order=1,
                        continue_on_failure=False,
                    ),
                    PlaybookStepCreate(
                        name="Subsequent Step",
                        action_type=PlaybookActionType.SEND_NOTIFICATION,
                        action_config={"title": "Should not run"},
                        step_order=2,
                    ),
                ],
            ),
        )

        exec_strict = create_execution(
            db=db,
            workspace_id=workspace_id,
            playbook_id=pb_strict.id,
            trigger_type=PlaybookTriggerType.MANUAL,
            user_id=user_id,
        )

        asyncio.run(run_execution_steps(db, exec_strict.id))
        db.refresh(exec_strict)
        assert exec_strict.status == PlaybookExecutionStatus.FAILED
        assert exec_strict.step_executions[0].status == PlaybookStepExecutionStatus.FAILED
        assert exec_strict.step_executions[1].status == PlaybookStepExecutionStatus.PENDING

        # 2. Playbook with continue_on_failure = True
        pb_lenient = create_playbook(
            db=db,
            workspace_id=workspace_id,
            user_id=user_id,
            data=PlaybookCreate(
                name="Lenient Playbook",
                status=PlaybookStatus.ACTIVE,
                trigger_type=PlaybookTriggerType.MANUAL,
                steps=[
                    PlaybookStepCreate(
                        name="Non-blocking Webhook",
                        action_type=PlaybookActionType.SEND_WEBHOOK,
                        action_config={"webhook_url": "http://invalid-non-existent-domain-12345.local"},
                        step_order=1,
                        continue_on_failure=True,
                    ),
                    PlaybookStepCreate(
                        name="Subsequent Notification",
                        action_type=PlaybookActionType.SEND_NOTIFICATION,
                        action_config={"title": "Ran despite previous error"},
                        step_order=2,
                    ),
                ],
            ),
        )

        exec_lenient = create_execution(
            db=db,
            workspace_id=workspace_id,
            playbook_id=pb_lenient.id,
            trigger_type=PlaybookTriggerType.MANUAL,
            user_id=user_id,
        )

        asyncio.run(run_execution_steps(db, exec_lenient.id))
        db.refresh(exec_lenient)
        assert exec_lenient.status == PlaybookExecutionStatus.COMPLETED
        assert exec_lenient.step_executions[0].status == PlaybookStepExecutionStatus.FAILED
        assert exec_lenient.step_executions[1].status == PlaybookStepExecutionStatus.COMPLETED


# ============================================================================
# 7. Deduplication & Idempotency
# ============================================================================

def test_execution_deduplication(auth_environment, login):
    """Verify that multiple events with the same trigger_event_id do not create duplicate executions."""
    factory = auth_environment["factory"]
    workspace_id = auth_environment["workspace_id"]
    user_id = auth_environment["user_id"]

    with factory() as db:
        pb = create_playbook(
            db=db,
            workspace_id=workspace_id,
            user_id=user_id,
            data=PlaybookCreate(
                name="Dedup Test Playbook",
                status=PlaybookStatus.ACTIVE,
                trigger_type=PlaybookTriggerType.ALERT_CREATED,
                steps=[
                    PlaybookStepCreate(
                        name="Step 1",
                        action_type=PlaybookActionType.SEND_NOTIFICATION,
                        action_config={"title": "Dedup Notif"},
                        step_order=1,
                    )
                ],
            ),
        )

        # First trigger event
        exec_1 = create_execution(
            db=db,
            workspace_id=workspace_id,
            playbook_id=pb.id,
            trigger_type=PlaybookTriggerType.ALERT_CREATED,
            trigger_event_id="alert-event-duplicate-check-999",
        )

        # Duplicate trigger event
        exec_2 = create_execution(
            db=db,
            workspace_id=workspace_id,
            playbook_id=pb.id,
            trigger_type=PlaybookTriggerType.ALERT_CREATED,
            trigger_event_id="alert-event-duplicate-check-999",
        )

        assert exec_1.id == exec_2.id


# ============================================================================
# 8. Execution Cancellation
# ============================================================================

def test_execution_cancellation(auth_environment, login):
    """Test cancelling an in-flight or awaiting-approval execution."""
    client = _client(auth_environment, login)
    workspace_id = auth_environment["workspace_id"]

    pb_payload = {
        "name": "Cancellable Playbook",
        "status": "active",
        "trigger_type": "manual",
        "steps": [
            {
                "name": "Gated Approval",
                "action_type": "require_approval",
                "action_config": {"prompt": "Waiting for cancel test."},
                "step_order": 1,
            }
        ],
    }
    pb_data = client.post(f"/api/v1/workspaces/{workspace_id}/playbooks", json=pb_payload).json()
    exec_data = client.post(
        f"/api/v1/workspaces/{workspace_id}/playbooks/{pb_data['id']}/execute",
        json={},
    ).json()
    execution_id = exec_data["id"]

    assert exec_data["status"] == "awaiting_approval"

    # Cancel execution
    cancel_resp = client.post(f"/api/v1/workspaces/{workspace_id}/playbook-executions/{execution_id}/cancel")
    assert cancel_resp.status_code == 200
    assert cancel_resp.json()["status"] == "cancelled"


# ============================================================================
# 9. Trigger Matching on Incident Creation
# ============================================================================

def test_trigger_matching_and_incident_creation(auth_environment, login):
    """Test that creating an incident automatically triggers matching active playbooks."""
    client = _client(auth_environment, login)
    workspace_id = auth_environment["workspace_id"]
    factory = auth_environment["factory"]

    with factory() as db:
        svc = _create_service(db, workspace_id, "checkout-gateway")
        service_id = svc.id
        db.commit()

    # Create active playbook triggered on SEV1 incident creation
    pb_payload = {
        "name": "SEV1 Critical Checkout Incident Playbook",
        "status": "active",
        "trigger_type": "incident_created",
        "severity_applicability": ["SEV1"],
        "steps": [
            {
                "name": "Auto Incident Note",
                "action_type": "create_incident_note",
                "action_config": {"body": "Automated playbook note triggered on SEV1 creation."},
                "step_order": 1,
            }
        ],
    }
    pb_resp = client.post(f"/api/v1/workspaces/{workspace_id}/playbooks", json=pb_payload)
    assert pb_resp.status_code == 201
    playbook_id = pb_resp.json()["id"]

    # Create SEV1 incident via API
    inc_payload = {
        "service_id": str(service_id),
        "title": "Checkout DB Connection Drop",
        "severity": "SEV1",
        "detected_at": utc_now().isoformat(),
    }
    inc_resp = client.post(f"/api/v1/workspaces/{workspace_id}/incidents", json=inc_payload)
    assert inc_resp.status_code == 201
    incident_id = inc_resp.json()["id"]

    # Verify that an execution was created for this playbook and incident
    with factory() as db:
        execs = db.query(PlaybookExecution).filter(
            PlaybookExecution.playbook_id == UUID(playbook_id),
            PlaybookExecution.incident_id == UUID(incident_id),
        ).all()
        assert len(execs) == 1
        assert execs[0].trigger_type == PlaybookTriggerType.INCIDENT_CREATED
