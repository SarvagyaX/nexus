"""Workspace-scoped structured log records and analytics API."""

from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from app.audit.service import record_domain_event
from app.auth.dependencies import AuthenticatedSession, require_csrf, require_workspace_permission
from app.db.session import get_db
from app.models.identity import Workspace, WorkspaceRole
from app.models.log import LogRecord, LogSeverity
from app.models.service import Service, ServiceStatus
from app.schemas.log import (
    LogBatchIngest,
    LogCreate,
    LogIngestResponse,
    LogListResponse,
    LogPage,
    LogResponse,
    LogServiceSummary,
    LogStatsResponse,
)
from app.security.rbac import Permission
from app.services.logs import calculate_log_stats, decode_log_cursor, encode_log_cursor
from app.services.alerts import evaluate_alert_rules

router = APIRouter(prefix="/api/v1/workspaces/{workspace_id}/logs", tags=["logs"])


def _not_found() -> HTTPException:
    return HTTPException(
        status_code=404,
        detail={"code": "log_not_found", "message": "Log record was not found."},
    )


def _format_log_response(
    log: LogRecord,
    service_cache: dict[UUID, Service] | None = None,
    db: Session | None = None,
) -> LogResponse:
    service = None
    if service_cache is not None and log.service_id in service_cache:
        service = service_cache[log.service_id]
    elif db is not None:
        service = db.scalar(
            select(Service).where(
                Service.workspace_id == log.workspace_id, Service.id == log.service_id
            )
        )
    return LogResponse(
        id=log.id,
        workspace_id=log.workspace_id,
        service_id=log.service_id,
        timestamp=log.timestamp,
        severity=log.severity,
        trace_id=log.trace_id,
        message=log.message,
        attributes=log.attributes,
        created_at=log.created_at,
        service=LogServiceSummary(
            id=service.id, name=service.name, service_key=service.service_key
        )
        if service
        else None,
    )


def _build_filter_clauses(
    severity: LogSeverity | None = None,
    service_id: UUID | None = None,
    trace_id: str | None = None,
    from_at: datetime | None = None,
    to_at: datetime | None = None,
    q: str | None = None,
) -> list:
    clauses = []
    if severity is not None:
        clauses.append(LogRecord.severity == severity)
    if service_id is not None:
        clauses.append(LogRecord.service_id == service_id)
    if trace_id is not None:
        cleaned_trace = trace_id.strip()
        if cleaned_trace:
            clauses.append(LogRecord.trace_id == cleaned_trace)
    if from_at is not None:
        clauses.append(LogRecord.timestamp >= from_at)
    if to_at is not None:
        clauses.append(LogRecord.timestamp <= to_at)
    if q is not None:
        search = q.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        if search:
            clauses.append(
                or_(
                    LogRecord.message.ilike(f"%{search}%", escape="\\"),
                    LogRecord.trace_id.ilike(f"%{search}%", escape="\\"),
                )
            )
    return clauses


@router.get("", response_model=LogListResponse)
def list_logs(
    workspace_id: UUID,
    severity: LogSeverity | None = Query(default=None),
    service_id: UUID | None = Query(default=None),
    trace_id: str | None = Query(default=None, max_length=64),
    from_at: datetime | None = Query(default=None, alias="from"),
    to_at: datetime | None = Query(default=None, alias="to"),
    q: str | None = Query(default=None, min_length=1, max_length=200),
    limit: int = Query(default=50, ge=1, le=200),
    cursor: str | None = Query(default=None, max_length=512),
    _access: tuple[Workspace, WorkspaceRole] = Depends(
        require_workspace_permission(Permission.LOG_READ)
    ),
    db: Session = Depends(get_db),
) -> LogListResponse:
    if from_at and from_at.tzinfo is None or to_at and to_at.tzinfo is None:
        raise HTTPException(
            status_code=422,
            detail={"code": "validation_error", "message": "Date filters must include a timezone."},
        )
    if from_at and to_at and from_at > to_at:
        raise HTTPException(
            status_code=422,
            detail={"code": "validation_error", "message": "from must be earlier than or equal to to."},
        )

    decoded_cursor = decode_log_cursor(cursor)
    clauses = _build_filter_clauses(severity, service_id, trace_id, from_at, to_at, q)

    query = select(LogRecord).where(LogRecord.workspace_id == workspace_id, *clauses)

    if decoded_cursor is not None:
        cursor_ts, cursor_id = decoded_cursor
        query = query.where(
            or_(
                LogRecord.timestamp < cursor_ts,
                and_(LogRecord.timestamp == cursor_ts, LogRecord.id < cursor_id),
            )
        )

    rows = list(
        db.scalars(
            query.order_by(LogRecord.timestamp.desc(), LogRecord.id.desc()).limit(limit + 1)
        )
    )
    has_more = len(rows) > limit
    items = rows[:limit]

    # Batch preload services to avoid N+1 queries
    service_ids = {log.service_id for log in items}
    service_cache = {}
    if service_ids:
        services = db.scalars(
            select(Service).where(
                Service.workspace_id == workspace_id, Service.id.in_(service_ids)
            )
        )
        service_cache = {s.id: s for s in services}

    next_cursor = encode_log_cursor(items[-1]) if has_more and items else None
    return LogListResponse(
        items=[_format_log_response(log, service_cache=service_cache) for log in items],
        page=LogPage(limit=limit, next_cursor=next_cursor, has_more=has_more),
    )


