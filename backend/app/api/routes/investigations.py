"""Workspace-scoped AI investigation routes."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ai.provider import get_llm_client
from app.ai.service import (
    get_investigation_detail,
    list_investigations,
    retry_investigation,
    review_recommendation,
    start_investigation,
)
from app.audit.service import record_domain_event
from app.auth.dependencies import AuthenticatedSession, require_csrf, require_workspace_permission
from app.db.session import get_db
from app.models.identity import Workspace, WorkspaceRole
from app.models.investigation import Investigation, InvestigationStatus
from app.models.service import Service
from app.schemas.investigation import (
    EvidenceResponse,
    HypothesisResponse,
    InvestigationCreate,
    InvestigationDetailResponse,
    InvestigationListResponse,
    InvestigationSummaryResponse,
    ProviderStatusResponse,
    RecommendationResponse,
    RecommendationReviewRequest,
)
from app.security.rbac import Permission

router = APIRouter(prefix="/api/v1/workspaces/{workspace_id}/investigations", tags=["investigations"])


def _not_found() -> HTTPException:
    return HTTPException(
        status_code=404,
        detail={"code": "investigation_not_found", "message": "Investigation was not found."},
    )


def _format_summary(inv: Investigation) -> InvestigationSummaryResponse:
    inc_title = inv.incident.title if inv.incident else None
    inc_sev = (
        inv.incident.severity.value
        if inv.incident and hasattr(inv.incident.severity, "value")
        else str(inv.incident.severity)
        if inv.incident
        else None
    )
    return InvestigationSummaryResponse(
        id=inv.id,
        workspace_id=inv.workspace_id,
        incident_id=inv.incident_id,
        status=inv.status,
        summary=inv.summary,
        confidence_score=inv.confidence_score,
        error_message=inv.error_message,
        started_at=inv.started_at,
        completed_at=inv.completed_at,
        created_by_user_id=inv.created_by_user_id,
        created_at=inv.created_at,
        updated_at=inv.updated_at,
        incident_title=inc_title,
        incident_severity=inc_sev,
        evidence_count=len(inv.evidence) if inv.evidence is not None else 0,
        hypotheses_count=len(inv.hypotheses) if inv.hypotheses is not None else 0,
        recommendations_count=len(inv.recommendations) if inv.recommendations is not None else 0,
    )


def _format_detail(inv: Investigation, db: Session) -> InvestigationDetailResponse:
    inc_title = inv.incident.title if inv.incident else None
    inc_sev = (
        inv.incident.severity.value
        if inv.incident and hasattr(inv.incident.severity, "value")
        else str(inv.incident.severity)
        if inv.incident
        else None
    )
    svc_id = inv.incident.service_id if inv.incident else None
    svc_name = None
    if svc_id:
        svc = db.scalar(
            select(Service).where(
                Service.workspace_id == inv.workspace_id,
                Service.id == svc_id,
            )
        )
        if svc:
            svc_name = svc.name

    return InvestigationDetailResponse(
        id=inv.id,
        workspace_id=inv.workspace_id,
        incident_id=inv.incident_id,
        status=inv.status,
        summary=inv.summary,
        confidence_score=inv.confidence_score,
        error_message=inv.error_message,
        started_at=inv.started_at,
        completed_at=inv.completed_at,
        created_by_user_id=inv.created_by_user_id,
        created_at=inv.created_at,
        updated_at=inv.updated_at,
        incident_title=inc_title,
        incident_severity=inc_sev,
        incident_service_id=svc_id,
        incident_service_name=svc_name,
        evidence=[EvidenceResponse.model_validate(e) for e in (inv.evidence or [])],
        hypotheses=[HypothesisResponse.model_validate(h) for h in (inv.hypotheses or [])],
        recommendations=[RecommendationResponse.model_validate(r) for r in (inv.recommendations or [])],
    )


@router.get("/provider-status", response_model=ProviderStatusResponse)
async def get_provider_status(
    workspace_id: UUID,
    _access: tuple[Workspace, WorkspaceRole] = Depends(require_workspace_permission(Permission.INCIDENT_READ)),
) -> ProviderStatusResponse:
    """Returns the configured LLM provider operational health status."""
    client = get_llm_client()
    health = await client.check_health()
    return ProviderStatusResponse(
        provider=health.provider,
        model=health.model,
        is_available=health.is_available,
        message=health.message or ("Available" if health.is_available else "Unavailable"),
    )


@router.post("", response_model=InvestigationDetailResponse, status_code=status.HTTP_201_CREATED)
async def create_investigation(
    workspace_id: UUID,
    payload: InvestigationCreate,
    request: Request,
    _access: tuple[Workspace, WorkspaceRole] = Depends(require_workspace_permission(Permission.INVESTIGATION_START)),
    auth: AuthenticatedSession = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> InvestigationDetailResponse:
    """Launches an AI investigation workflow against an incident."""
    inv = await start_investigation(
        db=db,
        workspace_id=workspace_id,
        incident_id=payload.incident_id,
        user_id=auth.user.id,
    )

    record_domain_event(
        db,
        request,
        actor_user_id=auth.user.id,
        workspace_id=workspace_id,
        action="investigation.started",
        entity_type="investigation",
        entity_id=inv.id,
        details={"incident_id": str(payload.incident_id)},
    )
    db.commit()

    return _format_detail(inv, db)


@router.get("", response_model=InvestigationListResponse)
def list_workspace_investigations(
    workspace_id: UUID,
    incident_id: UUID | None = Query(default=None),
    status: InvestigationStatus | None = Query(default=None),
    cursor: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
    _access: tuple[Workspace, WorkspaceRole] = Depends(require_workspace_permission(Permission.INCIDENT_READ)),
    db: Session = Depends(get_db),
) -> InvestigationListResponse:
    """Lists investigations for the workspace with pagination."""
    items, next_cursor = list_investigations(
        db=db,
        workspace_id=workspace_id,
        incident_id=incident_id,
        status=status,
        cursor=cursor,
        limit=limit,
    )
    return InvestigationListResponse(
        items=[_format_summary(i) for i in items],
        next_cursor=next_cursor,
    )


@router.get("/{investigation_id}", response_model=InvestigationDetailResponse)
def get_investigation(
    workspace_id: UUID,
    investigation_id: UUID,
    _access: tuple[Workspace, WorkspaceRole] = Depends(require_workspace_permission(Permission.INCIDENT_READ)),
    db: Session = Depends(get_db),
) -> InvestigationDetailResponse:
    """Retrieves full investigation detail including evidence, hypotheses, and recommendations."""
    inv = get_investigation_detail(db, workspace_id, investigation_id)
    if not inv:
        raise _not_found()
    return _format_detail(inv, db)


@router.post("/{investigation_id}/retry", response_model=InvestigationDetailResponse)
async def retry_workspace_investigation(
    workspace_id: UUID,
    investigation_id: UUID,
    request: Request,
    _access: tuple[Workspace, WorkspaceRole] = Depends(require_workspace_permission(Permission.INVESTIGATION_START)),
    auth: AuthenticatedSession = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> InvestigationDetailResponse:
    """Retries a failed or incomplete investigation."""
    inv = await retry_investigation(
        db=db,
        workspace_id=workspace_id,
        investigation_id=investigation_id,
        user_id=auth.user.id,
    )

    record_domain_event(
        db,
        request,
        actor_user_id=auth.user.id,
        workspace_id=workspace_id,
        action="investigation.retried",
        entity_type="investigation",
        entity_id=inv.id,
        details={"incident_id": str(inv.incident_id)},
    )
    db.commit()

    return _format_detail(inv, db)


@router.post(
    "/{investigation_id}/recommendations/{recommendation_id}/review",
    response_model=RecommendationResponse,
)
def review_investigation_recommendation(
    workspace_id: UUID,
    investigation_id: UUID,
    recommendation_id: UUID,
    payload: RecommendationReviewRequest,
    request: Request,
    _access: tuple[Workspace, WorkspaceRole] = Depends(require_workspace_permission(Permission.RECOMMENDATION_APPROVE)),
    auth: AuthenticatedSession = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> RecommendationResponse:
    """Human-in-the-loop review (Approve / Reject) for an investigation recommendation."""
    rec = review_recommendation(
        db=db,
        workspace_id=workspace_id,
        investigation_id=investigation_id,
        recommendation_id=recommendation_id,
        user_id=auth.user.id,
        status=payload.status,
        review_notes=payload.review_notes,
    )

    record_domain_event(
        db,
        request,
        actor_user_id=auth.user.id,
        workspace_id=workspace_id,
        action="investigation.recommendation_reviewed",
        entity_type="investigation_recommendation",
        entity_id=rec.id,
        details={
            "investigation_id": str(investigation_id),
            "status": payload.status.value,
        },
    )
    db.commit()

    return RecommendationResponse.model_validate(rec)
