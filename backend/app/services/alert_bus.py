"""Real-time event broadcaster supporting Redis pub/sub and in-process subscribers."""

import asyncio
from collections import defaultdict
import json
import logging
import time
from typing import Any, AsyncGenerator
from uuid import UUID

from app.core.config import get_settings
from app.core.metrics import metrics_collector

logger = logging.getLogger(__name__)

# In-process subscriber queues: workspace_id -> set of asyncio.Queue
_local_subscribers: dict[UUID, set[asyncio.Queue]] = defaultdict(set)
_redis_client = None


def get_redis_client():
    global _redis_client
    if _redis_client is None:
        settings = get_settings()
        if settings.redis_url:
            try:
                import redis.asyncio as aioredis
                url = settings.redis_url.get_secret_value()
                _redis_client = aioredis.from_url(url, decode_responses=True, socket_timeout=3.0)
            except Exception as exc:
                logger.warning(f"Could not initialize Redis client: {exc}")
                _redis_client = False
        else:
            _redis_client = False
    return _redis_client if _redis_client is not False else None


def check_redis_health() -> dict[str, Any]:
    """Checks Redis connectivity safely with a timeout, reporting fallback status."""
    settings = get_settings()
    if not settings.redis_url:
        return {
            "status": "degraded",
            "mode": "in_process_fallback",
            "message": "Redis is not configured. Active via in-process local event bus.",
        }

    try:
        import redis
        url = settings.redis_url.get_secret_value()
        start = time.perf_counter()
        r = redis.from_url(url, socket_timeout=0.8, socket_connect_timeout=0.8)
        pong = r.ping()
        latency_ms = round((time.perf_counter() - start) * 1000, 2)
        r.close()
        if pong:
            metrics_collector.record_redis_op(True)
            return {
                "status": "healthy",
                "mode": "pubsub",
                "latency_ms": latency_ms,
            }
    except Exception as exc:
        metrics_collector.record_redis_op(False)
        logger.debug(f"Redis health check failed: {exc}")

    return {
        "status": "degraded",
        "mode": "in_process_fallback",
        "message": "Redis is currently unreachable. Real-time event streaming is operating in fallback in-process mode.",
    }


async def close_redis_client() -> None:
    """Closes Redis connections during application shutdown."""
    global _redis_client
    if _redis_client and _redis_client is not False:
        try:
            await _redis_client.close()
        except Exception:
            pass
        _redis_client = None


async def broadcast_alert_event(workspace_id: UUID, event_type: str, alert_data: dict) -> None:
    """Publishes an alert event to both Redis channel and in-process subscribers."""
    payload = json.dumps({
        "event": event_type,
        "workspace_id": str(workspace_id),
        "alert": alert_data,
    })

    # 1. Publish to Redis pub/sub if available
    client = get_redis_client()
    if client:
        try:
            channel = f"workspace:{workspace_id}:alerts"
            await client.publish(channel, payload)
        except Exception as exc:
            logger.debug(f"Redis publish failed, falling back to local bus: {exc}")

    # 2. Publish to local in-process subscribers
    queues = list(_local_subscribers.get(workspace_id, []))
    for q in queues:
        try:
            q.put_nowait(payload)
        except Exception:
            pass


async def subscribe_alert_stream(workspace_id: UUID) -> AsyncGenerator[str, None]:
    """Yields Server-Sent Event formatted chunks for a workspace subscription."""
    queue: asyncio.Queue = asyncio.Queue(maxsize=100)
    _local_subscribers[workspace_id].add(queue)

    # Initial connection handshake frame
    yield f"event: connected\ndata: {json.dumps({'status': 'connected', 'workspace_id': str(workspace_id)})}\n\n"

    try:
        while True:
            try:
                # Wait for next event or send keepalive ping every 15s
                payload = await asyncio.wait_for(queue.get(), timeout=15.0)
                try:
                    event_dict = json.loads(payload)
                    ev_type = event_dict.get("event", "alert")
                except Exception:
                    ev_type = "alert"
                yield f"event: {ev_type}\ndata: {payload}\n\n"
            except asyncio.TimeoutError:
                # Keepalive comment to prevent socket timeout
                yield ": ping\n\n"
    except asyncio.CancelledError:
        pass
    finally:
        _local_subscribers[workspace_id].discard(queue)
        if not _local_subscribers[workspace_id]:
            _local_subscribers.pop(workspace_id, None)
