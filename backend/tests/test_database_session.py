import os

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import session as database_session


def test_request_session_is_closed_when_dependency_finishes(monkeypatch) -> None:
    class TrackingSession(Session):
        was_closed = False

        def close(self) -> None:
            self.was_closed = True
            super().close()

    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    factory = sessionmaker(bind=engine, class_=TrackingSession)
    monkeypatch.setattr(database_session, "SessionLocal", factory)

    dependency = database_session.get_db()
    yielded_session = next(dependency)
    yielded_session.execute(text("SELECT 1"))
    dependency.close()

    assert yielded_session.was_closed
    engine.dispose()


def test_optional_postgresql_connectivity_uses_dedicated_test_database() -> None:
    database_url = os.getenv("TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("Set TEST_DATABASE_URL to a dedicated nexus_test database for PostgreSQL integration.")

    parsed_url = make_url(database_url)
    if parsed_url.database != "nexus_test":
        pytest.fail("TEST_DATABASE_URL must target a database named nexus_test; no development DB is touched.")
    if parsed_url.drivername == "postgresql":
        parsed_url = parsed_url.set(drivername="postgresql+psycopg")

    engine = create_engine(parsed_url, pool_pre_ping=True)
    try:
        with engine.connect() as connection:
            assert connection.execute(text("SELECT 1")).scalar_one() == 1
    finally:
        engine.dispose()
