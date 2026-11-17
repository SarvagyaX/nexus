"""Workflow Automation & Playbook Engine.

Provides playbook management, condition evaluation, sequential execution,
approval gating, and integration with Incidents, Alerts, Investigations, and Notifications.
"""

import asyncio
from datetime import datetime, timezone
import logging
import time
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import desc, func, select
from sqlalchemy.orm import Session

from app.models.alert import Alert
from app.models.incident import (
    Incident,
    IncidentEvent,
    IncidentSeverity,
    SeveritySource,
)
from app.models.notification import NotificationCategory
from app.models.playbook import (
    Playbook,
    PlaybookActionType,
    PlaybookApprovalRequest,
    PlaybookApprovalStatus,
    PlaybookExecution,
    PlaybookExecutionStatus,
    PlaybookStatus,
    PlaybookStep,
    PlaybookStepExecution,
    PlaybookStepExecutionStatus,
    PlaybookTriggerType,
)
from app.schemas.playbook import (
    PlaybookCreate,
    PlaybookStepCreate,
    PlaybookUpdate,
)
from app.services.notifications import WebhookProvider, dispatch_notification
from app.services.playbook_templates import get_template_by_id

logger = logging.getLogger("nexus.playbooks")


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _normalize_uuid(val: Any) -> UUID:
    if isinstance(val, UUID):
        return val
    return UUID(str(val))


# ============================================================================
# Playbook CRUD
# ============================================================================

def list_playbooks(
    db: Session,
    workspace_id: UUID | str,
    status: PlaybookStatus | None = None,
    trigger_type: PlaybookTriggerType | None = None,
    category: str | None = None,
    search: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[Playbook], int]:
    """Retrieves paginated playbooks for a workspace with optional filters."""
    ws_id = _normalize_uuid(workspace_id)
    query = select(Playbook).where(Playbook.workspace_id == ws_id)

    if status:
        query = query.where(Playbook.status == status)
    if trigger_type:
        query = query.where(Playbook.trigger_type == trigger_type)
    if category:
        query = query.where(Playbook.category == category)
    if search:
        query = query.where(Playbook.name.ilike(f"%{search}%"))

    total_count = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    items = db.scalars(
        query.order_by(Playbook.created_at.desc()).offset(offset).limit(limit)
    ).all()
    return list(items), total_count


def get_playbook(
    db: Session,
    workspace_id: UUID | str,
    playbook_id: UUID | str,
) -> Playbook | None:
    """Retrieves a single playbook scoped to a workspace."""
    ws_id = _normalize_uuid(workspace_id)
    pb_id = _normalize_uuid(playbook_id)
    return db.scalar(
        select(Playbook).where(
            Playbook.workspace_id == ws_id,
            Playbook.id == pb_id,
        )
    )


def create_playbook(
    db: Session,
    workspace_id: UUID | str,
    user_id: UUID | str | None,
    data: PlaybookCreate,
    is_template: bool = False,
    template_id: str | None = None,
) -> Playbook:
    """Creates a new playbook with its ordered steps."""
    ws_id = _normalize_uuid(workspace_id)
    u_id = _normalize_uuid(user_id) if user_id else None

    playbook = Playbook(
        workspace_id=ws_id,
        name=data.name,
        description=data.description,
        category=data.category or "general",
        status=data.status or PlaybookStatus.DRAFT,
        trigger_type=data.trigger_type or PlaybookTriggerType.MANUAL,
        trigger_config=data.trigger_config or {},
        severity_applicability=data.severity_applicability or [],
        is_template=is_template,
        template_id=template_id,
        created_by_user_id=u_id,
        created_at=utc_now(),
        updated_at=utc_now(),
    )
    db.add(playbook)
    db.flush()

    for idx, step_data in enumerate(data.steps, start=1):
        step = PlaybookStep(
            workspace_id=ws_id,
            playbook_id=playbook.id,
            step_order=step_data.step_order or idx,
            name=step_data.name,
            action_type=step_data.action_type,
            action_config=step_data.action_config or {},
            is_enabled=step_data.is_enabled,
            continue_on_failure=step_data.continue_on_failure,
            timeout_seconds=step_data.timeout_seconds or 60,
            created_at=utc_now(),
            updated_at=utc_now(),
        )
        db.add(step)

    db.commit()
    db.refresh(playbook)
    return playbook


