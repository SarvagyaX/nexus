"""Incident and alert escalation policies, due-step evaluation, and state transitions."""

from datetime import datetime, timedelta, timezone
import logging
from uuid import UUID, uuid4

from fastapi import HTTPException
from sqlalchemy import desc, or_, select
from sqlalchemy.orm import Session, selectinload

from app.core.logging import sanitize_text
from app.models.alert import Alert, AlertStatus
from app.models.identity import User
from app.models.incident import Incident, IncidentStatus
from app.models.notification import (
    EscalationExecution,
    EscalationExecutionStatus,
    EscalationPolicy,
    EscalationStep,
    EscalationTargetType,
    NotificationCategory,
    NotificationDeliveryChannel,
    OnCallSchedule,
    utc_now,
)
from app.services.notifications import WebhookProvider, _severity_rank, dispatch_notification
from app.services.on_call import get_schedule, resolve_current_on_call

logger = logging.getLogger(__name__)


# ============================================================================
# Policy CRUD
# ============================================================================

def list_policies(db: Session, workspace_id: UUID) -> list[EscalationPolicy]:
    """Lists escalation policies in a workspace with their ordered steps."""
    return list(
        db.scalars(
            select(EscalationPolicy)
            .options(selectinload(EscalationPolicy.steps))
            .where(EscalationPolicy.workspace_id == workspace_id)
            .order_by(desc(EscalationPolicy.is_active), desc(EscalationPolicy.created_at))
        ).all()
    )


def get_policy(db: Session, workspace_id: UUID | str, policy_id: UUID | str) -> EscalationPolicy:
    """Gets an escalation policy by ID with steps."""
    ws_id = UUID(str(workspace_id)) if not isinstance(workspace_id, UUID) else workspace_id
    pol_id = UUID(str(policy_id)) if not isinstance(policy_id, UUID) else policy_id
    policy = db.scalar(
        select(EscalationPolicy)
        .options(selectinload(EscalationPolicy.steps))
        .where(
            EscalationPolicy.workspace_id == ws_id,
            EscalationPolicy.id == pol_id,
        )
    )
    if not policy:
        raise HTTPException(
            status_code=404,
            detail={"code": "policy_not_found", "message": "Escalation policy was not found."},
        )
    return policy


def create_policy(
    db: Session,
    workspace_id: UUID,
    name: str,
    steps: list[dict],
    description: str | None = None,
    is_active: bool = True,
    min_severity: str = "SEV2",
    service_id: UUID | None = None,
    repeat_count: int = 0,
) -> EscalationPolicy:
    """Creates a new escalation policy with ordered steps."""
    policy = EscalationPolicy(
        workspace_id=workspace_id,
        name=name,
        description=description,
        is_active=is_active,
        min_severity=min_severity,
        service_id=service_id,
        repeat_count=repeat_count,
        created_at=utc_now(),
        updated_at=utc_now(),
    )
    db.add(policy)
    db.flush()

    for s in steps:
        step = EscalationStep(
            policy_id=policy.id,
            step_number=s["step_number"],
            target_type=s["target_type"],
            target_user_id=s.get("target_user_id"),
            target_schedule_id=s.get("target_schedule_id"),
            target_webhook_url=s.get("target_webhook_url"),
            delay_minutes=s.get("delay_minutes", 15),
        )
        db.add(step)

    db.commit()
    return get_policy(db, workspace_id, policy.id)


def update_policy(
    db: Session,
    workspace_id: UUID,
    policy_id: UUID,
    updates: dict,
    steps: list[dict] | None = None,
) -> EscalationPolicy:
    """Updates an escalation policy and its steps."""
    policy = get_policy(db, workspace_id, policy_id)
    for field, val in updates.items():
        if val is not None and hasattr(policy, field):
            setattr(policy, field, val)
    policy.updated_at = utc_now()

    if steps is not None:
        # Replace steps
        for old_step in list(policy.steps):
            db.delete(old_step)
        db.flush()

        for s in steps:
            step = EscalationStep(
                policy_id=policy.id,
                step_number=s["step_number"],
                target_type=s["target_type"],
                target_user_id=s.get("target_user_id"),
                target_schedule_id=s.get("target_schedule_id"),
                target_webhook_url=s.get("target_webhook_url"),
                delay_minutes=s.get("delay_minutes", 15),
            )
            db.add(step)

    db.commit()
    return get_policy(db, workspace_id, policy.id)


