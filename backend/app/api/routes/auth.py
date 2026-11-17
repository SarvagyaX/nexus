"""Cookie-based login, logout, and current-user endpoints."""

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.audit.service import record_auth_event
from app.auth.dependencies import AuthenticatedSession, get_authenticated_session, require_csrf, require_login_origin
from app.auth.passwords import hash_password, password_needs_rehash, verify_password
from app.auth.rate_limit import clear_failures, is_limited, record_failure
from app.auth.tokens import derive_csrf_token, generate_token, token_digest
from app.core.config import get_settings
from app.db.session import get_db
from app.models.identity import Membership, SessionRecord, User, UserStatus, Workspace, WorkspaceStatus
from app.schemas.auth import AuthResponse, LoginRequest, UserPublic, WorkspaceMembershipPublic

router = APIRouter(prefix="/api/v1/auth", tags=["authentication"])
_dummy_hash = hash_password("nexus-invalid-login-dummy-value")


def _client_host(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _workspaces(db: Session, user: User) -> list[WorkspaceMembershipPublic]:
    rows = db.execute(
        select(Workspace, Membership.role)
        .join(Membership, Membership.workspace_id == Workspace.id)
        .where(Membership.user_id == user.id, Workspace.status == WorkspaceStatus.ACTIVE)
        .order_by(Workspace.name, Workspace.id)
    ).all()
    return [
        WorkspaceMembershipPublic(id=workspace.id, name=workspace.name, slug=workspace.slug, role=role)
        for workspace, role in rows
    ]


def _authentication_unavailable() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail={"code": "authentication_unavailable", "message": "Password authentication is not enabled."},
    )


@router.post("/login", response_model=AuthResponse)
def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    _origin: None = Depends(require_login_origin),
    db: Session = Depends(get_db),
) -> AuthResponse:
    settings = get_settings()
    if settings.app_env == "production" or not settings.demo_auth_enabled:
        raise _authentication_unavailable()

    client_host = _client_host(request)
    if is_limited(client_host, payload.email):
        raise HTTPException(
            status_code=429,
            detail={"code": "login_rate_limited", "message": "Too many sign-in attempts. Try again later."},
            headers={"Retry-After": "900"},
        )

    user = db.scalar(select(User).where(User.email == payload.email))
    password_ok = verify_password(payload.password, user.password_hash if user else _dummy_hash)
    memberships = _workspaces(db, user) if user and user.status == UserStatus.ACTIVE and password_ok else []
    if user is None or user.status != UserStatus.ACTIVE or not password_ok or not memberships:
        record_auth_event(db, request, action="auth.login_failed")
        db.commit()
        record_failure(client_host, payload.email)
        raise HTTPException(status_code=401, detail={"code": "invalid_credentials", "message": "Email or password is incorrect."})

    clear_failures(client_host, payload.email)
    if password_needs_rehash(user.password_hash):
        user.password_hash = hash_password(payload.password)

    # Rotate any supplied valid or stale session token before issuing a fresh token.
    existing_token = request.cookies.get("nexus_session")
    if existing_token:
        existing = db.scalar(select(SessionRecord).where(SessionRecord.token_hash == token_digest(existing_token)))
        if existing and existing.revoked_at is None:
            existing.revoked_at = datetime.now(timezone.utc)

    session_token = generate_token()
    csrf_token = derive_csrf_token(session_token)
    now = datetime.now(timezone.utc)
    session_record = SessionRecord(
        user_id=user.id,
        token_hash=token_digest(session_token),
        csrf_token_hash=token_digest(csrf_token),
        created_at=now,
        expires_at=now + timedelta(seconds=settings.session_ttl_seconds),
    )
    db.add(session_record)
    record_auth_event(
        db,
        request,
        action="auth.login_succeeded",
        actor_user_id=user.id,
        workspace_id=memberships[0].id,
        entity_id=user.id,
    )
    db.commit()

    response.set_cookie(
        key="nexus_session",
        value=session_token,
        max_age=settings.session_ttl_seconds,
        httponly=True,
        secure=settings.secure_session_cookie,
        samesite="lax",
        path="/",
    )
    response.headers["Cache-Control"] = "no-store"
    return AuthResponse(
        user=UserPublic.model_validate(user),
        workspaces=memberships,
        active_workspace_id=memberships[0].id,
        csrf_token=csrf_token,
    )


@router.get("/me", response_model=AuthResponse)
def current_user(
    response: Response,
    auth: AuthenticatedSession = Depends(get_authenticated_session),
    db: Session = Depends(get_db),
) -> AuthResponse:
    memberships = _workspaces(db, auth.user)
    if not memberships:
        raise HTTPException(status_code=401, detail={"code": "authentication_required", "message": "Authentication is required."})
    response.headers["Cache-Control"] = "no-store"
    return AuthResponse(
        user=UserPublic.model_validate(auth.user),
        workspaces=memberships,
        active_workspace_id=memberships[0].id,
        csrf_token=derive_csrf_token(auth.raw_token),
    )


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
def logout(
    request: Request,
    response: Response,
    auth: AuthenticatedSession = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> None:
    auth.session.revoked_at = datetime.now(timezone.utc)
    record_auth_event(
        db,
        request,
        action="auth.logout",
        actor_user_id=auth.user.id,
        entity_id=auth.user.id,
    )
    db.commit()
    response.delete_cookie(
        key="nexus_session",
        path="/",
        secure=get_settings().secure_session_cookie,
        httponly=True,
        samesite="lax",
    )
    response.headers["Cache-Control"] = "no-store"