def update_playbook(
    db: Session,
    workspace_id: UUID | str,
    playbook_id: UUID | str,
    data: PlaybookUpdate,
) -> Playbook | None:
    """Updates playbook configuration and optionally replaces its steps."""
    playbook = get_playbook(db, workspace_id, playbook_id)
    if not playbook:
        return None

    if data.name is not None:
        playbook.name = data.name
    if data.description is not None:
        playbook.description = data.description
    if data.category is not None:
        playbook.category = data.category
    if data.status is not None:
        playbook.status = data.status
    if data.trigger_type is not None:
        playbook.trigger_type = data.trigger_type
    if data.trigger_config is not None:
        playbook.trigger_config = data.trigger_config
    if data.severity_applicability is not None:
        playbook.severity_applicability = data.severity_applicability

    playbook.version += 1
    playbook.updated_at = utc_now()

    # If steps are supplied, replace existing steps
    if data.steps is not None:
        # Delete old steps
        for old_step in list(playbook.steps):
            db.delete(old_step)
        db.flush()

        ws_id = _normalize_uuid(workspace_id)
        for idx, step_data in enumerate(data.steps, start=1):
            step = PlaybookStep(
                workspace_id=ws_id,
                playbook_id=playbook.id,
                step_order=step_data.step_order or idx,
                name=step_data.name,
                action_type=step_data.action_type,
                action_config=step_data.action_config or {},
                is_enabled=step_data.is_enabled,
                continue_on_failure=step_data.continue_on_failure,
                timeout_seconds=step_data.timeout_seconds or 60,
                created_at=utc_now(),
                updated_at=utc_now(),
            )
            db.add(step)

    db.commit()
    db.refresh(playbook)
    return playbook


def duplicate_playbook(
    db: Session,
    workspace_id: UUID | str,
    playbook_id: UUID | str,
    user_id: UUID | str | None,
) -> Playbook | None:
    """Creates a copy of an existing playbook in DRAFT status."""
    source = get_playbook(db, workspace_id, playbook_id)
    if not source:
        return None

    create_data = PlaybookCreate(
        name=f"{source.name} (Copy)",
        description=source.description,
        category=source.category,
        status=PlaybookStatus.DRAFT,
        trigger_type=source.trigger_type,
        trigger_config=dict(source.trigger_config or {}),
        severity_applicability=list(source.severity_applicability or []),
        steps=[
            PlaybookStepCreate(
                name=step.name,
                action_type=step.action_type,
                action_config=dict(step.action_config or {}),
                step_order=step.step_order,
                is_enabled=step.is_enabled,
                continue_on_failure=step.continue_on_failure,
                timeout_seconds=step.timeout_seconds,
            )
            for step in source.steps
        ],
    )
    return create_playbook(db, workspace_id, user_id, create_data)


def archive_playbook(
    db: Session,
    workspace_id: UUID | str,
    playbook_id: UUID | str,
) -> Playbook | None:
    """Sets playbook status to ARCHIVED."""
    playbook = get_playbook(db, workspace_id, playbook_id)
    if not playbook:
        return None
    playbook.status = PlaybookStatus.ARCHIVED
    playbook.updated_at = utc_now()
    db.commit()
    db.refresh(playbook)
    return playbook


def delete_playbook(
    db: Session,
    workspace_id: UUID | str,
    playbook_id: UUID | str,
) -> bool:
    """Permanently removes a playbook and its associated cascade records."""
    playbook = get_playbook(db, workspace_id, playbook_id)
    if not playbook:
        return False
    db.delete(playbook)
    db.commit()
    return True


