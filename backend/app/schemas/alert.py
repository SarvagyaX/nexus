"""Pydantic API contracts for real-time alerting & event management engine."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models.alert import AlertRuleCondition, AlertStatus
from app.models.incident import IncidentSeverity


def _text(value: str | None) -> str | None:
    if value is None:
        return None
    result = value.strip()
    if not result:
        raise ValueError("Value must not be empty")
    return result


# ============================================================================
# Alert Rule Schemas
# ============================================================================

class AlertRuleCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    enabled: bool = True
    severity: IncidentSeverity = IncidentSeverity.SEV2
    condition_type: AlertRuleCondition = AlertRuleCondition.ERROR_COUNT
    threshold: float = Field(gt=0, default=5.0)
    window_minutes: int = Field(ge=1, le=1440, default=5)
    cooldown_minutes: int = Field(ge=1, le=1440, default=15)
    service_id: UUID | None = None

    @field_validator("name", "description")
    @classmethod
    def clean_text(cls, value):
        return _text(value)


class AlertRulePatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    enabled: bool | None = None
    severity: IncidentSeverity | None = None
    condition_type: AlertRuleCondition | None = None
    threshold: float | None = Field(default=None, gt=0)
    window_minutes: int | None = Field(default=None, ge=1, le=1440)
    cooldown_minutes: int | None = Field(default=None, ge=1, le=1440)
    service_id: UUID | None = None

    @field_validator("name", "description")
    @classmethod
    def clean_text(cls, value):
        return _text(value)

    @model_validator(mode="after")
    def non_empty_patch(self):
        if not self.model_fields_set:
            raise ValueError("At least one field is required for update")
        return self


class AlertRuleResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    workspace_id: UUID
    service_id: UUID | None = None
    service_name: str | None = None
    name: str
    description: str | None = None
    enabled: bool
    severity: IncidentSeverity
    condition_type: AlertRuleCondition
    threshold: float
    window_minutes: int
    cooldown_minutes: int
    created_by_user_id: UUID | None = None
    created_at: datetime
    updated_at: datetime


class AlertRuleListResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    items: list[AlertRuleResponse]


# ============================================================================
# Alert Event Schemas
# ============================================================================

class AlertEventResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    workspace_id: UUID
    alert_id: UUID
    actor_user_id: UUID | None = None
    event_type: str
    message: str | None = None
    payload: dict = Field(default_factory=dict)
    created_at: datetime


# ============================================================================
# Alert Action Request Schemas
# ============================================================================

class AlertAcknowledgeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    note: str | None = Field(default=None, max_length=1000)


class AlertSnoozeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    duration_minutes: int = Field(ge=1, le=10080, default=60)  # up to 7 days


class AlertResolveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    resolution_note: str | None = Field(default=None, max_length=2000)


class AlertCreateIncidentRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str | None = Field(default=None, min_length=1, max_length=240)
    summary: str | None = Field(default=None, max_length=4000)
    severity: IncidentSeverity | None = None


# ============================================================================
# Alert Response Schemas
# ============================================================================

class AlertSummaryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    workspace_id: UUID
    rule_id: UUID | None = None
    service_id: UUID | None = None
    incident_id: UUID | None = None
    fingerprint: str
    title: str
    description: str | None = None
    severity: IncidentSeverity
    status: AlertStatus
    occurrence_count: int
    first_seen_at: datetime
    last_seen_at: datetime
    snoozed_until: datetime | None = None
    acknowledged_at: datetime | None = None
    acknowledged_by_user_id: UUID | None = None
    resolved_at: datetime | None = None
    resolved_by_user_id: UUID | None = None
    resolution_note: str | None = None
    data: dict = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime

    service_name: str | None = None
    rule_name: str | None = None
    incident_reference: str | None = None


class AlertDetailResponse(AlertSummaryResponse):
    events: list[AlertEventResponse] = Field(default_factory=list)


class AlertListResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    items: list[AlertSummaryResponse]
    next_cursor: str | None = None


class AlertGroupResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    group_key: str
    service_id: UUID | None = None
    service_name: str | None = None
    severity: IncidentSeverity
    status: AlertStatus
    alert_count: int
    total_occurrences: int
    latest_alert: AlertSummaryResponse
    alerts: list[AlertSummaryResponse]


class AlertGroupListResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    groups: list[AlertGroupResponse]


class AlertStatsResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    total_open: int = 0
    total_critical: int = 0
    total_acknowledged: int = 0
    total_snoozed: int = 0
    active_rules_count: int = 0
    severity_distribution: dict[str, int] = Field(default_factory=dict)


class AlertEvaluationResult(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    evaluated_rules_count: int
    new_alerts_count: int
    updated_alerts_count: int
    alerts: list[AlertSummaryResponse] = Field(default_factory=list)
