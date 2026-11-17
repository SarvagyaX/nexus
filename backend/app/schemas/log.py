"""Validated log Explorer API contracts."""

from datetime import datetime, timezone
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models.log import LogSeverity


def _clean_text(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    if not cleaned:
        raise ValueError("Value must not be empty")
    return cleaned


_SEVERITY_ALIASES = {
    "warn": LogSeverity.WARN,
    "warning": LogSeverity.WARN,
    "err": LogSeverity.ERROR,
    "error": LogSeverity.ERROR,
    "info": LogSeverity.INFO,
    "information": LogSeverity.INFO,
    "debug": LogSeverity.DEBUG,
    "dbg": LogSeverity.DEBUG,
    "fatal": LogSeverity.FATAL,
    "critical": LogSeverity.FATAL,
    "crit": LogSeverity.FATAL,
}


class LogCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    service_id: UUID
    timestamp: datetime | None = None
    severity: LogSeverity = LogSeverity.INFO
    trace_id: str | None = Field(default=None, max_length=64)
    message: str = Field(min_length=1, max_length=10000)
    attributes: dict = Field(default_factory=dict)

    @field_validator("message")
    @classmethod
    def validate_message(cls, value: str) -> str:
        cleaned = _clean_text(value)
        if not cleaned:
            raise ValueError("Log message must not be empty")
        return cleaned

    @field_validator("trace_id")
    @classmethod
    def clean_trace_id(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned if cleaned else None

    @field_validator("timestamp")
    @classmethod
    def aware_timestamp(cls, value: datetime | None) -> datetime | None:
        if value is not None and value.tzinfo is None:
            raise ValueError("Timestamp must include a timezone")
        return value

    @field_validator("severity", mode="before")
    @classmethod
    def normalize_severity(cls, value: object) -> LogSeverity:
        if isinstance(value, LogSeverity):
            return value
        if isinstance(value, str):
            normalized = value.strip().lower()
            if normalized in _SEVERITY_ALIASES:
                return _SEVERITY_ALIASES[normalized]
            try:
                return LogSeverity(value.strip().upper())
            except ValueError:
                pass
        raise ValueError(f"Invalid severity: {value}. Must be one of DEBUG, INFO, WARN, ERROR, FATAL.")


class LogBatchIngest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[LogCreate] = Field(min_length=1, max_length=500)


class LogServiceSummary(BaseModel):
    id: UUID
    name: str
    service_key: str


class LogResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    workspace_id: UUID
    service_id: UUID
    timestamp: datetime
    severity: LogSeverity
    trace_id: str | None
    message: str
    attributes: dict
    created_at: datetime
    service: LogServiceSummary | None = None


class LogPage(BaseModel):
    limit: int
    next_cursor: str | None
    has_more: bool


class LogListResponse(BaseModel):
    items: list[LogResponse]
    page: LogPage


class LogTimeBucket(BaseModel):
    timestamp: str
    count: int
    severity_breakdown: dict[str, int]


class LogStatsResponse(BaseModel):
    total_count: int
    severity_counts: dict[str, int]
    time_buckets: list[LogTimeBucket]
    service_counts: dict[str, int]


class LogIngestResponse(BaseModel):
    ingested_count: int
    ids: list[UUID]