def instantiate_template(
    db: Session,
    workspace_id: UUID | str,
    user_id: UUID | str | None,
    template_id: str,
) -> Playbook | None:
    """Creates an editable playbook instance from a built-in template."""
    template = get_template_by_id(template_id)
    if not template:
        return None

    create_data = PlaybookCreate(
        name=template.name,
        description=template.description,
        category=template.category,
        status=PlaybookStatus.ACTIVE,
        trigger_type=template.trigger_type,
        trigger_config=template.trigger_config,
        severity_applicability=template.severity_applicability,
        steps=template.steps,
    )
    return create_playbook(
        db=db,
        workspace_id=workspace_id,
        user_id=user_id,
        data=create_data,
        is_template=False,
        template_id=template.id,
    )


# ============================================================================
# Trigger Matching & Deduplication
# ============================================================================

def find_matching_playbooks(
    db: Session,
    workspace_id: UUID | str,
    trigger_type: PlaybookTriggerType,
    severity: str | None = None,
    service_id: UUID | str | None = None,
) -> list[Playbook]:
    """Finds active playbooks matching trigger type and operational conditions."""
    ws_id = _normalize_uuid(workspace_id)
    query = select(Playbook).where(
        Playbook.workspace_id == ws_id,
        Playbook.status == PlaybookStatus.ACTIVE,
        Playbook.trigger_type == trigger_type,
    )
    candidates = db.scalars(query).all()

    matched: list[Playbook] = []
    norm_sev = (severity or "").upper()

    for pb in candidates:
        # Check severity applicability
        if norm_sev and pb.severity_applicability:
            app_sevs = [s.upper() for s in pb.severity_applicability]
            if norm_sev not in app_sevs:
                continue

        # Check trigger_config filters
        cfg = pb.trigger_config or {}
        if norm_sev and "severities" in cfg:
            cfg_sevs = [s.upper() for s in cfg["severities"]]
            if norm_sev not in cfg_sevs:
                continue

        if service_id and "service_ids" in cfg:
            cfg_services = [str(s) for s in cfg["service_ids"]]
            if str(service_id) not in cfg_services:
                continue

        matched.append(pb)

    return matched


# ============================================================================
# Execution Engine
# ============================================================================

def create_execution(
    db: Session,
    workspace_id: UUID | str,
    playbook_id: UUID | str,
    trigger_type: PlaybookTriggerType,
    trigger_event_id: str | None = None,
    incident_id: UUID | str | None = None,
    alert_id: UUID | str | None = None,
    user_id: UUID | str | None = None,
    context: dict | None = None,
) -> PlaybookExecution:
    """Instantiates a playbook execution and pre-generates step executions.

    Enforces idempotency: if trigger_event_id already exists for this playbook,
    returns the existing execution without duplicating work.
    """
    ws_id = _normalize_uuid(workspace_id)
    pb_id = _normalize_uuid(playbook_id)
    inc_id = _normalize_uuid(incident_id) if incident_id else None
    al_id = _normalize_uuid(alert_id) if alert_id else None
    u_id = _normalize_uuid(user_id) if user_id else None

    # Idempotency / deduplication check
    if trigger_event_id:
        existing = db.scalar(
            select(PlaybookExecution).where(
                PlaybookExecution.workspace_id == ws_id,
                PlaybookExecution.playbook_id == pb_id,
                PlaybookExecution.trigger_event_id == str(trigger_event_id),
            )
        )
        if existing:
            logger.info(
                f"Playbook execution already exists for trigger event '{trigger_event_id}', skipping duplicate."
            )
            return existing

    playbook = db.scalar(select(Playbook).where(Playbook.id == pb_id, Playbook.workspace_id == ws_id))
    if not playbook:
        raise ValueError(f"Playbook {playbook_id} not found in workspace {workspace_id}")

    execution = PlaybookExecution(
        workspace_id=ws_id,
        playbook_id=pb_id,
        trigger_type=trigger_type,
        trigger_event_id=str(trigger_event_id) if trigger_event_id else None,
        status=PlaybookExecutionStatus.PENDING,
        incident_id=inc_id,
        alert_id=al_id,
        triggered_by_user_id=u_id,
        current_step_order=1,
        context=dict(context or {}),
        created_at=utc_now(),
        updated_at=utc_now(),
    )
    db.add(execution)
    db.flush()

    # Pre-populate step executions from enabled steps
    active_steps = [s for s in playbook.steps if s.is_enabled]
    active_steps.sort(key=lambda s: s.step_order)

    for idx, step in enumerate(active_steps, start=1):
        step_exec = PlaybookStepExecution(
            workspace_id=ws_id,
            execution_id=execution.id,
            step_id=step.id,
            step_order=idx,
            step_name=step.name,
            action_type=step.action_type,
            status=PlaybookStepExecutionStatus.PENDING,
            input_payload=dict(step.action_config or {}),
            output_payload={},
            retry_count=0,
            created_at=utc_now(),
        )
        db.add(step_exec)

    # Increment playbook execution stats
    playbook.execution_count += 1
    playbook.last_executed_at = utc_now()

    db.commit()
    db.refresh(execution)
    return execution


