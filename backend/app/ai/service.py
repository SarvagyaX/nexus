"""Investigation domain operations, persistence, and workflow orchestrator."""

import base64
import binascii
from datetime import datetime, timezone
import json
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import desc, select
from sqlalchemy.orm import Session, selectinload

from app.ai.provider import get_llm_client
from app.ai.workflow import InvestigationState, build_investigation_graph
from app.models.incident import Incident, IncidentEvent, IncidentStatus
from app.models.investigation import (
    EvidenceType,
    Investigation,
    InvestigationEvidence,
    InvestigationHypothesis,
    InvestigationRecommendation,
    InvestigationStatus,
    RecommendationStatus,
    utc_now,
)
from app.models.log import LogRecord
from app.models.service import Service


def _invalid_cursor():
    raise HTTPException(
        status_code=400,
        detail={"code": "invalid_cursor", "message": "The pagination cursor is invalid."},
    )


def decode_investigation_cursor(cursor: str | None) -> tuple[datetime, UUID] | None:
    if cursor is None:
        return None
    try:
        if not cursor or len(cursor) > 512:
            raise ValueError
        data = json.loads(
            base64.b64decode(cursor + "=" * (-len(cursor) % 4), altchars=b"-_", validate=True)
        )
        if not isinstance(data, dict) or set(data) != {"created_at", "id"}:
            raise ValueError
        created_at = datetime.fromisoformat(data["created_at"])
        if created_at.tzinfo is None:
            raise ValueError
        return created_at, UUID(data["id"])
    except (ValueError, TypeError, KeyError, binascii.Error, json.JSONDecodeError):
        _invalid_cursor()


def encode_investigation_cursor(inv: Investigation) -> str:
    created_at = inv.created_at
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=timezone.utc)
    payload = json.dumps(
        {"created_at": created_at.isoformat(), "id": str(inv.id)},
        separators=(",", ":"),
    )
    return base64.b64encode(payload.encode("utf-8"), altchars=b"-_").decode("ascii").rstrip("=")


