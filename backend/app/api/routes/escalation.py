"""Workspace incident and alert escalation policy routes."""

from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, status
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
from app.models.notification import EscalationExecutionStatus
from app.schemas.notification import (
    EscalationExecutionResponse,
    EscalationPolicyCreate,
    EscalationPolicyResponse,
    EscalationPolicyUpdate,
    EscalationStepResponse,
)
from app.security.rbac import Permission
from app.services.escalation import (
    create_policy,
    delete_policy,
    get_policy,
    list_executions,
    list_policies,
    process_due_escalations,
    update_policy,
)

router = APIRouter(prefix="/api/v1/workspaces/{workspace_id}/escalation", tags=["escalation"])


def _format_policy_response(policy) -> EscalationPolicyResponse:
    steps = [
        EscalationStepResponse(
            id=s.id,
            policy_id=s.policy_id,
            step_number=s.step_number,
            target_type=s.target_type,
            target_user_id=s.target_user_id,
            target_schedule_id=s.target_schedule_id,
            target_webhook_url=s.target_webhook_url,
            delay_minutes=s.delay_minutes,
        )
        for s in policy.steps
    ]
    return EscalationPolicyResponse(
        id=policy.id,
        workspace_id=policy.workspace_id,
        name=policy.name,
        description=policy.description,
        is_active=policy.is_active,
        min_severity=policy.min_severity,
        service_id=policy.service_id,
        repeat_count=policy.repeat_count,
        created_at=policy.created_at,
        updated_at=policy.updated_at,
        steps=steps,
    )


@router.get("/policies", response_model=list[EscalationPolicyResponse])
def get_escalation_policies(
    workspace_id: UUID,
    _auth: AuthenticatedSession = Depends(get_authenticated_session),
    _access: tuple[Workspace, WorkspaceRole] = Depends(require_workspace_permission(Permission.ESCALATION_READ)),
    db: Session = Depends(get_db),
) -> list[EscalationPolicyResponse]:
    """Lists escalation policies in the workspace."""
    policies = list_policies(db, workspace_id)
    return [_format_policy_response(p) for p in policies]


@router.post("/policies", response_model=EscalationPolicyResponse, status_code=status.HTTP_201_CREATED)
def create_escalation_policy(
    workspace_id: UUID,
    payload: EscalationPolicyCreate,
    request: Request,
    auth: AuthenticatedSession = Depends(require_csrf),
    _access: tuple[Workspace, WorkspaceRole] = Depends(require_workspace_permission(Permission.ESCALATION_MANAGE)),
    db: Session = Depends(get_db),
) -> EscalationPolicyResponse:
    """Creates a new escalation policy with ordered steps."""
    steps_data = [s.model_dump() for s in payload.steps]
    policy = create_policy(
        db=db,
        workspace_id=workspace_id,
        name=payload.name,
        steps=steps_data,
        description=payload.description,
        is_active=payload.is_active,
        min_severity=payload.min_severity,
        service_id=payload.service_id,
        repeat_count=payload.repeat_count,
    )
    record_domain_event(
        db,
        request,
        actor_user_id=auth.user.id,
        workspace_id=workspace_id,
        action="escalation.policy_created",
        entity_type="escalation_policy",
        entity_id=policy.id,
        details={"name": policy.name, "steps_count": len(steps_data)},
    )
    return _format_policy_response(policy)


@router.get("/policies/{policy_id}", response_model=EscalationPolicyResponse)
def get_single_policy(
    workspace_id: UUID,
    policy_id: UUID,
    _auth: AuthenticatedSession = Depends(get_authenticated_session),
    _access: tuple[Workspace, WorkspaceRole] = Depends(require_workspace_permission(Permission.ESCALATION_READ)),
    db: Session = Depends(get_db),
) -> EscalationPolicyResponse:
    """Retrieves an escalation policy by ID."""
    policy = get_policy(db, workspace_id, policy_id)
    return _format_policy_response(policy)


@router.put("/policies/{policy_id}", response_model=EscalationPolicyResponse)
def update_escalation_policy_route(
    workspace_id: UUID,
    policy_id: UUID,
    payload: EscalationPolicyUpdate,
    request: Request,
    auth: AuthenticatedSession = Depends(require_csrf),
    _access: tuple[Workspace, WorkspaceRole] = Depends(require_workspace_permission(Permission.ESCALATION_MANAGE)),
    db: Session = Depends(get_db),
) -> EscalationPolicyResponse:
    """Updates an escalation policy and its steps."""
    updates = payload.model_dump(exclude_unset=True, exclude={"steps"})
    steps_data = [s.model_dump() for s in payload.steps] if payload.steps is not None else None
    policy = update_policy(db, workspace_id, policy_id, updates, steps=steps_data)
    record_domain_event(
        db,
        request,
        actor_user_id=auth.user.id,
        workspace_id=workspace_id,
        action="escalation.policy_updated",
        entity_type="escalation_policy",
        entity_id=policy.id,
        details={"name": policy.name},
    )
    return _format_policy_response(policy)


@router.delete("/policies/{policy_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_escalation_policy_route(
    workspace_id: UUID,
    policy_id: UUID,
    request: Request,
    auth: AuthenticatedSession = Depends(require_csrf),
    _access: tuple[Workspace, WorkspaceRole] = Depends(require_workspace_permission(Permission.ESCALATION_MANAGE)),
    db: Session = Depends(get_db),
) -> None:
    """Deletes an escalation policy."""
    delete_policy(db, workspace_id, policy_id)
    record_domain_event(
        db,
        request,
        actor_user_id=auth.user.id,
        workspace_id=workspace_id,
        action="escalation.policy_deleted",
        entity_type="escalation_policy",
        entity_id=policy_id,
        details={},
    )


@router.get("/executions", response_model=list[EscalationExecutionResponse])
def get_escalation_executions(
    workspace_id: UUID,
    status: EscalationExecutionStatus | None = None,
    limit: int = Query(default=50, ge=1, le=100),
    _auth: AuthenticatedSession = Depends(get_authenticated_session),
    _access: tuple[Workspace, WorkspaceRole] = Depends(require_workspace_permission(Permission.ESCALATION_READ)),
    db: Session = Depends(get_db),
) -> list[EscalationExecutionResponse]:
    """Lists recent escalation policy executions."""
    executions = list_executions(db, workspace_id, status=status, limit=limit)
    return [EscalationExecutionResponse.model_validate(ex) for ex in executions]


@router.post("/process-due", response_model=list[EscalationExecutionResponse])
def run_process_due_escalations(
    workspace_id: UUID,
    _auth: AuthenticatedSession = Depends(require_csrf),
    _access: tuple[Workspace, WorkspaceRole] = Depends(require_workspace_permission(Permission.ESCALATION_MANAGE)),
    db: Session = Depends(get_db),
) -> list[EscalationExecutionResponse]:
    """Manually triggers evaluation of due escalation steps."""
    processed = process_due_escalations(db)
    return [EscalationExecutionResponse.model_validate(ex) for ex in processed]
