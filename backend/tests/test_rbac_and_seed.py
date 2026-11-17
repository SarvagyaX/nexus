from sqlalchemy import func, select

from app.core.config import Settings
from app.models.identity import ActorType, AuditEvent, Membership, User, Workspace, WorkspaceRole
from app.security.rbac import Permission, has_permission
from app.seed import seed_demo_identity


def _seed_settings(password: str = "local-demo-password-long-enough") -> Settings:
    return Settings(
        _env_file=None,
        APP_ENV="development",
        POSTGRES_URL="postgresql://test:test@localhost/nexus_test",
        DEMO_AUTH_ENABLED=True,
        DEMO_ADMIN_EMAIL="seed-admin@example.local",
        DEMO_ADMIN_PASSWORD=password,
        DEMO_ADMIN_DISPLAY_NAME="Seed Admin",
        DEMO_WORKSPACE_NAME="Seed Demo",
        DEMO_WORKSPACE_SLUG="seed-demo",
    )


def test_seed_is_idempotent_and_does_not_reset_existing_password(auth_environment) -> None:
    with auth_environment["factory"]() as db:
        first_workspace, first_user, first_membership = seed_demo_identity(db, _seed_settings())
        original_hash = first_user.password_hash
        second_workspace, second_user, second_membership = seed_demo_identity(
            db, _seed_settings("a-different-configured-password-not-applied")
        )

        assert first_workspace.id == second_workspace.id
        assert first_user.id == second_user.id
        assert first_membership.id == second_membership.id
        assert second_user.password_hash == original_hash
        assert db.scalar(select(func.count(Workspace.id)).where(Workspace.slug == "seed-demo")) == 1
        assert db.scalar(select(func.count(User.id)).where(User.email == "seed-admin@example.local")) == 1
        assert db.scalar(select(func.count(Membership.id)).where(Membership.workspace_id == first_workspace.id)) == 1


def test_seed_does_not_claim_user_created_workspace_or_user(auth_environment) -> None:
    from app.seed import SeedConflict
    import pytest

    with auth_environment["factory"]() as db:
        collision = Workspace(name="User Workspace", slug="seed-demo", is_demo=False)
        db.add(collision)
        db.commit()
        with pytest.raises(SeedConflict):
            seed_demo_identity(db, _seed_settings())


def test_role_permission_matrix_is_deny_by_default() -> None:
    assert has_permission(WorkspaceRole.ADMIN, Permission.MEMBERS_MANAGE)
    assert has_permission(WorkspaceRole.COMMANDER, Permission.RECOMMENDATION_APPROVE)
    assert has_permission(WorkspaceRole.RESPONDER, Permission.INVESTIGATION_START)
    assert not has_permission(WorkspaceRole.RESPONDER, Permission.RECOMMENDATION_APPROVE)
    assert not has_permission(WorkspaceRole.VIEWER, Permission.INCIDENT_WRITE)
    assert has_permission(WorkspaceRole.VIEWER, Permission.AUDIT_READ)


def test_audit_event_is_append_only_at_orm_boundary(auth_environment) -> None:
    import pytest

    with auth_environment["factory"]() as db:
        event = AuditEvent(actor_type=ActorType.ANONYMOUS, action="auth.test", entity_type="authentication", details={})
        db.add(event)
        db.commit()
        event.action = "auth.changed"
        with pytest.raises(ValueError, match="append-only"):
            db.flush()


def test_demo_login_is_not_available_when_explicit_flag_is_off(auth_environment, monkeypatch) -> None:
    from app.api.routes import auth as auth_routes

    disabled = _seed_settings()
    disabled.demo_auth_enabled = False
    monkeypatch.setattr(auth_routes, "get_settings", lambda: disabled)
    response = auth_environment["client"].post(
        "/api/v1/auth/login",
        json={"email": "operator@example.local", "password": "any-value"},
        headers={"Origin": "http://localhost:5173"},
    )
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "authentication_unavailable"
