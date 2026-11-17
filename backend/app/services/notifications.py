"""Notification delivery engine, preference evaluation, and multi-channel dispatch."""

import asyncio
from datetime import datetime, timezone
import email.message
import hashlib
import json
import logging
import smtplib
import time
from uuid import UUID, uuid4

from fastapi import HTTPException
import httpx
from sqlalchemy import desc, func, select
from sqlalchemy.orm import Session, selectinload

from app.core.config import get_settings
from app.core.logging import sanitize_text
from app.models.identity import User
from app.models.notification import (
    Notification,
    NotificationCategory,
    NotificationDelivery,
    NotificationDeliveryChannel,
    NotificationDeliveryStatus,
    NotificationPreference,
    utc_now,
)

logger = logging.getLogger(__name__)

SEVERITY_RANKS = {
    "SEV1": 4,
    "SEV2": 3,
    "SEV3": 2,
    "SEV4": 1,
    "CRITICAL": 4,
    "HIGH": 3,
    "WARNING": 2,
    "INFO": 1,
    "info": 1,
    "warning": 2,
    "error": 3,
    "critical": 4,
}


def _severity_rank(sev: str | None) -> int:
    if not sev:
        return 1
    return SEVERITY_RANKS.get(sev.upper(), 1)


# ============================================================================
# Outbound Providers
# ============================================================================

class WebhookProvider:
    """Delivers notifications to outbound HTTPS/HTTP webhook endpoints."""

    @staticmethod
    async def send_webhook(
        url: str,
        payload: dict,
        timeout_sec: float = 5.0,
    ) -> tuple[bool, int | None, str | None]:
        start = time.perf_counter()
        try:
            async with httpx.AsyncClient(timeout=timeout_sec) as client:
                headers = {
                    "Content-Type": "application/json",
                    "User-Agent": "NEXUS-Incident-Engine/1.0",
                }
                res = await client.post(url, json=payload, headers=headers)
                duration_ms = round((time.perf_counter() - start) * 1000, 2)
                if 200 <= res.status_code < 300:
                    return True, res.status_code, None
                error_msg = f"Webhook returned HTTP {res.status_code} ({duration_ms}ms)"
                return False, res.status_code, sanitize_text(error_msg)
        except Exception as exc:
            duration_ms = round((time.perf_counter() - start) * 1000, 2)
            error_msg = f"Webhook dispatch error ({duration_ms}ms): {exc.__class__.__name__}: {str(exc)}"
            return False, None, sanitize_text(error_msg)


class EmailProvider:
    """Delivers notifications via SMTP when configured."""

    @staticmethod
    def send_email(
        recipient_email: str,
        subject: str,
        body_text: str,
    ) -> tuple[bool, str | None]:
        settings = get_settings()
        if not settings.is_smtp_configured:
            return False, "SMTP email provider is not configured in this environment."

        msg = email.message.EmailMessage()
        msg["Subject"] = f"[NEXUS] {subject}"
        msg["From"] = settings.smtp_from_email
        msg["To"] = recipient_email
        msg.set_content(body_text)

        try:
            with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10.0) as server:
                if settings.smtp_use_tls:
                    server.starttls()
                if settings.smtp_user and settings.smtp_password:
                    server.login(settings.smtp_user, settings.smtp_password.get_secret_value())
                server.send_message(msg)
            return True, None
        except Exception as exc:
            error_msg = f"SMTP error: {exc.__class__.__name__}: {str(exc)}"
            return False, sanitize_text(error_msg)


def get_providers_availability() -> list[dict]:
    """Returns the operational status of all supported delivery channels."""
    settings = get_settings()
    return [
        {
            "name": "In-App Notification Center",
            "channel": NotificationDeliveryChannel.IN_APP,
            "is_available": True,
            "description": "Real-time in-app dropdown and inbox delivery with persistent storage.",
        },
        {
            "name": "Outbound Webhooks",
            "channel": NotificationDeliveryChannel.WEBHOOK,
            "is_available": True,
            "description": "Generic HTTP POST webhooks to custom receiver endpoints, Slack, or PagerDuty.",
        },
        {
            "name": "SMTP Email Dispatch",
            "channel": NotificationDeliveryChannel.EMAIL,
            "is_available": settings.is_smtp_configured,
            "description": (
                f"Connected to SMTP host {settings.smtp_host}:{settings.smtp_port}"
                if settings.is_smtp_configured
                else "SMTP host is not configured (optional channel)."
            ),
        },
    ]


# ============================================================================
# Preference Operations
# ============================================================================

