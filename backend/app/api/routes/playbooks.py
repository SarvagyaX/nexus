"""Playbook management, template instantiation, and workflow execution endpoints."""

import asyncio
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
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
from app.models.playbook import (
    Playbook,
    PlaybookApprovalRequest,
    PlaybookApprovalStatus,
    PlaybookExecution,
    PlaybookExecutionStatus,
    PlaybookStatus,
    PlaybookStep,
    PlaybookStepExecution,
    PlaybookTriggerType,
)
from app.schemas.playbook import (
    PlaybookApprovalActionRequest,
    PlaybookApprovalRequestResponse,
    PlaybookCreate,
    PlaybookExecutionListResponse,
    PlaybookExecutionResponse,
    PlaybookListResponse,
    PlaybookManualExecuteRequest,
    PlaybookResponse,
    PlaybookStepExecutionResponse,
    PlaybookStepResponse,
    PlaybookTemplateResponse,
    PlaybookUpdate,
)
from app.security.rbac import Permission
from app.services.playbook_engine import (
    approve_execution_step,
    archive_playbook,
    cancel_execution,
    create_execution,
    create_playbook,
    delete_playbook,
    duplicate_playbook,
    get_execution,
    get_playbook,
    instantiate_template,
    list_executions,
    list_playbooks,
    reject_execution_step,
    run_execution_steps,
    update_playbook,
)
from app.services.playbook_templates import get_all_templates

router = APIRouter(prefix="/api/v1/workspaces/{workspace_id}", tags=["playbooks"])


def _format_playbook_response(pb: Playbook) -> PlaybookResponse:
    """Helper to convert ORM Playbook to PlaybookResponse schema."""
    steps_sorted = sorted(pb.steps, key=lambda s: s.step_order)
    return PlaybookResponse(
        id=pb.id,
        workspace_id=pb.workspace_id,
        name=pb.name,
        description=pb.description,
        category=pb.category,
        status=pb.status,
        trigger_type=pb.trigger_type,
        trigger_config=pb.trigger_config or {},
        severity_applicability=pb.severity_applicability or [],
        is_template=pb.is_template,
        template_id=pb.template_id,
        version=pb.version,
        execution_count=pb.execution_count,
        last_executed_at=pb.last_executed_at,
        created_by_user_id=pb.created_by_user_id,
        created_at=pb.created_at,
        updated_at=pb.updated_at,
        steps=[
            PlaybookStepResponse(
                id=s.id,
                playbook_id=s.playbook_id,
                step_order=s.step_order,
                name=s.name,
                action_type=s.action_type,
                action_config=s.action_config or {},
                is_enabled=s.is_enabled,
                continue_on_failure=s.continue_on_failure,
                timeout_seconds=s.timeout_seconds,
                created_at=s.created_at,
                updated_at=s.updated_at,
            )
            for s in steps_sorted
        ],
    )