@router.get("/stats", response_model=LogStatsResponse)
def get_log_stats(
    workspace_id: UUID,
    service_id: UUID | None = Query(default=None),
    severity: LogSeverity | None = Query(default=None),
    trace_id: str | None = Query(default=None, max_length=64),
    from_at: datetime | None = Query(default=None, alias="from"),
    to_at: datetime | None = Query(default=None, alias="to"),
    q: str | None = Query(default=None, min_length=1, max_length=200),
    _access: tuple[Workspace, WorkspaceRole] = Depends(
        require_workspace_permission(Permission.LOG_READ)
    ),
    db: Session = Depends(get_db),
) -> LogStatsResponse:
    if from_at and from_at.tzinfo is None or to_at and to_at.tzinfo is None:
        raise HTTPException(
            status_code=422,
            detail={"code": "validation_error", "message": "Date filters must include a timezone."},
        )
    if from_at and to_at and from_at > to_at:
        raise HTTPException(
            status_code=422,
            detail={"code": "validation_error", "message": "from must be earlier than or equal to to."},
        )

    base_clauses = _build_filter_clauses(
        severity=severity, service_id=service_id, trace_id=trace_id, q=q
    )
    total_count, severity_counts, time_buckets, service_counts = calculate_log_stats(
        db, workspace_id, base_clauses, from_at, to_at
    )
    return LogStatsResponse(
        total_count=total_count,
        severity_counts=severity_counts,
        time_buckets=time_buckets,
        service_counts=service_counts,
    )


@router.get("/{log_id}", response_model=LogResponse)
def get_log_record(
    workspace_id: UUID,
    log_id: UUID,
    _access: tuple[Workspace, WorkspaceRole] = Depends(
        require_workspace_permission(Permission.LOG_READ)
    ),
    db: Session = Depends(get_db),
) -> LogResponse:
    log = db.scalar(
        select(LogRecord).where(LogRecord.workspace_id == workspace_id, LogRecord.id == log_id)
    )
    if log is None:
        raise _not_found()
    return _format_log_response(log, db=db)


@router.post("", response_model=LogResponse, status_code=status.HTTP_201_CREATED)
def create_log(
    workspace_id: UUID,
    payload: LogCreate,
    request: Request,
    auth: AuthenticatedSession = Depends(require_csrf),
    _access: tuple[Workspace, WorkspaceRole] = Depends(
        require_workspace_permission(Permission.LOG_WRITE)
    ),
    db: Session = Depends(get_db),
) -> LogResponse:
    service = db.scalar(
        select(Service).where(
            Service.workspace_id == workspace_id, Service.id == payload.service_id
        )
    )
    if service is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "service_not_found", "message": "Referenced service was not found in this workspace."},
        )
    if service.status != ServiceStatus.ACTIVE:
        raise HTTPException(
            status_code=409,
            detail={"code": "service_archived", "message": "Logs cannot be recorded for an archived service."},
        )

    ts = payload.timestamp or datetime.now(timezone.utc)
    log = LogRecord(
        workspace_id=workspace_id,
        service_id=service.id,
        timestamp=ts,
        severity=payload.severity,
        trace_id=payload.trace_id,
        message=payload.message,
        attributes=payload.attributes,
    )
    db.add(log)
    db.commit()
    db.refresh(log)

    try:
        evaluate_alert_rules(db, workspace_id, service_id=service.id)
    except Exception:
        pass

    return _format_log_response(log, service_cache={service.id: service})


@router.post("/batch", response_model=LogIngestResponse, status_code=status.HTTP_201_CREATED)
def ingest_logs_batch(
    workspace_id: UUID,
    payload: LogBatchIngest,
    request: Request,
    auth: AuthenticatedSession = Depends(require_csrf),
    _access: tuple[Workspace, WorkspaceRole] = Depends(
        require_workspace_permission(Permission.LOG_WRITE)
    ),
    db: Session = Depends(get_db),
) -> LogIngestResponse:
    needed_service_ids = {item.service_id for item in payload.items}
    services = list(
        db.scalars(
            select(Service).where(
                Service.workspace_id == workspace_id,
                Service.id.in_(needed_service_ids),
            )
        )
    )
    service_map = {s.id: s for s in services}

    # Verify all referenced services exist in this workspace
    for s_id in needed_service_ids:
        if s_id not in service_map:
            raise HTTPException(
                status_code=404,
                detail={"code": "service_not_found", "message": f"Service {s_id} was not found in this workspace."},
            )
        if service_map[s_id].status != ServiceStatus.ACTIVE:
            raise HTTPException(
                status_code=409,
                detail={"code": "service_archived", "message": f"Service {service_map[s_id].name} is archived."},
            )

    now = datetime.now(timezone.utc)
    new_logs = []
    for item in payload.items:
        ts = item.timestamp or now
        log = LogRecord(
            workspace_id=workspace_id,
            service_id=item.service_id,
            timestamp=ts,
            severity=item.severity,
            trace_id=item.trace_id,
            message=item.message,
            attributes=item.attributes,
        )
        new_logs.append(log)

    db.add_all(new_logs)
    db.flush()

    record_domain_event(
        db,
        request,
        actor_user_id=auth.user.id,
        workspace_id=workspace_id,
        action="log.batch_ingested",
        entity_type="workspace",
        entity_id=workspace_id,
        details={"count": len(new_logs)},
    )
    db.commit()

    try:
        for s_id in needed_service_ids:
            evaluate_alert_rules(db, workspace_id, service_id=s_id)
    except Exception:
        pass

    return LogIngestResponse(
        ingested_count=len(new_logs),
        ids=[log.id for log in new_logs],
    )
