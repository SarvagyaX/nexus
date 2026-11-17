"""Authenticated, workspace-scoped service registry endpoints."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import and_, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth.dependencies import AuthenticatedSession, require_csrf, require_workspace_permission
from app.audit.service import record_domain_event
from app.db.session import get_db
from app.models.identity import Workspace, WorkspaceRole
from app.models.service import Service, ServiceStatus
from app.schemas.service import ServiceCreate, ServiceListResponse, ServicePatch, ServiceResponse
from app.security.rbac import Permission
from app.services.registry import decode_service_cursor, encode_service_cursor

router = APIRouter(prefix="/api/v1/workspaces/{workspace_id}/services", tags=["services"])


def _not_found() -> HTTPException:
    return HTTPException(
        status_code=404,
        detail={"code": "service_not_found", "message": "Service was not found."},
    )


def _key_conflict() -> HTTPException:
    return HTTPException(
        status_code=409,
        detail={"code": "service_key_conflict", "message": "A service with this key already exists in the workspace."},
    )


@router.get("", response_model=ServiceListResponse)
def list_services(
    workspace_id: UUID,
    status_filter: ServiceStatus | None = Query(default=None, alias="status"),
    q: str | None = Query(default=None, min_length=1, max_length=200),
    limit: int = Query(default=25, ge=1, le=100),
    cursor: str | None = Query(default=None, max_length=512),
    _access: tuple[Workspace, WorkspaceRole] = Depends(require_workspace_permission(Permission.SERVICE_READ)),
    db: Session = Depends(get_db),
) -> ServiceListResponse:
    decoded_cursor = decode_service_cursor(cursor)
    statement = select(Service).where(Service.workspace_id == workspace_id)
    if status_filter is not None:
        statement = statement.where(Service.status == status_filter)
    if q is not None:
        search = q.strip()
        if search:
            escaped = search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            statement = statement.where(
                or_(Service.name.ilike(f"%{escaped}%", escape="\\"), Service.service_key.ilike(f"%{escaped}%", escape="\\"))
            )
    if decoded_cursor is not None:
        cursor_name, cursor_id = decoded_cursor
        statement = statement.where(
            or_(Service.name > cursor_name, and_(Service.name == cursor_name, Service.id > cursor_id))
        )
    rows = list(db.scalars(statement.order_by(Service.name, Service.id).limit(limit + 1)))
    has_more = len(rows) > limit
    items = rows[:limit]
    next_cursor = encode_service_cursor(items[-1].name, items[-1].id) if has_more and items else None
    return ServiceListResponse(
        items=[ServiceResponse.model_validate(service) for service in items],
        page={"limit": limit, "next_cursor": next_cursor, "has_more": has_more},
    )


@router.post("", response_model=ServiceResponse, status_code=status.HTTP_201_CREATED)
def create_service(
    workspace_id: UUID,
    payload: ServiceCreate,
    request: Request,
    _csrf: AuthenticatedSession = Depends(require_csrf),
    _access: tuple[Workspace, WorkspaceRole] = Depends(require_workspace_permission(Permission.SERVICE_MANAGE)),
    db: Session = Depends(get_db),
) -> ServiceResponse:
    service = Service(workspace_id=workspace_id, **payload.model_dump())
    db.add(service)
    try:
        db.flush()
        record_domain_event(
            db, request, actor_user_id=_csrf.user.id, workspace_id=workspace_id,
            action="service.created", entity_type="service", entity_id=service.id,
            details={"fields": sorted(payload.model_fields_set)},
        )
        db.commit()
        db.refresh(service)
    except IntegrityError:
        db.rollback()
        raise _key_conflict() from None
    return ServiceResponse.model_validate(service)


@router.get("/{service_id}", response_model=ServiceResponse)
def get_service(
    workspace_id: UUID,
    service_id: UUID,
    _access: tuple[Workspace, WorkspaceRole] = Depends(require_workspace_permission(Permission.SERVICE_READ)),
    db: Session = Depends(get_db),
) -> ServiceResponse:
    service = db.scalar(
        select(Service).where(Service.workspace_id == workspace_id, Service.id == service_id)
    )
    if service is None:
        raise _not_found()
    return ServiceResponse.model_validate(service)


@router.patch("/{service_id}", response_model=ServiceResponse)
def update_service(
    workspace_id: UUID,
    service_id: UUID,
    payload: ServicePatch,
    request: Request,
    _csrf: AuthenticatedSession = Depends(require_csrf),
    _access: tuple[Workspace, WorkspaceRole] = Depends(require_workspace_permission(Permission.SERVICE_MANAGE)),
    db: Session = Depends(get_db),
) -> ServiceResponse:
    service = db.scalar(
        select(Service).where(Service.workspace_id == workspace_id, Service.id == service_id)
    )
    if service is None:
        raise _not_found()

    changes = payload.model_dump(exclude_unset=True)
    changed_fields = sorted(key for key, value in changes.items() if getattr(service, key) != value)
    if not changed_fields:
        return ServiceResponse.model_validate(service)

    old_status = service.status
    for key in changed_fields:
        setattr(service, key, changes[key])
    action = "service.updated"
    if old_status != ServiceStatus.ARCHIVED and service.status == ServiceStatus.ARCHIVED:
        action = "service.archived"
    elif old_status == ServiceStatus.ARCHIVED and service.status == ServiceStatus.ACTIVE:
        action = "service.reactivated"

    try:
        record_domain_event(
            db, request, actor_user_id=_csrf.user.id, workspace_id=workspace_id,
            action=action, entity_type="service", entity_id=service.id,
            details={"fields": changed_fields},
        )
        db.commit()
        db.refresh(service)
    except IntegrityError:
        db.rollback()
        raise _key_conflict() from None
    return ServiceResponse.model_validate(service)