def delete_policy(db: Session, workspace_id: UUID, policy_id: UUID) -> None:
    """Deletes an escalation policy."""
    policy = get_policy(db, workspace_id, policy_id)
    db.delete(policy)
    db.commit()


# ============================================================================
# Step Execution & Dispatch Helper
# ============================================================================

def _execute_step_action(
    db: Session,
    workspace_id: UUID,
    step: EscalationStep,
    title: str,
    message: str,
    severity: str,
    link: str | None = None,
    entity_type: str | None = None,
    entity_id: UUID | None = None,
) -> dict:
    """Executes the action for an escalation step (user, on-call schedule, or webhook)."""
    now_iso = utc_now().isoformat()
    action_record = {
        "step_number": step.step_number,
        "executed_at": now_iso,
        "target_type": step.target_type.value if hasattr(step.target_type, "value") else str(step.target_type),
        "target_id": None,
        "delivery_status": "pending",
        "error": None,
    }

    if step.target_type == EscalationTargetType.USER and step.target_user_id:
        action_record["target_id"] = str(step.target_user_id)
        dispatch_notification(
            db=db,
            workspace_id=workspace_id,
            user_id=step.target_user_id,
            category=NotificationCategory.ALERT if entity_type == "alert" else NotificationCategory.INCIDENT,
            severity=severity,
            title=f"[Escalation Step {step.step_number}] {title}",
            message=message,
            link=link,
            entity_type=entity_type,
            entity_id=entity_id,
            force_in_app=True,
        )
        action_record["delivery_status"] = "sent"

    elif step.target_type == EscalationTargetType.ON_CALL_SCHEDULE and step.target_schedule_id:
        action_record["target_id"] = str(step.target_schedule_id)
        schedule = db.scalar(
            select(OnCallSchedule).where(
                OnCallSchedule.workspace_id == workspace_id,
                OnCallSchedule.id == step.target_schedule_id,
            )
        )
        if schedule:
            on_call_member, _, _ = resolve_current_on_call(schedule)
            if on_call_member and on_call_member.get("user_id"):
                user_id = UUID(on_call_member["user_id"])
                action_record["resolved_user_id"] = str(user_id)
                action_record["resolved_user_name"] = on_call_member.get("name")
                dispatch_notification(
                    db=db,
                    workspace_id=workspace_id,
                    user_id=user_id,
                    category=NotificationCategory.ALERT if entity_type == "alert" else NotificationCategory.INCIDENT,
                    severity=severity,
                    title=f"[On-Call Escalation Step {step.step_number}] {title}",
                    message=f"You are receiving this as the current on-call responder for '{schedule.name}'.\n\n{message}",
                    link=link,
                    entity_type=entity_type,
                    entity_id=entity_id,
                    force_in_app=True,
                )
                action_record["delivery_status"] = "sent"
            else:
                action_record["delivery_status"] = "failed"
                action_record["error"] = "No active on-call responder could be resolved from schedule roster."
        else:
            action_record["delivery_status"] = "failed"
            action_record["error"] = "Target on-call schedule was not found."

    elif step.target_type == EscalationTargetType.WEBHOOK and step.target_webhook_url:
        action_record["target_id"] = step.target_webhook_url
        webhook_payload = {
            "escalation_step": step.step_number,
            "title": title,
            "message": message,
            "severity": severity,
            "link": link,
            "entity_type": entity_type,
            "entity_id": str(entity_id) if entity_id else None,
            "timestamp": now_iso,
        }
        try:
            import httpx
            with httpx.Client(timeout=4.0) as client:
                res = client.post(step.target_webhook_url, json=webhook_payload)
                if 200 <= res.status_code < 300:
                    action_record["delivery_status"] = "sent"
                else:
                    action_record["delivery_status"] = "failed"
                    action_record["error"] = f"Webhook returned HTTP {res.status_code}"
        except Exception as exc:
            action_record["delivery_status"] = "failed"
            action_record["error"] = sanitize_text(f"{exc.__class__.__name__}: {str(exc)}")

    return action_record


# ============================================================================
# Escalation Engine Lifecycle
# ============================================================================

