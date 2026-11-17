"""Workspace-owned service registry records."""

from datetime import datetime, timezone
from enum import Enum
from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint, DateTime, Enum as SAEnum, ForeignKey, Index, String, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class ServiceStatus(str, Enum):
    ACTIVE = "active"
    ARCHIVED = "archived"


def enum_values(enum_type: type[Enum]) -> list[str]:
    return [member.value for member in enum_type]


class Service(Base):
    __tablename__ = "services"
    __table_args__ = (
        UniqueConstraint("workspace_id", "service_key", name="uq_service_workspace_key"),
        UniqueConstraint("workspace_id", "id", name="uq_service_workspace_id"),
        CheckConstraint("length(trim(name)) > 0", name="ck_service_name_nonempty"),
        CheckConstraint("length(trim(service_key)) > 0", name="ck_service_key_nonempty"),
        CheckConstraint("service_key = lower(service_key)", name="ck_service_key_lowercase"),
        Index("ix_service_workspace_status_name", "workspace_id", "status", "name", "id"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    workspace_id: Mapped[UUID] = mapped_column(
        ForeignKey("workspaces.id", ondelete="RESTRICT"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    service_key: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    owner_team: Mapped[str | None] = mapped_column(String(160), nullable=True)
    environment: Mapped[str | None] = mapped_column(String(80), nullable=True)
    repository_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    status: Mapped[ServiceStatus] = mapped_column(
        SAEnum(
            ServiceStatus,
            name="service_status",
            native_enum=False,
            create_constraint=True,
            values_callable=enum_values,
        ),
        nullable=False,
        default=ServiceStatus.ACTIVE,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now, onupdate=utc_now
    )

    workspace = relationship("Workspace")
