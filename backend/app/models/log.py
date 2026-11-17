"""Workspace-scoped structured log records."""

from datetime import datetime, timezone
from enum import Enum
from uuid import UUID, uuid4

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Enum as SAEnum,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
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


class LogSeverity(str, Enum):
    DEBUG = "DEBUG"
    INFO = "INFO"
    WARN = "WARN"
    ERROR = "ERROR"
    FATAL = "FATAL"


class LogRecord(Base):
    __tablename__ = "log_records"
    __table_args__ = (
        UniqueConstraint("workspace_id", "id", name="uq_log_record_workspace_id"),
        ForeignKeyConstraint(
            ["workspace_id", "service_id"],
            ["services.workspace_id", "services.id"],
            name="fk_log_record_workspace_service",
            ondelete="RESTRICT",
        ),
        CheckConstraint("length(trim(message)) > 0", name="ck_log_record_message_nonempty"),
        Index("ix_log_record_workspace_timestamp_id", "workspace_id", "timestamp", "id"),
        Index("ix_log_record_workspace_service_timestamp", "workspace_id", "service_id", "timestamp", "id"),
        Index("ix_log_record_workspace_severity_timestamp", "workspace_id", "severity", "timestamp", "id"),
        Index("ix_log_record_workspace_trace_timestamp", "workspace_id", "trace_id", "timestamp"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    workspace_id: Mapped[UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="RESTRICT"), nullable=False)
    service_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    severity: Mapped[LogSeverity] = mapped_column(
        SAEnum(
            LogSeverity,
            name="log_severity",
            native_enum=False,
            create_constraint=True,
            values_callable=enum_values,
        ),
        nullable=False,
        default=LogSeverity.INFO,
    )
    trace_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    attributes: Mapped[dict] = mapped_column(
        JSON().with_variant(JSONB, "postgresql"),
        nullable=False,
        default=dict,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)

    workspace = relationship("Workspace")
    service = relationship("Service", overlaps="workspace")
