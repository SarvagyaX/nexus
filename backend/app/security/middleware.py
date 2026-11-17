"""Security hardening middleware: standard security headers and request payload bounds."""

from collections.abc import Callable
import logging
import time
from uuid import uuid4

from fastapi import Request, Response, status
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.config import get_settings
from app.core.logging import client_ip_ctx, request_id_ctx
from app.core.metrics import metrics_collector

logger = logging.getLogger("nexus.access")

# Default request payload limits
DEFAULT_MAX_REQUEST_SIZE_BYTES = 2 * 1024 * 1024  # 2 MB for standard JSON
BATCH_MAX_REQUEST_SIZE_BYTES = 10 * 1024 * 1024   # 10 MB for log batches


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Enforces standard defensive HTTP security response headers."""

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        response: Response = await call_next(request)

        # Standard OWASP recommended security headers
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(), payment=()"

        # HSTS only when running over TLS / production with secure cookies
        settings = get_settings()
        if settings.app_env == "production" and settings.session_cookie_secure:
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"

        return response


class RequestSizeLimitMiddleware(BaseHTTPMiddleware):
    """Guards endpoints against oversized payload DoS attacks."""

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        content_length = request.headers.get("content-length")
        if content_length:
            try:
                length = int(content_length)
                max_bytes = (
                    BATCH_MAX_REQUEST_SIZE_BYTES
                    if "/logs/batch" in request.url.path
                    else DEFAULT_MAX_REQUEST_SIZE_BYTES
                )
                if length > max_bytes:
                    request_id = getattr(request.state, "request_id", str(uuid4()))
                    return JSONResponse(
                        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        content={
                            "error": {
                                "code": "payload_too_large",
                                "message": f"Request body exceeds maximum allowed size ({max_bytes // (1024 * 1024)}MB).",
                                "details": [{"field": "Content-Length", "limit_bytes": max_bytes}],
                                "request_id": request_id,
                            }
                        },
                    )
            except ValueError:
                pass

        return await call_next(request)


class RequestObservabilityMiddleware(BaseHTTPMiddleware):
    """Tracks correlation IDs, calculates request latency, and records metrics."""

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        # 1. Correlation ID
        req_id = request.headers.get("X-Request-ID")
        if not req_id or len(req_id) > 64:
            req_id = str(uuid4())

        request.state.request_id = req_id
        token_req = request_id_ctx.set(req_id)

        # 2. Client IP
        client_ip = request.client.host if request.client else "unknown"
        token_ip = client_ip_ctx.set(client_ip)

        # 3. Metrics start
        metrics_collector.start_request()
        start_time = time.perf_counter()

        status_code = 500
        try:
            response = await call_next(request)
            status_code = response.status_code
            response.headers["X-Request-ID"] = req_id
            return response
        except Exception:
            status_code = 500
            raise
        finally:
            duration_ms = round((time.perf_counter() - start_time) * 1000, 2)
            metrics_collector.end_request(request.method, status_code, duration_ms)

            # Log request completion with structured extra attributes
            # Skip noise on SSE stream or rapid health checks
            if not request.url.path.endswith("/stream") and request.url.path != "/health":
                level = logging.WARNING if status_code >= 400 else logging.INFO
                logger.log(
                    level,
                    f"{request.method} {request.url.path} -> {status_code} ({duration_ms}ms)",
                    extra={
                        "request_id": req_id,
                        "http_method": request.method,
                        "path": request.url.path,
                        "status_code": status_code,
                        "duration_ms": duration_ms,
                        "client_ip": client_ip,
                    },
                )

            # Reset context
            request_id_ctx.reset(token_req)
            client_ip_ctx.reset(token_ip)
