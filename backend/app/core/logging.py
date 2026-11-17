"""Structured JSON logging with request context propagation and secret redaction."""

from contextvars import ContextVar
from datetime import datetime, timezone
import json
import logging
import re
import sys
from typing import Any

from app.core.config import get_settings

# Context variables for request-scoped correlation
request_id_ctx: ContextVar[str | None] = ContextVar("request_id_ctx", default=None)
client_ip_ctx: ContextVar[str | None] = ContextVar("client_ip_ctx", default=None)

# Regular expressions for identifying sensitive fields to redact
SENSITIVE_PATTERNS = [
    re.compile(r"(password['\"]?\s*[:=]\s*['\"])([^'\"]+)(['\"])", re.IGNORECASE),
    re.compile(r"(token['\"]?\s*[:=]\s*['\"])([^'\"]+)(['\"])", re.IGNORECASE),
    re.compile(r"(secret['\"]?\s*[:=]\s*['\"])([^'\"]+)(['\"])", re.IGNORECASE),
    re.compile(r"(csrf['\"]?\s*[:=]\s*['\"])([^'\"]+)(['\"])", re.IGNORECASE),
    re.compile(r"(cookie['\"]?\s*[:=]\s*['\"])([^'\"]+)(['\"])", re.IGNORECASE),
    re.compile(r"(authorization['\"]?\s*[:=]\s*['\"])([^'\"]+)(['\"])", re.IGNORECASE),
    re.compile(r"(postgres(?:ql)?://[^:]+:)([^@]+)(@)", re.IGNORECASE),
]

REDACTED_STR = "[REDACTED]"


def sanitize_text(text: str) -> str:
    """Masks secrets, passwords, credentials, and tokens in log strings."""
    if not isinstance(text, str):
        return text
    sanitized = text
    for pattern in SENSITIVE_PATTERNS:
        sanitized = pattern.sub(r"\g<1>[REDACTED]\g<3>", sanitized)
    return sanitized


def sanitize_dict(data: dict[str, Any]) -> dict[str, Any]:
    """Recursively redacts sensitive keys in dictionaries."""
    sanitized: dict[str, Any] = {}
    sensitive_keys = {
        "password",
        "password_hash",
        "secret",
        "token",
        "csrf_token",
        "nexus_session",
        "authorization",
        "cookie",
    }
    for k, v in data.items():
        if any(s in k.lower() for s in sensitive_keys):
            sanitized[k] = REDACTED_STR
        elif isinstance(v, dict):
            sanitized[k] = sanitize_dict(v)
        elif isinstance(v, list):
            sanitized[k] = [
                sanitize_dict(item) if isinstance(item, dict) else item for item in v
            ]
        elif isinstance(v, str):
            sanitized[k] = sanitize_text(v)
        else:
            sanitized[k] = v
    return sanitized


class NexusJsonFormatter(logging.Formatter):
    """Formats log records into clean, structured JSON."""

    def __init__(self, service_name: str, app_env: str) -> None:
        super().__init__()
        self.service_name = service_name
        self.app_env = app_env

    def format(self, record: logging.LogRecord) -> str:
        # Extract timestamp in ISO 8601 UTC
        record_time = datetime.fromtimestamp(record.created, tz=timezone.utc)
        iso_timestamp = record_time.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"

        # Determine request ID from contextvar or record attribute
        req_id = getattr(record, "request_id", None) or request_id_ctx.get()

        log_data: dict[str, Any] = {
            "timestamp": iso_timestamp,
            "level": record.levelname,
            "service": self.service_name,
            "environment": self.app_env,
            "logger": record.name,
            "message": sanitize_text(record.getMessage()),
        }

        if req_id:
            log_data["request_id"] = req_id

        # Include request details if passed in extra
        for field in ("http_method", "path", "status_code", "duration_ms", "client_ip", "event_type"):
            val = getattr(record, field, None)
            if val is not None:
                log_data[field] = val

        # Handle exception info safely
        if record.exc_info:
            log_data["exception"] = {
                "type": record.exc_info[0].__name__ if record.exc_info[0] else "UnknownException",
                "message": sanitize_text(str(record.exc_info[1])),
                "traceback": sanitize_text(self.formatException(record.exc_info)),
            }

        return json.dumps(log_data)


def setup_logging(app_env: str = "production", service_name: str = "nexus-api") -> None:
    """Configures structured JSON logging for the application."""
    root_logger = logging.getLogger()

    # Determine log level
    log_level = logging.DEBUG if app_env == "development" else logging.INFO
    root_logger.setLevel(log_level)

    # Remove existing handlers to prevent duplicate lines
    for handler in list(root_logger.handlers):
        root_logger.removeHandler(handler)

    # Create stdout handler with JSON formatter
    handler = logging.StreamHandler(sys.stdout)
    handler.setLevel(log_level)
    handler.setFormatter(NexusJsonFormatter(service_name=service_name, app_env=app_env))
    root_logger.addHandler(handler)

    # Align uvicorn loggers
    for uvicorn_logger_name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        u_logger = logging.getLogger(uvicorn_logger_name)
        u_logger.handlers = [handler]
        u_logger.propagate = False
