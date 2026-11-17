"""Opaque random browser secrets and one-way token digests."""

import hashlib
import hmac
import secrets


def generate_token() -> str:
    return secrets.token_urlsafe(32)


def token_digest(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def derive_csrf_token(session_token: str) -> str:
    """Derive a session-bound CSRF secret without storing recoverable tokens."""
    return hmac.new(session_token.encode("utf-8"), b"nexus-browser-csrf-v1", hashlib.sha256).hexdigest()
