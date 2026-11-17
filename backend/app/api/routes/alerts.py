"""Workspace-scoped real-time alerts and alert rules API."""

from uuid import UUID

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.audit.service import record_domain_event
from app.auth.dependencies import AuthenticatedSession, require_csrf, require_workspace_permission
from app.db.session import get_db
from app.models.alert import (
    Alert,
    AlertEvent,
    AlertRule,
    AlertStatus,
)
from app.models.identity import Workspace, WorkspaceRole
from app.models.incident import IncidentSeverity
from app.models.service import Service
from app.schemas.alert import (
    AlertAcknowledgeRequest,
    AlertCreateIncidentRequest,
    AlertDetailResponse,
    AlertEvaluationResult,
    AlertEventResponse,
    AlertGroupListResponse,
    AlertGroupResponse,
    AlertListResponse,
    AlertResolveRequest,
    AlertRuleCreate,
    AlertRuleListResponse,
    AlertRulePatch,
    AlertRuleResponse,
    AlertSnoozeRequest,
    AlertStatsResponse,
    AlertSummaryResponse,
)
from app.schemas.incident import IncidentResponse
from app.security.rbac import Permission
from app.services.alert_bus import subscribe_alert_stream
from app.services.alerts import (
    acknowledge_alert,
    create_incident_from_alert,
    evaluate_alert_rules,
    get_alert_detail,
    get_alert_stats,
    get_grouped_alerts,
    link_incident_to_alert,
    list_alerts,
    reopen_alert,
    resolve_alert,
    snooze_alert,
)

router = APIRouter(prefix="/api/v1/workspaces/{workspace_id}/alerts", tags=["alerts"])


def _format_rule(rule: AlertRule) -> AlertRuleResponse:
    return AlertRuleResponse(
        id=rule.id,
        workspace_id=rule.workspace_id,
        service_id=rule.service_id,
        service_name=rule.service.name if rule.service else None,
        name=rule.name,
        description=rule.description,
        enabled=rule.enabled,
        severity=rule.severity,
        condition_type=rule.condition_type,
        threshold=rule.threshold,
        window_minutes=rule.window_minutes,
        cooldown_minutes=rule.cooldown_minutes,
        created_by_user_id=rule.created_by_user_id,
        created_at=rule.created_at,
        updated_at=rule.updated_at,
    )


def _format_alert_summary(alert: Alert) -> AlertSummaryResponse:
    return AlertSummaryResponse(
        id=alert.id,
        workspace_id=alert.workspace_id,
        rule_id=alert.rule_id,
        service_id=alert.service_id,
        incident_id=alert.incident_id,
        fingerprint=alert.fingerprint,
        title=alert.title,
        description=alert.description,
        severity=alert.severity,
        status=alert.status,
        occurrence_count=alert.occurrence_count,
        first_seen_at=alert.first_seen_at,
        last_seen_at=alert.last_seen_at,
        snoozed_until=alert.snoozed_until,
        acknowledged_at=alert.acknowledged_at,
        acknowledged_by_user_id=alert.acknowledged_by_user_id,
        resolved_at=alert.resolved_at,
        resolved_by_user_id=alert.resolved_by_user_id,
        resolution_note=alert.resolution_note,
        data=alert.data or {},
        created_at=alert.created_at,
        updated_at=alert.updated_at,
        service_name=alert.service.name if alert.service else None,
        rule_name=alert.rule.name if alert.rule else None,
        incident_reference=alert.incident.reference if alert.incident else None,
    )


def _format_alert_detail(alert: Alert) -> AlertDetailResponse:
    summary = _format_alert_summary(alert)
    events = [
        AlertEventResponse(
            id=ev.id,
            workspace_id=ev.workspace_id,
            alert_id=ev.alert_id,
            actor_user_id=ev.actor_user_id,
            event_type=ev.event_type,
            message=ev.message,
            payload=ev.payload or {},
            created_at=ev.created_at,
        )
        for ev in (alert.events or [])
    ]
    return AlertDetailResponse(
        **summary.model_dump(),
        events=events,
    )


