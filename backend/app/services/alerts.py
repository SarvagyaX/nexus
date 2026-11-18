"""Alert evaluation engine, lifecycle transitions, grouping, and incident escalation."""

import asyncio
import base64
import binascii
from collections import defaultdict
from datetime import datetime, timedelta, timezone
import hashlib
import json
import logging
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import desc, func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.models.alert import (
    Alert,
    AlertEvent,
    AlertRule,
    AlertRuleCondition,
    AlertStatus,
    utc_now,
)
from app.models.identity import User
from app.models.incident import (
    Incident,
    IncidentEvent,
    IncidentSeverity,
    IncidentStatus,
    SeveritySource,
)
from app.models.log import LogRecord, LogSeverity
from app.models.service import Service
from app.services.alert_bus import broadcast_alert_event
from app.services.incidents import next_reference

logger = logging.getLogger(__name__)


def _to_utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _invalid_cursor():
    raise HTTPException(
        status_code=400,
        detail={"code": "invalid_cursor", "message": "The pagination cursor is invalid."},
    )


def decode_alert_cursor(cursor: str | None) -> tuple[datetime, UUID] | None:
    if cursor is None:
        return None
    try:
        if not cursor or len(cursor) > 512:
            raise ValueError
        data = json.loads(
            base64.b64decode(cursor + "=" * (-len(cursor) % 4), altchars=b"-_", validate=True)
        )
        if not isinstance(data, dict) or set(data) != {"last_seen_at", "id"}:
            raise ValueError
        last_seen_at = datetime.fromisoformat(data["last_seen_at"])
        if last_seen_at.tzinfo is None:
            raise ValueError
        return last_seen_at, UUID(data["id"])
    except (ValueError, TypeError, KeyError, binascii.Error, json.JSONDecodeError):
        _invalid_cursor()


def encode_alert_cursor(alert: Alert) -> str:
    last_seen_at = alert.last_seen_at
    if last_seen_at.tzinfo is None:
        last_seen_at = last_seen_at.replace(tzinfo=timezone.utc)
    payload = json.dumps(
        {"last_seen_at": last_seen_at.isoformat(), "id": str(alert.id)},
        separators=(",", ":"),
    )
    return base64.b64encode(payload.encode("utf-8"), altchars=b"-_").decode("ascii").rstrip("=")


def compute_alert_fingerprint(
    workspace_id: UUID,
    rule_id: UUID | None,
    service_id: UUID | None,
    condition_type: str,
) -> str:
    """Produces a deterministic fingerprint to deduplicate recurring operational alerts."""
    seed = f"{workspace_id}:{rule_id or 'global'}:{service_id or 'workspace'}:{condition_type}"
    return hashlib.sha256(seed.encode("utf-8")).hexdigest()[:32]


# ============================================================================
# Rule Evaluation & Alert Generation Engine
# ============================================================================