def _format_execution_response(execution: PlaybookExecution) -> PlaybookExecutionResponse:
    """Helper to convert ORM PlaybookExecution to PlaybookExecutionResponse schema."""
    step_execs_sorted = sorted(execution.step_executions, key=lambda se: se.step_order)

    pending_app = None
    for app_req in execution.approvals:
        if app_req.status == PlaybookApprovalStatus.PENDING:
            pending_app = PlaybookApprovalRequestResponse(
                id=app_req.id,
                execution_id=app_req.execution_id,
                step_execution_id=app_req.step_execution_id,
                prompt=app_req.prompt,
                status=app_req.status,
                approver_user_id=app_req.approver_user_id,
                comment=app_req.comment,
                responded_at=app_req.responded_at,
                created_at=app_req.created_at,
            )
            break

    formatted_steps = []
    for se in step_execs_sorted:
        app_resp = None
        if se.approval:
            app_resp = PlaybookApprovalRequestResponse(
                id=se.approval.id,
                execution_id=se.approval.execution_id,
                step_execution_id=se.approval.step_execution_id,
                prompt=se.approval.prompt,
                status=se.approval.status,
                approver_user_id=se.approval.approver_user_id,
                comment=se.approval.comment,
                responded_at=se.approval.responded_at,
                created_at=se.approval.created_at,
            )
        formatted_steps.append(
            PlaybookStepExecutionResponse(
                id=se.id,
                execution_id=se.execution_id,
                step_id=se.step_id,
                step_order=se.step_order,
                step_name=se.step_name,
                action_type=se.action_type,
                status=se.status,
                input_payload=se.input_payload or {},
                output_payload=se.output_payload or {},
                error_message=se.error_message,
                retry_count=se.retry_count,
                started_at=se.started_at,
                completed_at=se.completed_at,
                duration_ms=se.duration_ms,
                created_at=se.created_at,
                approval=app_resp,
            )
        )

    return PlaybookExecutionResponse(
        id=execution.id,
        workspace_id=execution.workspace_id,
        playbook_id=execution.playbook_id,
        playbook_name=execution.playbook.name if execution.playbook else None,
        trigger_type=execution.trigger_type,
        trigger_event_id=execution.trigger_event_id,
        status=execution.status,
        incident_id=execution.incident_id,
        alert_id=execution.alert_id,
        triggered_by_user_id=execution.triggered_by_user_id,
        current_step_order=execution.current_step_order,
        context=execution.context or {},
        error_message=execution.error_message,
        started_at=execution.started_at,
        completed_at=execution.completed_at,
        duration_ms=execution.duration_ms,
        created_at=execution.created_at,
        updated_at=execution.updated_at,
        step_executions=formatted_steps,
        pending_approval=pending_app,
    )


# ============================================================================
# Playbook Templates
# ============================================================================

@router.get("/playbooks/templates", response_model=list[PlaybookTemplateResponse])
def get_playbook_templates(
    workspace_id: UUID,
    _auth: AuthenticatedSession = Depends(get_authenticated_session),
    _access: tuple[Workspace, WorkspaceRole] = Depends(require_workspace_permission(Permission.PLAYBOOK_READ)),
) -> list[PlaybookTemplateResponse]:
    """Returns the catalog of built-in playbook templates."""
    return get_all_templates()


@router.post(
    "/playbooks/templates/{template_id}/instantiate",
    response_model=PlaybookResponse,
    status_code=status.HTTP_201_CREATED,
)
def instantiate_playbook_template(
    workspace_id: UUID,
    template_id: str,
    request: Request,
    auth: AuthenticatedSession = Depends(require_csrf),
    _access: tuple[Workspace, WorkspaceRole] = Depends(require_workspace_permission(Permission.PLAYBOOK_MANAGE)),
    db: Session = Depends(get_db),
) -> PlaybookResponse:
    """Creates a new editable playbook based on a built-in template."""
    pb = instantiate_template(db, workspace_id, auth.user.id, template_id)
    if not pb:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "template_not_found", "message": f"Template '{template_id}' not found."},
        )

    record_domain_event(
        db,
        request,
        actor_user_id=auth.user.id,
        workspace_id=workspace_id,
        action="playbook.instantiated_from_template",
        entity_type="playbook",
        entity_id=pb.id,
        details={"template_id": template_id, "name": pb.name},
    )
    return _format_playbook_response(pb)


# ============================================================================
# Playbook Management CRUD
# ============================================================================

@router.get("/playbooks", response_model=PlaybookListResponse)
def list_workspace_playbooks(
    workspace_id: UUID,
    status: PlaybookStatus | None = None,
    trigger_type: PlaybookTriggerType | None = None,
    category: str | None = None,
    search: str | None = None,
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    _auth: AuthenticatedSession = Depends(get_authenticated_session),
    _access: tuple[Workspace, WorkspaceRole] = Depends(require_workspace_permission(Permission.PLAYBOOK_READ)),
    db: Session = Depends(get_db),
) -> PlaybookListResponse:
    """Lists playbooks configured within the workspace."""
    items, total = list_playbooks(
        db=db,
        workspace_id=workspace_id,
        status=status,
        trigger_type=trigger_type,
        category=category,
        search=search,
        limit=limit,
        offset=offset,
    )
    return PlaybookListResponse(
        items=[_format_playbook_response(pb) for pb in items],
        total=total,
    )