async def run_execution_steps(
    db: Session,
    execution_id: UUID | str,
) -> PlaybookExecution:
    """Sequentially executes steps of a playbook execution.

    Pauses when encountering REQUIRE_APPROVAL or an error without continue_on_failure.
    """
    exec_id = _normalize_uuid(execution_id)
    execution = db.scalar(select(PlaybookExecution).where(PlaybookExecution.id == exec_id))
    if not execution:
        raise ValueError(f"Execution {execution_id} not found")

    if execution.status in (
        PlaybookExecutionStatus.COMPLETED,
        PlaybookExecutionStatus.FAILED,
        PlaybookExecutionStatus.CANCELLED,
    ):
        return execution

    start_perf = time.perf_counter()
    if not execution.started_at:
        execution.started_at = utc_now()
    execution.status = PlaybookExecutionStatus.RUNNING
    db.commit()

    step_executions = list(execution.step_executions)
    step_executions.sort(key=lambda s: s.step_order)

    for step_exec in step_executions:
        # Skip steps that have already run or succeeded
        if step_exec.status in (
            PlaybookStepExecutionStatus.COMPLETED,
            PlaybookStepExecutionStatus.SKIPPED,
        ):
            continue

        # If cancelled, stop
        db.refresh(execution)
        if execution.status == PlaybookExecutionStatus.CANCELLED:
            step_exec.status = PlaybookStepExecutionStatus.CANCELLED
            db.commit()
            break

        execution.current_step_order = step_exec.step_order
        step_exec.status = PlaybookStepExecutionStatus.RUNNING
        step_exec.started_at = utc_now()
        db.commit()

        step_start = time.perf_counter()
        action_type = step_exec.action_type
        config = step_exec.input_payload or {}

        try:
            # 1. Require Approval step: pause execution
            if action_type == PlaybookActionType.REQUIRE_APPROVAL:
                prompt_text = config.get(
                    "prompt",
                    f"Approval required for playbook step '{step_exec.step_name}'",
                )
                approval = PlaybookApprovalRequest(
                    workspace_id=execution.workspace_id,
                    execution_id=execution.id,
                    step_execution_id=step_exec.id,
                    prompt=prompt_text,
                    status=PlaybookApprovalStatus.PENDING,
                    created_at=utc_now(),
                )
                db.add(approval)
                step_exec.status = PlaybookStepExecutionStatus.AWAITING_APPROVAL
                execution.status = PlaybookExecutionStatus.AWAITING_APPROVAL
                execution.updated_at = utc_now()
                db.commit()
                logger.info(
                    f"Execution {execution.id} step '{step_exec.step_name}' paused awaiting approval."
                )
                return execution

            # 2. Wait Duration step
            elif action_type == PlaybookActionType.WAIT_DURATION:
                duration = min(int(config.get("duration_seconds", 5)), 60)
                await asyncio.sleep(duration)
                step_exec.output_payload = {"waited_seconds": duration}

            # 3. Create Incident Note
            elif action_type == PlaybookActionType.CREATE_INCIDENT_NOTE:
                note_body = config.get("body", f"Playbook automated note: {step_exec.step_name}")
                inc_id = execution.incident_id
                if inc_id:
                    event = IncidentEvent(
                        workspace_id=execution.workspace_id,
                        incident_id=inc_id,
                        actor_user_id=execution.triggered_by_user_id,
                        event_type="note",
                        body=note_body,
                        payload={"source": "playbook", "execution_id": str(execution.id)},
                        created_at=utc_now(),
                    )
                    db.add(event)
                    step_exec.output_payload = {"note_created": True, "incident_id": str(inc_id)}
                else:
                    step_exec.output_payload = {
                        "note_created": False,
                        "reason": "No associated incident attached to execution",
                    }

            # 4. Assign Incident
            elif action_type == PlaybookActionType.ASSIGN_INCIDENT:
                target_user_id = config.get("assignee_user_id") or config.get("user_id")
                inc_id = execution.incident_id
                if inc_id and target_user_id:
                    incident = db.scalar(select(Incident).where(Incident.id == inc_id))
                    if incident:
                        incident.assignee_user_id = _normalize_uuid(target_user_id)
                        incident.updated_at = utc_now()
                        db.add(
                            IncidentEvent(
                                workspace_id=execution.workspace_id,
                                incident_id=inc_id,
                                actor_user_id=execution.triggered_by_user_id,
                                event_type="assignment_changed",
                                body=f"Incident assigned to {target_user_id} via playbook automation.",
                                payload={"assignee_user_id": str(target_user_id)},
                                created_at=utc_now(),
                            )
                        )
                        step_exec.output_payload = {
                            "assigned": True,
                            "assignee_user_id": str(target_user_id),
                        }
                    else:
                        step_exec.output_payload = {"assigned": False, "reason": "Incident not found"}
                else:
                    step_exec.output_payload = {
                        "assigned": False,
                        "reason": "No incident or target user configured",
                    }

            # 5. Change Incident Severity
            elif action_type == PlaybookActionType.CHANGE_INCIDENT_SEVERITY:
                target_sev = config.get("severity", "SEV2").upper()
                inc_id = execution.incident_id
                if inc_id:
                    incident = db.scalar(select(Incident).where(Incident.id == inc_id))
                    if incident:
                        incident.severity = IncidentSeverity(target_sev)
                        incident.severity_source = SeveritySource.AGENT
                        incident.updated_at = utc_now()
                        db.add(
                            IncidentEvent(
                                workspace_id=execution.workspace_id,
                                incident_id=inc_id,
                                actor_user_id=execution.triggered_by_user_id,
                                event_type="severity_changed",
                                body=f"Incident severity changed to {target_sev} by playbook.",
                                payload={"severity": target_sev},
                                created_at=utc_now(),
                            )
                        )
                        step_exec.output_payload = {"severity_updated": True, "new_severity": target_sev}
                    else:
                        step_exec.output_payload = {"severity_updated": False, "reason": "Incident not found"}
                else:
                    step_exec.output_payload = {"severity_updated": False, "reason": "No associated incident"}

            # 6. Send Notification
            elif action_type == PlaybookActionType.SEND_NOTIFICATION:
                title = config.get("title", f"Playbook: {step_exec.step_name}")
                message = config.get("message", "Automated playbook step dispatched notification.")
                severity = config.get("severity", "info")
                category_str = config.get("category", "system")
                try:
                    category_enum = NotificationCategory(category_str)
                except ValueError:
                    category_enum = NotificationCategory.SYSTEM

                target_user_id = config.get("user_id") or execution.triggered_by_user_id
                if not target_user_id:
                    from app.models.identity import Membership
                    target_user_id = db.scalar(
                        select(Membership.user_id).where(Membership.workspace_id == execution.workspace_id)
                    )

                if target_user_id:
                    notif = dispatch_notification(
                        db=db,
                        workspace_id=execution.workspace_id,
                        user_id=_normalize_uuid(target_user_id),
                        category=category_enum,
                        severity=severity,
                        title=title,
                        message=message,
                        link=f"/playbook-executions/{execution.id}",
                    )
                    step_exec.output_payload = {
                        "notification_sent": True,
                        "notification_id": str(notif.id) if notif else None,
                    }
                else:
                    step_exec.output_payload = {
                        "notification_sent": False,
                        "reason": "No recipient user found in workspace",
                    }

            # 7. Trigger AI Investigation
            elif action_type == PlaybookActionType.TRIGGER_INVESTIGATION:
                inc_id = execution.incident_id
                if inc_id:
                    try:
                        from app.ai.service import start_investigation

                        inv = await start_investigation(
                            db=db,
                            workspace_id=execution.workspace_id,
                            incident_id=inc_id,
                            user_id=execution.triggered_by_user_id,
                        )
                        step_exec.output_payload = {
                            "investigation_started": True,
                            "investigation_id": str(inv.id),
                        }
                    except Exception as inv_err:
                        logger.error(f"Failed to start AI investigation from playbook: {inv_err}")
                        step_exec.output_payload = {
                            "investigation_started": False,
                            "error": str(inv_err),
                        }
                else:
                    step_exec.output_payload = {
                        "investigation_started": False,
                        "reason": "No incident attached to trigger investigation",
                    }

            # 8. Send Outbound Webhook
            elif action_type == PlaybookActionType.SEND_WEBHOOK:
                wh_url = config.get("webhook_url") or config.get("url")
                if wh_url:
                    webhook_payload = {
                        "event": "nexus.playbook.step",
                        "execution_id": str(execution.id),
                        "playbook_id": str(execution.playbook_id),
                        "step_order": step_exec.step_order,
                        "step_name": step_exec.step_name,
                        "incident_id": str(execution.incident_id) if execution.incident_id else None,
                        "alert_id": str(execution.alert_id) if execution.alert_id else None,
                        "timestamp": utc_now().isoformat(),
                    }
                    ok, code, err_msg = await WebhookProvider.send_webhook(wh_url, webhook_payload)
                    step_exec.output_payload = {
                        "webhook_delivered": ok,
                        "status_code": code,
                        "error": err_msg,
                    }
                    if not ok and not config.get("continue_on_failure", False):
                        raise RuntimeError(f"Webhook delivery failed: {err_msg} (HTTP {code})")
                else:
                    step_exec.output_payload = {
                        "webhook_delivered": False,
                        "reason": "No webhook URL provided in config",
                    }

            step_duration_ms = int((time.perf_counter() - step_start) * 1000)
            step_exec.status = PlaybookStepExecutionStatus.COMPLETED
            step_exec.completed_at = utc_now()
            step_exec.duration_ms = step_duration_ms

            # Update execution context with output
            ctx = dict(execution.context or {})
            ctx[f"step_{step_exec.step_order}"] = step_exec.output_payload
            execution.context = ctx
            db.commit()

        except Exception as exc:
            step_duration_ms = int((time.perf_counter() - step_start) * 1000)
            step_exec.status = PlaybookStepExecutionStatus.FAILED
            step_exec.error_message = str(exc)
            step_exec.completed_at = utc_now()
            step_exec.duration_ms = step_duration_ms

            # Check if step allows continuation on failure
            step_model = step_exec.step_id and db.scalar(
                select(PlaybookStep).where(PlaybookStep.id == step_exec.step_id)
            )
            continue_on_failure = step_model.continue_on_failure if step_model else False

            if continue_on_failure:
                logger.warning(
                    f"Step {step_exec.step_order} ({step_exec.step_name}) failed, continuing execution: {exc}"
                )
                db.commit()
                continue
            else:
                logger.error(f"Step {step_exec.step_order} ({step_exec.step_name}) failed: {exc}")
                execution.status = PlaybookExecutionStatus.FAILED
                execution.error_message = f"Step {step_exec.step_order} ({step_exec.step_name}) failed: {exc}"
                execution.completed_at = utc_now()
                execution.duration_ms = int((time.perf_counter() - start_perf) * 1000)
                db.commit()
                return execution

    # All steps completed successfully
    execution.status = PlaybookExecutionStatus.COMPLETED
    execution.completed_at = utc_now()
    execution.duration_ms = int((time.perf_counter() - start_perf) * 1000)
    db.commit()
    db.refresh(execution)
    return execution


