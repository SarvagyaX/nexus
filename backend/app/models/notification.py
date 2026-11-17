"""Workspace-scoped notifications, preferences, on-call schedules, and escalation policies."""

from datetime import datetime, timezone
from enum import Enum
from uuid import UUID, uuid4

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Enum as SAEnum,
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


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def enum_values(enum_type: type[Enum]) -> list[str]:
    return [member.value for member in enum_type]


# ============================================================================
# Enums
# ============================================================================

class NotificationCategory(str, Enum):
    ALERT = "alert"
    INCIDENT = "incident"
    INVESTIGATION = "investigation"
    SYSTEM = "system"


class NotificationDeliveryChannel(str, Enum):
    IN_APP = "in_app"
    WEBHOOK = "webhook"
    EMAIL = "email"


class NotificationDeliveryStatus(str, Enum):
    PENDING = "pending"
    SENT = "sent"
    FAILED = "failed"


class OnCallRotationType(str, Enum):
    DAILY = "daily"
    WEEKLY = "weekly"
    CUSTOM = "custom"


class EscalationTargetType(str, Enum):
    USER = "user"
    ON_CALL_SCHEDULE = "on_call_schedule"
    WEBHOOK = "webhook"


class EscalationExecutionStatus(str, Enum):
    ACTIVE = "active"
    ACKNOWLEDGED = "acknowledged"
    RESOLVED = "resolved"
    EXHAUSTED = "exhausted"
    FAILED = "failed"


# ============================================================================
# Notification Models
# ============================================================================

class Notification(Base):
    """A persisted user-facing notification in a workspace."""

    __tablename__ = "notifications"
    __table_args__ = (
        Index("ix_notifications_workspace_user_created", "workspace_id", "user_id", "created_at"),
        Index("ix_notifications_user_unread", "user_id", "is_read"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    workspace_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("workspaces.id", ondelete="CASCADE"),
        nullable=False,
    )
    user_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )

    category: Mapped[NotificationCategory] = mapped_column(
        SAEnum(
            NotificationCategory,
            name="notification_category_enum",
            values_callable=enum_values,
            native_enum=False,
        ),
        nullable=False,
        default=NotificationCategory.SYSTEM,
    )
    severity: Mapped[str] = mapped_column(String(16), nullable=False, default="info")
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    link: Mapped[str | None] = mapped_column(String(500), nullable=True)

    entity_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    entity_id: Mapped[UUID | None] = mapped_column(Uuid, nullable=True)

    is_read: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    dedup_key: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)

    # Relationships
    deliveries: Mapped[list["NotificationDelivery"]] = relationship(
        "NotificationDelivery",
        back_populates="notification",
        cascade="all, delete-orphan",
        order_by="NotificationDelivery.created_at",
    )


class NotificationDelivery(Base):
    """Tracks per-channel delivery attempts and results for a notification."""

    __tablename__ = "notification_deliveries"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    notification_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("notifications.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    workspace_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("workspaces.id", ondelete="CASCADE"),
        nullable=False,
    )

    channel: Mapped[NotificationDeliveryChannel] = mapped_column(
        SAEnum(
            NotificationDeliveryChannel,
            name="notification_delivery_channel_enum",
            values_callable=enum_values,
            native_enum=False,
        ),
        nullable=False,
    )
    recipient_target: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[NotificationDeliveryStatus] = mapped_column(
        SAEnum(
            NotificationDeliveryStatus,
            name="notification_delivery_status_enum",
            values_callable=enum_values,
            native_enum=False,
        ),
        nullable=False,
        default=NotificationDeliveryStatus.PENDING,
    )
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    max_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=3)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)

    notification: Mapped["Notification"] = relationship("Notification", back_populates="deliveries")


class NotificationPreference(Base):
    """User-level notification delivery preferences within a workspace."""

    __tablename__ = "notification_preferences"
    __table_args__ = (
        UniqueConstraint("workspace_id", "user_id", name="uq_notification_preference_workspace_user"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    workspace_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("workspaces.id", ondelete="CASCADE"),
        nullable=False,
    )
    user_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )

    alerts_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    alerts_min_severity: Mapped[str] = mapped_column(String(16), nullable=False, default="SEV3")

    incidents_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    incidents_min_severity: Mapped[str] = mapped_column(String(16), nullable=False, default="SEV3")

    investigations_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    assignments_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    in_app_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    email_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    webhook_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    webhook_url: Mapped[str | None] = mapped_column(String(500), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)


# ============================================================================
# On-Call Schedule Models
# ============================================================================