async def run_investigation_workflow(
    db: Session,
    investigation: Investigation,
    incident: Incident,
) -> Investigation:
    """Executes the 8-node LangGraph investigation workflow and persists all results."""
    llm_client = get_llm_client()

    # Step 1: Check provider availability
    health = await llm_client.check_health()
    if not health.is_available:
        investigation.status = InvestigationStatus.FAILED
        investigation.error_message = (
            f"LLM Provider '{health.provider}' is unavailable: {health.message or 'Health check failed'}"
        )
        investigation.completed_at = utc_now()
        db.commit()
        db.refresh(investigation)
        return investigation

    investigation.status = InvestigationStatus.RUNNING
    investigation.started_at = utc_now()
    db.commit()

    try:
        # Step 2: Fetch domain context
        service = db.scalar(
            select(Service).where(
                Service.workspace_id == incident.workspace_id,
                Service.id == incident.service_id,
            )
        )

        logs = db.scalars(
            select(LogRecord)
            .where(
                LogRecord.workspace_id == incident.workspace_id,
                LogRecord.service_id == incident.service_id,
            )
            .order_by(LogRecord.timestamp.desc())
            .limit(100)
        ).all()

        timeline_events = db.scalars(
            select(IncidentEvent)
            .where(
                IncidentEvent.workspace_id == incident.workspace_id,
                IncidentEvent.incident_id == incident.id,
            )
            .order_by(IncidentEvent.created_at.desc())
            .limit(20)
        ).all()

        related_incidents = db.scalars(
            select(Incident).where(
                Incident.workspace_id == incident.workspace_id,
                Incident.id != incident.id,
                Incident.status.in_([IncidentStatus.OPEN, IncidentStatus.INVESTIGATING]),
            )
        ).all()

        # Step 3: Construct state
        initial_state: InvestigationState = {
            "workspace_id": str(investigation.workspace_id),
            "incident_id": str(investigation.incident_id),
            "incident": {
                "id": str(incident.id),
                "title": incident.title,
                "summary": incident.summary,
                "severity": incident.severity.value,
                "status": incident.status.value,
                "detected_at": incident.detected_at.isoformat(),
                "started_at": incident.started_at.isoformat() if incident.started_at else None,
                "service_id": str(incident.service_id),
            },
            "service": {
                "id": str(service.id),
                "name": service.name,
                "slug": service.service_key,
                "tier": getattr(service.tier, "value", str(service.tier)) if hasattr(service, "tier") else "tier_3",
                "health_status": (
                    getattr(service.status, "value", str(service.status))
                    if hasattr(service, "status")
                    else "healthy"
                ),
            }
            if service
            else None,
            "raw_logs": [
                {
                    "id": str(l.id),
                    "timestamp": l.timestamp.isoformat(),
                    "severity": getattr(l.severity, "value", str(l.severity)),
                    "message": l.message,
                    "trace_id": l.trace_id,
                    "attributes": l.attributes or {},
                }
                for l in logs
            ],
            "timeline_events": [
                {
                    "id": str(e.id),
                    "event_type": e.event_type,
                    "message": e.body,
                    "created_at": e.created_at.isoformat(),
                }
                for e in timeline_events
            ],
            "related_incidents": [
                {
                    "id": str(i.id),
                    "title": i.title,
                    "severity": getattr(i.severity, "value", str(i.severity)),
                    "status": getattr(i.status, "value", str(i.status)),
                    "detected_at": i.detected_at.isoformat(),
                }
                for i in related_incidents
            ],
        }

        # Step 4: Execute LangGraph
        graph = build_investigation_graph(llm_client)
        final_state = await graph.ainvoke(initial_state)

        # Step 5: Persist results
        investigation.summary = final_state.get("summary")
        investigation.confidence_score = final_state.get("confidence_score")
        investigation.status = InvestigationStatus.COMPLETED
        investigation.completed_at = utc_now()
        investigation.error_message = None

        # Evidence
        for ev in final_state.get("evidence", []):
            try:
                ev_type = EvidenceType(ev.get("evidence_type", "log"))
            except ValueError:
                ev_type = EvidenceType.LOG

            db.add(
                InvestigationEvidence(
                    workspace_id=investigation.workspace_id,
                    investigation_id=investigation.id,
                    evidence_type=ev_type,
                    source_id=str(ev.get("source_id", "source"))[:128],
                    title=str(ev.get("title", "Evidence"))[:255],
                    summary=str(ev.get("summary", "")),
                    data=ev.get("data", {}),
                )
            )

        # Hypotheses
        for hyp in final_state.get("hypotheses", []):
            db.add(
                InvestigationHypothesis(
                    workspace_id=investigation.workspace_id,
                    investigation_id=investigation.id,
                    title=str(hyp.get("title", "Hypothesis"))[:255],
                    description=str(hyp.get("description", "")),
                    likelihood=str(hyp.get("likelihood", "medium"))[:32],
                    confidence_score=float(hyp.get("confidence_score", 0.5)),
                    supporting_evidence=hyp.get("supporting_evidence", []),
                    contradicting_evidence=hyp.get("contradicting_evidence", []),
                    is_primary=bool(hyp.get("is_primary", False)),
                )
            )

        # Recommendations
        for rec in final_state.get("recommendations", []):
            db.add(
                InvestigationRecommendation(
                    workspace_id=investigation.workspace_id,
                    investigation_id=investigation.id,
                    title=str(rec.get("title", "Recommendation"))[:255],
                    description=str(rec.get("description", "")),
                    action_type=str(rec.get("action_type", "mitigation"))[:64],
                    priority=str(rec.get("priority", "P2"))[:16],
                    rationale=str(rec.get("rationale", "")),
                    status=RecommendationStatus.PENDING_APPROVAL,
                )
            )

        # Timeline event on incident
        conf_pct = int((investigation.confidence_score or 0.75) * 100)
        db.add(
            IncidentEvent(
                workspace_id=investigation.workspace_id,
                incident_id=incident.id,
                actor_user_id=investigation.created_by_user_id,
                event_type="investigation.completed",
                body=f"AI Investigation completed with {conf_pct}% confidence.",
                payload={
                    "investigation_id": str(investigation.id),
                    "confidence_score": investigation.confidence_score,
                },
            )
        )

        db.commit()
        db.refresh(investigation)
        return investigation

    except Exception as exc:
        db.rollback()
        investigation.status = InvestigationStatus.FAILED
        investigation.error_message = f"Workflow failed: {str(exc)}"
        investigation.completed_at = utc_now()
        db.add(investigation)
        db.commit()
        db.refresh(investigation)
        return investigation


async def start_investigation(
    db: Session,
    workspace_id: UUID,
    incident_id: UUID,
    user_id: UUID | None,
) -> Investigation:
    """Creates a new investigation and triggers the workflow."""
    incident = db.scalar(
        select(Incident).where(
            Incident.workspace_id == workspace_id,
            Incident.id == incident_id,
        )
    )
    if not incident:
        raise HTTPException(
            status_code=404,
            detail={"code": "incident_not_found", "message": "Incident not found in this workspace."},
        )

    investigation = Investigation(
        workspace_id=workspace_id,
        incident_id=incident_id,
        status=InvestigationStatus.PENDING,
        created_by_user_id=user_id,
    )
    db.add(investigation)

    # Timeline event
    db.add(
        IncidentEvent(
            workspace_id=workspace_id,
            incident_id=incident.id,
            actor_user_id=user_id,
            event_type="investigation.started",
            body="AI Investigation initialized.",
            payload={"investigation_id": str(investigation.id)},
        )
    )

    db.commit()
    db.refresh(investigation)

    return await run_investigation_workflow(db, investigation, incident)


