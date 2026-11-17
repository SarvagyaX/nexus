from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.routes import auth as auth_routes
from app.core.config import Settings
from app.db.base import Base
from app.db.session import get_db
from app.main import app
from app.models.identity import Membership, User, UserStatus, Workspace, WorkspaceRole, WorkspaceStatus
from app.auth.passwords import hash_password

FRONTEND_ORIGIN = "http://localhost:5173"
TEST_PASSWORD = "correct-horse-battery-staple-test"


@pytest.fixture
def auth_environment(monkeypatch) -> Generator[dict, None, None]:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)

    settings = Settings(
        _env_file=None,
        APP_ENV="testing",
        POSTGRES_URL="postgresql://test:test@localhost/nexus_test",
        FRONTEND_ORIGIN=FRONTEND_ORIGIN,
        DEMO_AUTH_ENABLED=True,
        SESSION_COOKIE_SECURE=False,
        DEMO_ADMIN_EMAIL="operator@example.local",
        DEMO_ADMIN_PASSWORD=TEST_PASSWORD,
    )
    monkeypatch.setattr(auth_routes, "get_settings", lambda: settings)

    def override_get_db() -> Generator[Session, None, None]:
        with factory() as db:
            yield db

    app.dependency_overrides[get_db] = override_get_db
    with factory() as db:
        workspace = Workspace(name="Test workspace", slug="test-workspace", status=WorkspaceStatus.ACTIVE)
        user = User(
            email="operator@example.local",
            display_name="Test Operator",
            password_hash=hash_password(TEST_PASSWORD),
            status=UserStatus.ACTIVE,
        )
        db.add_all([workspace, user])
        db.flush()
        db.add(Membership(workspace_id=workspace.id, user_id=user.id, role=WorkspaceRole.ADMIN))
        db.commit()
        ids = {"workspace_id": workspace.id, "user_id": user.id}

    client = TestClient(app)
    try:
        yield {"client": client, "engine": engine, "factory": factory, **ids, "settings": settings}
    finally:
        app.dependency_overrides.pop(get_db, None)
        client.close()
        engine.dispose()


@pytest.fixture
def login(auth_environment: dict):
    def do_login(client: TestClient | None = None, email: str = "operator@example.local", password: str = TEST_PASSWORD):
        client = client or auth_environment["client"]
        return client.post(
            "/api/v1/auth/login",
            json={"email": email, "password": password},
            headers={"Origin": FRONTEND_ORIGIN},
        )
    return do_login
