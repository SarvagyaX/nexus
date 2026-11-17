"""Workspace-scoped agentic AI investigation models."""

from datetime import datetime, timezone
from enum import Enum
from uuid import UUID, uuid4

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum as SAEnum,
    Float,
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


class InvestigationStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class EvidenceType(str, Enum):
    LOG = "log"
    INCIDENT = "incident"
    SERVICE = "service"
    METRIC = "metric"


class RecommendationStatus(str, Enum):
    PENDING_APPROVAL = "pending_approval"
    APPROVED = "approved"
    REJECTED = "rejected"


class Investigation(Base):
    __tablename__ = "investigations"
    __table_args__ = (
        UniqueConstraint("workspace_id", "id", name="uq_investigation_workspace_id"),
        ForeignKeyConstraint(
            ["workspace_id", "incident_id"],
            ["incidents.workspace_id", "incidents.id"],
            name="fk_investigation_workspace_incident",
            ondelete="CASCADE",
        ),
        Index("ix_investigation_workspace_status_created", "workspace_id", "status", "created_at"),
        Index("ix_investigation_workspace_incident_created", "workspace_id", "incident_id", "created_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    workspace_id: Mapped[UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="RESTRICT"), nullable=False)
    incident_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    status: Mapped[InvestigationStatus] = mapped_column(
        SAEnum(
            InvestigationStatus,
            name="investigation_status",
            native_enum=False,
            create_constraint=True,
            values_callable=enum_values,
        ),
        nullable=False,
        default=InvestigationStatus.PENDING,
    )
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    confidence_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by_user_id: Mapped[UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now, onupdate=utc_now)

    workspace = relationship("Workspace")
    incident = relationship("Incident", overlaps="workspace")
    created_by = relationship("User")

    evidence: Mapped[list["InvestigationEvidence"]] = relationship(
        back_populates="investigation", cascade="all, delete-orphan", order_by="InvestigationEvidence.collected_at"
    )
    hypotheses: Mapped[list["InvestigationHypothesis"]] = relationship(
        back_populates="investigation", cascade="all, delete-orphan", order_by="InvestigationHypothesis.confidence_score.desc()"
    )
    recommendations: Mapped[list["InvestigationRecommendation"]] = relationship(
        back_populates="investigation", cascade="all, delete-orphan", order_by="InvestigationRecommendation.created_at"
    )


class InvestigationEvidence(Base):
    __tablename__ = "investigation_evidence"
    __table_args__ = (
        UniqueConstraint("workspace_id", "id", name="uq_investigation_evidence_workspace_id"),
        ForeignKeyConstraint(
            ["workspace_id", "investigation_id"],
            ["investigations.workspace_id", "investigations.id"],
            name="fk_evidence_workspace_investigation",
            ondelete="CASCADE",
        ),
        Index("ix_evidence_workspace_investigation_collected", "workspace_id", "investigation_id", "collected_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    workspace_id: Mapped[UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="RESTRICT"), nullable=False)
    investigation_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    evidence_type: Mapped[EvidenceType] = mapped_column(
        SAEnum(
            EvidenceType,
            name="evidence_type",
            native_enum=False,
            create_constraint=True,
            values_callable=enum_values,
        ),
        nullable=False,
    )
    source_id: Mapped[str] = mapped_column(String(128), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    data: Mapped[dict] = mapped_column(JSON().with_variant(JSONB, "postgresql"), nullable=False, default=dict)
    collected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)

    investigation: Mapped["Investigation"] = relationship(back_populates="evidence")


class InvestigationHypothesis(Base):
    __tablename__ = "investigation_hypotheses"
    __table_args__ = (
        UniqueConstraint("workspace_id", "id", name="uq_investigation_hypothesis_workspace_id"),
        ForeignKeyConstraint(
            ["workspace_id", "investigation_id"],
            ["investigations.workspace_id", "investigations.id"],
            name="fk_hypothesis_workspace_investigation",
            ondelete="CASCADE",
        ),
        Index("ix_hypothesis_workspace_investigation_primary", "workspace_id", "investigation_id", "is_primary"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    workspace_id: Mapped[UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="RESTRICT"), nullable=False)
    investigation_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    likelihood: Mapped[str] = mapped_column(String(32), nullable=False, default="medium")
    confidence_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.5)
    supporting_evidence: Mapped[list] = mapped_column(JSON().with_variant(JSONB, "postgresql"), nullable=False, default=list)
    contradicting_evidence: Mapped[list] = mapped_column(JSON().with_variant(JSONB, "postgresql"), nullable=False, default=list)
    is_primary: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)

    investigation: Mapped["Investigation"] = relationship(back_populates="hypotheses")


class InvestigationRecommendation(Base):
    __tablename__ = "investigation_recommendations"
    __table_args__ = (
        UniqueConstraint("workspace_id", "id", name="uq_investigation_recommendation_workspace_id"),
        ForeignKeyConstraint(
            ["workspace_id", "investigation_id"],
            ["investigations.workspace_id", "investigations.id"],
            name="fk_recommendation_workspace_investigation",
            ondelete="CASCADE",
        ),
        Index("ix_recommendation_workspace_investigation_status", "workspace_id", "investigation_id", "status"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    workspace_id: Mapped[UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="RESTRICT"), nullable=False)
    investigation_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    action_type: Mapped[str] = mapped_column(String(64), nullable=False, default="mitigation")
    priority: Mapped[str] = mapped_column(String(16), nullable=False, default="P2")
    rationale: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[RecommendationStatus] = mapped_column(
        SAEnum(
            RecommendationStatus,
            name="recommendation_status",
            native_enum=False,
            create_constraint=True,
            values_callable=enum_values,
        ),
        nullable=False,
        default=RecommendationStatus.PENDING_APPROVAL,
    )
    reviewed_by_user_id: Mapped[UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    review_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)

    investigation: Mapped["Investigation"] = relationship(back_populates="recommendations")
    reviewed_by = relationship("User")