@router.post(
    "/playbooks",
    response_model=PlaybookResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_workspace_playbook(
    workspace_id: UUID,
    payload: PlaybookCreate,
    request: Request,
    auth: AuthenticatedSession = Depends(require_csrf),
    _access: tuple[Workspace, WorkspaceRole] = Depends(require_workspace_permission(Permission.PLAYBOOK_MANAGE)),
    db: Session = Depends(get_db),
) -> PlaybookResponse:
    """Creates a new operational playbook with ordered steps."""
    pb = create_playbook(db, workspace_id, auth.user.id, payload)

    record_domain_event(
        db,
        request,
        actor_user_id=auth.user.id,
        workspace_id=workspace_id,
        action="playbook.created",
        entity_type="playbook",
        entity_id=pb.id,
        details={"name": pb.name, "trigger_type": pb.trigger_type.value, "step_count": len(pb.steps)},
    )
    return _format_playbook_response(pb)


@router.get("/playbooks/{playbook_id}", response_model=PlaybookResponse)
def get_workspace_playbook(
    workspace_id: UUID,
    playbook_id: UUID,
    _auth: AuthenticatedSession = Depends(get_authenticated_session),
    _access: tuple[Workspace, WorkspaceRole] = Depends(require_workspace_permission(Permission.PLAYBOOK_READ)),
    db: Session = Depends(get_db),
) -> PlaybookResponse:
    """Retrieves playbook details, triggers, and ordered steps."""
    pb = get_playbook(db, workspace_id, playbook_id)
    if not pb:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "playbook_not_found", "message": "Playbook was not found."},
        )
    return _format_playbook_response(pb)


@router.patch("/playbooks/{playbook_id}", response_model=PlaybookResponse)
def update_workspace_playbook(
    workspace_id: UUID,
    playbook_id: UUID,
    payload: PlaybookUpdate,
    request: Request,
    auth: AuthenticatedSession = Depends(require_csrf),
    _access: tuple[Workspace, WorkspaceRole] = Depends(require_workspace_permission(Permission.PLAYBOOK_MANAGE)),
    db: Session = Depends(get_db),
) -> PlaybookResponse:
    """Updates playbook configuration, trigger parameters, or step sequence."""
    pb = update_playbook(db, workspace_id, playbook_id, payload)
    if not pb:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "playbook_not_found", "message": "Playbook was not found."},
        )

    record_domain_event(
        db,
        request,
        actor_user_id=auth.user.id,
        workspace_id=workspace_id,
        action="playbook.updated",
        entity_type="playbook",
        entity_id=pb.id,
        details={"version": pb.version, "status": pb.status.value},
    )
    return _format_playbook_response(pb)


@router.post(
    "/playbooks/{playbook_id}/duplicate",
    response_model=PlaybookResponse,
    status_code=status.HTTP_201_CREATED,
)
def duplicate_workspace_playbook(
    workspace_id: UUID,
    playbook_id: UUID,
    request: Request,
    auth: AuthenticatedSession = Depends(require_csrf),
    _access: tuple[Workspace, WorkspaceRole] = Depends(require_workspace_permission(Permission.PLAYBOOK_MANAGE)),
    db: Session = Depends(get_db),
) -> PlaybookResponse:
    """Duplicates an existing playbook into a new DRAFT copy."""
    pb = duplicate_playbook(db, workspace_id, playbook_id, auth.user.id)
    if not pb:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "playbook_not_found", "message": "Source playbook was not found."},
        )

    record_domain_event(
        db,
        request,
        actor_user_id=auth.user.id,
        workspace_id=workspace_id,
        action="playbook.duplicated",
        entity_type="playbook",
        entity_id=pb.id,
        details={"source_playbook_id": str(playbook_id), "new_name": pb.name},
    )
    return _format_playbook_response(pb)