# ============================================================================
# Approval & Resumption Handling
# ============================================================================

async def approve_execution_step(
    db: Session,
    workspace_id: UUID | str,
    execution_id: UUID | str,
    user_id: UUID | str,
    comment: str | None = None,
) -> PlaybookExecution:
    """Approves a pending approval step and resumes playbook execution."""
    ws_id = _normalize_uuid(workspace_id)
    exec_id = _normalize_uuid(execution_id)
    u_id = _normalize_uuid(user_id)

    execution = db.scalar(
        select(PlaybookExecution).where(
            PlaybookExecution.id == exec_id,
            PlaybookExecution.workspace_id == ws_id,
        )
    )
    if not execution:
        raise ValueError("Execution not found")

    approval = db.scalar(
        select(PlaybookApprovalRequest).where(
            PlaybookApprovalRequest.execution_id == exec_id,
            PlaybookApprovalRequest.status == PlaybookApprovalStatus.PENDING,
        )
    )
    if not approval:
        raise ValueError("No pending approval request for this execution")

    # Mark approval request approved
    approval.status = PlaybookApprovalStatus.APPROVED
    approval.approver_user_id = u_id
    approval.comment = comment
    approval.responded_at = utc_now()

    # Mark the associated step completed
    step_exec = db.scalar(
        select(PlaybookStepExecution).where(PlaybookStepExecution.id == approval.step_execution_id)
    )
    if step_exec:
        step_exec.status = PlaybookStepExecutionStatus.COMPLETED
        step_exec.completed_at = utc_now()
        step_exec.output_payload = {
            "approved": True,
            "approver_user_id": str(u_id),
            "comment": comment,
        }

    execution.status = PlaybookExecutionStatus.RUNNING
    execution.updated_at = utc_now()
    db.commit()

    # Resume execution of remaining steps
    return await run_execution_steps(db, execution.id)


