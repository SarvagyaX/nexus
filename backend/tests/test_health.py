from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.db.session import get_db
from app.main import app

client = TestClient(app)


def test_health_returns_service_status() -> None:
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "nexus-api"}


def test_readiness_returns_success_when_database_is_reachable() -> None:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)

    def override_get_db():
        with Session(engine) as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    try:
        response = client.get("/ready")
    finally:
        app.dependency_overrides.pop(get_db, None)
        engine.dispose()

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "nexus-api", "database": "ok"}


def test_readiness_hides_database_errors() -> None:
    from sqlalchemy.exc import OperationalError

    class BrokenSession:
        def execute(self, _statement):
            raise OperationalError("SELECT 1", {}, RuntimeError("private-host password=secret"))

        def close(self) -> None:
            pass

    def override_get_db():
        yield BrokenSession()

    app.dependency_overrides[get_db] = override_get_db
    try:
        response = client.get("/ready")
    finally:
        app.dependency_overrides.pop(get_db, None)

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "database_unavailable"
    assert "secret" not in response.text
    assert "private-host" not in response.text


def test_readiness_database_connection_is_exercised_by_select() -> None:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    try:
        with engine.connect() as connection:
            assert connection.exec_driver_sql("SELECT 1").scalar_one() == 1
    finally:
        engine.dispose()
