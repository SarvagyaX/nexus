"""Identity, workspace membership, session, and authentication audit models."""

from datetime import datetime, timezone
from enum import Enum
from uuid import UUID, uuid4

from sqlalchemy import (
    JSON,
    CheckConstraint,
    DateTime,
    Enum as SAEnum,
    ForeignKey,
    Index,
    String,
    UniqueConstraint,
    Uuid,
    event,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def enum_values(enum_type: type[Enum]) -> list[str]:
    return [member.value for member in enum_type]


class WorkspaceStatus(str, Enum):
    ACTIVE = "active"
    SUSPENDED = "suspended"


class UserStatus(str, Enum):
    ACTIVE = "active"
    DISABLED = "disabled"


class WorkspaceRole(str, Enum):
    ADMIN = "admin"
    RESPONDER = "responder"
    COMMANDER = "commander"
    VIEWER = "viewer"


class ActorType(str, Enum):
    USER = "user"
    SYSTEM = "system"
    ANONYMOUS = "anonymous"


class Workspace(Base):
    __tablename__ = "workspaces"

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    slug: Mapped[str] = mapped_column(String(80), nullable=False, unique=True)
    status: Mapped[WorkspaceStatus] = mapped_column(
        SAEnum(WorkspaceStatus, name="workspace_status", native_enum=False, create_constraint=True, values_callable=enum_values),
        nullable=False,
        default=WorkspaceStatus.ACTIVE,
    )
    is_demo: Mapped[bool] = mapped_column(nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now, onupdate=utc_now)

    memberships: Mapped[list["Membership"]] = relationship(back_populates="workspace", cascade="all, delete-orphan")


class User(Base):
    __tablename__ = "users"
    __table_args__ = (CheckConstraint("email = lower(email)", name="ck_user_email_normalized"),)

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    email: Mapped[str] = mapped_column(String(320), nullable=False, unique=True)
    display_name: Mapped[str] = mapped_column(String(160), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(512), nullable=False)
    status: Mapped[UserStatus] = mapped_column(
        SAEnum(UserStatus, name="user_status", native_enum=False, create_constraint=True, values_callable=enum_values),
        nullable=False,
        default=UserStatus.ACTIVE,
    )
    is_demo: Mapped[bool] = mapped_column(nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now, onupdate=utc_now)

    memberships: Mapped[list["Membership"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    sessions: Mapped[list["SessionRecord"]] = relationship(back_populates="user", cascade="all, delete-orphan")


class Membership(Base):
    __tablename__ = "workspace_memberships"
    __table_args__ = (
        UniqueConstraint("workspace_id", "user_id", name="uq_membership_workspace_user"),
        Index("ix_membership_user_workspace", "user_id", "workspace_id"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    workspace_id: Mapped[UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    role: Mapped[WorkspaceRole] = mapped_column(
        SAEnum(WorkspaceRole, name="workspace_role", native_enum=False, create_constraint=True, values_callable=enum_values),
        nullable=False,
    )
    is_seeded: Mapped[bool] = mapped_column(nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now, onupdate=utc_now)

    workspace: Mapped[Workspace] = relationship(back_populates="memberships")
    user: Mapped[User] = relationship(back_populates="memberships")


class SessionRecord(Base):
    __tablename__ = "user_sessions"
    __table_args__ = (
        Index("ix_session_user_active_expiry", "user_id", "revoked_at", "expires_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    csrf_token_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped[User] = relationship(back_populates="sessions")


class AuditEvent(Base):
    __tablename__ = "audit_events"
    __table_args__ = (
        Index("ix_audit_workspace_created", "workspace_id", "created_at"),
        Index("ix_audit_entity_created", "entity_type", "entity_id", "created_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    workspace_id: Mapped[UUID | None] = mapped_column(ForeignKey("workspaces.id", ondelete="SET NULL"), nullable=True)
    actor_user_id: Mapped[UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    actor_type: Mapped[ActorType] = mapped_column(
        SAEnum(ActorType, name="audit_actor_type", native_enum=False, create_constraint=True, values_callable=enum_values), nullable=False
    )
    action: Mapped[str] = mapped_column(String(100), nullable=False)
    entity_type: Mapped[str] = mapped_column(String(100), nullable=False)
    entity_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), nullable=True)
    request_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    source_ip: Mapped[str | None] = mapped_column(String(64), nullable=True)
    details: Mapped[dict] = mapped_column(JSON().with_variant(JSONB, "postgresql"), nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)


@event.listens_for(AuditEvent, "before_update")
def prevent_audit_update(_mapper, _connection, _target) -> None:
    raise ValueError("Audit events are append-only")


@event.listens_for(AuditEvent, "before_delete")
def prevent_audit_delete(_mapper, _connection, _target) -> None:
    raise ValueError("Audit events are append-only")
