"""Validated service registry API contracts."""

import re
from datetime import datetime
from urllib.parse import urlsplit
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models.service import ServiceStatus

_SERVICE_KEY = re.compile(r"^[a-z0-9]+(?:[._-][a-z0-9]+)*$")


def _clean_required(value: str) -> str:
    cleaned = value.strip()
    if not cleaned:
        raise ValueError("Value must not be empty")
    return cleaned


def _clean_optional(value: str | None) -> str | None:
    if value is None:
        return None
    return _clean_required(value)


def _validate_repository_url(value: str | None) -> str | None:
    if value is None:
        return None
    parsed = urlsplit(value)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("Repository URL must be an HTTP(S) URL without embedded credentials")
    return value


class ServiceFields(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=160)
    service_key: str = Field(min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=2000)
    owner_team: str | None = Field(default=None, max_length=160)
    environment: str | None = Field(default=None, max_length=80)
    repository_url: str | None = Field(default=None, max_length=2048)

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        return _clean_required(value)

    @field_validator("service_key")
    @classmethod
    def normalize_service_key(cls, value: str) -> str:
        normalized = _clean_required(value).lower()
        if not _SERVICE_KEY.fullmatch(normalized):
            raise ValueError("Service key must use lowercase letters, numbers, dots, underscores, or hyphens")
        return normalized

    @field_validator("description", "owner_team", "environment")
    @classmethod
    def clean_optional_text(cls, value: str | None) -> str | None:
        return _clean_optional(value)

    @field_validator("repository_url")
    @classmethod
    def validate_repository(cls, value: str | None) -> str | None:
        return _validate_repository_url(value)


class ServiceCreate(ServiceFields):
    pass


class ServicePatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=160)
    service_key: str | None = Field(default=None, min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=2000)
    owner_team: str | None = Field(default=None, max_length=160)
    environment: str | None = Field(default=None, max_length=80)
    repository_url: str | None = Field(default=None, max_length=2048)
    status: ServiceStatus | None = None

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str | None) -> str | None:
        if value is None:
            raise ValueError("Name cannot be null")
        return _clean_required(value)

    @field_validator("service_key")
    @classmethod
    def normalize_service_key(cls, value: str | None) -> str | None:
        if value is None:
            raise ValueError("Service key cannot be null")
        normalized = _clean_required(value).lower()
        if not _SERVICE_KEY.fullmatch(normalized):
            raise ValueError("Service key must use lowercase letters, numbers, dots, underscores, or hyphens")
        return normalized

    @field_validator("description", "owner_team", "environment")
    @classmethod
    def clean_optional_text(cls, value: str | None) -> str | None:
        return _clean_optional(value)

    @field_validator("repository_url")
    @classmethod
    def validate_repository(cls, value: str | None) -> str | None:
        return _validate_repository_url(value)

    @model_validator(mode="after")
    def require_patch_fields(self) -> "ServicePatch":
        if not self.model_fields_set:
            raise ValueError("At least one service field is required")
        if "status" in self.model_fields_set and self.status is None:
            raise ValueError("Status cannot be null")
        return self


class ServiceResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    workspace_id: UUID
    name: str
    service_key: str
    description: str | None
    owner_team: str | None
    environment: str | None
    repository_url: str | None
    status: ServiceStatus
    created_at: datetime
    updated_at: datetime


class ServicePage(BaseModel):
    limit: int
    next_cursor: str | None
    has_more: bool


class ServiceListResponse(BaseModel):
    items: list[ServiceResponse]
    page: ServicePage