def get_investigation_detail(
    db: Session,
    workspace_id: UUID,
    investigation_id: UUID,
) -> Investigation | None:
    """Retrieves full investigation with eager loaded relations."""
    stmt = (
        select(Investigation)
        .where(
            Investigation.workspace_id == workspace_id,
            Investigation.id == investigation_id,
        )
        .options(
            selectinload(Investigation.evidence),
            selectinload(Investigation.hypotheses),
            selectinload(Investigation.recommendations),
            selectinload(Investigation.incident),
        )
    )
    return db.scalar(stmt)


def list_investigations(
    db: Session,
    workspace_id: UUID,
    incident_id: UUID | None = None,
    status: InvestigationStatus | None = None,
    cursor: str | None = None,
    limit: int = 20,
) -> tuple[list[Investigation], str | None]:
    """Lists investigations with filtering and cursor-based pagination."""
    limit = max(1, min(limit, 100))
    query = (
        select(Investigation)
        .where(Investigation.workspace_id == workspace_id)
        .options(
            selectinload(Investigation.incident),
            selectinload(Investigation.evidence),
            selectinload(Investigation.hypotheses),
            selectinload(Investigation.recommendations),
        )
    )

    if incident_id:
        query = query.where(Investigation.incident_id == incident_id)
    if status:
        query = query.where(Investigation.status == status)

    if cursor:
        cursor_created_at, cursor_id = decode_investigation_cursor(cursor)
        query = query.where(
            (Investigation.created_at < cursor_created_at)
            | (
                (Investigation.created_at == cursor_created_at)
                & (Investigation.id < cursor_id)
            )
        )

    query = query.order_by(desc(Investigation.created_at), desc(Investigation.id)).limit(limit + 1)
    results = db.scalars(query).all()

    has_more = len(results) > limit
    items = results[:limit]
    next_cursor = encode_investigation_cursor(items[-1]) if has_more and items else None

    return items, next_cursor


async def retry_investigation(
    db: Session,
    workspace_id: UUID,
    investigation_id: UUID,
    user_id: UUID | None,
) -> Investigation:
    """Retries a failed or incomplete investigation."""
    investigation = get_investigation_detail(db, workspace_id, investigation_id)
    if not investigation:
        raise HTTPException(
            status_code=404,
            detail={"code": "investigation_not_found", "message": "Investigation not found."},
        )

    incident = db.scalar(
        select(Incident).where(
            Incident.workspace_id == workspace_id,
            Incident.id == investigation.incident_id,
        )
    )
    if not incident:
        raise HTTPException(
            status_code=404,
            detail={"code": "incident_not_found", "message": "Associated incident not found."},
        )

    # Clear prior sub-records
    investigation.evidence.clear()
    investigation.hypotheses.clear()
    investigation.recommendations.clear()
    investigation.status = InvestigationStatus.PENDING
    investigation.error_message = None
    investigation.confidence_score = None
    investigation.summary = None
    investigation.started_at = None
    investigation.completed_at = None
    db.commit()

    return await run_investigation_workflow(db, investigation, incident)


def review_recommendation(
    db: Session,
    workspace_id: UUID,
    investigation_id: UUID,
    recommendation_id: UUID,
    user_id: UUID,
    status: RecommendationStatus,
    review_notes: str | None = None,
) -> InvestigationRecommendation:
    """Approves or rejects an investigation recommendation."""
    rec = db.scalar(
        select(InvestigationRecommendation).where(
            InvestigationRecommendation.workspace_id == workspace_id,
            InvestigationRecommendation.investigation_id == investigation_id,
            InvestigationRecommendation.id == recommendation_id,
        )
    )
    if not rec:
        raise HTTPException(
            status_code=404,
            detail={"code": "recommendation_not_found", "message": "Recommendation not found."},
        )

    rec.status = status
    rec.reviewed_by_user_id = user_id
    rec.reviewed_at = utc_now()
    rec.review_notes = review_notes

    # Add timeline event to incident
    inv = db.scalar(
        select(Investigation).where(
            Investigation.workspace_id == workspace_id,
            Investigation.id == investigation_id,
        )
    )
    if inv:
        db.add(
            IncidentEvent(
                workspace_id=workspace_id,
                incident_id=inv.incident_id,
                actor_user_id=user_id,
                event_type=f"recommendation.{status.value}",
                body=f"Recommendation '{rec.title}' was marked as {status.value.replace('_', ' ')}.",
                payload={
                    "investigation_id": str(investigation_id),
                    "recommendation_id": str(recommendation_id),
                    "status": status.value,
                    "review_notes": review_notes,
                },
            )
        )

    db.commit()
    db.refresh(rec)
    return rec