def get_or_create_user_preferences(
    db: Session,
    workspace_id: UUID,
    user_id: UUID,
) -> NotificationPreference:
    """Retrieves or initializes user notification preferences within a workspace."""
    pref = db.scalar(
        select(NotificationPreference).where(
            NotificationPreference.workspace_id == workspace_id,
            NotificationPreference.user_id == user_id,
        )
    )
    if not pref:
        pref = NotificationPreference(
            workspace_id=workspace_id,
            user_id=user_id,
            alerts_enabled=True,
            alerts_min_severity="SEV3",
            incidents_enabled=True,
            incidents_min_severity="SEV3",
            investigations_enabled=True,
            assignments_enabled=True,
            in_app_enabled=True,
            email_enabled=True,
            webhook_enabled=False,
            webhook_url=None,
        )
        db.add(pref)
        db.commit()
        db.refresh(pref)
    return pref


def update_user_preferences(
    db: Session,
    workspace_id: UUID,
    user_id: UUID,
    updates: dict,
) -> NotificationPreference:
    """Updates user notification preferences."""
    pref = get_or_create_user_preferences(db, workspace_id, user_id)
    for k, v in updates.items():
        if v is not None and hasattr(pref, k):
            setattr(pref, k, v)
    pref.updated_at = utc_now()
    db.commit()
    db.refresh(pref)
    return pref


# ============================================================================
# Notification Core Operations
# ============================================================================

def dispatch_notification(
    db: Session,
    workspace_id: UUID,
    user_id: UUID,
    category: NotificationCategory,
    severity: str,
    title: str,
    message: str,
    link: str | None = None,
    entity_type: str | None = None,
    entity_id: UUID | None = None,
    dedup_key: str | None = None,
    force_in_app: bool = False,
    override_channels: list[NotificationDeliveryChannel] | None = None,
) -> Notification | None:
    """Dispatches a notification according to recipient preferences and delivery channels.

    Guarantees idempotency via dedup_key to prevent duplicate spam.
    """
    # 1. Idempotency check
    if dedup_key:
        existing = db.scalar(
            select(Notification).where(
                Notification.workspace_id == workspace_id,
                Notification.dedup_key == dedup_key,
            )
        )
        if existing:
            logger.debug(f"Notification with dedup_key {dedup_key} already exists. Skipping.")
            return existing

    # 2. Check user preferences
    prefs = get_or_create_user_preferences(db, workspace_id, user_id)

    if not force_in_app:
        # Check category toggles
        if category == NotificationCategory.ALERT:
            if not prefs.alerts_enabled:
                return None
            if _severity_rank(severity) < _severity_rank(prefs.alerts_min_severity):
                return None
        elif category == NotificationCategory.INCIDENT:
            if not prefs.incidents_enabled:
                return None
            if _severity_rank(severity) < _severity_rank(prefs.incidents_min_severity):
                return None
        elif category == NotificationCategory.INVESTIGATION:
            if not prefs.investigations_enabled:
                return None

    # 3. Create Notification record
    notification = Notification(
        workspace_id=workspace_id,
        user_id=user_id,
        category=category,
        severity=severity,
        title=title,
        message=message,
        link=link,
        entity_type=entity_type,
        entity_id=entity_id,
        is_read=False,
        dedup_key=dedup_key,
        created_at=utc_now(),
    )
    db.add(notification)
    db.flush()

    # 4. Handle Delivery Channels
    channels_to_deliver = override_channels or []
    if not override_channels:
        if prefs.in_app_enabled or force_in_app:
            channels_to_deliver.append(NotificationDeliveryChannel.IN_APP)
        if prefs.webhook_enabled and prefs.webhook_url:
            channels_to_deliver.append(NotificationDeliveryChannel.WEBHOOK)
        if prefs.email_enabled:
            channels_to_deliver.append(NotificationDeliveryChannel.EMAIL)

    # Deliver In-App
    if NotificationDeliveryChannel.IN_APP in channels_to_deliver:
        delivery_in_app = NotificationDelivery(
            notification_id=notification.id,
            workspace_id=workspace_id,
            channel=NotificationDeliveryChannel.IN_APP,
            recipient_target=str(user_id),
            status=NotificationDeliveryStatus.SENT,
            attempts=1,
            sent_at=utc_now(),
            created_at=utc_now(),
        )
        db.add(delivery_in_app)

    # Deliver Email (if requested and user has email)
    if NotificationDeliveryChannel.EMAIL in channels_to_deliver:
        user = db.scalar(select(User).where(User.id == user_id))
        if user and user.email:
            ok, err = EmailProvider.send_email(
                recipient_email=user.email,
                subject=title,
                body_text=f"{title}\n\n{message}\n\nLink: {link or 'N/A'}",
            )
            db.add(
                NotificationDelivery(
                    notification_id=notification.id,
                    workspace_id=workspace_id,
                    channel=NotificationDeliveryChannel.EMAIL,
                    recipient_target=user.email,
                    status=NotificationDeliveryStatus.SENT if ok else NotificationDeliveryStatus.FAILED,
                    attempts=1,
                    error_message=err,
                    sent_at=utc_now() if ok else None,
                    created_at=utc_now(),
                )
            )

    # Deliver Webhook (if requested)
    if NotificationDeliveryChannel.WEBHOOK in channels_to_deliver and prefs.webhook_url:
        webhook_payload = {
            "id": str(notification.id),
            "workspace_id": str(workspace_id),
            "user_id": str(user_id),
            "category": category.value if hasattr(category, "value") else str(category),
            "severity": severity,
            "title": title,
            "message": message,
            "link": link,
            "entity_type": entity_type,
            "entity_id": str(entity_id) if entity_id else None,
            "timestamp": notification.created_at.isoformat(),
        }
        # Run webhook synchronously or create delivery record
        try:
            # Quick sync POST using httpx
            with httpx.Client(timeout=3.0) as client:
                res = client.post(prefs.webhook_url, json=webhook_payload)
                ok = 200 <= res.status_code < 300
                err = None if ok else f"HTTP {res.status_code}"
        except Exception as exc:
            ok = False
            err = f"{exc.__class__.__name__}: {str(exc)}"

        db.add(
            NotificationDelivery(
                notification_id=notification.id,
                workspace_id=workspace_id,
                channel=NotificationDeliveryChannel.WEBHOOK,
                recipient_target=prefs.webhook_url,
                status=NotificationDeliveryStatus.SENT if ok else NotificationDeliveryStatus.FAILED,
                attempts=1,
                error_message=sanitize_text(err) if err else None,
                sent_at=utc_now() if ok else None,
                created_at=utc_now(),
            )
        )

    db.commit()
    db.refresh(notification)
    return notification


