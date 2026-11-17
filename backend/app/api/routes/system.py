"""System diagnostics and platform reliability monitoring endpoints."""

from datetime import datetime, timezone
import time
from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.ai.provider import get_llm_client
from app.auth.dependencies import AuthenticatedSession, get_authenticated_session
from app.core.config import settings
from app.core.metrics import metrics_collector
from app.db.session import get_db
from app.services.alert_bus import check_redis_health

router = APIRouter(prefix="/api/v1/system", tags=["system-diagnostics"])


@router.get("/status")
async def get_system_status(
    _auth: AuthenticatedSession = Depends(get_authenticated_session),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Returns comprehensive real-time platform health and dependency status."""
    now_utc = datetime.now(timezone.utc).isoformat()

    # 1. Database check
    db_start = time.perf_counter()
    db_healthy = False
    db_latency_ms = 0.0
    db_message = None
    try:
        db.execute(text("SELECT 1"))
        db_latency_ms = round((time.perf_counter() - db_start) * 1000, 2)
        db_healthy = True
        metrics_collector.record_db_check(True)
    except SQLAlchemyError as exc:
        metrics_collector.record_db_check(False)
        db_message = "PostgreSQL connection could not be established."

    # 2. Redis check
    redis_health = check_redis_health()

    # 3. LLM provider check
    llm_client = get_llm_client()
    try:
        llm_status = await llm_client.check_health()
        llm_data = {
            "status": "ready" if llm_status.is_available else "unavailable",
            "provider": llm_status.provider,
            "model": llm_status.model,
            "message": llm_status.message,
        }
    except Exception as exc:
        llm_data = {
            "status": "unavailable",
            "provider": settings.llm_provider,
            "model": settings.llm_model,
            "message": "AI inference engine probe failed.",
        }

    # 4. Metrics snapshot
    metrics_snapshot = metrics_collector.get_snapshot()

    # 5. Overall status determination
    if not db_healthy:
        overall_status = "major_outage"
    elif redis_health["status"] == "degraded":
        overall_status = "degraded"
    else:
        overall_status = "operational"

    return {
        "overall_status": overall_status,
        "service": settings.service_name,
        "environment": settings.app_env,
        "timestamp": now_utc,
        "uptime_seconds": metrics_snapshot["uptime_seconds"],
        "dependencies": {
            "database": {
                "status": "healthy" if db_healthy else "unhealthy",
                "latency_ms": db_latency_ms,
                "engine": "PostgreSQL",
                "error": db_message,
            },
            "redis": redis_health,
            "llm": llm_data,
        },
        "telemetry": {
            "total_requests": metrics_snapshot["total_requests"],
            "active_requests": metrics_snapshot["active_requests"],
            "avg_latency_ms": metrics_snapshot["avg_latency_ms"],
            "percentiles_ms": metrics_snapshot["percentiles_ms"],
            "error_rate_pct": metrics_snapshot["error_rate_pct"],
            "status_classes": metrics_snapshot["status_classes"],
        },
    }


@router.get("/metrics")
def get_system_metrics(
    _auth: AuthenticatedSession = Depends(get_authenticated_session),
) -> dict[str, Any]:
    """Returns JSON metrics telemetry snapshot for the platform health dashboard."""
    return metrics_collector.get_snapshot()


@router.post("/diagnostics/ping")
async def run_diagnostics(
    _auth: AuthenticatedSession = Depends(get_authenticated_session),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Actively probes platform dependencies and measures round-trip latencies."""
    start_time = time.perf_counter()

    # Probe DB
    db_start = time.perf_counter()
    try:
        db.execute(text("SELECT 1"))
        db_latency = round((time.perf_counter() - db_start) * 1000, 2)
        db_ok = True
    except Exception:
        db_latency = round((time.perf_counter() - db_start) * 1000, 2)
        db_ok = False

    # Probe Redis
    redis_info = check_redis_health()

    # Probe LLM
    llm_start = time.perf_counter()
    try:
        llm_client = get_llm_client()
        llm_status = await llm_client.check_health()
        llm_latency = round((time.perf_counter() - llm_start) * 1000, 2)
        llm_ok = llm_status.is_available
    except Exception:
        llm_latency = round((time.perf_counter() - llm_start) * 1000, 2)
        llm_ok = False

    total_duration = round((time.perf_counter() - start_time) * 1000, 2)

    return {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "total_duration_ms": total_duration,
        "probes": {
            "database": {"ok": db_ok, "latency_ms": db_latency},
            "redis": {"ok": redis_info["status"] == "healthy", "mode": redis_info["mode"], "latency_ms": redis_info.get("latency_ms", 0.0)},
            "llm": {"ok": llm_ok, "latency_ms": llm_latency},
        },
    }
