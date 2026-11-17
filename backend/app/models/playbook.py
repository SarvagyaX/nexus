"""Workspace-scoped workflow automation, playbook definitions, and execution tracking models."""

from datetime import datetime, timezone
from enum import Enum
from uuid import UUID, uuid4

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Enum as SAEnum,
    ForeignKey,
    Index,
    Integer,
    JSON,
    String,
    Text,
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

class PlaybookStatus(str, Enum):
    DRAFT = "draft"
    ACTIVE = "active"
    INACTIVE = "inactive"
    ARCHIVED = "archived"


class PlaybookTriggerType(str, Enum):
    MANUAL = "manual"
    ALERT_CREATED = "alert_created"
    INCIDENT_CREATED = "incident_created"
    INCIDENT_SEVERITY_CHANGED = "incident_severity_changed"
    INCIDENT_ASSIGNED = "incident_assigned"


class PlaybookActionType(str, Enum):
    CREATE_INCIDENT_NOTE = "create_incident_note"
    ASSIGN_INCIDENT = "assign_incident"
    CHANGE_INCIDENT_SEVERITY = "change_incident_severity"
    SEND_NOTIFICATION = "send_notification"
    TRIGGER_INVESTIGATION = "trigger_investigation"
    SEND_WEBHOOK = "send_webhook"
    WAIT_DURATION = "wait_duration"
    REQUIRE_APPROVAL = "require_approval"


class PlaybookExecutionStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    AWAITING_APPROVAL = "awaiting_approval"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class PlaybookStepExecutionStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    AWAITING_APPROVAL = "awaiting_approval"
    COMPLETED = "completed"
    FAILED = "failed"
    SKIPPED = "skipped"
    CANCELLED = "cancelled"


class PlaybookApprovalStatus(str, Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    CANCELLED = "cancelled"


# ============================================================================
# Playbook Models
# ============================================================================

class Playbook(Base):
    """Playbook definition representing an automated or semi-automated operational workflow."""

    __tablename__ = "playbooks"
    __table_args__ = (
        Index("ix_playbooks_workspace_status", "workspace_id", "status"),
        Index("ix_playbooks_workspace_trigger", "workspace_id", "trigger_type"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    workspace_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("workspaces.id", ondelete="CASCADE"),
        nullable=False,
    )

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    category: Mapped[str] = mapped_column(String(64), nullable=False, default="general")

    status: Mapped[PlaybookStatus] = mapped_column(
        SAEnum(
            PlaybookStatus,
            name="playbook_status_enum",
            values_callable=enum_values,
            native_enum=False,
        ),
        nullable=False,
        default=PlaybookStatus.DRAFT,
    )

    trigger_type: Mapped[PlaybookTriggerType] = mapped_column(
        SAEnum(
            PlaybookTriggerType,
            name="playbook_trigger_type_enum",
            values_callable=enum_values,
            native_enum=False,
        ),
        nullable=False,
        default=PlaybookTriggerType.MANUAL,
    )

    # Condition configuration: e.g. {"severity_in": ["SEV1", "SEV2"], "service_ids": [...]}
    trigger_config: Mapped[dict] = mapped_column(
        JSONB().with_variant(JSON, "sqlite"),
        nullable=False,
        default=dict,
    )

    # Allowed severities for easy filtering e.g. ["SEV1", "SEV2"]
    severity_applicability: Mapped[list[str]] = mapped_column(
        JSONB().with_variant(JSON, "sqlite"),
        nullable=False,
        default=list,
    )

    is_template: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    template_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    execution_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_executed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_by_user_id: Mapped[UUID | None] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)

    # Ordered list of workflow steps
    steps: Mapped[list["PlaybookStep"]] = relationship(
        "PlaybookStep",
        back_populates="playbook",
        cascade="all, delete-orphan",
        order_by="PlaybookStep.step_order",
    )

    executions: Mapped[list["PlaybookExecution"]] = relationship(
        "PlaybookExecution",
        back_populates="playbook",
        cascade="all, delete-orphan",
        order_by="PlaybookExecution.created_at.desc()",
    )


class PlaybookStep(Base):
    """An individual ordered action step within a playbook."""

    __tablename__ = "playbook_steps"
    __table_args__ = (
        Index("ix_playbook_steps_playbook_order", "playbook_id", "step_order"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    workspace_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("workspaces.id", ondelete="CASCADE"),
        nullable=False,
    )
    playbook_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("playbooks.id", ondelete="CASCADE"),
        nullable=False,
    )

    step_order: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    name: Mapped[str] = mapped_column(String(200), nullable=False)

    action_type: Mapped[PlaybookActionType] = mapped_column(
        SAEnum(
            PlaybookActionType,
            name="playbook_action_type_enum",
            values_callable=enum_values,
            native_enum=False,
        ),
        nullable=False,
    )

    action_config: Mapped[dict] = mapped_column(
        JSONB().with_variant(JSON, "sqlite"),
        nullable=False,
        default=dict,
    )

    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    continue_on_failure: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    timeout_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=60)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)

    playbook: Mapped["Playbook"] = relationship("Playbook", back_populates="steps")


# ============================================================================
# Playbook Execution Models
# ============================================================================