def evaluate_alert_rules(
    db: Session,
    workspace_id: UUID,
    service_id: UUID | None = None,
) -> list[Alert]:
    """Evaluates enabled alert rules against ingested logs and generates or updates alerts."""
    now = utc_now()

    # Query enabled rules for this workspace
    rule_query = select(AlertRule).where(
        AlertRule.workspace_id == workspace_id,
        AlertRule.enabled == True,  # noqa: E712
    )
    if service_id is not None:
        rule_query = rule_query.where(
            or_(AlertRule.service_id == service_id, AlertRule.service_id.is_(None))
        )

    rules = db.scalars(rule_query).all()
    if not rules:
        return []

    triggered_alerts: list[Alert] = []

    for rule in rules:
        window_start = now - timedelta(minutes=rule.window_minutes)
        target_service_id = rule.service_id or service_id

        # 1. Evaluate condition
        is_triggered = False
        metric_value = 0.0
        triggering_logs_sample: list[dict] = []

        if rule.condition_type == AlertRuleCondition.ERROR_COUNT:
            log_q = select(LogRecord).where(
                LogRecord.workspace_id == workspace_id,
                LogRecord.timestamp >= window_start,
                LogRecord.timestamp <= now,
                LogRecord.severity.in_([LogSeverity.ERROR, LogSeverity.FATAL]),
            )
            if target_service_id:
                log_q = log_q.where(LogRecord.service_id == target_service_id)

            matching_logs = db.scalars(log_q.order_by(LogRecord.timestamp.desc()).limit(20)).all()
            count = db.scalar(
                select(func.count(LogRecord.id)).where(
                    LogRecord.workspace_id == workspace_id,
                    LogRecord.timestamp >= window_start,
                    LogRecord.timestamp <= now,
                    LogRecord.severity.in_([LogSeverity.ERROR, LogSeverity.FATAL]),
                    *([LogRecord.service_id == target_service_id] if target_service_id else []),
                )
            ) or 0
            metric_value = float(count)
            if metric_value >= rule.threshold:
                is_triggered = True
                triggering_logs_sample = [
                    {
                        "id": str(l.id),
                        "message": l.message[:120],
                        "severity": str(l.severity),
                        "timestamp": l.timestamp.isoformat(),
                    }
                    for l in matching_logs[:3]
                ]

        elif rule.condition_type == AlertRuleCondition.FATAL_LOG:
            log_q = select(LogRecord).where(
                LogRecord.workspace_id == workspace_id,
                LogRecord.timestamp >= window_start,
                LogRecord.timestamp <= now,
                LogRecord.severity == LogSeverity.FATAL,
            )
            if target_service_id:
                log_q = log_q.where(LogRecord.service_id == target_service_id)

            matching_logs = db.scalars(log_q.order_by(LogRecord.timestamp.desc()).limit(10)).all()
            fatal_count = len(matching_logs)
            metric_value = float(fatal_count)
            if metric_value >= rule.threshold or (rule.threshold <= 1.0 and fatal_count > 0):
                is_triggered = True
                triggering_logs_sample = [
                    {
                        "id": str(l.id),
                        "message": l.message[:120],
                        "severity": str(l.severity),
                        "timestamp": l.timestamp.isoformat(),
                    }
                    for l in matching_logs[:3]
                ]

        elif rule.condition_type == AlertRuleCondition.ERROR_RATE:
            total_logs = db.scalar(
                select(func.count(LogRecord.id)).where(
                    LogRecord.workspace_id == workspace_id,
                    LogRecord.timestamp >= window_start,
                    LogRecord.timestamp <= now,
                    *([LogRecord.service_id == target_service_id] if target_service_id else []),
                )
            ) or 0

            error_logs = db.scalar(
                select(func.count(LogRecord.id)).where(
                    LogRecord.workspace_id == workspace_id,
                    LogRecord.timestamp >= window_start,
                    LogRecord.timestamp <= now,
                    LogRecord.severity.in_([LogSeverity.ERROR, LogSeverity.FATAL]),
                    *([LogRecord.service_id == target_service_id] if target_service_id else []),
                )
            ) or 0

            if total_logs >= 5:
                rate_pct = (error_logs / total_logs) * 100.0
                metric_value = round(rate_pct, 1)
                if metric_value >= rule.threshold:
                    is_triggered = True

        elif rule.condition_type == AlertRuleCondition.REPEATED_FAILURES:
            # Group errors by message prefix
            errors = db.scalars(
                select(LogRecord)
                .where(
                    LogRecord.workspace_id == workspace_id,
                    LogRecord.timestamp >= window_start,
                    LogRecord.timestamp <= now,
                    LogRecord.severity.in_([LogSeverity.ERROR, LogSeverity.FATAL]),
                    *([LogRecord.service_id == target_service_id] if target_service_id else []),
                )
                .limit(50)
            ).all()

            pattern_counts: dict[str, int] = defaultdict(int)
            for l in errors:
                prefix = l.message[:40]
                pattern_counts[prefix] += 1

            max_reps = max(pattern_counts.values()) if pattern_counts else 0
            metric_value = float(max_reps)
            if metric_value >= rule.threshold:
                is_triggered = True

        # 2. Handle triggered condition
        if is_triggered:
            fp = compute_alert_fingerprint(
                workspace_id=workspace_id,
                rule_id=rule.id,
                service_id=target_service_id,
                condition_type=rule.condition_type.value,
            )

            # Check for existing active alert
            active_alert = db.scalar(
                select(Alert)
                .where(
                    Alert.workspace_id == workspace_id,
                    Alert.fingerprint == fp,
                    Alert.status.in_([AlertStatus.OPEN, AlertStatus.ACKNOWLEDGED, AlertStatus.SNOOZED]),
                )
                .order_by(Alert.last_seen_at.desc())
            )

            if active_alert:
                # If snoozed and snooze expired, reopen
                if active_alert.status == AlertStatus.SNOOZED and active_alert.snoozed_until:
                    snooze_limit = _to_utc(active_alert.snoozed_until)
                    if snooze_limit and snooze_limit <= now:
                        active_alert.status = AlertStatus.OPEN
                        active_alert.snoozed_until = None
                        db.add(
                            AlertEvent(
                                workspace_id=workspace_id,
                                alert_id=active_alert.id,
                                event_type="alert.reopened_from_snooze",
                                message="Alert snooze window elapsed while condition is still triggering.",
                            )
                        )

                # Check cooldown: if cooldown elapsed, record new occurrence
                last_seen = _to_utc(active_alert.last_seen_at) or now
                time_since_last = (now - last_seen).total_seconds()
                cooldown_sec = rule.cooldown_minutes * 60

                active_alert.last_seen_at = now
                active_alert.occurrence_count += 1
                active_alert.data = {
                    "last_metric_value": metric_value,
                    "threshold": rule.threshold,
                    "window_minutes": rule.window_minutes,
                    "sample_logs": triggering_logs_sample,
                }

                db.add(
                    AlertEvent(
                        workspace_id=workspace_id,
                        alert_id=active_alert.id,
                        event_type="alert.occurrence_incremented",
                        message=f"Condition '{rule.condition_type.value}' triggered again with value {metric_value}.",
                        payload={"metric_value": metric_value, "occurrence_count": active_alert.occurrence_count},
                    )
                )
                triggered_alerts.append(active_alert)

            else:
                # No active alert exists, create new alert
                service_obj = (
                    db.scalar(select(Service).where(Service.workspace_id == workspace_id, Service.id == target_service_id))
                    if target_service_id
                    else None
                )
                svc_title = f" [{service_obj.name}]" if service_obj else ""

                new_alert = Alert(
                    workspace_id=workspace_id,
                    rule_id=rule.id,
                    service_id=target_service_id,
                    fingerprint=fp,
                    title=f"[{rule.severity.value}] {rule.name}{svc_title}",
                    description=(
                        f"Rule '{rule.name}' triggered. Condition '{rule.condition_type.value}' reached {metric_value} "
                        f"(threshold: {rule.threshold}) over {rule.window_minutes}m window."
                    ),
                    severity=rule.severity,
                    status=AlertStatus.OPEN,
                    occurrence_count=1,
                    first_seen_at=now,
                    last_seen_at=now,
                    data={
                        "metric_value": metric_value,
                        "threshold": rule.threshold,
                        "window_minutes": rule.window_minutes,
                        "sample_logs": triggering_logs_sample,
                    },
                )
                db.add(new_alert)
                db.flush()

                db.add(
                    AlertEvent(
                        workspace_id=workspace_id,
                        alert_id=new_alert.id,
                        event_type="alert.created",
                        message=f"Alert generated from rule '{rule.name}'.",
                        payload={"metric_value": metric_value, "severity": rule.severity.value},
                    )
                )
                triggered_alerts.append(new_alert)

    db.commit()

    # Trigger notifications and escalation for newly created alerts
    for a in triggered_alerts:
        if a.occurrence_count == 1:
            try:
                from app.models.identity import Membership
                from app.models.notification import NotificationCategory
                from app.services.escalation import trigger_escalation
                from app.services.notifications import dispatch_notification

                trigger_escalation(db, workspace_id, alert=a)

                member_user_ids = db.scalars(
                    select(Membership.user_id).where(Membership.workspace_id == workspace_id)
                ).all()
                for uid in member_user_ids:
                    dispatch_notification(
                        db=db,
                        workspace_id=workspace_id,
                        user_id=uid,
                        category=NotificationCategory.ALERT,
                        severity=a.severity.value,
                        title=a.title,
                        message=a.description or a.title,
                        link=f"/alerts/{a.id}",
                        entity_type="alert",
                        entity_id=a.id,
                        dedup_key=f"alert-create-{a.id}-{uid}",
                    )
            except Exception as exc:
                logger.warning(f"Error dispatching alert notification/escalation: {exc}")

            # Trigger matching automated playbooks for newly created alert
            try:
                from app.models.playbook import PlaybookTriggerType
                from app.services.playbook_engine import (
                    create_execution,
                    find_matching_playbooks,
                    run_execution_steps,
                )

                matching_pbs = find_matching_playbooks(
                    db=db,
                    workspace_id=workspace_id,
                    trigger_type=PlaybookTriggerType.ALERT_CREATED,
                    severity=a.severity.value,
                    service_id=a.service_id,
                )
                for pb in matching_pbs:
                    exec_record = create_execution(
                        db=db,
                        workspace_id=workspace_id,
                        playbook_id=pb.id,
                        trigger_type=PlaybookTriggerType.ALERT_CREATED,
                        trigger_event_id=f"alert-created-{a.id}",
                        alert_id=a.id,
                        context={"alert_title": a.title, "severity": a.severity.value, "service_id": str(a.service_id)},
                    )
                    try:
                        loop = asyncio.get_running_loop()
                        loop.create_task(run_execution_steps(db, exec_record.id))
                    except RuntimeError:
                        asyncio.run(run_execution_steps(db, exec_record.id))
            except Exception as pb_exc:
                logger.warning(f"Error triggering playbooks for alert {a.id}: {pb_exc}")

    # Broadcast generated/updated alerts to real-time bus
    for a in triggered_alerts:
        try:
            loop = asyncio.get_running_loop()
            if loop.is_running():
                asyncio.create_task(
                    broadcast_alert_event(
                        workspace_id=workspace_id,
                        event_type="alert.created" if a.occurrence_count == 1 else "alert.updated",
                        alert_data={"id": str(a.id), "title": a.title, "severity": a.severity.value, "status": a.status.value},
                    )
                )
        except (RuntimeError, Exception):
            pass

    return triggered_alerts