async def reject_execution_step(
    db: Session,
    workspace_id: UUID | str,
    execution_id: UUID | str,
    user_id: UUID | str,
    comment: str | None = None,
) -> PlaybookExecution:
    """Rejects a pending approval step, terminating the playbook execution."""
    ws_id = _normalize_uuid(workspace_id)
    exec_id = _normalize_uuid(execution_id)
    u_id = _normalize_uuid(user_id)

    execution = db.scalar(
        select(PlaybookExecution).where(
            PlaybookExecution.id == exec_id,
            PlaybookExecution.workspace_id == ws_id,
        )
    )
    if not execution:
        raise ValueError("Execution not found")

    approval = db.scalar(
        select(PlaybookApprovalRequest).where(
            PlaybookApprovalRequest.execution_id == exec_id,
            PlaybookApprovalRequest.status == PlaybookApprovalStatus.PENDING,
        )
    )
    if not approval:
        raise ValueError("No pending approval request for this execution")

    # Mark approval request rejected
    approval.status = PlaybookApprovalStatus.REJECTED
    approval.approver_user_id = u_id
    approval.comment = comment
    approval.responded_at = utc_now()

    # Mark step failed
    step_exec = db.scalar(
        select(PlaybookStepExecution).where(PlaybookStepExecution.id == approval.step_execution_id)
    )
    if step_exec:
        step_exec.status = PlaybookStepExecutionStatus.FAILED
        step_exec.completed_at = utc_now()
        step_exec.error_message = f"Step rejected by approver: {comment or 'No comment provided'}"
        step_exec.output_payload = {
            "approved": False,
            "approver_user_id": str(u_id),
            "comment": comment,
        }

    # Execution is cancelled
    execution.status = PlaybookExecutionStatus.CANCELLED
    execution.error_message = f"Execution cancelled due to rejection: {comment or 'Rejected by approver'}"
    execution.completed_at = utc_now()
    execution.updated_at = utc_now()
    db.commit()
    db.refresh(execution)
    return execution


