"""Authentication, CSRF, membership, and permission dependencies."""

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Callable
from uuid import UUID

import hmac
from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.auth.tokens import token_digest
from app.core.config import get_settings
from app.db.session import get_db
from app.models.identity import Membership, SessionRecord, User, UserStatus, Workspace, WorkspaceRole, WorkspaceStatus
from app.security.rbac import Permission, has_permission


@dataclass(frozen=True)
class AuthenticatedSession:
    user: User
    session: SessionRecord
    raw_token: str = field(repr=False)


def _unauthorized() -> HTTPException:
    return HTTPException(status_code=401, detail={"code": "authentication_required", "message": "Authentication is required."})


def get_authenticated_session(
    request: Request,
    db: Session = Depends(get_db),
) -> AuthenticatedSession:
    raw_token = request.cookies.get("nexus_session")
    if not raw_token:
        raise _unauthorized()

    now = datetime.now(timezone.utc)
    session_record = db.scalar(
        select(SessionRecord)
        .options(joinedload(SessionRecord.user))
        .where(
            SessionRecord.token_hash == token_digest(raw_token),
            SessionRecord.revoked_at.is_(None),
            SessionRecord.expires_at > now,
        )
    )
    if session_record is None or session_record.user.status != UserStatus.ACTIVE:
        raise _unauthorized()
    return AuthenticatedSession(session_record.user, session_record, raw_token)


def _ensure_origin(request: Request) -> None:
    origin = request.headers.get("origin")
    if origin != get_settings().frontend_origin:
        raise HTTPException(status_code=403, detail={"code": "origin_not_allowed", "message": "Request origin is not allowed."})


def require_login_origin(request: Request) -> None:
    """Login is protected from cross-site request forgery by exact Origin."""
    _ensure_origin(request)


def require_csrf(
    request: Request,
    auth: AuthenticatedSession = Depends(get_authenticated_session),
) -> AuthenticatedSession:
    _ensure_origin(request)
    token = request.headers.get("x-csrf-token", "")
    if not token or len(token) > 128 or not hmac.compare_digest(auth.session.csrf_token_hash, token_digest(token)):
        raise HTTPException(status_code=403, detail={"code": "csrf_invalid", "message": "CSRF validation failed."})
    return auth


def require_workspace_permission(permission: Permission) -> Callable:
    """Return a dependency which checks membership, workspace state and role."""

    def dependency(
        workspace_id: UUID,
        auth: AuthenticatedSession = Depends(get_authenticated_session),
        db: Session = Depends(get_db),
    ) -> tuple[Workspace, WorkspaceRole]:
        row = db.execute(
            select(Workspace, Membership.role)
            .join(Membership, Membership.workspace_id == Workspace.id)
            .where(
                Workspace.id == workspace_id,
                Workspace.status == WorkspaceStatus.ACTIVE,
                Membership.user_id == auth.user.id,
            )
        ).first()
        if row is None:
            # An absent and an out-of-scope workspace are intentionally indistinguishable.
            raise HTTPException(status_code=404, detail={"code": "workspace_not_found", "message": "Workspace was not found."})
        workspace, role = row
        if not has_permission(role, permission):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail={"code": "permission_denied", "message": "You do not have permission to perform this action."})
        return workspace, role

    return dependency