# ============================================================================
# Alert Lifecycle Actions
# ============================================================================

def acknowledge_alert(
    db: Session,
    workspace_id: UUID,
    alert_id: UUID,
    user_id: UUID,
    note: str | None = None,
) -> Alert:
    """Acknowledges an open or snoozed alert."""
    alert = db.scalar(
        select(Alert).where(Alert.workspace_id == workspace_id, Alert.id == alert_id)
    )
    if not alert:
        raise HTTPException(status_code=404, detail={"code": "alert_not_found", "message": "Alert was not found."})

    alert.status = AlertStatus.ACKNOWLEDGED
    alert.acknowledged_at = utc_now()
    alert.acknowledged_by_user_id = user_id

    db.add(
        AlertEvent(
            workspace_id=workspace_id,
            alert_id=alert.id,
            actor_user_id=user_id,
            event_type="alert.acknowledged",
            message=note or "Alert acknowledged by responder.",
            payload={"acknowledged_by": str(user_id)},
        )
    )

    db.commit()
    db.refresh(alert)
    try:
        from app.services.escalation import acknowledge_escalation_for_entity
        acknowledge_escalation_for_entity(db, workspace_id, "alert", alert.id, user_id)
    except Exception as exc:
        logger.warning(f"Error updating escalation on alert acknowledge: {exc}")
    return alert


