"""On-call schedule management and current rotation resolution service."""

from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from app.models.notification import OnCallRotationType, OnCallSchedule, utc_now


def resolve_current_on_call(
    schedule: OnCallSchedule,
    at_time: datetime | None = None,
) -> tuple[dict | None, datetime, datetime]:
    """Calculates which user is actively on-call for a schedule at a specific time."""
    now = at_time or utc_now()
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)

    members = schedule.members or []
    if not members or not schedule.is_active:
        return None, now, now

    sorted_members = sorted(members, key=lambda m: m.get("order", 0))
    n = len(sorted_members)
    if n == 0:
        return None, now, now

    ref_start = schedule.shift_start_time
    if ref_start.tzinfo is None:
        ref_start = ref_start.replace(tzinfo=timezone.utc)

    # Determine rotation interval in seconds
    if schedule.rotation_type == OnCallRotationType.DAILY:
        interval_sec = 86400
    elif schedule.rotation_type == OnCallRotationType.WEEKLY:
        interval_sec = 7 * 86400
    else:
        interval_sec = max(1, schedule.rotation_interval_days) * 86400

    if now < ref_start:
        member = sorted_members[0]
        shift_start = ref_start
        shift_end = ref_start + timedelta(seconds=interval_sec)
        return member, shift_start, shift_end

    elapsed_sec = (now - ref_start).total_seconds()
    cycle = int(elapsed_sec // interval_sec)
    index = cycle % n

    shift_start = ref_start + timedelta(seconds=cycle * interval_sec)
    shift_end = shift_start + timedelta(seconds=interval_sec)
    return sorted_members[index], shift_start, shift_end


def list_schedules(db: Session, workspace_id: UUID) -> list[OnCallSchedule]:
    """Lists all on-call schedules in a workspace."""
    return list(
        db.scalars(
            select(OnCallSchedule)
            .where(OnCallSchedule.workspace_id == workspace_id)
            .order_by(desc(OnCallSchedule.is_active), desc(OnCallSchedule.created_at))
        ).all()
    )


def get_schedule(db: Session, workspace_id: UUID | str, schedule_id: UUID | str) -> OnCallSchedule:
    """Gets an on-call schedule by ID."""
    ws_id = UUID(str(workspace_id)) if not isinstance(workspace_id, UUID) else workspace_id
    sched_id = UUID(str(schedule_id)) if not isinstance(schedule_id, UUID) else schedule_id
    schedule = db.scalar(
        select(OnCallSchedule).where(
            OnCallSchedule.workspace_id == ws_id,
            OnCallSchedule.id == sched_id,
        )
    )
    if not schedule:
        raise HTTPException(
            status_code=404,
            detail={"code": "schedule_not_found", "message": "On-call schedule was not found."},
        )
    return schedule


def create_schedule(
    db: Session,
    workspace_id: UUID,
    name: str,
    description: str | None = None,
    timezone: str = "UTC",
    is_active: bool = True,
    rotation_type: OnCallRotationType = OnCallRotationType.WEEKLY,
    rotation_interval_days: int = 7,
    shift_start_time: datetime | None = None,
    handover_hour: int = 9,
    members: list[dict] | None = None,
) -> OnCallSchedule:
    """Creates a new on-call schedule."""
    schedule = OnCallSchedule(
        workspace_id=workspace_id,
        name=name,
        description=description,
        timezone=timezone,
        is_active=is_active,
        rotation_type=rotation_type,
        rotation_interval_days=rotation_interval_days,
        shift_start_time=shift_start_time or utc_now(),
        handover_hour=handover_hour,
        members=members or [],
        created_at=utc_now(),
        updated_at=utc_now(),
    )
    db.add(schedule)
    db.commit()
    db.refresh(schedule)
    return schedule


def update_schedule(
    db: Session,
    workspace_id: UUID,
    schedule_id: UUID,
    updates: dict,
) -> OnCallSchedule:
    """Updates an existing on-call schedule."""
    schedule = get_schedule(db, workspace_id, schedule_id)
    for field, val in updates.items():
        if val is not None and hasattr(schedule, field):
            setattr(schedule, field, val)
    schedule.updated_at = utc_now()
    db.commit()
    db.refresh(schedule)
    return schedule


def delete_schedule(db: Session, workspace_id: UUID, schedule_id: UUID) -> None:
    """Deletes an on-call schedule."""
    schedule = get_schedule(db, workspace_id, schedule_id)
    db.delete(schedule)
    db.commit()
