"""Workspace on-call schedule rotation management endpoints."""

from uuid import UUID

from fastapi import APIRouter, Depends, Request, status
from sqlalchemy.orm import Session

from app.audit.service import record_domain_event
from app.auth.dependencies import (
    AuthenticatedSession,
    get_authenticated_session,
    require_csrf,
    require_workspace_permission,
)
from app.db.session import get_db
from app.models.identity import Workspace, WorkspaceRole
from app.schemas.notification import (
    CurrentOnCallResponse,
    OnCallMember,
    OnCallScheduleCreate,
    OnCallScheduleResponse,
    OnCallScheduleUpdate,
)
from app.security.rbac import Permission
from app.services.on_call import (
    create_schedule,
    delete_schedule,
    get_schedule,
    list_schedules,
    resolve_current_on_call,
    update_schedule,
)

router = APIRouter(prefix="/api/v1/workspaces/{workspace_id}/on-call/schedules", tags=["on-call"])


def _format_schedule_response(schedule) -> OnCallScheduleResponse:
    current_member, _, _ = resolve_current_on_call(schedule)
    cur = OnCallMember(**current_member) if current_member else None
    return OnCallScheduleResponse(
        id=schedule.id,
        workspace_id=schedule.workspace_id,
        name=schedule.name,
        description=schedule.description,
        timezone=schedule.timezone,
        is_active=schedule.is_active,
        rotation_type=schedule.rotation_type,
        rotation_interval_days=schedule.rotation_interval_days,
        shift_start_time=schedule.shift_start_time,
        handover_hour=schedule.handover_hour,
        members=schedule.members,
        created_at=schedule.created_at,
        updated_at=schedule.updated_at,
        current_on_call=cur,
    )


@router.get("", response_model=list[OnCallScheduleResponse])
def get_on_call_schedules(
    workspace_id: UUID,
    _auth: AuthenticatedSession = Depends(get_authenticated_session),
    _access: tuple[Workspace, WorkspaceRole] = Depends(require_workspace_permission(Permission.ONCALL_READ)),
    db: Session = Depends(get_db),
) -> list[OnCallScheduleResponse]:
    """Lists all on-call schedules in the workspace."""
    schedules = list_schedules(db, workspace_id)
    return [_format_schedule_response(s) for s in schedules]


@router.post("", response_model=OnCallScheduleResponse, status_code=status.HTTP_201_CREATED)
def create_on_call_schedule(
    workspace_id: UUID,
    payload: OnCallScheduleCreate,
    request: Request,
    auth: AuthenticatedSession = Depends(require_csrf),
    _access: tuple[Workspace, WorkspaceRole] = Depends(require_workspace_permission(Permission.ONCALL_MANAGE)),
    db: Session = Depends(get_db),
) -> OnCallScheduleResponse:
    """Creates a new on-call schedule rotation."""
    members_data = [m.model_dump() for m in payload.members]
    schedule = create_schedule(
        db=db,
        workspace_id=workspace_id,
        name=payload.name,
        description=payload.description,
        timezone=payload.timezone,
        is_active=payload.is_active,
        rotation_type=payload.rotation_type,
        rotation_interval_days=payload.rotation_interval_days,
        shift_start_time=payload.shift_start_time,
        handover_hour=payload.handover_hour,
        members=members_data,
    )
    record_domain_event(
        db,
        request,
        actor_user_id=auth.user.id,
        workspace_id=workspace_id,
        action="on_call.schedule_created",
        entity_type="on_call_schedule",
        entity_id=schedule.id,
        details={"name": schedule.name, "members_count": len(members_data)},
    )
    return _format_schedule_response(schedule)


@router.get("/{schedule_id}", response_model=OnCallScheduleResponse)
def get_single_schedule(
    workspace_id: UUID,
    schedule_id: UUID,
    _auth: AuthenticatedSession = Depends(get_authenticated_session),
    _access: tuple[Workspace, WorkspaceRole] = Depends(require_workspace_permission(Permission.ONCALL_READ)),
    db: Session = Depends(get_db),
) -> OnCallScheduleResponse:
    """Retrieves an on-call schedule by ID."""
    schedule = get_schedule(db, workspace_id, schedule_id)
    return _format_schedule_response(schedule)


@router.put("/{schedule_id}", response_model=OnCallScheduleResponse)
def update_on_call_schedule_route(
    workspace_id: UUID,
    schedule_id: UUID,
    payload: OnCallScheduleUpdate,
    request: Request,
    auth: AuthenticatedSession = Depends(require_csrf),
    _access: tuple[Workspace, WorkspaceRole] = Depends(require_workspace_permission(Permission.ONCALL_MANAGE)),
    db: Session = Depends(get_db),
) -> OnCallScheduleResponse:
    """Updates an existing on-call schedule."""
    updates = payload.model_dump(exclude_unset=True)
    if "members" in updates and updates["members"] is not None:
        updates["members"] = [
            m if isinstance(m, dict) else m.model_dump() for m in updates["members"]
        ]
    schedule = update_schedule(db, workspace_id, schedule_id, updates)
    record_domain_event(
        db,
        request,
        actor_user_id=auth.user.id,
        workspace_id=workspace_id,
        action="on_call.schedule_updated",
        entity_type="on_call_schedule",
        entity_id=schedule.id,
        details={"name": schedule.name},
    )
    return _format_schedule_response(schedule)


@router.delete("/{schedule_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_on_call_schedule_route(
    workspace_id: UUID,
    schedule_id: UUID,
    request: Request,
    auth: AuthenticatedSession = Depends(require_csrf),
    _access: tuple[Workspace, WorkspaceRole] = Depends(require_workspace_permission(Permission.ONCALL_MANAGE)),
    db: Session = Depends(get_db),
) -> None:
    """Deletes an on-call schedule."""
    delete_schedule(db, workspace_id, schedule_id)
    record_domain_event(
        db,
        request,
        actor_user_id=auth.user.id,
        workspace_id=workspace_id,
        action="on_call.schedule_deleted",
        entity_type="on_call_schedule",
        entity_id=schedule_id,
        details={},
    )


@router.get("/{schedule_id}/current", response_model=CurrentOnCallResponse)
def get_current_on_call_user(
    workspace_id: UUID,
    schedule_id: UUID,
    _auth: AuthenticatedSession = Depends(get_authenticated_session),
    _access: tuple[Workspace, WorkspaceRole] = Depends(require_workspace_permission(Permission.ONCALL_READ)),
    db: Session = Depends(get_db),
) -> CurrentOnCallResponse:
    """Resolves which user is currently on-call for the schedule."""
    schedule = get_schedule(db, workspace_id, schedule_id)
    current_member, shift_start, shift_end = resolve_current_on_call(schedule)
    return CurrentOnCallResponse(
        schedule_id=schedule.id,
        schedule_name=schedule.name,
        timezone=schedule.timezone,
        is_active=schedule.is_active,
        current_user=OnCallMember(**current_member) if current_member else None,
        shift_start=shift_start if current_member else None,
        shift_end=shift_end if current_member else None,
    )