def snooze_alert(
    db: Session,
    workspace_id: UUID,
    alert_id: UUID,
    user_id: UUID,
    duration_minutes: int,
) -> Alert:
    """Snoozes an alert for a specified duration."""
    alert = db.scalar(
        select(Alert).where(Alert.workspace_id == workspace_id, Alert.id == alert_id)
    )
    if not alert:
        raise HTTPException(status_code=404, detail={"code": "alert_not_found", "message": "Alert was not found."})

    duration_minutes = max(1, min(duration_minutes, 10080))
    snooze_until = utc_now() + timedelta(minutes=duration_minutes)

    alert.status = AlertStatus.SNOOZED
    alert.snoozed_until = snooze_until

    db.add(
        AlertEvent(
            workspace_id=workspace_id,
            alert_id=alert.id,
            actor_user_id=user_id,
            event_type="alert.snoozed",
            message=f"Alert snoozed for {duration_minutes} minutes.",
            payload={"snoozed_until": snooze_until.isoformat(), "duration_minutes": duration_minutes},
        )
    )

    db.commit()
    db.refresh(alert)
    return alert


def resolve_alert(
    db: Session,
    workspace_id: UUID,
    alert_id: UUID,
    user_id: UUID,
    resolution_note: str | None = None,
) -> Alert:
    """Resolves an alert with an optional resolution note."""
    alert = db.scalar(
        select(Alert).where(Alert.workspace_id == workspace_id, Alert.id == alert_id)
    )
    if not alert:
        raise HTTPException(status_code=404, detail={"code": "alert_not_found", "message": "Alert was not found."})

    alert.status = AlertStatus.RESOLVED
    alert.resolved_at = utc_now()
    alert.resolved_by_user_id = user_id
    alert.resolution_note = resolution_note

    db.add(
        AlertEvent(
            workspace_id=workspace_id,
            alert_id=alert.id,
            actor_user_id=user_id,
            event_type="alert.resolved",
            message=resolution_note or "Alert marked as resolved.",
            payload={"resolved_by": str(user_id)},
        )
    )

    db.commit()
    db.refresh(alert)
    try:
        from app.services.escalation import resolve_escalation_for_entity
        resolve_escalation_for_entity(db, workspace_id, "alert", alert.id, user_id)
    except Exception as exc:
        logger.warning(f"Error updating escalation on alert resolve: {exc}")
    return alert


