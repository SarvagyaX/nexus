"""Workspace-scoped incident management API."""

import asyncio
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import and_, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth.dependencies import AuthenticatedSession, require_csrf, require_workspace_permission
from app.audit.service import record_domain_event
from app.db.session import get_db
from app.models.identity import Membership, User, UserStatus, Workspace, WorkspaceRole
from app.models.incident import (Incident, IncidentEvent, IncidentSeverity, IncidentStatus,
                                 SeveritySource)
from app.models.service import Service, ServiceStatus
from app.schemas.incident import (AssigneeSummary, IncidentCreate, IncidentEventListResponse,
                                  IncidentEventResponse, IncidentListResponse, IncidentNote,
                                  IncidentPage, IncidentPatch, IncidentResponse, IncidentTransition,
                                  ServiceSummary)
from app.security.rbac import Permission
from app.services.incidents import (TRANSITIONS, add_event, decode_incident_cursor,
                                    encode_incident_cursor, get_incident, next_reference,
                                    validate_transition)

router = APIRouter(prefix="/api/v1/workspaces/{workspace_id}/incidents", tags=["incidents"])


def _not_found() -> HTTPException:
    return HTTPException(404, detail={"code": "incident_not_found", "message": "Incident was not found."})


def _response(db: Session, incident: Incident) -> IncidentResponse:
    service = db.scalar(select(Service).where(Service.workspace_id == incident.workspace_id, Service.id == incident.service_id))
    assignee = None
    if incident.assignee_user_id:
        user = db.scalar(select(User).join(Membership, Membership.user_id == User.id).where(
            Membership.workspace_id == incident.workspace_id, User.id == incident.assignee_user_id))
        if user:
            assignee = AssigneeSummary(id=user.id, display_name=user.display_name, email=user.email)
    return IncidentResponse(
        id=incident.id, workspace_id=incident.workspace_id, service_id=incident.service_id,
        reference=incident.reference, title=incident.title, summary=incident.summary,
        severity=incident.severity, status=incident.status, severity_source=incident.severity_source,
        assignee_user_id=incident.assignee_user_id, detected_at=incident.detected_at,
        started_at=incident.started_at, resolved_at=incident.resolved_at,
        resolution_summary=incident.resolution_summary, created_by_user_id=incident.created_by_user_id,
        created_at=incident.created_at, updated_at=incident.updated_at,
        service=ServiceSummary(id=service.id, name=service.name, service_key=service.service_key) if service else None,
        assignee=assignee,
    )


@router.get("", response_model=IncidentListResponse)
def list_incidents(
    workspace_id: UUID,
    status_filter: IncidentStatus | None = Query(default=None, alias="status"),
    severity: IncidentSeverity | None = None,
    service_id: UUID | None = None,
    assignee_user_id: UUID | None = None,
    from_at: datetime | None = Query(default=None, alias="from"),
    to_at: datetime | None = Query(default=None, alias="to"),
    q: str | None = Query(default=None, min_length=1, max_length=200),
    limit: int = Query(default=25, ge=1, le=100),
    cursor: str | None = Query(default=None, max_length=512),
    _access: tuple[Workspace, WorkspaceRole] = Depends(require_workspace_permission(Permission.INCIDENT_READ)),
    db: Session = Depends(get_db),
) -> IncidentListResponse:
    decoded = decode_incident_cursor(cursor)
    if from_at and from_at.tzinfo is None or to_at and to_at.tzinfo is None:
        raise HTTPException(422, detail={"code": "validation_error", "message": "Date filters must include a timezone."})
    if from_at and to_at and from_at > to_at:
        raise HTTPException(422, detail={"code": "validation_error", "message": "from must be earlier than or equal to to."})
    query = select(Incident).where(Incident.workspace_id == workspace_id)
    if status_filter: query = query.where(Incident.status == status_filter)
    if severity: query = query.where(Incident.severity == severity)
    if service_id: query = query.where(Incident.service_id == service_id)
    if assignee_user_id: query = query.where(Incident.assignee_user_id == assignee_user_id)
    if from_at: query = query.where(Incident.detected_at >= from_at)
    if to_at: query = query.where(Incident.detected_at <= to_at)
    if q:
        search = q.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        query = query.where(or_(Incident.reference.ilike(f"%{search}%", escape="\\"),
                                Incident.title.ilike(f"%{search}%", escape="\\"),
                                Incident.summary.ilike(f"%{search}%", escape="\\")))
    if decoded:
        timestamp, incident_id = decoded
        query = query.where(or_(Incident.detected_at < timestamp,
                                and_(Incident.detected_at == timestamp, Incident.id < incident_id)))
    rows = list(db.scalars(query.order_by(Incident.detected_at.desc(), Incident.id.desc()).limit(limit + 1)))
    has_more = len(rows) > limit
    items = rows[:limit]
    return IncidentListResponse(items=[_response(db, row) for row in items],
                                page=IncidentPage(limit=limit, has_more=has_more,
                                                  next_cursor=encode_incident_cursor(items[-1]) if has_more and items else None))