def cancel_execution(
    db: Session,
    workspace_id: UUID | str,
    execution_id: UUID | str,
    user_id: UUID | str | None,
) -> PlaybookExecution:
    """Cancels a pending or running playbook execution."""
    ws_id = _normalize_uuid(workspace_id)
    exec_id = _normalize_uuid(execution_id)

    execution = db.scalar(
        select(PlaybookExecution).where(
            PlaybookExecution.id == exec_id,
            PlaybookExecution.workspace_id == ws_id,
        )
    )
    if not execution:
        raise ValueError("Execution not found")

    if execution.status in (
        PlaybookExecutionStatus.COMPLETED,
        PlaybookExecutionStatus.FAILED,
        PlaybookExecutionStatus.CANCELLED,
    ):
        return execution

    execution.status = PlaybookExecutionStatus.CANCELLED
    execution.error_message = "Cancelled by user"
    execution.completed_at = utc_now()
    execution.updated_at = utc_now()

    # Cancel pending step executions and approval requests
    for step_exec in execution.step_executions:
        if step_exec.status in (
            PlaybookStepExecutionStatus.PENDING,
            PlaybookStepExecutionStatus.RUNNING,
            PlaybookStepExecutionStatus.AWAITING_APPROVAL,
        ):
            step_exec.status = PlaybookStepExecutionStatus.CANCELLED
            step_exec.completed_at = utc_now()

    for app_req in execution.approvals:
        if app_req.status == PlaybookApprovalStatus.PENDING:
            app_req.status = PlaybookApprovalStatus.CANCELLED
            app_req.responded_at = utc_now()

    db.commit()
    db.refresh(execution)
    return execution


