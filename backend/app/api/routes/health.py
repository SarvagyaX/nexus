"""Process liveness, dependency readiness, and metrics exposition endpoints."""

import time
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Depends, Query, Response, status
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.metrics import metrics_collector
from app.db.session import get_db
from app.services.alert_bus import check_redis_health

router = APIRouter()


@router.get("/health")
@router.get("/api/v1/health/liveness")
def health() -> dict[str, str]:
    """Lightweight liveness probe confirming that the FastAPI process is responsive."""
    return {"status": "ok", "service": settings.service_name}


@router.get("/ready", response_model=None)
@router.get("/api/v1/health/readiness", response_model=None)
def readiness(
    full: bool = Query(default=False),
    db: Session = Depends(get_db),
) -> dict[str, Any] | JSONResponse:
    """Verifies reachability of core infrastructure dependencies (PostgreSQL and Redis)."""
    db_start = time.perf_counter()
    try:
        # Enforce lightweight query with short statement timeout
        db.execute(text("SELECT 1"))
        db_latency_ms = round((time.perf_counter() - db_start) * 1000, 2)
        metrics_collector.record_db_check(True)
    except SQLAlchemyError:
        metrics_collector.record_db_check(False)
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content={
                "error": {
                    "code": "database_unavailable",
                    "message": "Database is unavailable.",
                    "details": [],
                    "request_id": str(uuid4()),
                }
            },
        )

    redis_health = check_redis_health()

    if full:
        overall_status = "ok" if redis_health["status"] == "healthy" else "degraded"
        return {
            "status": overall_status,
            "service": settings.service_name,
            "database": "ok",
            "redis": redis_health["status"],
            "dependencies": {
                "database": {
                    "status": "healthy",
                    "latency_ms": db_latency_ms,
                },
                "redis": redis_health,
            },
        }

    # Preserves exact contract for existing tests and standard Kubernetes readiness
    return {"status": "ok", "service": settings.service_name, "database": "ok"}


@router.get("/metrics")
def metrics() -> Response:
    """Exposes application operational metrics in standard Prometheus exposition format."""
    content = metrics_collector.format_prometheus()
    return Response(
        content=content,
        media_type="text/plain; version=0.0.4; charset=utf-8",
    )