@router.post("", response_model=IncidentResponse, status_code=status.HTTP_201_CREATED)
def create_incident(
    workspace_id: UUID, payload: IncidentCreate, request: Request,
    auth: AuthenticatedSession = Depends(require_csrf),
    _access: tuple[Workspace, WorkspaceRole] = Depends(require_workspace_permission(Permission.INCIDENT_WRITE)),
    db: Session = Depends(get_db),
) -> IncidentResponse:
    service = db.scalar(select(Service).where(Service.workspace_id == workspace_id, Service.id == payload.service_id).with_for_update())
    if service is None:
        raise HTTPException(404, detail={"code": "service_not_found", "message": "Service was not found."})
    if service.status != ServiceStatus.ACTIVE:
        raise HTTPException(409, detail={"code": "service_archived", "message": "Incidents cannot be created for an archived service."})
    incident = Incident(workspace_id=workspace_id, service_id=service.id,
                        reference=next_reference(db, workspace_id), title=payload.title,
                        summary=payload.summary, severity=payload.severity, status=IncidentStatus.OPEN,
                        severity_source=SeveritySource.HUMAN, detected_at=payload.detected_at,
                        started_at=payload.started_at, created_by_user_id=auth.user.id)
    db.add(incident)
    try:
        db.flush()
        add_event(db, workspace_id=workspace_id, incident_id=incident.id, actor_user_id=auth.user.id,
                  event_type="incident.created", payload={"reference": incident.reference, "status": incident.status.value,
                                                         "severity": incident.severity.value})
        record_domain_event(db, request, actor_user_id=auth.user.id, workspace_id=workspace_id,
                            action="incident.created", entity_type="incident", entity_id=incident.id,
                            details={"reference": incident.reference})
        db.commit()
        db.refresh(incident)

        try:
            from app.models.identity import Membership
            from app.models.notification import NotificationCategory
            from app.services.escalation import trigger_escalation
            from app.services.notifications import dispatch_notification

            trigger_escalation(db, workspace_id, incident=incident)

            member_user_ids = db.scalars(
                select(Membership.user_id).where(Membership.workspace_id == workspace_id)
            ).all()
            for uid in member_user_ids:
                dispatch_notification(
                    db=db,
                    workspace_id=workspace_id,
                    user_id=uid,
                    category=NotificationCategory.INCIDENT,
                    severity=incident.severity.value,
                    title=f"[{incident.severity.value}] {incident.reference}: {incident.title}",
                    message=incident.summary or incident.title,
                    link=f"/incidents/{incident.id}",
                    entity_type="incident",
                    entity_id=incident.id,
                    dedup_key=f"inc-create-{incident.id}-{uid}",
                )

            # Trigger matching automated playbooks for incident_created
            from app.models.playbook import PlaybookTriggerType
            from app.services.playbook_engine import (
                create_execution,
                find_matching_playbooks,
                run_execution_steps,
            )

            matching_pbs = find_matching_playbooks(
                db=db,
                workspace_id=workspace_id,
                trigger_type=PlaybookTriggerType.INCIDENT_CREATED,
                severity=incident.severity.value,
                service_id=incident.service_id,
            )
            for pb in matching_pbs:
                exec_record = create_execution(
                    db=db,
                    workspace_id=workspace_id,
                    playbook_id=pb.id,
                    trigger_type=PlaybookTriggerType.INCIDENT_CREATED,
                    trigger_event_id=f"incident-created-{incident.id}",
                    incident_id=incident.id,
                    user_id=auth.user.id,
                    context={"incident_ref": incident.reference, "title": incident.title, "severity": incident.severity.value},
                )
                try:
                    loop = asyncio.get_running_loop()
                    loop.create_task(run_execution_steps(db, exec_record.id))
                except RuntimeError:
                    asyncio.run(run_execution_steps(db, exec_record.id))
        except Exception:
            pass
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, detail={"code": "incident_conflict", "message": "The incident could not be created due to a conflicting record."}) from None
    return _response(db, incident)


@router.get("/{incident_id}", response_model=IncidentResponse)
def get_incident_route(workspace_id: UUID, incident_id: UUID,
                       _access: tuple[Workspace, WorkspaceRole] = Depends(require_workspace_permission(Permission.INCIDENT_READ)),
                       db: Session = Depends(get_db)) -> IncidentResponse:
    incident = get_incident(db, workspace_id, incident_id)
    if incident is None: raise _not_found()
    return _response(db, incident)