# ============================================================================
# Execution Queries
# ============================================================================

def list_executions(
    db: Session,
    workspace_id: UUID | str,
    playbook_id: UUID | str | None = None,
    status: PlaybookExecutionStatus | None = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[PlaybookExecution], int]:
    """Retrieves paginated executions for a workspace or specific playbook."""
    ws_id = _normalize_uuid(workspace_id)
    query = select(PlaybookExecution).where(PlaybookExecution.workspace_id == ws_id)

    if playbook_id:
        pb_id = _normalize_uuid(playbook_id)
        query = query.where(PlaybookExecution.playbook_id == pb_id)
    if status:
        query = query.where(PlaybookExecution.status == status)

    total_count = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    items = db.scalars(
        query.order_by(PlaybookExecution.created_at.desc()).offset(offset).limit(limit)
    ).all()
    return list(items), total_count


def get_execution(
    db: Session,
    workspace_id: UUID | str,
    execution_id: UUID | str,
) -> PlaybookExecution | None:
    """Retrieves a single execution with its step executions and approvals."""
    ws_id = _normalize_uuid(workspace_id)
    exec_id = _normalize_uuid(execution_id)
    return db.scalar(
        select(PlaybookExecution).where(
            PlaybookExecution.workspace_id == ws_id,
            PlaybookExecution.id == exec_id,
        )
    )
