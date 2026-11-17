from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select

from app.auth.tokens import token_digest
from app.models.identity import AuditEvent, SessionRecord, User, UserStatus


def test_successful_login_sets_httponly_cookie_and_returns_membership(auth_environment, login) -> None:
    client = auth_environment["client"]
    response = login()

    assert response.status_code == 200
    body = response.json()
    assert body["user"]["display_name"] == "Test Operator"
    assert body["workspaces"][0]["role"] == "admin"
    assert body["active_workspace_id"] == str(auth_environment["workspace_id"])
    assert body["csrf_token"]
    assert "password" not in body["user"]
    assert "password_hash" not in response.text
    cookie = response.headers["set-cookie"]
    assert "HttpOnly" in cookie
    assert "SameSite=lax" in cookie
    assert "Secure" not in cookie
    raw_token = client.cookies.get("nexus_session")
    assert raw_token
    assert raw_token not in response.text

    with auth_environment["factory"]() as db:
        session_record = db.scalar(select(SessionRecord).where(SessionRecord.token_hash == token_digest(raw_token)))
        assert session_record is not None
        assert raw_token != session_record.token_hash
        assert session_record.csrf_token_hash == token_digest(body["csrf_token"])
        assert db.scalar(select(func.count(AuditEvent.id)).where(AuditEvent.action == "auth.login_succeeded")) == 1


def test_invalid_credentials_are_generic_for_unknown_and_wrong_password(auth_environment, login) -> None:
    unknown = login(email="missing@example.local", password="wrong-password")
    wrong = login(password="wrong-password")

    assert unknown.status_code == wrong.status_code == 401
    assert unknown.json()["error"]["code"] == wrong.json()["error"]["code"]
    assert unknown.json()["error"]["message"] == wrong.json()["error"]["message"]
    assert "incorrect" in unknown.json()["error"]["message"].lower()
    assert "missing@example.local" not in unknown.text


def test_login_rejects_untrusted_origin(auth_environment) -> None:
    response = auth_environment["client"].post(
        "/api/v1/auth/login",
        json={"email": "operator@example.local", "password": "anything"},
        headers={"Origin": "https://attacker.example"},
    )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "origin_not_allowed"


def test_current_user_and_session_survive_reload(auth_environment, login) -> None:
    client = auth_environment["client"]
    login()
    response = client.get("/api/v1/auth/me")
    assert response.status_code == 200
    assert response.json()["csrf_token"]
    assert response.json()["user"]["email"] == "operator@example.local"


def test_login_rotates_existing_browser_session(auth_environment, login) -> None:
    client = auth_environment["client"]
    login()
    first_token = client.cookies.get("nexus_session")
    login()
    second_token = client.cookies.get("nexus_session")

    assert first_token != second_token
    with auth_environment["factory"]() as db:
        records = list(db.scalars(select(SessionRecord).order_by(SessionRecord.created_at)))
        assert len(records) == 2
        assert any(record.token_hash == token_digest(first_token) and record.revoked_at for record in records)
        assert any(record.token_hash == token_digest(second_token) and record.revoked_at is None for record in records)


def test_csrf_rejects_wrong_token(auth_environment, login) -> None:
    client = auth_environment["client"]
    login()
    response = client.post(
        "/api/v1/auth/logout",
        headers={"Origin": "http://localhost:5173", "X-CSRF-Token": "incorrect"},
    )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "csrf_invalid"


def test_login_rate_limit_is_bounded(auth_environment, login) -> None:
    for _ in range(5):
        response = login(email="rate-limit@example.local", password="wrong")
        assert response.status_code == 401
    limited = login(email="rate-limit@example.local", password="wrong")
    assert limited.status_code == 429
    assert limited.json()["error"]["code"] == "login_rate_limited"


def test_logout_requires_csrf_and_revokes_session(auth_environment, login) -> None:
    client = auth_environment["client"]
    login_response = login()
    csrf_token = login_response.json()["csrf_token"]

    missing_csrf = client.post("/api/v1/auth/logout", headers={"Origin": "http://localhost:5173"})
    assert missing_csrf.status_code == 403
    assert missing_csrf.json()["error"]["code"] == "csrf_invalid"

    logout_response = client.post(
        "/api/v1/auth/logout",
        headers={"Origin": "http://localhost:5173", "X-CSRF-Token": csrf_token},
    )
    assert logout_response.status_code == 204
    assert client.get("/api/v1/auth/me").status_code == 401
    with auth_environment["factory"]() as db:
        record = db.scalar(select(SessionRecord))
        assert record and record.revoked_at is not None


def test_missing_and_invalid_session_return_401(auth_environment) -> None:
    client = auth_environment["client"]
    assert client.get("/api/v1/auth/me").status_code == 401
    client.cookies.set("nexus_session", "not-a-valid-random-session")
    assert client.get("/api/v1/auth/me").status_code == 401


def test_public_registration_is_not_exposed(auth_environment) -> None:
    response = auth_environment["client"].post(
        "/api/v1/auth/register",
        json={"email": "new@example.local", "password": "long-password-value"},
        headers={"Origin": "http://localhost:5173"},
    )
    assert response.status_code == 404


def test_expired_session_is_rejected(auth_environment) -> None:
    with auth_environment["factory"]() as db:
        session = SessionRecord(
            user_id=auth_environment["user_id"],
            token_hash=token_digest("expired-session-token"),
            csrf_token_hash=token_digest("csrf"),
            expires_at=datetime.now(timezone.utc) - timedelta(seconds=2),
        )
        db.add(session)
        db.commit()
    client = auth_environment["client"]
    client.cookies.set("nexus_session", "expired-session-token")
    assert client.get("/api/v1/auth/me").status_code == 401


def test_disabled_user_cannot_use_password_or_existing_session(auth_environment, login) -> None:
    client = auth_environment["client"]
    login()
    with auth_environment["factory"]() as db:
        user = db.get(User, auth_environment["user_id"])
        assert user is not None
        user.status = UserStatus.DISABLED
        db.commit()

    assert client.get("/api/v1/auth/me").status_code == 401
    client.cookies.clear()
    invalid_login = login()
    assert invalid_login.status_code == 401
    assert invalid_login.json()["error"]["code"] == "invalid_credentials"


def test_workspace_membership_is_required_and_cross_workspace_is_hidden(auth_environment, login) -> None:
    client = auth_environment["client"]
    login()
    allowed = client.get(f"/api/v1/workspaces/{auth_environment['workspace_id']}")
    absent = client.get("/api/v1/workspaces/00000000-0000-0000-0000-000000000001")
    assert allowed.status_code == 200
    assert allowed.json()["slug"] == "test-workspace"
    assert absent.status_code == 404
    assert absent.json()["error"]["code"] == "workspace_not_found"


def test_workspace_route_has_no_credential_or_hash_fields(auth_environment, login) -> None:
    client = auth_environment["client"]
    login()
    response = client.get(f"/api/v1/workspaces/{auth_environment['workspace_id']}")
    assert "password" not in response.text
    assert "token_hash" not in response.text