@router.patch("/{incident_id}", response_model=IncidentResponse)
def update_incident(workspace_id: UUID, incident_id: UUID, payload: IncidentPatch, request: Request,
                    auth: AuthenticatedSession = Depends(require_csrf),
                    _access: tuple[Workspace, WorkspaceRole] = Depends(require_workspace_permission(Permission.INCIDENT_WRITE)),
                    db: Session = Depends(get_db)) -> IncidentResponse:
    incident = get_incident(db, workspace_id, incident_id, lock=True)
    if incident is None: raise _not_found()
    changes = payload.model_dump(exclude_unset=True)
    if "assignee_user_id" in changes and changes["assignee_user_id"] is not None:
        valid = db.scalar(select(User.id).join(Membership, Membership.user_id == User.id).where(
            Membership.workspace_id == workspace_id, User.id == changes["assignee_user_id"], User.status == UserStatus.ACTIVE))
        if valid is None:
            raise HTTPException(422, detail={"code": "invalid_assignee", "message": "Assignee must be an active member of this workspace."})
    changed = {key: value for key, value in changes.items() if getattr(incident, key) != value}
    if not changed: return _response(db, incident)
    previous = {key: getattr(incident, key) for key in changed}
    for key, value in changed.items(): setattr(incident, key, value)
    if "severity" in changed: incident.severity_source = SeveritySource.HUMAN
    try:
        for key, value in changed.items():
            event_type = {"severity": "incident.severity_changed", "assignee_user_id": "incident.assignment_changed"}.get(key, "incident.details_changed")
            add_event(db, workspace_id=workspace_id, incident_id=incident.id, actor_user_id=auth.user.id,
                      event_type=event_type, payload={"field": key, "from": str(previous[key]) if previous[key] is not None else None,
                                                      "to": str(value) if value is not None else None})
        record_domain_event(db, request, actor_user_id=auth.user.id, workspace_id=workspace_id,
                            action="incident.updated", entity_type="incident", entity_id=incident.id,
                            details={"fields": sorted(changed)})
        db.commit(); db.refresh(incident)

        # Trigger playbooks for severity or assignment changes
        try:
            import asyncio
            from app.models.playbook import PlaybookTriggerType
            from app.services.playbook_engine import (
                create_execution,
                find_matching_playbooks,
                run_execution_steps,
            )

            if "severity" in changed:
                matching_pbs = find_matching_playbooks(
                    db=db,
                    workspace_id=workspace_id,
                    trigger_type=PlaybookTriggerType.INCIDENT_SEVERITY_CHANGED,
                    severity=incident.severity.value,
                    service_id=incident.service_id,
                )
                for pb in matching_pbs:
                    exec_record = create_execution(
                        db=db,
                        workspace_id=workspace_id,
                        playbook_id=pb.id,
                        trigger_type=PlaybookTriggerType.INCIDENT_SEVERITY_CHANGED,
                        trigger_event_id=f"inc-sev-{incident.id}-{incident.severity.value}",
                        incident_id=incident.id,
                        user_id=auth.user.id,
                        context={"previous_severity": str(previous.get("severity")), "new_severity": incident.severity.value},
                    )
                    try:
                        loop = asyncio.get_running_loop()
                        loop.create_task(run_execution_steps(db, exec_record.id))
                    except RuntimeError:
                        asyncio.run(run_execution_steps(db, exec_record.id))

            if "assignee_user_id" in changed and incident.assignee_user_id:
                matching_pbs = find_matching_playbooks(
                    db=db,
                    workspace_id=workspace_id,
                    trigger_type=PlaybookTriggerType.INCIDENT_ASSIGNED,
                    severity=incident.severity.value,
                    service_id=incident.service_id,
                )
                for pb in matching_pbs:
                    exec_record = create_execution(
                        db=db,
                        workspace_id=workspace_id,
                        playbook_id=pb.id,
                        trigger_type=PlaybookTriggerType.INCIDENT_ASSIGNED,
                        trigger_event_id=f"inc-assign-{incident.id}-{incident.assignee_user_id}",
                        incident_id=incident.id,
                        user_id=auth.user.id,
                        context={"assignee_user_id": str(incident.assignee_user_id)},
                    )
                    try:
                        loop = asyncio.get_running_loop()
                        loop.create_task(run_execution_steps(db, exec_record.id))
                    except RuntimeError:
                        asyncio.run(run_execution_steps(db, exec_record.id))
        except Exception:
            pass
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, detail={"code": "incident_conflict", "message": "The incident update conflicted with another change."}) from None
    return _response(db, incident)


