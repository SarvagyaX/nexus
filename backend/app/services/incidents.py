"""Incident domain helpers shared by the HTTP routes."""

import base64
import binascii
import json
from datetime import datetime, timezone
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from app.models.incident import Incident, IncidentEvent, IncidentStatus, WorkspaceIncidentCounter


def _invalid_cursor():
    raise HTTPException(status_code=400, detail={"code": "invalid_cursor", "message": "The pagination cursor is invalid."})


def decode_incident_cursor(cursor: str | None):
    if cursor is None:
        return None
    try:
        if not cursor or len(cursor) > 512:
            raise ValueError
        data = json.loads(base64.b64decode(cursor + "=" * (-len(cursor) % 4), altchars=b"-_", validate=True))
        if not isinstance(data, dict) or set(data) != {"detected_at", "id"}:
            raise ValueError
        timestamp = datetime.fromisoformat(data["detected_at"])
        if timestamp.tzinfo is None:
            raise ValueError
        return timestamp, UUID(data["id"])
    except (ValueError, TypeError, KeyError, binascii.Error, json.JSONDecodeError):
        _invalid_cursor()


def encode_incident_cursor(incident: Incident) -> str:
    timestamp = incident.detected_at
    if timestamp.tzinfo is None:  # SQLite test databases return naive UTC values.
        timestamp = timestamp.replace(tzinfo=timezone.utc)
    payload = json.dumps({"detected_at": timestamp.isoformat(), "id": str(incident.id)}, separators=(",", ":")).encode()
    return base64.urlsafe_b64encode(payload).decode().rstrip("=")


def next_reference(db: Session, workspace_id: UUID) -> str:
    table = WorkspaceIncidentCounter.__table__
    dialect = db.bind.dialect.name
    if dialect == "postgresql":
        statement = pg_insert(table).values(workspace_id=workspace_id, last_value=1)
        statement = statement.on_conflict_do_update(
            index_elements=[table.c.workspace_id], set_={"last_value": table.c.last_value + 1}
        ).returning(table.c.last_value)
    elif dialect == "sqlite":
        statement = sqlite_insert(table).values(workspace_id=workspace_id, last_value=1)
        statement = statement.on_conflict_do_update(
            index_elements=[table.c.workspace_id], set_={"last_value": table.c.last_value + 1}
        ).returning(table.c.last_value)
    else:
        counter = db.get(WorkspaceIncidentCounter, workspace_id)
        if counter is None:
            counter = WorkspaceIncidentCounter(workspace_id=workspace_id, last_value=1)
            db.add(counter)
            db.flush()
        else:
            counter.last_value += 1
            db.flush()
        value = counter.last_value
        return f"INC-{value:06d}"
    value = db.execute(statement).scalar_one()
    return f"INC-{value:06d}"


def add_event(db: Session, *, workspace_id: UUID, incident_id: UUID, actor_user_id: UUID,
              event_type: str, payload: dict | None = None, body: str | None = None) -> IncidentEvent:
    event = IncidentEvent(workspace_id=workspace_id, incident_id=incident_id, actor_user_id=actor_user_id,
                          event_type=event_type, payload=payload or {}, body=body)
    db.add(event)
    return event


TRANSITIONS = {
    IncidentStatus.OPEN: {IncidentStatus.INVESTIGATING},
    IncidentStatus.INVESTIGATING: {IncidentStatus.MONITORING},
    IncidentStatus.MONITORING: {IncidentStatus.RESOLVED, IncidentStatus.OPEN, IncidentStatus.INVESTIGATING},
    IncidentStatus.RESOLVED: set(),
}


def get_incident(db: Session, workspace_id: UUID, incident_id: UUID, *, lock: bool = False) -> Incident | None:
    statement = select(Incident).where(Incident.workspace_id == workspace_id, Incident.id == incident_id)
    if lock:
        statement = statement.with_for_update()
    return db.scalar(statement)


def validate_transition(current: IncidentStatus, target: IncidentStatus) -> None:
    if target not in TRANSITIONS[current]:
        raise HTTPException(status_code=409, detail={"code": "invalid_incident_transition", "message": "The requested incident status transition is not allowed."})