class PlaybookExecution(Base):
    """Record of an instantiated playbook execution."""

    __tablename__ = "playbook_executions"
    __table_args__ = (
        Index("ix_playbook_executions_workspace_status", "workspace_id", "status"),
        Index("ix_playbook_executions_playbook", "playbook_id"),
        Index("ix_playbook_executions_dedup", "workspace_id", "playbook_id", "trigger_event_id"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    workspace_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("workspaces.id", ondelete="CASCADE"),
        nullable=False,
    )
    playbook_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("playbooks.id", ondelete="CASCADE"),
        nullable=False,
    )

    trigger_type: Mapped[PlaybookTriggerType] = mapped_column(
        SAEnum(
            PlaybookTriggerType,
            name="playbook_trigger_type_enum",
            values_callable=enum_values,
            native_enum=False,
        ),
        nullable=False,
        default=PlaybookTriggerType.MANUAL,
    )

    trigger_event_id: Mapped[str | None] = mapped_column(String(120), nullable=True)

    status: Mapped[PlaybookExecutionStatus] = mapped_column(
        SAEnum(
            PlaybookExecutionStatus,
            name="playbook_execution_status_enum",
            values_callable=enum_values,
            native_enum=False,
        ),
        nullable=False,
        default=PlaybookExecutionStatus.PENDING,
    )

    incident_id: Mapped[UUID | None] = mapped_column(
        Uuid,
        ForeignKey("incidents.id", ondelete="SET NULL"),
        nullable=True,
    )

    alert_id: Mapped[UUID | None] = mapped_column(
        Uuid,
        ForeignKey("alerts.id", ondelete="SET NULL"),
        nullable=True,
    )

    triggered_by_user_id: Mapped[UUID | None] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )

    current_step_order: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    context: Mapped[dict] = mapped_column(
        JSONB().with_variant(JSON, "sqlite"),
        nullable=False,
        default=dict,
    )

    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)

    playbook: Mapped["Playbook"] = relationship("Playbook", back_populates="executions")
    step_executions: Mapped[list["PlaybookStepExecution"]] = relationship(
        "PlaybookStepExecution",
        back_populates="execution",
        cascade="all, delete-orphan",
        order_by="PlaybookStepExecution.step_order",
    )
    approvals: Mapped[list["PlaybookApprovalRequest"]] = relationship(
        "PlaybookApprovalRequest",
        back_populates="execution",
        cascade="all, delete-orphan",
    )


class PlaybookStepExecution(Base):
    """Execution status and output of a specific playbook step."""

    __tablename__ = "playbook_step_executions"
    __table_args__ = (
        Index("ix_playbook_step_executions_exec_order", "execution_id", "step_order"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    workspace_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("workspaces.id", ondelete="CASCADE"),
        nullable=False,
    )
    execution_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("playbook_executions.id", ondelete="CASCADE"),
        nullable=False,
    )
    step_id: Mapped[UUID | None] = mapped_column(
        Uuid,
        ForeignKey("playbook_steps.id", ondelete="SET NULL"),
        nullable=True,
    )

    step_order: Mapped[int] = mapped_column(Integer, nullable=False)
    step_name: Mapped[str] = mapped_column(String(200), nullable=False)

    action_type: Mapped[PlaybookActionType] = mapped_column(
        SAEnum(
            PlaybookActionType,
            name="playbook_action_type_enum",
            values_callable=enum_values,
            native_enum=False,
        ),
        nullable=False,
    )

    status: Mapped[PlaybookStepExecutionStatus] = mapped_column(
        SAEnum(
            PlaybookStepExecutionStatus,
            name="playbook_step_execution_status_enum",
            values_callable=enum_values,
            native_enum=False,
        ),
        nullable=False,
        default=PlaybookStepExecutionStatus.PENDING,
    )

    input_payload: Mapped[dict] = mapped_column(
        JSONB().with_variant(JSON, "sqlite"),
        nullable=False,
        default=dict,
    )

    output_payload: Mapped[dict] = mapped_column(
        JSONB().with_variant(JSON, "sqlite"),
        nullable=False,
        default=dict,
    )

    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    retry_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)

    execution: Mapped["PlaybookExecution"] = relationship("PlaybookExecution", back_populates="step_executions")
    approval: Mapped["PlaybookApprovalRequest | None"] = relationship(
        "PlaybookApprovalRequest",
        back_populates="step_execution",
        uselist=False,
    )


class PlaybookApprovalRequest(Base):
    """An approval request halting execution until human intervention."""

    __tablename__ = "playbook_approval_requests"
    __table_args__ = (
        Index("ix_playbook_approval_requests_exec_status", "execution_id", "status"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    workspace_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("workspaces.id", ondelete="CASCADE"),
        nullable=False,
    )
    execution_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("playbook_executions.id", ondelete="CASCADE"),
        nullable=False,
    )
    step_execution_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("playbook_step_executions.id", ondelete="CASCADE"),
        nullable=False,
    )

    prompt: Mapped[str] = mapped_column(String(1000), nullable=False)

    status: Mapped[PlaybookApprovalStatus] = mapped_column(
        SAEnum(
            PlaybookApprovalStatus,
            name="playbook_approval_status_enum",
            values_callable=enum_values,
            native_enum=False,
        ),
        nullable=False,
        default=PlaybookApprovalStatus.PENDING,
    )

    approver_user_id: Mapped[UUID | None] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )

    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    responded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)

    execution: Mapped["PlaybookExecution"] = relationship("PlaybookExecution", back_populates="approvals")
    step_execution: Mapped["PlaybookStepExecution"] = relationship("PlaybookStepExecution", back_populates="approval")
