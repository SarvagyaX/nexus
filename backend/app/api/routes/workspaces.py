"""Workspace-scoped read API guarded by centralized membership policy."""

from uuid import UUID

from fastapi import APIRouter, Depends

from app.auth.dependencies import require_workspace_permission
from app.models.identity import Workspace
from app.schemas.auth import WorkspacePublic
from app.security.rbac import Permission

router = APIRouter(prefix="/api/v1/workspaces", tags=["workspaces"])


@router.get("/{workspace_id}", response_model=WorkspacePublic)
def get_workspace(
    workspace_id: UUID,
    access: tuple[Workspace, object] = Depends(require_workspace_permission(Permission.WORKSPACE_READ)),
) -> Workspace:
    workspace, _role = access
    return workspace