@router.post("/{incident_id}/transitions", response_model=IncidentResponse)
def transition_incident(workspace_id: UUID, incident_id: UUID, payload: IncidentTransition, request: Request,
                        auth: AuthenticatedSession = Depends(require_csrf),
                        _access: tuple[Workspace, WorkspaceRole] = Depends(require_workspace_permission(Permission.INCIDENT_WRITE)),
                        db: Session = Depends(get_db)) -> IncidentResponse:
    incident = get_incident(db, workspace_id, incident_id, lock=True)
    if incident is None: raise _not_found()
    validate_transition(incident.status, payload.to_status)
    before = incident.status
    incident.status = payload.to_status
    if payload.to_status in {IncidentStatus.INVESTIGATING, IncidentStatus.MONITORING} and incident.started_at is None:
        incident.started_at = datetime.now(timezone.utc)
    if payload.to_status == IncidentStatus.RESOLVED:
        incident.resolved_at = datetime.now(timezone.utc)
        incident.resolution_summary = payload.resolution_summary
    try:
        db.flush()
        add_event(db, workspace_id=workspace_id, incident_id=incident.id, actor_user_id=auth.user.id,
                  event_type="incident.status_changed", body=payload.reason,
                  payload={"from": before.value, "to": payload.to_status.value})
        record_domain_event(db, request, actor_user_id=auth.user.id, workspace_id=workspace_id,
                            action="incident.status_changed", entity_type="incident", entity_id=incident.id,
                            details={"from": before.value, "to": payload.to_status.value})
        db.commit(); db.refresh(incident)

        try:
            from app.services.escalation import acknowledge_escalation_for_entity, resolve_escalation_for_entity
            if payload.to_status == IncidentStatus.ACKNOWLEDGED:
                acknowledge_escalation_for_entity(db, workspace_id, "incident", incident.id, auth.user.id)
            elif payload.to_status in (IncidentStatus.RESOLVED, IncidentStatus.CLOSED):
                resolve_escalation_for_entity(db, workspace_id, "incident", incident.id, auth.user.id)
        except Exception:
            pass
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, detail={"code": "incident_conflict", "message": "The incident transition conflicted with another change."}) from None
    return _response(db, incident)


@router.get("/{incident_id}/events", response_model=IncidentEventListResponse)
def list_incident_events(workspace_id: UUID, incident_id: UUID,
                         limit: int = Query(default=50, ge=1, le=100), cursor: str | None = Query(default=None, max_length=512),
                         _access: tuple[Workspace, WorkspaceRole] = Depends(require_workspace_permission(Permission.INCIDENT_READ)),
                         db: Session = Depends(get_db)) -> IncidentEventListResponse:
    if get_incident(db, workspace_id, incident_id) is None: raise _not_found()
    # Event pagination is anchored to a validated event UUID and ordered chronologically.
    anchor = None
    if cursor:
        try: anchor = UUID(cursor)
        except ValueError: raise HTTPException(400, detail={"code": "invalid_cursor", "message": "The pagination cursor is invalid."}) from None
    query = select(IncidentEvent).where(IncidentEvent.workspace_id == workspace_id, IncidentEvent.incident_id == incident_id)
    if anchor:
        event_row = db.scalar(select(IncidentEvent).where(IncidentEvent.id == anchor, IncidentEvent.workspace_id == workspace_id, IncidentEvent.incident_id == incident_id))
        if event_row is None: raise HTTPException(400, detail={"code": "invalid_cursor", "message": "The pagination cursor is invalid."})
        query = query.where(or_(IncidentEvent.created_at > event_row.created_at,
                                and_(IncidentEvent.created_at == event_row.created_at, IncidentEvent.id > event_row.id)))
    rows = list(db.scalars(query.order_by(IncidentEvent.created_at, IncidentEvent.id).limit(limit + 1)))
    has_more = len(rows) > limit; items = rows[:limit]
    return IncidentEventListResponse(items=[IncidentEventResponse.model_validate(row) for row in items],
                                     page=IncidentPage(limit=limit, has_more=has_more,
                                                       next_cursor=str(items[-1].id) if has_more and items else None))


@router.post("/{incident_id}/events", response_model=IncidentEventResponse, status_code=201)
def create_incident_note(workspace_id: UUID, incident_id: UUID, payload: IncidentNote, request: Request,
                         auth: AuthenticatedSession = Depends(require_csrf),
                         _access: tuple[Workspace, WorkspaceRole] = Depends(require_workspace_permission(Permission.INCIDENT_WRITE)),
                         db: Session = Depends(get_db)) -> IncidentEventResponse:
    incident = get_incident(db, workspace_id, incident_id, lock=True)
    if incident is None: raise _not_found()
    event = add_event(db, workspace_id=workspace_id, incident_id=incident.id, actor_user_id=auth.user.id,
                      event_type="incident.note_added", body=payload.body)
    record_domain_event(db, request, actor_user_id=auth.user.id, workspace_id=workspace_id,
                        action="incident.note_added", entity_type="incident", entity_id=incident.id,
                        details={"event_id": str(event.id)})
    db.commit(); db.refresh(event)
    return IncidentEventResponse.model_validate(event)
