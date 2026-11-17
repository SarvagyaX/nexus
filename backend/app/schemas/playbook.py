"""Pydantic schemas for Playbooks, steps, templates, and executions."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.models.playbook import (
    PlaybookActionType,
    PlaybookApprovalStatus,
    PlaybookExecutionStatus,
    PlaybookStatus,
    PlaybookStepExecutionStatus,
    PlaybookTriggerType,
)


# ============================================================================
# Step Schemas
# ============================================================================

class PlaybookStepCreate(BaseModel):
    name: str = Field(..., min_length=2, max_length=200)
    action_type: PlaybookActionType
    action_config: dict = Field(default_factory=dict)
    step_order: int = Field(default=1, ge=1, le=50)
    is_enabled: bool = True
    continue_on_failure: bool = False
    timeout_seconds: int = Field(default=60, ge=1, le=3600)


class PlaybookStepResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    playbook_id: UUID
    step_order: int
    name: str
    action_type: PlaybookActionType
    action_config: dict
    is_enabled: bool
    continue_on_failure: bool
    timeout_seconds: int
    created_at: datetime
    updated_at: datetime


# ============================================================================
# Playbook Schemas
# ============================================================================

class PlaybookCreate(BaseModel):
    name: str = Field(..., min_length=2, max_length=200)
    description: str | None = None
    category: str = Field(default="general", max_length=64)
    status: PlaybookStatus = PlaybookStatus.DRAFT
    trigger_type: PlaybookTriggerType = PlaybookTriggerType.MANUAL
    trigger_config: dict = Field(default_factory=dict)
    severity_applicability: list[str] = Field(default_factory=list)
    steps: list[PlaybookStepCreate] = Field(default_factory=list)


class PlaybookUpdate(BaseModel):
    name: str | None = Field(None, min_length=2, max_length=200)
    description: str | None = None
    category: str | None = None
    status: PlaybookStatus | None = None
    trigger_type: PlaybookTriggerType | None = None
    trigger_config: dict | None = None
    severity_applicability: list[str] | None = None
    steps: list[PlaybookStepCreate] | None = None


class PlaybookResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    workspace_id: UUID
    name: str
    description: str | None = None
    category: str
    status: PlaybookStatus
    trigger_type: PlaybookTriggerType
    trigger_config: dict
    severity_applicability: list[str]
    is_template: bool
    template_id: str | None = None
    version: int
    execution_count: int
    last_executed_at: datetime | None = None
    created_by_user_id: UUID | None = None
    created_at: datetime
    updated_at: datetime
    steps: list[PlaybookStepResponse] = Field(default_factory=list)


class PlaybookListResponse(BaseModel):
    items: list[PlaybookResponse]
    total: int


# ============================================================================
# Approval & Step Execution Schemas
# ============================================================================

class PlaybookApprovalRequestResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    execution_id: UUID
    step_execution_id: UUID
    prompt: str
    status: PlaybookApprovalStatus
    approver_user_id: UUID | None = None
    comment: str | None = None
    responded_at: datetime | None = None
    created_at: datetime


class PlaybookApprovalActionRequest(BaseModel):
    comment: str | None = Field(None, max_length=2000)


class PlaybookStepExecutionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    execution_id: UUID
    step_id: UUID | None = None
    step_order: int
    step_name: str
    action_type: PlaybookActionType
    status: PlaybookStepExecutionStatus
    input_payload: dict
    output_payload: dict
    error_message: str | None = None
    retry_count: int
    started_at: datetime | None = None
    completed_at: datetime | None = None
    duration_ms: int | None = None
    created_at: datetime
    approval: PlaybookApprovalRequestResponse | None = None


# ============================================================================
# Playbook Execution Schemas
# ============================================================================

class PlaybookManualExecuteRequest(BaseModel):
    incident_id: UUID | None = None
    alert_id: UUID | None = None
    context: dict = Field(default_factory=dict)


class PlaybookExecutionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    workspace_id: UUID
    playbook_id: UUID
    playbook_name: str | None = None
    trigger_type: PlaybookTriggerType
    trigger_event_id: str | None = None
    status: PlaybookExecutionStatus
    incident_id: UUID | None = None
    alert_id: UUID | None = None
    triggered_by_user_id: UUID | None = None
    current_step_order: int
    context: dict
    error_message: str | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    duration_ms: int | None = None
    created_at: datetime
    updated_at: datetime
    step_executions: list[PlaybookStepExecutionResponse] = Field(default_factory=list)
    pending_approval: PlaybookApprovalRequestResponse | None = None


class PlaybookExecutionListResponse(BaseModel):
    items: list[PlaybookExecutionResponse]
    total: int


# ============================================================================
# Playbook Template Schemas
# ============================================================================

class PlaybookTemplateResponse(BaseModel):
    id: str
    name: str
    description: str
    category: str
    trigger_type: PlaybookTriggerType
    trigger_config: dict
    severity_applicability: list[str]
    steps: list[PlaybookStepCreate]
