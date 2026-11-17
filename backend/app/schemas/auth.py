"""Public authentication and workspace response contracts."""

from uuid import UUID
import re

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.identity import WorkspaceRole, WorkspaceStatus

_EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class LoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=1, max_length=256)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        normalized = value.strip().lower()
        if not _EMAIL_PATTERN.fullmatch(normalized):
            raise ValueError("Enter a valid email address")
        return normalized


class UserPublic(BaseModel):
    id: UUID
    email: str
    display_name: str

    model_config = ConfigDict(from_attributes=True)


class WorkspaceMembershipPublic(BaseModel):
    id: UUID
    name: str
    slug: str
    role: WorkspaceRole


class AuthResponse(BaseModel):
    user: UserPublic
    workspaces: list[WorkspaceMembershipPublic]
    active_workspace_id: UUID | None
    csrf_token: str


class WorkspacePublic(BaseModel):
    id: UUID
    name: str
    slug: str
    status: WorkspaceStatus
    is_demo: bool

    model_config = ConfigDict(from_attributes=True)
