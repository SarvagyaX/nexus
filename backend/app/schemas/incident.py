"""Validated incident API contracts."""

from datetime import datetime, timezone
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models.incident import IncidentSeverity, IncidentStatus, SeveritySource


def _text(value: str | None) -> str | None:
    if value is None:
        return None
    result = value.strip()
    if not result:
        raise ValueError("Value must not be empty")
    return result


class IncidentCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    service_id: UUID
    title: str = Field(min_length=1, max_length=240)
    summary: str | None = Field(default=None, max_length=4000)
    severity: IncidentSeverity
    detected_at: datetime
    started_at: datetime | None = None

    @field_validator("title", "summary")
    @classmethod
    def clean_text(cls, value):
        return _text(value)

    @field_validator("detected_at", "started_at")
    @classmethod
    def aware_datetime(cls, value):
        if value is not None and value.tzinfo is None:
            raise ValueError("Datetime must include a timezone")
        return value


class IncidentPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str | None = Field(default=None, min_length=1, max_length=240)
    summary: str | None = Field(default=None, max_length=4000)
    severity: IncidentSeverity | None = None
    assignee_user_id: UUID | None = None

    @field_validator("title", "summary")
    @classmethod
    def clean_text(cls, value):
        return _text(value)

    @model_validator(mode="after")
    def non_empty_patch(self):
        if not self.model_fields_set:
            raise ValueError("At least one incident field is required")
        if any(getattr(self, key) is None for key in self.model_fields_set if key in {"title", "severity"}):
            raise ValueError("Field cannot be null")
        return self


class IncidentTransition(BaseModel):
    model_config = ConfigDict(extra="forbid")
    to_status: IncidentStatus
    reason: str | None = Field(default=None, max_length=4000)
    resolution_summary: str | None = Field(default=None, max_length=4000)

    @field_validator("reason", "resolution_summary")
    @classmethod
    def clean_text(cls, value):
        return _text(value)

    @model_validator(mode="after")
    def resolution_required(self):
        if self.to_status == IncidentStatus.RESOLVED and not self.resolution_summary:
            raise ValueError("resolution_summary is required when resolving an incident")
        if self.to_status != IncidentStatus.RESOLVED and self.resolution_summary is not None:
            raise ValueError("resolution_summary is only valid when resolving")
        return self


class IncidentNote(BaseModel):
    model_config = ConfigDict(extra="forbid")
    body: str = Field(min_length=1, max_length=4000)

    @field_validator("body")
    @classmethod
    def clean_body(cls, value):
        return _text(value)


class ServiceSummary(BaseModel):
    id: UUID
    name: str
    service_key: str


class AssigneeSummary(BaseModel):
    id: UUID
    display_name: str
    email: str


class IncidentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    workspace_id: UUID
    service_id: UUID
    reference: str
    title: str
    summary: str | None
    severity: IncidentSeverity
    status: IncidentStatus
    severity_source: SeveritySource
    assignee_user_id: UUID | None
    detected_at: datetime
    started_at: datetime | None
    resolved_at: datetime | None
    resolution_summary: str | None
    created_by_user_id: UUID | None
    created_at: datetime
    updated_at: datetime
    service: ServiceSummary | None = None
    assignee: AssigneeSummary | None = None


class IncidentEventResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    workspace_id: UUID
    incident_id: UUID
    actor_user_id: UUID | None
    event_type: str
    body: str | None
    payload: dict
    created_at: datetime


class IncidentPage(BaseModel):
    limit: int
    next_cursor: str | None
    has_more: bool


class IncidentListResponse(BaseModel):
    items: list[IncidentResponse]
    page: IncidentPage


class IncidentEventListResponse(BaseModel):
    items: list[IncidentEventResponse]
    page: IncidentPage
