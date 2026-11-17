from datetime import datetime, timezone
from uuid import UUID, uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.models.identity import AuditEvent, Membership, User, UserStatus, Workspace, WorkspaceRole
from app.models.incident import Incident, IncidentEvent, IncidentSeverity, IncidentStatus
from app.models.service import Service, ServiceStatus
from app.services.incidents import next_reference, validate_transition


def _client(auth_environment, login):
    client = auth_environment["client"]
    response = login()
    client.headers.update({"Origin": "http://localhost:5173", "X-CSRF-Token": response.json()["csrf_token"]})
    return client


def _service(auth_environment, *, status=ServiceStatus.ACTIVE):
    with auth_environment["factory"]() as db:
        item = Service(workspace_id=auth_environment["workspace_id"], name="Payments", service_key=f"payments-{uuid4().hex[:8]}", status=status)
        db.add(item); db.commit(); return item.id


def _create(client, workspace_id, service_id, title="Checkout failures", severity="SEV2"):
    return client.post(f"/api/v1/workspaces/{workspace_id}/incidents", json={
        "service_id": str(service_id), "title": title, "summary": "Elevated failed requests",
        "severity": severity, "detected_at": "2026-11-14T10:00:00Z"})


def test_incident_create_reference_timeline_audit_and_details(auth_environment, login):
    client = _client(auth_environment, login); workspace = auth_environment["workspace_id"]
    service_id = _service(auth_environment)
    response = _create(client, workspace, service_id)
    assert response.status_code == 201, response.text
    data = response.json()
    assert data["reference"] == "INC-000001" and data["status"] == "open"
    assert data["service"]["service_key"].startswith("payments-")
    assert client.get(f"/api/v1/workspaces/{workspace}/incidents/{data['id']}").status_code == 200
    with auth_environment["factory"]() as db:
        timeline = list(db.scalars(select(IncidentEvent).where(IncidentEvent.incident_id == UUID(data["id"]))))
        audit = db.scalar(select(AuditEvent).where(AuditEvent.entity_id == UUID(data["id"])))
        assert len(timeline) == 1 and timeline[0].event_type == "incident.created"
        assert audit.action == "incident.created" and audit.actor_user_id == auth_environment["user_id"]


def test_incident_list_filters_and_cursor(auth_environment, login):
    client = _client(auth_environment, login); workspace = auth_environment["workspace_id"]
    service_id = _service(auth_environment)
    ids = [_create(client, workspace, service_id, f"Incident {i}").json()["id"] for i in range(3)]
    page = client.get(f"/api/v1/workspaces/{workspace}/incidents?limit=2&severity=SEV2")
    assert page.status_code == 200 and len(page.json()["items"]) == 2
    assert page.json()["page"]["has_more"]
    from app.services.incidents import decode_incident_cursor
    assert decode_incident_cursor(page.json()["page"]["next_cursor"])
    following = client.get(f"/api/v1/workspaces/{workspace}/incidents", params={"limit": 2, "cursor": page.json()["page"]["next_cursor"]})
    assert following.status_code == 200, following.text
    assert len(following.json()["items"]) == 1
    assert client.get(f"/api/v1/workspaces/{workspace}/incidents", params={"service_id": str(service_id), "q": "Incident 1"}).json()["items"][0]["id"] == ids[1]


def test_update_assignment_transition_resolution_and_events(auth_environment, login):
    client = _client(auth_environment, login); workspace = auth_environment["workspace_id"]
    service_id = _service(auth_environment); created = _create(client, workspace, service_id).json()
    incident_url = f"/api/v1/workspaces/{workspace}/incidents/{created['id']}"
    changed = client.patch(incident_url, json={"severity": "SEV1", "assignee_user_id": str(auth_environment["user_id"])})
    assert changed.status_code == 200 and changed.json()["severity_source"] == "human"
    cleared = client.patch(incident_url, json={"summary": None})
    assert cleared.status_code == 200 and cleared.json()["summary"] is None
    transition = client.post(f"{incident_url}/transitions", json={"to_status": "investigating", "reason": "On-call engaged"})
    assert transition.status_code == 200 and transition.json()["status"] == "investigating"
    assert client.post(f"{incident_url}/transitions", json={"to_status": "resolved"}).status_code == 422
    assert client.post(f"{incident_url}/transitions", json={"to_status": "monitoring"}).status_code == 200
    resolved = client.post(f"{incident_url}/transitions", json={"to_status": "resolved", "resolution_summary": "Recovered"})
    assert resolved.status_code == 200 and resolved.json()["resolved_at"]
    assert client.post(f"{incident_url}/transitions", json={"to_status": "open"}).status_code == 409
    events = client.get(f"{incident_url}/events")
    assert events.status_code == 200
    types = [event["event_type"] for event in events.json()["items"]]
    assert "incident.severity_changed" in types and types.count("incident.status_changed") == 3