def reopen_alert(
    db: Session,
    workspace_id: UUID,
    alert_id: UUID,
    user_id: UUID,
) -> Alert:
    """Reopens a resolved or snoozed alert."""
    alert = db.scalar(
        select(Alert).where(Alert.workspace_id == workspace_id, Alert.id == alert_id)
    )
    if not alert:
        raise HTTPException(status_code=404, detail={"code": "alert_not_found", "message": "Alert was not found."})

    alert.status = AlertStatus.OPEN
    alert.snoozed_until = None
    alert.resolved_at = None
    alert.resolved_by_user_id = None
    alert.resolution_note = None

    db.add(
        AlertEvent(
            workspace_id=workspace_id,
            alert_id=alert.id,
            actor_user_id=user_id,
            event_type="alert.reopened",
            message="Alert manually reopened by user.",
            payload={"reopened_by": str(user_id)},
        )
    )

    db.commit()
    db.refresh(alert)
    try:
        from app.services.escalation import trigger_escalation
        trigger_escalation(db, workspace_id, alert=alert)
    except Exception as exc:
        logger.warning(f"Error triggering escalation on alert reopen: {exc}")
    return alert


# ============================================================================
# Incident Creation & Linking
# ============================================================================

def create_incident_from_alert(
    db: Session,
    workspace_id: UUID,
    alert_id: UUID,
    user_id: UUID,
    title_override: str | None = None,
    summary_override: str | None = None,
    severity_override: IncidentSeverity | None = None,
) -> tuple[Incident, Alert]:
    """Escalates an operational alert into an official NEXUS Incident."""
    alert = db.scalar(
        select(Alert).where(Alert.workspace_id == workspace_id, Alert.id == alert_id)
    )
    if not alert:
        raise HTTPException(status_code=404, detail={"code": "alert_not_found", "message": "Alert was not found."})

    # If alert already has an associated incident, return it
    if alert.incident_id:
        existing = db.scalar(
            select(Incident).where(Incident.workspace_id == workspace_id, Incident.id == alert.incident_id)
        )
        if existing:
            return existing, alert

    # Target service resolution
    service_id = alert.service_id
    if not service_id:
        first_svc = db.scalar(select(Service).where(Service.workspace_id == workspace_id).order_by(Service.created_at))
        if not first_svc:
            raise HTTPException(
                status_code=400,
                detail={"code": "no_service_available", "message": "At least one service must exist in the workspace to create an incident."},
            )
        service_id = first_svc.id

    # Reference counter
    ref = next_reference(db, workspace_id)
    sev = severity_override or alert.severity

    incident = Incident(
        workspace_id=workspace_id,
        service_id=service_id,
        reference=ref,
        title=title_override or f"Escalated Alert: {alert.title}",
        summary=summary_override or alert.description or f"Triggered from alert {alert.title}",
        severity=sev,
        status=IncidentStatus.INVESTIGATING,
        severity_source=SeveritySource.AGENT,
        detected_at=alert.first_seen_at,
        created_by_user_id=user_id,
    )
    db.add(incident)
    db.flush()

    # Link incident to alert
    alert.incident_id = incident.id
    alert.status = AlertStatus.ACKNOWLEDGED
    alert.acknowledged_at = utc_now()
    alert.acknowledged_by_user_id = user_id

    # Append timeline event on incident
    db.add(
        IncidentEvent(
            workspace_id=workspace_id,
            incident_id=incident.id,
            actor_user_id=user_id,
            event_type="incident.created_from_alert",
            body=f"Incident escalated from Alert '{alert.title}' (occurrence count: {alert.occurrence_count}).",
            payload={"alert_id": str(alert.id), "fingerprint": alert.fingerprint},
        )
    )

    # Append event on alert
    db.add(
        AlertEvent(
            workspace_id=workspace_id,
            alert_id=alert.id,
            actor_user_id=user_id,
            event_type="alert.incident_created",
            message=f"Created incident {incident.reference} from this alert.",
            payload={"incident_id": str(incident.id), "incident_reference": incident.reference},
        )
    )

    db.commit()

    try:
        from app.services.escalation import trigger_escalation
        trigger_escalation(db, workspace_id, incident=incident)
    except Exception as exc:
        logger.warning(f"Error triggering escalation for escalated incident: {exc}")

    db.refresh(incident)
    db.refresh(alert)
    return incident, alert


