"""Pydantic schemas for notifications, preferences, on-call schedules, and escalation policies."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.notification import (
    EscalationExecutionStatus,
    EscalationTargetType,
    NotificationCategory,
    NotificationDeliveryChannel,
    NotificationDeliveryStatus,
    OnCallRotationType,
)


# ============================================================================
# Notification Delivery Schemas
# ============================================================================

class NotificationDeliveryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    notification_id: UUID
    channel: NotificationDeliveryChannel
    recipient_target: str
    status: NotificationDeliveryStatus
    attempts: int
    error_message: str | None = None
    sent_at: datetime | None = None
    created_at: datetime


# ============================================================================
# Notification Schemas
# ============================================================================

class NotificationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    workspace_id: UUID
    user_id: UUID
    category: NotificationCategory
    severity: str
    title: str
    message: str
    link: str | None = None
    entity_type: str | None = None
    entity_id: UUID | None = None
    is_read: bool
    read_at: datetime | None = None
    created_at: datetime
    deliveries: list[NotificationDeliveryResponse] = Field(default_factory=list)


class NotificationListResponse(BaseModel):
    items: list[NotificationResponse]
    total_unread: int
    next_cursor: str | None = None


class UnreadCountResponse(BaseModel):
    unread_count: int


class MarkReadRequest(BaseModel):
    notification_ids: list[UUID] | None = None


# ============================================================================
# Notification Preferences Schemas
# ============================================================================

class NotificationPreferenceResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    workspace_id: UUID
    user_id: UUID
    alerts_enabled: bool
    alerts_min_severity: str
    incidents_enabled: bool
    incidents_min_severity: str
    investigations_enabled: bool
    assignments_enabled: bool
    in_app_enabled: bool
    email_enabled: bool
    webhook_enabled: bool
    webhook_url: str | None = None
    updated_at: datetime


class NotificationPreferenceUpdate(BaseModel):
    alerts_enabled: bool | None = None
    alerts_min_severity: str | None = None
    incidents_enabled: bool | None = None
    incidents_min_severity: str | None = None
    investigations_enabled: bool | None = None
    assignments_enabled: bool | None = None
    in_app_enabled: bool | None = None
    email_enabled: bool | None = None
    webhook_enabled: bool | None = None
    webhook_url: str | None = None


# ============================================================================
# Provider Status & Test Webhook Schemas
# ============================================================================

class ProviderStatusItem(BaseModel):
    name: str
    channel: NotificationDeliveryChannel
    is_available: bool
    description: str


class NotificationProvidersStatusResponse(BaseModel):
    providers: list[ProviderStatusItem]


class TestWebhookRequest(BaseModel):
    webhook_url: str = Field(..., max_length=500)


class TestWebhookResponse(BaseModel):
    success: bool
    status_code: int | None = None
    message: str
    duration_ms: float


# ============================================================================
# On-Call Schedule Schemas
# ============================================================================

class OnCallMember(BaseModel):
    user_id: str | None = None
    name: str
    email: str | None = None
    phone: str | None = None
    order: int = 0


class OnCallScheduleCreate(BaseModel):
    name: str = Field(..., min_length=2, max_length=200)
    description: str | None = None
    timezone: str = Field(default="UTC", max_length=64)
    is_active: bool = True
    rotation_type: OnCallRotationType = OnCallRotationType.WEEKLY
    rotation_interval_days: int = Field(default=7, ge=1, le=365)
    shift_start_time: datetime | None = None
    handover_hour: int = Field(default=9, ge=0, le=23)
    members: list[OnCallMember] = Field(default_factory=list)


class OnCallScheduleUpdate(BaseModel):
    name: str | None = Field(None, min_length=2, max_length=200)
    description: str | None = None
    timezone: str | None = None
    is_active: bool | None = None
    rotation_type: OnCallRotationType | None = None
    rotation_interval_days: int | None = Field(None, ge=1, le=365)
    shift_start_time: datetime | None = None
    handover_hour: int | None = Field(None, ge=0, le=23)
    members: list[OnCallMember] | None = None


class CurrentOnCallResponse(BaseModel):
    schedule_id: UUID
    schedule_name: str
    timezone: str
    is_active: bool
    current_user: OnCallMember | None = None
    shift_start: datetime | None = None
    shift_end: datetime | None = None


class OnCallScheduleResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    workspace_id: UUID
    name: str
    description: str | None = None
    timezone: str
    is_active: bool
    rotation_type: OnCallRotationType
    rotation_interval_days: int
    shift_start_time: datetime
    handover_hour: int
    members: list[dict]
    created_at: datetime
    updated_at: datetime
    current_on_call: OnCallMember | None = None


# ============================================================================
# Escalation Policy Schemas
# ============================================================================

class EscalationStepCreate(BaseModel):
    step_number: int = Field(..., ge=1, le=20)
    target_type: EscalationTargetType
    target_user_id: UUID | None = None
    target_schedule_id: UUID | None = None
    target_webhook_url: str | None = None
    delay_minutes: int = Field(default=15, ge=0, le=1440)

    @field_validator("target_type", mode="before")
    @classmethod
    def normalize_target_type(cls, v):
        if v == "schedule":
            return EscalationTargetType.ON_CALL_SCHEDULE
        return v


class EscalationStepResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    policy_id: UUID
    step_number: int
    target_type: EscalationTargetType
    target_user_id: UUID | None = None
    target_schedule_id: UUID | None = None
    target_webhook_url: str | None = None
    delay_minutes: int


class EscalationPolicyCreate(BaseModel):
    name: str = Field(..., min_length=2, max_length=200)
    description: str | None = None
    is_active: bool = True
    min_severity: str = Field(default="SEV2", max_length=16)
    service_id: UUID | None = None
    repeat_count: int = Field(default=0, ge=0, le=10)
    steps: list[EscalationStepCreate] = Field(..., min_length=1)


class EscalationPolicyUpdate(BaseModel):
    name: str | None = Field(None, min_length=2, max_length=200)
    description: str | None = None
    is_active: bool | None = None
    min_severity: str | None = None
    service_id: UUID | None = None
    repeat_count: int | None = Field(None, ge=0, le=10)
    steps: list[EscalationStepCreate] | None = None


class EscalationPolicyResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    workspace_id: UUID
    name: str
    description: str | None = None
    is_active: bool
    min_severity: str
    service_id: UUID | None = None
    repeat_count: int
    created_at: datetime
    updated_at: datetime
    steps: list[EscalationStepResponse] = Field(default_factory=list)


class EscalationExecutionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    workspace_id: UUID
    policy_id: UUID
    alert_id: UUID | None = None
    incident_id: UUID | None = None
    current_step_number: int
    status: EscalationExecutionStatus
    started_at: datetime
    next_escalation_at: datetime | None = None
    acknowledged_at: datetime | None = None
    acknowledged_by_user_id: UUID | None = None
    resolved_at: datetime | None = None
    history: list[dict] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime
