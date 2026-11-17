"""NEXUS FastAPI application entry point."""

from contextlib import asynccontextmanager
import logging
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app.api.routes.auth import router as auth_router
from app.api.routes.health import router as health_router
from app.api.routes.workspaces import router as workspaces_router
from app.api.routes.services import router as services_router
from app.api.routes.incidents import router as incidents_router
from app.api.routes.logs import router as logs_router
from app.api.routes.investigations import router as investigations_router
from app.api.routes.alerts import router as alerts_router
from app.api.routes.system import router as system_router
from app.api.routes.notifications import router as notifications_router
from app.api.routes.on_call import router as on_call_router
from app.api.routes.escalation import router as escalation_router
from app.api.routes.playbooks import router as playbooks_router
from app.core.config import get_settings
from app.core.logging import setup_logging
from app.security.middleware import (
    RequestObservabilityMiddleware,
    RequestSizeLimitMiddleware,
    SecurityHeadersMiddleware,
)
from app.services.alert_bus import close_redis_client

settings = get_settings()
logger = logging.getLogger("nexus.api")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Application lifespan context for startup and graceful shutdown."""
    setup_logging(app_env=settings.app_env, service_name=settings.service_name)
    logger.info("NEXUS API platform initialized successfully.")
    yield
    # Graceful shutdown: close Redis client and connections
    await close_redis_client()
    logger.info("NEXUS API platform shutdown complete.")


app = FastAPI(
    title="NEXUS API",
    description="NEXUS API with cookie-based authentication, workspace authorization, and telemetry.",
    version="0.3.0",
    lifespan=lifespan,
)

# Middleware stack (executed in reverse order: CORS -> Observability -> SizeLimit -> SecurityHeaders -> Endpoint)
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(RequestSizeLimitMiddleware)
app.add_middleware(RequestObservabilityMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "X-CSRF-Token", "X-Request-ID"],
    expose_headers=["X-Request-ID"],
)
if settings.trusted_hosts_list != ["*"]:
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.trusted_hosts_list)


@app.exception_handler(StarletteHTTPException)
async def http_error_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    detail = exc.detail if isinstance(exc.detail, dict) else {}
    defaults = {
        401: ("authentication_required", "Authentication is required."),
        403: ("permission_denied", "You do not have permission to perform this action."),
        404: ("not_found", "The requested resource was not found."),
        413: ("payload_too_large", "Request payload exceeds allowed limit."),
        429: ("rate_limited", "Too many requests. Try again later."),
        503: ("dependency_unavailable", "A required service is unavailable."),
    }
    code, message = defaults.get(exc.status_code, ("request_failed", "The request could not be completed."))
    body = {
        "error": {
            "code": detail.get("code", code),
            "message": detail.get("message", message if not isinstance(exc.detail, str) else exc.detail),
            "details": [],
            "request_id": getattr(request.state, "request_id", str(uuid4())),
        }
    }
    return JSONResponse(status_code=exc.status_code, content=body, headers=exc.headers)


@app.exception_handler(RequestValidationError)
async def validation_error_handler(request: Request, _exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content={
            "error": {
                "code": "validation_error",
                "message": "Request is invalid.",
                "details": [],
                "request_id": getattr(request.state, "request_id", str(uuid4())),
            }
        },
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Catches unhandled errors, logs them safely with correlation ID, and returns a clean 500."""
    req_id = getattr(request.state, "request_id", str(uuid4()))
    logger.error(
        f"Unhandled exception during {request.method} {request.url.path}: {exc}",
        exc_info=True,
        extra={"request_id": req_id, "path": request.url.path, "method": request.method},
    )
    return JSONResponse(
        status_code=500,
        content={
            "error": {
                "code": "internal_server_error",
                "message": "An unexpected server error occurred. Please try again later.",
                "details": [],
                "request_id": req_id,
            }
        },
    )


app.include_router(health_router)
app.include_router(system_router)
app.include_router(auth_router)
app.include_router(workspaces_router)
app.include_router(services_router)
app.include_router(incidents_router)
app.include_router(logs_router)
app.include_router(investigations_router)
app.include_router(alerts_router)
app.include_router(notifications_router)
app.include_router(on_call_router)
app.include_router(escalation_router)
app.include_router(playbooks_router)