def link_incident_to_alert(
    db: Session,
    workspace_id: UUID,
    alert_id: UUID,
    incident_id: UUID,
    user_id: UUID,
) -> Alert:
    """Links an existing incident to an alert."""
    alert = db.scalar(select(Alert).where(Alert.workspace_id == workspace_id, Alert.id == alert_id))
    if not alert:
        raise HTTPException(status_code=404, detail={"code": "alert_not_found", "message": "Alert not found."})

    incident = db.scalar(select(Incident).where(Incident.workspace_id == workspace_id, Incident.id == incident_id))
    if not incident:
        raise HTTPException(status_code=404, detail={"code": "incident_not_found", "message": "Incident not found."})

    alert.incident_id = incident.id

    db.add(
        AlertEvent(
            workspace_id=workspace_id,
            alert_id=alert.id,
            actor_user_id=user_id,
            event_type="alert.incident_linked",
            message=f"Linked to existing incident {incident.reference}.",
            payload={"incident_id": str(incident.id), "incident_reference": incident.reference},
        )
    )

    db.commit()
    db.refresh(alert)
    return alert


# ============================================================================
# Querying, Grouping & Stats
# ============================================================================

def list_alerts(
    db: Session,
    workspace_id: UUID,
    status: AlertStatus | None = None,
    severity: IncidentSeverity | None = None,
    service_id: UUID | None = None,
    search: str | None = None,
    cursor: str | None = None,
    limit: int = 25,
) -> tuple[list[Alert], str | None]:
    """Retrieves workspace alerts with filtering and cursor pagination."""
    limit = max(1, min(limit, 100))
    query = (
        select(Alert)
        .where(Alert.workspace_id == workspace_id)
        .options(
            selectinload(Alert.service),
            selectinload(Alert.rule),
            selectinload(Alert.incident),
        )
    )

    if status:
        query = query.where(Alert.status == status)
    if severity:
        query = query.where(Alert.severity == severity)
    if service_id:
        query = query.where(Alert.service_id == service_id)
    if search:
        term = f"%{search.strip()}%"
        query = query.where(or_(Alert.title.ilike(term), Alert.description.ilike(term)))

    if cursor:
        cur_ts, cur_id = decode_alert_cursor(cursor)
        query = query.where(
            (Alert.last_seen_at < cur_ts)
            | ((Alert.last_seen_at == cur_ts) & (Alert.id < cur_id))
        )

    query = query.order_by(desc(Alert.last_seen_at), desc(Alert.id)).limit(limit + 1)
    results = db.scalars(query).all()

    has_more = len(results) > limit
    items = results[:limit]
    next_cursor = encode_alert_cursor(items[-1]) if has_more and items else None

    return items, next_cursor


