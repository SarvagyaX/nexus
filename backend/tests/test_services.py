from uuid import UUID

from sqlalchemy import select

from app.models.identity import AuditEvent, Membership, Workspace, WorkspaceRole, WorkspaceStatus
from app.models.service import Service, ServiceStatus
from app.schemas.service import ServiceCreate, ServicePatch


def _authenticated_client(auth_environment, login):
    client = auth_environment["client"]
    response = login()
    client.headers.update({
        "Origin": "http://localhost:5173",
        "X-CSRF-Token": response.json()["csrf_token"],
    })
    return client


def _payload(name: str, key: str) -> dict:
    return {"name": name, "service_key": key}


def test_service_schema_normalizes_and_validates_fields() -> None:
    service = ServiceCreate(
        name="  Payments API ",
        service_key=" Payments.API ",
        owner_team=" SRE ",
        repository_url="https://github.com/acme/payments",
    )
    assert service.name == "Payments API"
    assert service.service_key == "payments.api"
    assert service.owner_team == "SRE"

    import pytest
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        ServiceCreate(name="  ", service_key="bad key")
    with pytest.raises(ValidationError):
        ServiceCreate(name="Valid", service_key="valid", repository_url="javascript:alert(1)")
    with pytest.raises(ValidationError):
        ServicePatch()
    with pytest.raises(ValidationError):
        ServicePatch(name=None)


def test_service_model_constraints_and_workspace_key_uniqueness(auth_environment) -> None:
    import pytest
    from sqlalchemy.exc import IntegrityError

    with auth_environment["factory"]() as db:
        service = Service(
            workspace_id=auth_environment["workspace_id"], name="API", service_key="api", status=ServiceStatus.ACTIVE
        )
        db.add(service)
        db.commit()
        duplicate = Service(
            workspace_id=auth_environment["workspace_id"], name="Another API", service_key="api"
        )
        db.add(duplicate)
        with pytest.raises(IntegrityError):
            db.commit()
        db.rollback()


def test_service_create_detail_update_archive_and_audit(auth_environment, login) -> None:
    client = _authenticated_client(auth_environment, login)
    workspace_id = auth_environment["workspace_id"]
    created = client.post(
        f"/api/v1/workspaces/{workspace_id}/services",
        json={**_payload("Payments API", "payments-api"), "owner_team": "SRE"},
    )
    assert created.status_code == 201, created.text
    service = created.json()
    assert service["status"] == "active"
    assert service["workspace_id"] == str(workspace_id)
    assert service["owner_team"] == "SRE"

    detail = client.get(f"/api/v1/workspaces/{workspace_id}/services/{service['id']}")
    assert detail.status_code == 200
    assert detail.json()["service_key"] == "payments-api"

    updated = client.patch(
        f"/api/v1/workspaces/{workspace_id}/services/{service['id']}",
        json={"description": "Payment processing", "status": "archived"},
    )
    assert updated.status_code == 200
    assert updated.json()["status"] == "archived"
    assert updated.json()["description"] == "Payment processing"
    archived = client.get(f"/api/v1/workspaces/{workspace_id}/services?status=archived")
    assert [item["id"] for item in archived.json()["items"]] == [service["id"]]

    with auth_environment["factory"]() as db:
        events = list(db.scalars(select(AuditEvent).where(AuditEvent.entity_id == UUID(service["id"]))))
        assert sorted(event.action for event in events) == ["service.archived", "service.created"]
        assert all(event.actor_user_id == auth_environment["user_id"] for event in events)
        assert all(event.workspace_id == workspace_id for event in events)


