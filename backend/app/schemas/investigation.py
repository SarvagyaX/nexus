"""Pydantic schemas for agentic AI investigation engine."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.models.investigation import (
    EvidenceType,
    InvestigationStatus,
    RecommendationStatus,
)


class InvestigationCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    incident_id: UUID


class EvidenceResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    workspace_id: UUID
    investigation_id: UUID
    evidence_type: EvidenceType
    source_id: str
    title: str
    summary: str
    data: dict = Field(default_factory=dict)
    collected_at: datetime


class HypothesisResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    workspace_id: UUID
    investigation_id: UUID
    title: str
    description: str
    likelihood: str
    confidence_score: float
    supporting_evidence: list = Field(default_factory=list)
    contradicting_evidence: list = Field(default_factory=list)
    is_primary: bool
    created_at: datetime


class RecommendationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    workspace_id: UUID
    investigation_id: UUID
    title: str
    description: str
    action_type: str
    priority: str
    rationale: str
    status: RecommendationStatus
    reviewed_by_user_id: UUID | None = None
    reviewed_at: datetime | None = None
    review_notes: str | None = None
    created_at: datetime


class RecommendationReviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: RecommendationStatus
    review_notes: str | None = Field(default=None, max_length=2000)


class InvestigationSummaryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    workspace_id: UUID
    incident_id: UUID
    status: InvestigationStatus
    summary: str | None = None
    confidence_score: float | None = None
    error_message: str | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    created_by_user_id: UUID | None = None
    created_at: datetime
    updated_at: datetime

    incident_title: str | None = None
    incident_severity: str | None = None
    evidence_count: int = 0
    hypotheses_count: int = 0
    recommendations_count: int = 0


class InvestigationDetailResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    workspace_id: UUID
    incident_id: UUID
    status: InvestigationStatus
    summary: str | None = None
    confidence_score: float | None = None
    error_message: str | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    created_by_user_id: UUID | None = None
    created_at: datetime
    updated_at: datetime

    incident_title: str | None = None
    incident_severity: str | None = None
    incident_service_id: UUID | None = None
    incident_service_name: str | None = None

    evidence: list[EvidenceResponse] = Field(default_factory=list)
    hypotheses: list[HypothesisResponse] = Field(default_factory=list)
    recommendations: list[RecommendationResponse] = Field(default_factory=list)


class InvestigationListResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    items: list[InvestigationSummaryResponse]
    next_cursor: str | None = None


class ProviderStatusResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    provider: str
    model: str
    is_available: bool
    message: str