def get_alert_detail(
    db: Session,
    workspace_id: UUID,
    alert_id: UUID,
) -> Alert | None:
    """Returns alert with eager loaded relations and event timeline."""
    stmt = (
        select(Alert)
        .where(Alert.workspace_id == workspace_id, Alert.id == alert_id)
        .options(
            selectinload(Alert.service),
            selectinload(Alert.rule),
            selectinload(Alert.incident),
            selectinload(Alert.events).selectinload(AlertEvent.actor),
        )
    )
    return db.scalar(stmt)


def get_alert_stats(db: Session, workspace_id: UUID) -> dict:
    """Computes operational alert KPIs."""
    alerts = db.scalars(select(Alert).where(Alert.workspace_id == workspace_id)).all()
    active_rules = db.scalar(
        select(func.count(AlertRule.id)).where(AlertRule.workspace_id == workspace_id, AlertRule.enabled == True)  # noqa: E712
    ) or 0

    open_count = sum(1 for a in alerts if a.status == AlertStatus.OPEN)
    crit_count = sum(1 for a in alerts if a.status in {AlertStatus.OPEN, AlertStatus.ACKNOWLEDGED} and a.severity in {IncidentSeverity.SEV1, IncidentSeverity.SEV2})
    ack_count = sum(1 for a in alerts if a.status == AlertStatus.ACKNOWLEDGED)
    snooze_count = sum(1 for a in alerts if a.status == AlertStatus.SNOOZED)

    sev_dist: dict[str, int] = defaultdict(int)
    for a in alerts:
        if a.status in {AlertStatus.OPEN, AlertStatus.ACKNOWLEDGED}:
            sev_dist[a.severity.value] += 1

    return {
        "total_open": open_count,
        "total_critical": crit_count,
        "total_acknowledged": ack_count,
        "total_snoozed": snooze_count,
        "active_rules_count": active_rules,
        "severity_distribution": dict(sev_dist),
    }


def get_grouped_alerts(
    db: Session,
    workspace_id: UUID,
    status: AlertStatus | None = None,
) -> list[dict]:
    """Groups alerts by service and severity to reduce alert noise and surface clustered outages."""
    query = (
        select(Alert)
        .where(Alert.workspace_id == workspace_id)
        .options(
            selectinload(Alert.service),
            selectinload(Alert.rule),
            selectinload(Alert.incident),
        )
        .order_by(desc(Alert.last_seen_at))
    )
    if status:
        query = query.where(Alert.status == status)

    all_alerts = db.scalars(query).all()

    # Group by (service_id, severity, status)
    grouped: dict[tuple, list[Alert]] = defaultdict(list)
    for a in all_alerts:
        key = (a.service_id, a.severity, a.status)
        grouped[key].append(a)

    result = []
    for (svc_id, sev, st), items in grouped.items():
        latest = items[0]
        svc_name = latest.service.name if latest.service else "Workspace-Wide"
        group_key = f"{svc_id or 'workspace'}_{sev.value}_{st.value}"
        total_occurrences = sum(i.occurrence_count for i in items)

        result.append({
            "group_key": group_key,
            "service_id": svc_id,
            "service_name": svc_name,
            "severity": sev,
            "status": st,
            "alert_count": len(items),
            "total_occurrences": total_occurrences,
            "latest_alert": latest,
            "alerts": items,
        })

    return result