def test_archived_service_cross_workspace_and_csrf_denied(auth_environment, login):
    client = _client(auth_environment, login); workspace = auth_environment["workspace_id"]
    archived = _service(auth_environment, status=ServiceStatus.ARCHIVED)
    assert _create(client, workspace, archived).status_code == 409
    second = _service(auth_environment)
    foreign_workspace = uuid4()
    assert client.get(f"/api/v1/workspaces/{foreign_workspace}/incidents").status_code == 404
    client.headers.pop("X-CSRF-Token")
    assert _create(client, workspace, second).status_code == 403


def test_incident_in_unjoined_workspace_is_hidden(auth_environment, login):
    client = _client(auth_environment, login)
    with auth_environment["factory"]() as db:
        foreign_workspace = Workspace(name="Other", slug="other-space")
        foreign_user = User(email="other@example.local", display_name="Other", password_hash="unused", status=UserStatus.ACTIVE)
        db.add_all([foreign_workspace, foreign_user]); db.flush()
        db.add(Membership(workspace_id=foreign_workspace.id, user_id=foreign_user.id, role=WorkspaceRole.ADMIN))
        service = Service(workspace_id=foreign_workspace.id, name="Foreign API", service_key="foreign")
        db.add(service); db.flush()
        incident = Incident(workspace_id=foreign_workspace.id, service_id=service.id, reference="INC-000001",
                            title="Private incident", severity=IncidentSeverity.SEV2,
                            detected_at=datetime.now(timezone.utc))
        db.add(incident); db.commit()
        foreign_workspace_id, incident_id = foreign_workspace.id, incident.id
    assert client.get(f"/api/v1/workspaces/{foreign_workspace_id}/incidents/{incident_id}").status_code == 404


def test_invalid_assignee_and_viewer_write_denied(auth_environment, login):
    client = _client(auth_environment, login); workspace = auth_environment["workspace_id"]
    service_id = _service(auth_environment); created = _create(client, workspace, service_id).json()
    assert client.patch(f"/api/v1/workspaces/{workspace}/incidents/{created['id']}", json={"assignee_user_id": str(uuid4())}).status_code == 422
    with auth_environment["factory"]() as db:
        membership = db.scalar(select(Membership).where(Membership.user_id == auth_environment["user_id"]))
        membership.role = WorkspaceRole.VIEWER; db.commit()
    assert client.patch(f"/api/v1/workspaces/{workspace}/incidents/{created['id']}", json={"title": "No"}).status_code == 403


def test_reference_counter_and_transition_matrix(auth_environment):
    with auth_environment["factory"]() as db:
        workspace = auth_environment["workspace_id"]
        assert next_reference(db, workspace) == "INC-000001"
        db.commit()
        assert next_reference(db, workspace) == "INC-000002"
    from app.services.incidents import TRANSITIONS
    assert IncidentStatus.RESOLVED not in TRANSITIONS[IncidentStatus.RESOLVED]
    assert IncidentStatus.OPEN in TRANSITIONS[IncidentStatus.MONITORING]
    with pytest.raises(Exception): validate_transition(IncidentStatus.OPEN, IncidentStatus.RESOLVED)


def test_timeline_events_are_immutable_at_orm_layer(auth_environment):
    with auth_environment["factory"]() as db:
        service = Service(workspace_id=auth_environment["workspace_id"], name="Audit", service_key="audit")
        db.add(service); db.flush()
        incident = Incident(workspace_id=auth_environment["workspace_id"], service_id=service.id, reference="INC-LOCK",
                            title="Immutable", severity=IncidentSeverity.SEV3, detected_at=datetime.now(timezone.utc))
        db.add(incident); db.flush()
        event = IncidentEvent(workspace_id=incident.workspace_id, incident_id=incident.id, event_type="incident.created")
        db.add(event); db.commit()
        event.body = "rewrite"
        with pytest.raises(ValueError, match="append-only"): db.flush()
