"""Small append-only audit event writer."""

from uuid import UUID

from fastapi import Request
from sqlalchemy.orm import Session

from app.models.identity import ActorType, AuditEvent


def record_auth_event(
    db: Session,
    request: Request,
    *,
    action: str,
    actor_user_id: UUID | None = None,
    workspace_id: UUID | None = None,
    entity_id: UUID | None = None,
) -> None:
    db.add(
        AuditEvent(
            workspace_id=workspace_id,
            actor_user_id=actor_user_id,
            actor_type=ActorType.USER if actor_user_id else ActorType.ANONYMOUS,
            action=action,
            entity_type="user" if actor_user_id else "authentication",
            entity_id=entity_id,
            request_id=getattr(request.state, "request_id", None),
            source_ip=request.client.host if request.client else None,
            details={},
        )
    )


def record_domain_event(
    db: Session,
    request: Request,
    *,
    actor_user_id: UUID,
    workspace_id: UUID,
    action: str,
    entity_type: str,
    entity_id: UUID,
    details: dict,
) -> None:
    """Record a user mutation without copying domain text or secrets into audit data."""
    db.add(
        AuditEvent(
            workspace_id=workspace_id,
            actor_user_id=actor_user_id,
            actor_type=ActorType.USER,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            request_id=getattr(request.state, "request_id", None),
            source_ip=request.client.host if request.client else None,
            details=details,
        )
    )