def trigger_escalation(
    db: Session,
    workspace_id: UUID,
    alert: Alert | None = None,
    incident: Incident | None = None,
) -> EscalationExecution | None:
    """Evaluates escalation policies and triggers Step 1 if matching criteria are met."""
    if not alert and not incident:
        return None

    entity_type = "alert" if alert else "incident"
    entity_id = alert.id if alert else incident.id
    severity = alert.severity if alert else incident.severity
    if hasattr(severity, "value"):
        severity = severity.value
    service_id = alert.service_id if alert else incident.service_id

    # 1. Check for existing active execution
    existing = db.scalar(
        select(EscalationExecution).where(
            EscalationExecution.workspace_id == workspace_id,
            or_(
                EscalationExecution.alert_id == (alert.id if alert else None),
                EscalationExecution.incident_id == (incident.id if incident else None),
            ),
            EscalationExecution.status == EscalationExecutionStatus.ACTIVE,
        )
    )
    if existing:
        return existing

    # 2. Find best matching active policy
    query = (
        select(EscalationPolicy)
        .options(selectinload(EscalationPolicy.steps))
        .where(
            EscalationPolicy.workspace_id == workspace_id,
            EscalationPolicy.is_active.is_(True),
        )
    )
    policies = db.scalars(query).all()
    matching_policy = None

    # Priority 1: Service-specific matching policy with severity <= entity severity
    for p in policies:
        if p.service_id and p.service_id == service_id and _severity_rank(severity) >= _severity_rank(p.min_severity):
            matching_policy = p
            break

    # Priority 2: Workspace-wide matching policy (service_id is None)
    if not matching_policy:
        for p in policies:
            if not p.service_id and _severity_rank(severity) >= _severity_rank(p.min_severity):
                matching_policy = p
                break

    if not matching_policy or not matching_policy.steps:
        return None

    # Sort steps by step_number
    steps = sorted(matching_policy.steps, key=lambda s: s.step_number)
    step1 = steps[0]

    title = alert.title if alert else incident.title
    message = alert.message if alert else (incident.summary or "Incident requires responder attention.")
    link = f"/alerts/{alert.id}" if alert else f"/incidents/{incident.id}"

    # Execute Step 1
    action_record = _execute_step_action(
        db=db,
        workspace_id=workspace_id,
        step=step1,
        title=title,
        message=message,
        severity=severity,
        link=link,
        entity_type=entity_type,
        entity_id=entity_id,
    )

    next_at = utc_now() + timedelta(minutes=step1.delay_minutes) if len(steps) > 1 else None

    execution = EscalationExecution(
        workspace_id=workspace_id,
        policy_id=matching_policy.id,
        alert_id=alert.id if alert else None,
        incident_id=incident.id if incident else None,
        current_step_number=step1.step_number,
        status=EscalationExecutionStatus.ACTIVE,
        started_at=utc_now(),
        next_escalation_at=next_at,
        history=[action_record],
        created_at=utc_now(),
        updated_at=utc_now(),
    )
    db.add(execution)
    db.commit()
    db.refresh(execution)
    return execution