# ============================================================================
# Alert Rules Endpoints
# ============================================================================

@router.get("/rules", response_model=AlertRuleListResponse)
def get_alert_rules(
    workspace_id: UUID,
    _access: tuple[Workspace, WorkspaceRole] = Depends(require_workspace_permission(Permission.ALERT_READ)),
    db: Session = Depends(get_db),
) -> AlertRuleListResponse:
    """Lists configured alert rules for the workspace."""
    rules = db.scalars(
        select(AlertRule)
        .where(AlertRule.workspace_id == workspace_id)
        .order_by(AlertRule.name)
    ).all()
    return AlertRuleListResponse(items=[_format_rule(r) for r in rules])


@router.post("/rules", response_model=AlertRuleResponse, status_code=status.HTTP_201_CREATED)
def create_rule(
    workspace_id: UUID,
    payload: AlertRuleCreate,
    request: Request,
    _access: tuple[Workspace, WorkspaceRole] = Depends(require_workspace_permission(Permission.ALERT_MANAGE)),
    auth: AuthenticatedSession = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> AlertRuleResponse:
    """Creates a new operational alert rule."""
    if payload.service_id is not None:
        svc = db.scalar(
            select(Service).where(Service.workspace_id == workspace_id, Service.id == payload.service_id)
        )
        if not svc:
            raise HTTPException(status_code=404, detail={"code": "service_not_found", "message": "Target service not found."})

    rule = AlertRule(
        workspace_id=workspace_id,
        service_id=payload.service_id,
        name=payload.name,
        description=payload.description,
        enabled=payload.enabled,
        severity=payload.severity,
        condition_type=payload.condition_type,
        threshold=payload.threshold,
        window_minutes=payload.window_minutes,
        cooldown_minutes=payload.cooldown_minutes,
        created_by_user_id=auth.user.id,
    )
    db.add(rule)
    db.commit()
    db.refresh(rule)

    record_domain_event(
        db,
        request,
        actor_user_id=auth.user.id,
        workspace_id=workspace_id,
        action="alert_rule.created",
        entity_type="alert_rule",
        entity_id=rule.id,
        details={"name": rule.name, "condition_type": rule.condition_type.value},
    )
    db.commit()

    return _format_rule(rule)


@router.get("/rules/{rule_id}", response_model=AlertRuleResponse)
def get_rule(
    workspace_id: UUID,
    rule_id: UUID,
    _access: tuple[Workspace, WorkspaceRole] = Depends(require_workspace_permission(Permission.ALERT_READ)),
    db: Session = Depends(get_db),
) -> AlertRuleResponse:
    rule = db.scalar(
        select(AlertRule).where(AlertRule.workspace_id == workspace_id, AlertRule.id == rule_id)
    )
    if not rule:
        raise HTTPException(status_code=404, detail={"code": "rule_not_found", "message": "Alert rule not found."})
    return _format_rule(rule)


@router.patch("/rules/{rule_id}", response_model=AlertRuleResponse)
def update_rule(
    workspace_id: UUID,
    rule_id: UUID,
    payload: AlertRulePatch,
    request: Request,
    _access: tuple[Workspace, WorkspaceRole] = Depends(require_workspace_permission(Permission.ALERT_MANAGE)),
    auth: AuthenticatedSession = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> AlertRuleResponse:
    rule = db.scalar(
        select(AlertRule).where(AlertRule.workspace_id == workspace_id, AlertRule.id == rule_id)
    )
    if not rule:
        raise HTTPException(status_code=404, detail={"code": "rule_not_found", "message": "Alert rule not found."})

    changes = payload.model_dump(exclude_unset=True)
    if "service_id" in changes and changes["service_id"] is not None:
        svc = db.scalar(
            select(Service).where(Service.workspace_id == workspace_id, Service.id == changes["service_id"])
        )
        if not svc:
            raise HTTPException(status_code=404, detail={"code": "service_not_found", "message": "Target service not found."})

    for k, v in changes.items():
        setattr(rule, k, v)

    db.commit()
    db.refresh(rule)

    record_domain_event(
        db,
        request,
        actor_user_id=auth.user.id,
        workspace_id=workspace_id,
        action="alert_rule.updated",
        entity_type="alert_rule",
        entity_id=rule.id,
        details={"name": rule.name, "updated_fields": list(changes.keys())},
    )
    db.commit()

    return _format_rule(rule)


@router.delete("/rules/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_rule(
    workspace_id: UUID,
    rule_id: UUID,
    request: Request,
    _access: tuple[Workspace, WorkspaceRole] = Depends(require_workspace_permission(Permission.ALERT_MANAGE)),
    auth: AuthenticatedSession = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> None:
    rule = db.scalar(
        select(AlertRule).where(AlertRule.workspace_id == workspace_id, AlertRule.id == rule_id)
    )
    if not rule:
        raise HTTPException(status_code=404, detail={"code": "rule_not_found", "message": "Alert rule not found."})

    rule_name = rule.name
    db.delete(rule)
    db.commit()

    record_domain_event(
        db,
        request,
        actor_user_id=auth.user.id,
        workspace_id=workspace_id,
        action="alert_rule.deleted",
        entity_type="alert_rule",
        entity_id=rule_id,
        details={"name": rule_name},
    )
    db.commit()


# ============================================================================
# Alert Querying & Evaluation Endpoints
# ============================================================================

@router.get("", response_model=AlertListResponse)
def get_alerts(
    workspace_id: UUID,
    status: AlertStatus | None = Query(default=None),
    severity: IncidentSeverity | None = Query(default=None),
    service_id: UUID | None = Query(default=None),
    search: str | None = Query(default=None),
    cursor: str | None = Query(default=None),
    limit: int = Query(default=25, ge=1, le=100),
    _access: tuple[Workspace, WorkspaceRole] = Depends(require_workspace_permission(Permission.ALERT_READ)),
    db: Session = Depends(get_db),
) -> AlertListResponse:
    """Retrieves workspace alerts with filtering, search, and cursor pagination."""
    items, next_cursor = list_alerts(
        db=db,
        workspace_id=workspace_id,
        status=status,
        severity=severity,
        service_id=service_id,
        search=search,
        cursor=cursor,
        limit=limit,
    )
    return AlertListResponse(
        items=[_format_alert_summary(a) for a in items],
        next_cursor=next_cursor,
    )


@router.get("/stats", response_model=AlertStatsResponse)
def get_stats(
    workspace_id: UUID,
    _access: tuple[Workspace, WorkspaceRole] = Depends(require_workspace_permission(Permission.ALERT_READ)),
    db: Session = Depends(get_db),
) -> AlertStatsResponse:
    """Returns operational alert KPIs."""
    stats = get_alert_stats(db, workspace_id)
    return AlertStatsResponse(**stats)


@router.get("/groups", response_model=AlertGroupListResponse)
def get_groups(
    workspace_id: UUID,
    status: AlertStatus | None = Query(default=None),
    _access: tuple[Workspace, WorkspaceRole] = Depends(require_workspace_permission(Permission.ALERT_READ)),
    db: Session = Depends(get_db),
) -> AlertGroupListResponse:
    """Returns clustered alerts grouped by service and severity."""
    raw_groups = get_grouped_alerts(db, workspace_id, status)
    groups = [
        AlertGroupResponse(
            group_key=g["group_key"],
            service_id=g["service_id"],
            service_name=g["service_name"],
            severity=g["severity"],
            status=g["status"],
            alert_count=g["alert_count"],
            total_occurrences=g["total_occurrences"],
            latest_alert=_format_alert_summary(g["latest_alert"]),
            alerts=[_format_alert_summary(a) for a in g["alerts"]],
        )
        for g in raw_groups
    ]
    return AlertGroupListResponse(groups=groups)


@router.post("/evaluate", response_model=AlertEvaluationResult)
def trigger_evaluation(
    workspace_id: UUID,
    service_id: UUID | None = Query(default=None),
    request: Request = None,
    _access: tuple[Workspace, WorkspaceRole] = Depends(require_workspace_permission(Permission.ALERT_WRITE)),
    auth: AuthenticatedSession = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> AlertEvaluationResult:
    """Manually evaluates alert rules against recent log telemetry."""
    rules_count = db.scalar(
        select(func.count(AlertRule.id)).where(AlertRule.workspace_id == workspace_id, AlertRule.enabled == True)  # noqa: E712
    ) or 0

    triggered = evaluate_alert_rules(db, workspace_id, service_id)
    new_count = sum(1 for a in triggered if a.occurrence_count == 1)
    updated_count = len(triggered) - new_count

    return AlertEvaluationResult(
        evaluated_rules_count=rules_count,
        new_alerts_count=new_count,
        updated_alerts_count=updated_count,
        alerts=[_format_alert_summary(a) for a in triggered],
    )


@router.get("/{alert_id}", response_model=AlertDetailResponse)
def get_alert(
    workspace_id: UUID,
    alert_id: UUID,
    _access: tuple[Workspace, WorkspaceRole] = Depends(require_workspace_permission(Permission.ALERT_READ)),
    db: Session = Depends(get_db),
) -> AlertDetailResponse:
    """Fetches full alert detail including occurrence history and events."""
    alert = get_alert_detail(db, workspace_id, alert_id)
    if not alert:
        raise HTTPException(status_code=404, detail={"code": "alert_not_found", "message": "Alert not found."})
    return _format_alert_detail(alert)


# ============================================================================
# Alert Lifecycle Endpoints
# ============================================================================

@router.post("/{alert_id}/acknowledge", response_model=AlertDetailResponse)
def ack_alert(
    workspace_id: UUID,
    alert_id: UUID,
    payload: AlertAcknowledgeRequest = Body(default_factory=AlertAcknowledgeRequest),
    request: Request = None,
    _access: tuple[Workspace, WorkspaceRole] = Depends(require_workspace_permission(Permission.ALERT_WRITE)),
    auth: AuthenticatedSession = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> AlertDetailResponse:
    alert = acknowledge_alert(db, workspace_id, alert_id, auth.user.id, payload.note)
    record_domain_event(
        db,
        request,
        actor_user_id=auth.user.id,
        workspace_id=workspace_id,
        action="alert.acknowledged",
        entity_type="alert",
        entity_id=alert.id,
        details={"status": alert.status.value},
    )
    db.commit()
    detailed = get_alert_detail(db, workspace_id, alert_id)
    return _format_alert_detail(detailed)


@router.post("/{alert_id}/snooze", response_model=AlertDetailResponse)
def snz_alert(
    workspace_id: UUID,
    alert_id: UUID,
    payload: AlertSnoozeRequest,
    request: Request,
    _access: tuple[Workspace, WorkspaceRole] = Depends(require_workspace_permission(Permission.ALERT_WRITE)),
    auth: AuthenticatedSession = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> AlertDetailResponse:
    alert = snooze_alert(db, workspace_id, alert_id, auth.user.id, payload.duration_minutes)
    record_domain_event(
        db,
        request,
        actor_user_id=auth.user.id,
        workspace_id=workspace_id,
        action="alert.snoozed",
        entity_type="alert",
        entity_id=alert.id,
        details={"duration_minutes": payload.duration_minutes},
    )
    db.commit()
    detailed = get_alert_detail(db, workspace_id, alert_id)
    return _format_alert_detail(detailed)


@router.post("/{alert_id}/resolve", response_model=AlertDetailResponse)
def res_alert(
    workspace_id: UUID,
    alert_id: UUID,
    payload: AlertResolveRequest = Body(default_factory=AlertResolveRequest),
    request: Request = None,
    _access: tuple[Workspace, WorkspaceRole] = Depends(require_workspace_permission(Permission.ALERT_WRITE)),
    auth: AuthenticatedSession = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> AlertDetailResponse:
    alert = resolve_alert(db, workspace_id, alert_id, auth.user.id, payload.resolution_note)
    record_domain_event(
        db,
        request,
        actor_user_id=auth.user.id,
        workspace_id=workspace_id,
        action="alert.resolved",
        entity_type="alert",
        entity_id=alert.id,
        details={"resolution_note": payload.resolution_note},
    )
    db.commit()
    detailed = get_alert_detail(db, workspace_id, alert_id)
    return _format_alert_detail(detailed)


@router.post("/{alert_id}/reopen", response_model=AlertDetailResponse)
def rep_alert(
    workspace_id: UUID,
    alert_id: UUID,
    request: Request,
    _access: tuple[Workspace, WorkspaceRole] = Depends(require_workspace_permission(Permission.ALERT_WRITE)),
    auth: AuthenticatedSession = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> AlertDetailResponse:
    alert = reopen_alert(db, workspace_id, alert_id, auth.user.id)
    record_domain_event(
        db,
        request,
        actor_user_id=auth.user.id,
        workspace_id=workspace_id,
        action="alert.reopened",
        entity_type="alert",
        entity_id=alert.id,
        details={"status": alert.status.value},
    )
    db.commit()
    detailed = get_alert_detail(db, workspace_id, alert_id)
    return _format_alert_detail(detailed)


# ============================================================================
# Incident Escalation & Linking
# ============================================================================

@router.post("/{alert_id}/create-incident", response_model=AlertDetailResponse, status_code=status.HTTP_201_CREATED)
def escalate_to_incident(
    workspace_id: UUID,
    alert_id: UUID,
    payload: AlertCreateIncidentRequest = Body(default_factory=AlertCreateIncidentRequest),
    request: Request = None,
    _access: tuple[Workspace, WorkspaceRole] = Depends(require_workspace_permission(Permission.INCIDENT_WRITE)),
    auth: AuthenticatedSession = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> AlertDetailResponse:
    """Escalates an operational alert into an official Incident."""
    incident, alert = create_incident_from_alert(
        db=db,
        workspace_id=workspace_id,
        alert_id=alert_id,
        user_id=auth.user.id,
        title_override=payload.title,
        summary_override=payload.summary,
        severity_override=payload.severity,
    )

    record_domain_event(
        db,
        request,
        actor_user_id=auth.user.id,
        workspace_id=workspace_id,
        action="incident.created_from_alert",
        entity_type="incident",
        entity_id=incident.id,
        details={"alert_id": str(alert.id), "reference": incident.reference},
    )
    db.commit()

    detailed = get_alert_detail(db, workspace_id, alert_id)
    return _format_alert_detail(detailed)


@router.post("/{alert_id}/link-incident", response_model=AlertDetailResponse)
def link_existing_incident(
    workspace_id: UUID,
    alert_id: UUID,
    incident_id: UUID = Query(...),
    request: Request = None,
    _access: tuple[Workspace, WorkspaceRole] = Depends(require_workspace_permission(Permission.INCIDENT_WRITE)),
    auth: AuthenticatedSession = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> AlertDetailResponse:
    """Links an existing incident to an alert."""
    alert = link_incident_to_alert(db, workspace_id, alert_id, incident_id, auth.user.id)
    record_domain_event(
        db,
        request,
        actor_user_id=auth.user.id,
        workspace_id=workspace_id,
        action="alert.incident_linked",
        entity_type="alert",
        entity_id=alert.id,
        details={"incident_id": str(incident_id)},
    )
    db.commit()

    detailed = get_alert_detail(db, workspace_id, alert_id)
    return _format_alert_detail(detailed)


# ============================================================================
# Real-Time Server-Sent Events Stream
# ============================================================================

@router.get("/stream")
async def stream_alerts(
    workspace_id: UUID,
    _access: tuple[Workspace, WorkspaceRole] = Depends(require_workspace_permission(Permission.ALERT_READ)),
):
    """Subscribes to live Server-Sent Events for alerts in this workspace."""
    return StreamingResponse(
        subscribe_alert_stream(workspace_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