def test_service_lists_are_workspace_scoped_filtered_and_cursor_paginated(auth_environment, login) -> None:
    client = _authenticated_client(auth_environment, login)
    workspace_id = auth_environment["workspace_id"]
    for name, key in [("Alpha API", "alpha"), ("Beta API", "beta"), ("Gamma Worker", "gamma")]:
        response = client.post(f"/api/v1/workspaces/{workspace_id}/services", json=_payload(name, key))
        assert response.status_code == 201, response.text

    first_page = client.get(f"/api/v1/workspaces/{workspace_id}/services?limit=2")
    assert first_page.status_code == 200
    body = first_page.json()
    assert [item["name"] for item in body["items"]] == ["Alpha API", "Beta API"]
    assert body["page"]["limit"] == 2
    assert body["page"]["has_more"] is True
    assert body["page"]["next_cursor"]
    second_page = client.get(
        f"/api/v1/workspaces/{workspace_id}/services?limit=2&cursor={body['page']['next_cursor']}"
    )
    assert [item["name"] for item in second_page.json()["items"]] == ["Gamma Worker"]
    filtered = client.get(f"/api/v1/workspaces/{workspace_id}/services?q=gamma&status=active")
    assert [item["service_key"] for item in filtered.json()["items"]] == ["gamma"]
    archived = client.get(f"/api/v1/workspaces/{workspace_id}/services?status=archived")
    assert archived.json()["items"] == []


def test_service_invalid_input_duplicate_and_invalid_cursor(auth_environment, login) -> None:
    client = _authenticated_client(auth_environment, login)
    path = f"/api/v1/workspaces/{auth_environment['workspace_id']}/services"
    invalid = client.post(path, json={"name": " ", "service_key": "bad key"})
    assert invalid.status_code == 422
    invalid_url = client.post(path, json={**_payload("Bad URL", "bad-url"), "repository_url": "file:///etc/passwd"})
    assert invalid_url.status_code == 422
    assert client.post(path, json=_payload("One", "unique-key")).status_code == 201
    duplicate = client.post(path, json=_payload("Two", "unique-key"))
    assert duplicate.status_code == 409
    assert duplicate.json()["error"]["code"] == "service_key_conflict"
    assert client.get(f"{path}?cursor=not-a-valid-cursor").status_code == 400
    assert client.get(f"{path}?limit=101").status_code == 422


def test_service_rbac_read_for_members_admin_only_mutation(auth_environment, login) -> None:
    client = _authenticated_client(auth_environment, login)
    workspace_id = auth_environment["workspace_id"]
    service = client.post(
        f"/api/v1/workspaces/{workspace_id}/services", json=_payload("Read API", "read-api")
    ).json()
    with auth_environment["factory"]() as db:
        membership = db.scalar(
            select(Membership).where(
                Membership.workspace_id == workspace_id, Membership.user_id == auth_environment["user_id"]
            )
        )
        membership.role = WorkspaceRole.RESPONDER
        db.commit()

    assert client.get(f"/api/v1/workspaces/{workspace_id}/services").status_code == 200
    denied = client.post(f"/api/v1/workspaces/{workspace_id}/services", json=_payload("Denied", "denied"))
    assert denied.status_code == 403
    denied_patch = client.patch(
        f"/api/v1/workspaces/{workspace_id}/services/{service['id']}", json={"name": "Nope"}
    )
    assert denied_patch.status_code == 403


def test_service_requires_csrf_and_denies_cross_workspace_access(auth_environment, login) -> None:
    client = _authenticated_client(auth_environment, login)
    workspace_id = auth_environment["workspace_id"]
    path = f"/api/v1/workspaces/{workspace_id}/services"
    client.headers.pop("X-CSRF-Token")
    missing_csrf = client.post(path, json=_payload("No CSRF", "no-csrf"))
    assert missing_csrf.status_code == 403
    assert missing_csrf.json()["error"]["code"] == "csrf_invalid"

    with auth_environment["factory"]() as db:
        foreign_workspace = Workspace(
            name="Other tenant", slug="other-tenant", status=WorkspaceStatus.ACTIVE
        )
        db.add(foreign_workspace)
        db.flush()
        foreign_service = Service(
            workspace_id=foreign_workspace.id, name="Private API", service_key="private-api"
        )
        db.add(foreign_service)
        db.commit()
        foreign_workspace_id, foreign_service_id = foreign_workspace.id, foreign_service.id

    assert client.get(f"/api/v1/workspaces/{foreign_workspace_id}/services").status_code == 404
    assert client.get(f"/api/v1/workspaces/{foreign_workspace_id}/services/{foreign_service_id}").status_code == 404
    assert client.get(f"/api/v1/workspaces/{workspace_id}/services/{foreign_service_id}").status_code == 404

