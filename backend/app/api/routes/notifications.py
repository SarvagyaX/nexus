"""Workspace notification endpoints, user preferences, and webhook testing."""

import time
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app.audit.service import record_domain_event
from app.auth.dependencies import (
    AuthenticatedSession,
    get_authenticated_session,
    require_csrf,
    require_workspace_permission,
)
from app.db.session import get_db
from app.models.identity import Workspace, WorkspaceRole
from app.models.notification import NotificationCategory
from app.schemas.notification import (
    MarkReadRequest,
    NotificationListResponse,
    NotificationPreferenceResponse,
    NotificationPreferenceUpdate,
    NotificationProvidersStatusResponse,
    NotificationResponse,
    TestWebhookRequest,
    TestWebhookResponse,
    UnreadCountResponse,
)
from app.security.rbac import Permission
from app.services.notifications import (
    WebhookProvider,
    get_or_create_user_preferences,
    get_providers_availability,
    get_unread_count,
    list_notifications,
    mark_all_read,
    mark_notification_read,
    update_user_preferences,
)

router = APIRouter(prefix="/api/v1/workspaces/{workspace_id}/notifications", tags=["notifications"])


@router.get("", response_model=NotificationListResponse)
def get_notifications(
    workspace_id: UUID,
    category: NotificationCategory | None = None,
    is_read: bool | None = None,
    cursor: str | None = None,
    limit: int = Query(default=50, ge=1, le=100),
    auth: AuthenticatedSession = Depends(get_authenticated_session),
    _access: tuple[Workspace, WorkspaceRole] = Depends(require_workspace_permission(Permission.NOTIFICATION_READ)),
    db: Session = Depends(get_db),
) -> NotificationListResponse:
    """Retrieves workspace-scoped notification history for the authenticated user."""
    items, unread_count, next_cursor = list_notifications(
        db=db,
        workspace_id=workspace_id,
        user_id=auth.user.id,
        category=category,
        is_read=is_read,
        cursor=cursor,
        limit=limit,
    )
    return NotificationListResponse(
        items=[NotificationResponse.model_validate(n) for n in items],
        total_unread=unread_count,
        next_cursor=next_cursor,
    )


@router.get("/unread-count", response_model=UnreadCountResponse)
def get_notifications_unread_count(
    workspace_id: UUID,
    auth: AuthenticatedSession = Depends(get_authenticated_session),
    _access: tuple[Workspace, WorkspaceRole] = Depends(require_workspace_permission(Permission.NOTIFICATION_READ)),
    db: Session = Depends(get_db),
) -> UnreadCountResponse:
    """Returns the unread notification count for the authenticated user in the workspace."""
    count = get_unread_count(db, workspace_id, auth.user.id)
    return UnreadCountResponse(unread_count=count)


@router.post("/{notification_id}/read", response_model=NotificationResponse)
def mark_single_read(
    workspace_id: UUID,
    notification_id: UUID,
    auth: AuthenticatedSession = Depends(require_csrf),
    _access: tuple[Workspace, WorkspaceRole] = Depends(require_workspace_permission(Permission.NOTIFICATION_WRITE)),
    db: Session = Depends(get_db),
) -> NotificationResponse:
    """Marks a single notification as read."""
    updated = mark_notification_read(db, workspace_id, auth.user.id, notification_id)
    return NotificationResponse.model_validate(updated)


@router.post("/read-all")
def mark_notifications_read_all(
    workspace_id: UUID,
    payload: MarkReadRequest | None = None,
    auth: AuthenticatedSession = Depends(require_csrf),
    _access: tuple[Workspace, WorkspaceRole] = Depends(require_workspace_permission(Permission.NOTIFICATION_WRITE)),
    db: Session = Depends(get_db),
) -> dict[str, int]:
    """Marks all unread notifications (or the specified subset) as read."""
    ids = payload.notification_ids if payload else None
    count = mark_all_read(db, workspace_id, auth.user.id, ids)
    return {"marked_read": count}


@router.get("/preferences", response_model=NotificationPreferenceResponse)
def get_preferences(
    workspace_id: UUID,
    auth: AuthenticatedSession = Depends(get_authenticated_session),
    _access: tuple[Workspace, WorkspaceRole] = Depends(require_workspace_permission(Permission.NOTIFICATION_READ)),
    db: Session = Depends(get_db),
) -> NotificationPreferenceResponse:
    """Retrieves current user notification delivery preferences."""
    pref = get_or_create_user_preferences(db, workspace_id, auth.user.id)
    return NotificationPreferenceResponse.model_validate(pref)


@router.put("/preferences", response_model=NotificationPreferenceResponse)
def set_preferences(
    workspace_id: UUID,
    payload: NotificationPreferenceUpdate,
    request: Request,
    auth: AuthenticatedSession = Depends(require_csrf),
    _access: tuple[Workspace, WorkspaceRole] = Depends(require_workspace_permission(Permission.NOTIFICATION_WRITE)),
    db: Session = Depends(get_db),
) -> NotificationPreferenceResponse:
    """Updates user notification delivery preferences."""
    updates = payload.model_dump(exclude_unset=True)
    pref = update_user_preferences(db, workspace_id, auth.user.id, updates)
    record_domain_event(
        db,
        request,
        actor_user_id=auth.user.id,
        workspace_id=workspace_id,
        action="notification.preferences_updated",
        entity_type="notification_preference",
        entity_id=pref.id,
        details={"updated_fields": list(updates.keys())},
    )
    return NotificationPreferenceResponse.model_validate(pref)


@router.get("/providers/status", response_model=NotificationProvidersStatusResponse)
def get_providers_status(
    workspace_id: UUID,
    _auth: AuthenticatedSession = Depends(get_authenticated_session),
    _access: tuple[Workspace, WorkspaceRole] = Depends(require_workspace_permission(Permission.NOTIFICATION_READ)),
) -> NotificationProvidersStatusResponse:
    """Returns the availability and status of supported notification delivery providers."""
    return NotificationProvidersStatusResponse(providers=get_providers_availability())


@router.post("/test-webhook", response_model=TestWebhookResponse)
async def test_webhook(
    workspace_id: UUID,
    payload: TestWebhookRequest,
    _auth: AuthenticatedSession = Depends(require_csrf),
    _access: tuple[Workspace, WorkspaceRole] = Depends(require_workspace_permission(Permission.NOTIFICATION_WRITE)),
) -> TestWebhookResponse:
    """Dispatches a test notification payload to verify webhook connectivity."""
    start = time.perf_counter()
    test_payload = {
        "event": "nexus.webhook.test",
        "title": "NEXUS Webhook Verification",
        "message": "This is a verification event from the NEXUS incident management platform.",
        "severity": "INFO",
        "timestamp": time.time(),
    }
    ok, status_code, err = await WebhookProvider.send_webhook(payload.webhook_url, test_payload)
    duration_ms = round((time.perf_counter() - start) * 1000, 2)
    return TestWebhookResponse(
        success=ok,
        status_code=status_code,
        message="Webhook delivered successfully." if ok else (err or "Webhook delivery failed."),
        duration_ms=duration_ms,
    )