class OnCallSchedule(Base):
    """Workspace-scoped on-call schedule rotation."""

    __tablename__ = "on_call_schedules"
    __table_args__ = (
        Index("ix_on_call_schedules_workspace", "workspace_id"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    workspace_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("workspaces.id", ondelete="CASCADE"),
        nullable=False,
    )

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    timezone: Mapped[str] = mapped_column(String(64), nullable=False, default="UTC")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    rotation_type: Mapped[OnCallRotationType] = mapped_column(
        SAEnum(
            OnCallRotationType,
            name="on_call_rotation_type_enum",
            values_callable=enum_values,
            native_enum=False,
        ),
        nullable=False,
        default=OnCallRotationType.WEEKLY,
    )
    rotation_interval_days: Mapped[int] = mapped_column(Integer, nullable=False, default=7)
    shift_start_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    handover_hour: Mapped[int] = mapped_column(Integer, nullable=False, default=9)

    # Ordered list of participants: [{"user_id": str, "order": int, "name": str, "email": str}]
    members: Mapped[list[dict]] = mapped_column(
        JSONB().with_variant(JSON, "sqlite"),
        nullable=False,
        default=list,
    )

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)


# ============================================================================
# Escalation Policy Models
# ============================================================================

class EscalationPolicy(Base):
    """Configurable incident and alert escalation policy."""

    __tablename__ = "escalation_policies"
    __table_args__ = (
        Index("ix_escalation_policies_workspace", "workspace_id"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    workspace_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("workspaces.id", ondelete="CASCADE"),
        nullable=False,
    )

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    min_severity: Mapped[str] = mapped_column(String(16), nullable=False, default="SEV2")

    service_id: Mapped[UUID | None] = mapped_column(
        Uuid,
        ForeignKey("services.id", ondelete="SET NULL"),
        nullable=True,
    )
    repeat_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)

    # Relationships
    steps: Mapped[list["EscalationStep"]] = relationship(
        "EscalationStep",
        back_populates="policy",
        cascade="all, delete-orphan",
        order_by="EscalationStep.step_number",
    )


class EscalationStep(Base):
    """An ordered step in an escalation policy."""

    __tablename__ = "escalation_steps"
    __table_args__ = (
        UniqueConstraint("policy_id", "step_number", name="uq_escalation_step_policy_number"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    policy_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("escalation_policies.id", ondelete="CASCADE"),
        nullable=False,
    )
    step_number: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    target_type: Mapped[EscalationTargetType] = mapped_column(
        SAEnum(
            EscalationTargetType,
            name="escalation_target_type_enum",
            values_callable=enum_values,
            native_enum=False,
        ),
        nullable=False,
    )
    target_user_id: Mapped[UUID | None] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    target_schedule_id: Mapped[UUID | None] = mapped_column(
        Uuid,
        ForeignKey("on_call_schedules.id", ondelete="SET NULL"),
        nullable=True,
    )
    target_webhook_url: Mapped[str | None] = mapped_column(String(500), nullable=True)

    delay_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=15)

    policy: Mapped["EscalationPolicy"] = relationship("EscalationPolicy", back_populates="steps")


class EscalationExecution(Base):
    """Tracks active or completed execution of an escalation policy for an alert or incident."""

    __tablename__ = "escalation_executions"
    __table_args__ = (
        Index("ix_escalation_executions_workspace", "workspace_id"),
        Index("ix_escalation_executions_due", "status", "next_escalation_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    workspace_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("workspaces.id", ondelete="CASCADE"),
        nullable=False,
    )
    policy_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("escalation_policies.id", ondelete="CASCADE"),
        nullable=False,
    )

    alert_id: Mapped[UUID | None] = mapped_column(
        Uuid,
        ForeignKey("alerts.id", ondelete="CASCADE"),
        nullable=True,
    )
    incident_id: Mapped[UUID | None] = mapped_column(
        Uuid,
        ForeignKey("incidents.id", ondelete="CASCADE"),
        nullable=True,
    )

    current_step_number: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    status: Mapped[EscalationExecutionStatus] = mapped_column(
        SAEnum(
            EscalationExecutionStatus,
            name="escalation_execution_status_enum",
            values_callable=enum_values,
            native_enum=False,
        ),
        nullable=False,
        default=EscalationExecutionStatus.ACTIVE,
    )

    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    next_escalation_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    acknowledged_by_user_id: Mapped[UUID | None] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Audit history of steps executed: [{"step": 1, "executed_at": "...", "target_type": "...", "target_name": "...", "status": "..."}]
    history: Mapped[list[dict]] = mapped_column(
        JSONB().with_variant(JSON, "sqlite"),
        nullable=False,
        default=list,
    )

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