@router.post("/playbooks/{playbook_id}/archive", response_model=PlaybookResponse)
def archive_workspace_playbook(
    workspace_id: UUID,
    playbook_id: UUID,
    request: Request,
    auth: AuthenticatedSession = Depends(require_csrf),
    _access: tuple[Workspace, WorkspaceRole] = Depends(require_workspace_permission(Permission.PLAYBOOK_MANAGE)),
    db: Session = Depends(get_db),
) -> PlaybookResponse:
    """Archives an active or inactive playbook."""
    pb = archive_playbook(db, workspace_id, playbook_id)
    if not pb:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "playbook_not_found", "message": "Playbook was not found."},
        )

    record_domain_event(
        db,
        request,
        actor_user_id=auth.user.id,
        workspace_id=workspace_id,
        action="playbook.archived",
        entity_type="playbook",
        entity_id=pb.id,
        details={"status": pb.status.value},
    )
    return _format_playbook_response(pb)


@router.delete("/playbooks/{playbook_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_workspace_playbook(
    workspace_id: UUID,
    playbook_id: UUID,
    request: Request,
    auth: AuthenticatedSession = Depends(require_csrf),
    _access: tuple[Workspace, WorkspaceRole] = Depends(require_workspace_permission(Permission.PLAYBOOK_MANAGE)),
    db: Session = Depends(get_db),
) -> None:
    """Permanently deletes a playbook and associated steps."""
    ok = delete_playbook(db, workspace_id, playbook_id)
    if not ok:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "playbook_not_found", "message": "Playbook was not found."},
        )

    record_domain_event(
        db,
        request,
        actor_user_id=auth.user.id,
        workspace_id=workspace_id,
        action="playbook.deleted",
        entity_type="playbook",
        entity_id=playbook_id,
        details={"deleted": True},
    )


# ============================================================================
# Execution & Approval Endpoints
# ============================================================================

@router.post(
    "/playbooks/{playbook_id}/execute",
    response_model=PlaybookExecutionResponse,
    status_code=status.HTTP_201_CREATED,
)
async def execute_playbook_manually(
    workspace_id: UUID,
    playbook_id: UUID,
    payload: PlaybookManualExecuteRequest,
    request: Request,
    auth: AuthenticatedSession = Depends(require_csrf),
    _access: tuple[Workspace, WorkspaceRole] = Depends(require_workspace_permission(Permission.PLAYBOOK_EXECUTE)),
    db: Session = Depends(get_db),
) -> PlaybookExecutionResponse:
    """Triggers manual execution of a playbook with optional incident/alert bindings."""
    pb = get_playbook(db, workspace_id, playbook_id)
    if not pb:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "playbook_not_found", "message": "Playbook was not found."},
        )

    execution = create_execution(
        db=db,
        workspace_id=workspace_id,
        playbook_id=playbook_id,
        trigger_type=PlaybookTriggerType.MANUAL,
        incident_id=payload.incident_id,
        alert_id=payload.alert_id,
        user_id=auth.user.id,
        context=payload.context,
    )

    record_domain_event(
        db,
        request,
        actor_user_id=auth.user.id,
        workspace_id=workspace_id,
        action="playbook.executed_manually",
        entity_type="playbook_execution",
        entity_id=execution.id,
        details={
            "playbook_id": str(playbook_id),
            "incident_id": str(payload.incident_id) if payload.incident_id else None,
            "alert_id": str(payload.alert_id) if payload.alert_id else None,
        },
    )

    # Execute steps synchronously or initiate background execution
    updated_exec = await run_execution_steps(db, execution.id)
    return _format_execution_response(updated_exec)


@router.get("/playbook-executions", response_model=PlaybookExecutionListResponse)
def list_workspace_executions(
    workspace_id: UUID,
    playbook_id: UUID | None = None,
    status: PlaybookExecutionStatus | None = None,
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    _auth: AuthenticatedSession = Depends(get_authenticated_session),
    _access: tuple[Workspace, WorkspaceRole] = Depends(require_workspace_permission(Permission.PLAYBOOK_READ)),
    db: Session = Depends(get_db),
) -> PlaybookExecutionListResponse:
    """Lists recent playbook executions and their statuses."""
    items, total = list_executions(
        db=db,
        workspace_id=workspace_id,
        playbook_id=playbook_id,
        status=status,
        limit=limit,
        offset=offset,
    )
    return PlaybookExecutionListResponse(
        items=[_format_execution_response(e) for e in items],
        total=total,
    )


