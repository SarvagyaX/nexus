"""Workspace-scoped incident records and append-only timeline events."""

from datetime import datetime, timezone
from enum import Enum
from uuid import UUID, uuid4

from sqlalchemy import (CheckConstraint, DateTime, Enum as SAEnum, ForeignKey, ForeignKeyConstraint,
                        Index, Integer, JSON, String, UniqueConstraint, Uuid, event)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def enum_values(enum_type: type[Enum]) -> list[str]:
    return [member.value for member in enum_type]


class IncidentSeverity(str, Enum):
    SEV1 = "SEV1"
    SEV2 = "SEV2"
    SEV3 = "SEV3"
    SEV4 = "SEV4"


class IncidentStatus(str, Enum):
    OPEN = "open"
    INVESTIGATING = "investigating"
    MONITORING = "monitoring"
    RESOLVED = "resolved"


class SeveritySource(str, Enum):
    HUMAN = "human"
    AGENT = "agent"
    DEMO = "demo"


class Incident(Base):
    __tablename__ = "incidents"
    __table_args__ = (
        UniqueConstraint("workspace_id", "reference", name="uq_incident_workspace_reference"),
        UniqueConstraint("workspace_id", "id", name="uq_incident_workspace_id"),
        ForeignKeyConstraint(["workspace_id", "service_id"], ["services.workspace_id", "services.id"],
                             name="fk_incident_workspace_service", ondelete="RESTRICT"),
        ForeignKeyConstraint(["workspace_id", "assignee_user_id"],
                             ["workspace_memberships.workspace_id", "workspace_memberships.user_id"],
                             name="fk_incident_workspace_assignee", ondelete="RESTRICT"),
        CheckConstraint("length(trim(title)) > 0", name="ck_incident_title_nonempty"),
        CheckConstraint("length(trim(reference)) > 0", name="ck_incident_reference_nonempty"),
        Index("ix_incident_workspace_status_detected", "workspace_id", "status", "detected_at", "id"),
        Index("ix_incident_workspace_service_detected", "workspace_id", "service_id", "detected_at", "id"),
        Index("ix_incident_workspace_assignee_status", "workspace_id", "assignee_user_id", "status"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    workspace_id: Mapped[UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="RESTRICT"), nullable=False)
    service_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    reference: Mapped[str] = mapped_column(String(32), nullable=False)
    title: Mapped[str] = mapped_column(String(240), nullable=False)
    summary: Mapped[str | None] = mapped_column(String(4000))
    severity: Mapped[IncidentSeverity] = mapped_column(SAEnum(IncidentSeverity, name="incident_severity", native_enum=False, create_constraint=True, values_callable=enum_values), nullable=False)
    status: Mapped[IncidentStatus] = mapped_column(SAEnum(IncidentStatus, name="incident_status", native_enum=False, create_constraint=True, values_callable=enum_values), nullable=False, default=IncidentStatus.OPEN)
    severity_source: Mapped[SeveritySource] = mapped_column(SAEnum(SeveritySource, name="severity_source", native_enum=False, create_constraint=True, values_callable=enum_values), nullable=False, default=SeveritySource.HUMAN)
    assignee_user_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True))
    detected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    resolution_summary: Mapped[str | None] = mapped_column(String(4000))
    created_by_user_id: Mapped[UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now, onupdate=utc_now)


class IncidentEvent(Base):
    __tablename__ = "incident_events"
    __table_args__ = (
        ForeignKeyConstraint(["workspace_id", "incident_id"], ["incidents.workspace_id", "incidents.id"],
                             name="fk_incident_event_workspace_incident", ondelete="RESTRICT"),
        Index("ix_incident_event_workspace_incident_created", "workspace_id", "incident_id", "created_at", "id"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    workspace_id: Mapped[UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="RESTRICT"), nullable=False)
    incident_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    actor_user_id: Mapped[UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    event_type: Mapped[str] = mapped_column(String(40), nullable=False)
    body: Mapped[str | None] = mapped_column(String(4000))
    payload: Mapped[dict] = mapped_column(JSON().with_variant(JSONB, "postgresql"), nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)


class WorkspaceIncidentCounter(Base):
    __tablename__ = "workspace_incident_counters"
    __table_args__ = (CheckConstraint("last_value >= 0", name="ck_incident_counter_nonnegative"),)

    workspace_id: Mapped[UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="RESTRICT"), primary_key=True)
    last_value: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


@event.listens_for(IncidentEvent, "before_update")
def _prevent_event_update(_mapper, _connection, _target) -> None:
    raise ValueError("Incident timeline events are append-only")


@event.listens_for(IncidentEvent, "before_delete")
def _prevent_event_delete(_mapper, _connection, _target) -> None:
    raise ValueError("Incident timeline events are append-only")
