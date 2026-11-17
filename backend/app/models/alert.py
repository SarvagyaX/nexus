"""Workspace-scoped real-time alert rules, alerts, and timeline event models."""

from datetime import datetime, timezone
from enum import Enum
from uuid import UUID, uuid4

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Enum as SAEnum,
    Float,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.incident import IncidentSeverity


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def enum_values(enum_type: type[Enum]) -> list[str]:
    return [member.value for member in enum_type]


class AlertStatus(str, Enum):
    OPEN = "open"
    ACKNOWLEDGED = "acknowledged"
    SNOOZED = "snoozed"
    RESOLVED = "resolved"


class AlertRuleCondition(str, Enum):
    ERROR_COUNT = "error_count"
    FATAL_LOG = "fatal_log"
    ERROR_RATE = "error_rate"
    REPEATED_FAILURES = "repeated_failures"


class AlertRule(Base):
    __tablename__ = "alert_rules"
    __table_args__ = (
        UniqueConstraint("workspace_id", "id", name="uq_alert_rule_workspace_id"),
        ForeignKeyConstraint(
            ["workspace_id", "service_id"],
            ["services.workspace_id", "services.id"],
            name="fk_alert_rule_workspace_service",
            ondelete="SET NULL",
        ),
        CheckConstraint("length(trim(name)) > 0", name="ck_alert_rule_name_nonempty"),
        CheckConstraint("threshold > 0", name="ck_alert_rule_threshold_positive"),
        CheckConstraint("window_minutes >= 1 AND window_minutes <= 1440", name="ck_alert_rule_window_valid"),
        CheckConstraint("cooldown_minutes >= 1 AND cooldown_minutes <= 1440", name="ck_alert_rule_cooldown_valid"),
        Index("ix_alert_rule_workspace_enabled", "workspace_id", "enabled"),
        Index("ix_alert_rule_workspace_service", "workspace_id", "service_id"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    workspace_id: Mapped[UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="RESTRICT"), nullable=False)
    service_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), nullable=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    severity: Mapped[IncidentSeverity] = mapped_column(
        SAEnum(
            IncidentSeverity,
            name="incident_severity",
            native_enum=False,
            create_constraint=False,
            values_callable=enum_values,
        ),
        nullable=False,
        default=IncidentSeverity.SEV2,
    )
    condition_type: Mapped[AlertRuleCondition] = mapped_column(
        SAEnum(
            AlertRuleCondition,
            name="alert_rule_condition",
            native_enum=False,
            create_constraint=True,
            values_callable=enum_values,
        ),
        nullable=False,
        default=AlertRuleCondition.ERROR_COUNT,
    )
    threshold: Mapped[float] = mapped_column(Float, nullable=False, default=5.0)
    window_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=5)
    cooldown_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=15)
    created_by_user_id: Mapped[UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now, onupdate=utc_now)

    workspace = relationship("Workspace")
    service = relationship("Service", overlaps="workspace")
    created_by = relationship("User")
    alerts: Mapped[list["Alert"]] = relationship("Alert", back_populates="rule")


class Alert(Base):
    __tablename__ = "alerts"
    __table_args__ = (
        UniqueConstraint("workspace_id", "id", name="uq_alert_workspace_id"),
        ForeignKeyConstraint(
            ["workspace_id", "rule_id"],
            ["alert_rules.workspace_id", "alert_rules.id"],
            name="fk_alert_workspace_rule",
            ondelete="SET NULL",
        ),
        ForeignKeyConstraint(
            ["workspace_id", "service_id"],
            ["services.workspace_id", "services.id"],
            name="fk_alert_workspace_service",
            ondelete="SET NULL",
        ),
        ForeignKeyConstraint(
            ["workspace_id", "incident_id"],
            ["incidents.workspace_id", "incidents.id"],
            name="fk_alert_workspace_incident",
            ondelete="SET NULL",
        ),
        CheckConstraint("length(trim(title)) > 0", name="ck_alert_title_nonempty"),
        CheckConstraint("occurrence_count >= 1", name="ck_alert_occurrence_count_positive"),
        Index("ix_alert_workspace_status_last_seen", "workspace_id", "status", "last_seen_at"),
        Index("ix_alert_workspace_severity_last_seen", "workspace_id", "severity", "last_seen_at"),
        Index("ix_alert_workspace_fingerprint", "workspace_id", "fingerprint"),
        Index("ix_alert_workspace_service_status", "workspace_id", "service_id", "status"),
        Index("ix_alert_workspace_incident", "workspace_id", "incident_id"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    workspace_id: Mapped[UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="RESTRICT"), nullable=False)
    rule_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), nullable=True)
    service_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), nullable=True)
    incident_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), nullable=True)
    fingerprint: Mapped[str] = mapped_column(String(128), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    severity: Mapped[IncidentSeverity] = mapped_column(
        SAEnum(
            IncidentSeverity,
            name="incident_severity",
            native_enum=False,
            create_constraint=False,
            values_callable=enum_values,
        ),
        nullable=False,
        default=IncidentSeverity.SEV2,
    )
    status: Mapped[AlertStatus] = mapped_column(
        SAEnum(
            AlertStatus,
            name="alert_status",
            native_enum=False,
            create_constraint=True,
            values_callable=enum_values,
        ),
        nullable=False,
        default=AlertStatus.OPEN,
    )
    occurrence_count: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    first_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    snoozed_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    acknowledged_by_user_id: Mapped[UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resolved_by_user_id: Mapped[UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    resolution_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    data: Mapped[dict] = mapped_column(JSON().with_variant(JSONB, "postgresql"), nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now, onupdate=utc_now)

    workspace = relationship("Workspace", overlaps="alerts")
    rule: Mapped[AlertRule | None] = relationship("AlertRule", back_populates="alerts", overlaps="workspace")
    service = relationship("Service", overlaps="alerts,rule,workspace")
    incident = relationship("Incident", overlaps="alerts,rule,service,workspace")
    acknowledged_by = relationship("User", foreign_keys=[acknowledged_by_user_id])
    resolved_by = relationship("User", foreign_keys=[resolved_by_user_id])

    events: Mapped[list["AlertEvent"]] = relationship(
        "AlertEvent", back_populates="alert", cascade="all, delete-orphan", order_by="AlertEvent.created_at.desc()"
    )


class AlertEvent(Base):
    __tablename__ = "alert_events"
    __table_args__ = (
        UniqueConstraint("workspace_id", "id", name="uq_alert_event_workspace_id"),
        ForeignKeyConstraint(
            ["workspace_id", "alert_id"],
            ["alerts.workspace_id", "alerts.id"],
            name="fk_alert_event_workspace_alert",
            ondelete="CASCADE",
        ),
        Index("ix_alert_event_workspace_alert_created", "workspace_id", "alert_id", "created_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    workspace_id: Mapped[UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="RESTRICT"), nullable=False)
    alert_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    actor_user_id: Mapped[UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    event_type: Mapped[str] = mapped_column(String(64), nullable=False)
    message: Mapped[str | None] = mapped_column(Text, nullable=True)
    payload: Mapped[dict] = mapped_column(JSON().with_variant(JSONB, "postgresql"), nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)

    alert: Mapped["Alert"] = relationship("Alert", back_populates="events", overlaps="workspace")
    actor = relationship("User")