@router.get("/playbook-executions/{execution_id}", response_model=PlaybookExecutionResponse)
def get_workspace_execution(
    workspace_id: UUID,
    execution_id: UUID,
    _auth: AuthenticatedSession = Depends(get_authenticated_session),
    _access: tuple[Workspace, WorkspaceRole] = Depends(require_workspace_permission(Permission.PLAYBOOK_READ)),
    db: Session = Depends(get_db),
) -> PlaybookExecutionResponse:
    """Retrieves execution details, step outputs, logs, and approval state."""
    execution = get_execution(db, workspace_id, execution_id)
    if not execution:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "execution_not_found", "message": "Playbook execution was not found."},
        )
    return _format_execution_response(execution)


@router.post("/playbook-executions/{execution_id}/approve", response_model=PlaybookExecutionResponse)
async def approve_step(
    workspace_id: UUID,
    execution_id: UUID,
    payload: PlaybookApprovalActionRequest,
    request: Request,
    auth: AuthenticatedSession = Depends(require_csrf),
    _access: tuple[Workspace, WorkspaceRole] = Depends(require_workspace_permission(Permission.PLAYBOOK_APPROVE)),
    db: Session = Depends(get_db),
) -> PlaybookExecutionResponse:
    """Approves a pending approval step and resumes playbook execution."""
    try:
        updated_exec = await approve_execution_step(
            db=db,
            workspace_id=workspace_id,
            execution_id=execution_id,
            user_id=auth.user.id,
            comment=payload.comment,
        )
    except ValueError as val_err:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "invalid_approval_action", "message": str(val_err)},
        )

    record_domain_event(
        db,
        request,
        actor_user_id=auth.user.id,
        workspace_id=workspace_id,
        action="playbook.step_approved",
        entity_type="playbook_execution",
        entity_id=execution_id,
        details={"comment": payload.comment, "status": updated_exec.status.value},
    )
    return _format_execution_response(updated_exec)


@router.post("/playbook-executions/{execution_id}/reject", response_model=PlaybookExecutionResponse)
async def reject_step(
    workspace_id: UUID,
    execution_id: UUID,
    payload: PlaybookApprovalActionRequest,
    request: Request,
    auth: AuthenticatedSession = Depends(require_csrf),
    _access: tuple[Workspace, WorkspaceRole] = Depends(require_workspace_permission(Permission.PLAYBOOK_APPROVE)),
    db: Session = Depends(get_db),
) -> PlaybookExecutionResponse:
    """Rejects a pending approval step, terminating the playbook execution."""
    try:
        updated_exec = await reject_execution_step(
            db=db,
            workspace_id=workspace_id,
            execution_id=execution_id,
            user_id=auth.user.id,
            comment=payload.comment,
        )
    except ValueError as val_err:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "invalid_rejection_action", "message": str(val_err)},
        )

    record_domain_event(
        db,
        request,
        actor_user_id=auth.user.id,
        workspace_id=workspace_id,
        action="playbook.step_rejected",
        entity_type="playbook_execution",
        entity_id=execution_id,
        details={"comment": payload.comment, "status": updated_exec.status.value},
    )
    return _format_execution_response(updated_exec)


@router.post("/playbook-executions/{execution_id}/cancel", response_model=PlaybookExecutionResponse)
def cancel_workspace_execution(
    workspace_id: UUID,
    execution_id: UUID,
    request: Request,
    auth: AuthenticatedSession = Depends(require_csrf),
    _access: tuple[Workspace, WorkspaceRole] = Depends(require_workspace_permission(Permission.PLAYBOOK_MANAGE)),
    db: Session = Depends(get_db),
) -> PlaybookExecutionResponse:
    """Cancels an in-progress or awaiting-approval execution."""
    try:
        updated_exec = cancel_execution(
            db=db,
            workspace_id=workspace_id,
            execution_id=execution_id,
            user_id=auth.user.id,
        )
    except ValueError as val_err:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "invalid_cancel_action", "message": str(val_err)},
        )

    record_domain_event(
        db,
        request,
        actor_user_id=auth.user.id,
        workspace_id=workspace_id,
        action="playbook.execution_cancelled",
        entity_type="playbook_execution",
        entity_id=execution_id,
        details={"status": updated_exec.status.value},
    )
    return _format_execution_response(updated_exec)