def process_due_escalations(db: Session) -> list[EscalationExecution]:
    """Evaluates all active escalation executions whose next step is due."""
    now = utc_now()
    due_executions = list(
        db.scalars(
            select(EscalationExecution)
            .where(
                EscalationExecution.status == EscalationExecutionStatus.ACTIVE,
                EscalationExecution.next_escalation_at <= now,
            )
        ).all()
    )

    processed = []
    for ex in due_executions:
        # Check if underlying alert or incident is already acknowledged or resolved
        is_acked = False
        is_resolved = False

        if ex.alert_id:
            alert = db.scalar(select(Alert).where(Alert.id == ex.alert_id))
            if not alert or alert.status == AlertStatus.RESOLVED:
                is_resolved = True
            elif alert.status in (AlertStatus.ACKNOWLEDGED, AlertStatus.SNOOZED):
                is_acked = True
                ex.acknowledged_by_user_id = alert.acknowledged_by_user_id
        elif ex.incident_id:
            incident = db.scalar(select(Incident).where(Incident.id == ex.incident_id))
            if not incident or incident.status == IncidentStatus.RESOLVED:
                is_resolved = True
            elif incident.assignee_user_id is not None:
                is_acked = True
                ex.acknowledged_by_user_id = incident.assignee_user_id

        if is_resolved:
            ex.status = EscalationExecutionStatus.RESOLVED
            ex.resolved_at = now
            ex.next_escalation_at = None
            ex.updated_at = now
            processed.append(ex)
            continue

        if is_acked:
            ex.status = EscalationExecutionStatus.ACKNOWLEDGED
            ex.acknowledged_at = now
            ex.next_escalation_at = None
            ex.updated_at = now
            processed.append(ex)
            continue

        # Load policy steps
        policy = db.scalar(
            select(EscalationPolicy)
            .options(selectinload(EscalationPolicy.steps))
            .where(EscalationPolicy.id == ex.policy_id)
        )
        if not policy:
            ex.status = EscalationExecutionStatus.FAILED
            ex.next_escalation_at = None
            ex.updated_at = now
            processed.append(ex)
            continue

        steps = sorted(policy.steps, key=lambda s: s.step_number)
        next_step_num = ex.current_step_number + 1
        target_step = next((s for s in steps if s.step_number == next_step_num), None)

        if target_step:
            # Execute step
            title = "Escalated Incident"
            message = "Unacknowledged incident has escalated to you."
            severity = "SEV1"
            link = None
            entity_type = "incident"
            entity_id = ex.incident_id

            if ex.alert_id:
                alert = db.scalar(select(Alert).where(Alert.id == ex.alert_id))
                if alert:
                    title = alert.title
                    message = alert.message
                    severity = alert.severity
                    link = f"/alerts/{alert.id}"
                    entity_type = "alert"
                    entity_id = alert.id

            action_record = _execute_step_action(
                db=db,
                workspace_id=ex.workspace_id,
                step=target_step,
                title=title,
                message=message,
                severity=severity,
                link=link,
                entity_type=entity_type,
                entity_id=entity_id,
            )

            current_history = list(ex.history or [])
            current_history.append(action_record)
            ex.history = current_history
            ex.current_step_number = target_step.step_number

            # Check if there is another step after this
            has_more = any(s.step_number > target_step.step_number for s in steps)
            if has_more:
                ex.next_escalation_at = now + timedelta(minutes=target_step.delay_minutes)
            else:
                ex.status = EscalationExecutionStatus.EXHAUSTED
                ex.next_escalation_at = None

            ex.updated_at = now
            processed.append(ex)
        else:
            ex.status = EscalationExecutionStatus.EXHAUSTED
            ex.next_escalation_at = None
            ex.updated_at = now
            processed.append(ex)

    db.commit()
    return processed


def acknowledge_escalation_for_entity(
    db: Session,
    workspace_id: UUID,
    entity_type: str,
    entity_id: UUID,
    user_id: UUID | None = None,
) -> int:
    """Stops further escalation immediately when an alert or incident is acknowledged."""
    filter_cond = (
        EscalationExecution.alert_id == entity_id
        if entity_type == "alert"
        else EscalationExecution.incident_id == entity_id
    )
    executions = list(
        db.scalars(
            select(EscalationExecution).where(
                EscalationExecution.workspace_id == workspace_id,
                filter_cond,
                EscalationExecution.status == EscalationExecutionStatus.ACTIVE,
            )
        ).all()
    )
    now = utc_now()
    count = len(executions)
    for ex in executions:
        ex.status = EscalationExecutionStatus.ACKNOWLEDGED
        ex.acknowledged_at = now
        ex.acknowledged_by_user_id = user_id
        ex.next_escalation_at = None
        ex.updated_at = now
    db.commit()
    return count


def resolve_escalation_for_entity(
    db: Session,
    workspace_id: UUID,
    entity_type: str,
    entity_id: UUID,
    user_id: UUID | None = None,
) -> int:
    """Stops further escalation immediately when an alert or incident is resolved."""
    filter_cond = (
        EscalationExecution.alert_id == entity_id
        if entity_type == "alert"
        else EscalationExecution.incident_id == entity_id
    )
    executions = list(
        db.scalars(
            select(EscalationExecution).where(
                EscalationExecution.workspace_id == workspace_id,
                filter_cond,
                EscalationExecution.status == EscalationExecutionStatus.ACTIVE,
            )
        ).all()
    )
    now = utc_now()
    count = len(executions)
    for ex in executions:
        ex.status = EscalationExecutionStatus.RESOLVED
        ex.resolved_at = now
        ex.next_escalation_at = None
        ex.updated_at = now
    db.commit()
    return count


def list_executions(
    db: Session,
    workspace_id: UUID,
    status: EscalationExecutionStatus | None = None,
    limit: int = 50,
) -> list[EscalationExecution]:
    """Lists escalation executions in a workspace."""
    query = select(EscalationExecution).where(EscalationExecution.workspace_id == workspace_id)
    if status is not None:
        query = query.where(EscalationExecution.status == status)
    query = query.order_by(desc(EscalationExecution.created_at)).limit(limit)
    return list(db.scalars(query).all())