def list_notifications(
    db: Session,
    workspace_id: UUID,
    user_id: UUID,
    category: NotificationCategory | None = None,
    is_read: bool | None = None,
    cursor: str | None = None,
    limit: int = 50,
) -> tuple[list[Notification], int, str | None]:
    """Returns workspace-scoped notifications for a user with unread count and pagination."""
    limit = max(1, min(limit, 100))

    # Base query for user notifications
    query = (
        select(Notification)
        .options(selectinload(Notification.deliveries))
        .where(
            Notification.workspace_id == workspace_id,
            Notification.user_id == user_id,
        )
    )

    if category is not None:
        query = query.where(Notification.category == category)
    if is_read is not None:
        query = query.where(Notification.is_read == is_read)

    # Decode cursor if provided
    if cursor:
        try:
            cursor_dt = datetime.fromisoformat(cursor)
            query = query.where(Notification.created_at < cursor_dt)
        except Exception:
            pass

    query = query.order_by(desc(Notification.created_at), desc(Notification.id)).limit(limit + 1)
    results = db.scalars(query).all()

    items = list(results[:limit])
    next_cursor = None
    if len(results) > limit:
        next_cursor = items[-1].created_at.isoformat()

    # Total unread count for user in this workspace
    unread_count = db.scalar(
        select(func.count(Notification.id)).where(
            Notification.workspace_id == workspace_id,
            Notification.user_id == user_id,
            Notification.is_read.is_(False),
        )
    ) or 0

    return items, unread_count, next_cursor


def get_unread_count(db: Session, workspace_id: UUID, user_id: UUID) -> int:
    """Returns the count of unread notifications for a user."""
    return db.scalar(
        select(func.count(Notification.id)).where(
            Notification.workspace_id == workspace_id,
            Notification.user_id == user_id,
            Notification.is_read.is_(False),
        )
    ) or 0


def mark_notification_read(
    db: Session,
    workspace_id: UUID,
    user_id: UUID,
    notification_id: UUID,
) -> Notification:
    """Marks a single notification as read."""
    notification = db.scalar(
        select(Notification).where(
            Notification.workspace_id == workspace_id,
            Notification.user_id == user_id,
            Notification.id == notification_id,
        )
    )
    if not notification:
        raise HTTPException(
            status_code=404,
            detail={"code": "notification_not_found", "message": "Notification was not found."},
        )

    if not notification.is_read:
        notification.is_read = True
        notification.read_at = utc_now()
        db.commit()
        db.refresh(notification)
    return notification


def mark_all_read(
    db: Session,
    workspace_id: UUID,
    user_id: UUID,
    notification_ids: list[UUID] | None = None,
) -> int:
    """Marks all (or specific) notifications as read."""
    query = select(Notification).where(
        Notification.workspace_id == workspace_id,
        Notification.user_id == user_id,
        Notification.is_read.is_(False),
    )
    if notification_ids:
        query = query.where(Notification.id.in_(notification_ids))

    notifications = db.scalars(query).all()
    count = len(notifications)
    now = utc_now()
    for n in notifications:
        n.is_read = True
        n.read_at = now
    db.commit()
    return count
