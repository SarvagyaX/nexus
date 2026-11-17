"""Unit and integration tests for Milestone 12: Production Deployment & Hardening."""

import os
import pytest
from pydantic import ValidationError

from app.core.config import Settings
from app.core.logging import sanitize_dict, sanitize_text, REDACTED_STR


def test_log_sanitizer_redacts_passwords_and_tokens() -> None:
    # Test text sanitizer
    text_samples = [
        ('password="SuperSecretPassword123"', 'password="[REDACTED]"'),
        ('token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"', 'token: "[REDACTED]"'),
        ('cookie="nexus_session=secret_value"', 'cookie="[REDACTED]"'),
        ('authorization: "Bearer secret-token-xyz"', 'authorization: "[REDACTED]"'),
        ('postgresql://user:secretpass123@postgres:5432/db', 'postgresql://user:[REDACTED]@postgres:5432/db'),
    ]

    for original, expected in text_samples:
        sanitized = sanitize_text(original)
        assert "[REDACTED]" in sanitized
        assert "SuperSecretPassword123" not in sanitized
        assert "secret_value" not in sanitized
        assert "secretpass123" not in sanitized


def test_log_sanitizer_redacts_dict_keys() -> None:
    payload = {
        "user_email": "admin@nexus.local",
        "password": "CleartextPassword99!",
        "token": "sensitive-token-abc",
        "nested": {
            "csrf_token": "csrf-secret-123",
            "safe_key": "safe_value",
            "cookie": "session=abc",
        },
        "list_items": [
            {"password_hash": "$argon2id$..."},
            {"public_info": "visible"},
        ],
    }

    sanitized = sanitize_dict(payload)
    assert sanitized["user_email"] == "admin@nexus.local"
    assert sanitized["password"] == REDACTED_STR
    assert sanitized["token"] == REDACTED_STR
    assert sanitized["nested"]["csrf_token"] == REDACTED_STR
    assert sanitized["nested"]["cookie"] == REDACTED_STR
    assert sanitized["nested"]["safe_key"] == "safe_value"
    assert sanitized["list_items"][0]["password_hash"] == REDACTED_STR
    assert sanitized["list_items"][1]["public_info"] == "visible"


def test_production_environment_validation() -> None:
    # Valid production settings
    valid_prod = Settings(
        _env_file=None,
        APP_ENV="production",
        POSTGRES_URL="postgresql://produser:StrongProdPass2026!@postgres:5432/nexus_prod",
        REDIS_URL="redis://redis:6379/0",
        FRONTEND_ORIGIN="https://nexus.example.com",
        SESSION_COOKIE_SECURE=True,
        DEMO_AUTH_ENABLED=False,
        TRUSTED_HOSTS="nexus.example.com,localhost",
    )
    assert valid_prod.app_env == "production"
    assert valid_prod.secure_session_cookie is True
    assert "nexus.example.com" in valid_prod.trusted_hosts_list

    # Insecure cookie rejection in production
    with pytest.raises(ValidationError):
        Settings(
            _env_file=None,
            APP_ENV="production",
            POSTGRES_URL="postgresql://produser:StrongProdPass2026!@postgres:5432/nexus_prod",
            SESSION_COOKIE_SECURE=False,
            DEMO_AUTH_ENABLED=False,
        )

    # Demo auth rejection in production
    with pytest.raises(ValidationError):
        Settings(
            _env_file=None,
            APP_ENV="production",
            POSTGRES_URL="postgresql://produser:StrongProdPass2026!@postgres:5432/nexus_prod",
            SESSION_COOKIE_SECURE=True,
            DEMO_AUTH_ENABLED=True,
        )


def test_production_rejects_wildcard_frontend_origin() -> None:
    with pytest.raises(ValidationError):
        Settings(
            _env_file=None,
            APP_ENV="production",
            POSTGRES_URL="postgresql://produser:StrongProdPass2026!@postgres:5432/nexus_prod",
            FRONTEND_ORIGIN="*",
            SESSION_COOKIE_SECURE=True,
            DEMO_AUTH_ENABLED=False,
        )
