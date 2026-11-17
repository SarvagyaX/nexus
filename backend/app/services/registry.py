"""Cursor encoding and bounded service registry query helpers."""

import base64
import binascii
import json
from uuid import UUID

from fastapi import HTTPException


def encode_service_cursor(name: str, service_id: UUID) -> str:
    payload = json.dumps({"name": name, "id": str(service_id)}, separators=(",", ":")).encode("utf-8")
    return base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")


def decode_service_cursor(cursor: str | None) -> tuple[str, UUID] | None:
    if cursor is None:
        return None
    try:
        if not cursor or len(cursor) > 512:
            raise ValueError
        padded = cursor + "=" * (-len(cursor) % 4)
        payload = json.loads(base64.b64decode(padded, altchars=b"-_", validate=True))
        if not isinstance(payload, dict) or set(payload) != {"name", "id"}:
            raise ValueError
        name = payload["name"]
        raw_id = payload["id"]
        if not isinstance(name, str) or not name.strip() or len(name) > 160 or not isinstance(raw_id, str):
            raise ValueError
        return name, UUID(raw_id)
    except (ValueError, TypeError, KeyError, AttributeError, binascii.Error, json.JSONDecodeError):
        raise HTTPException(
            status_code=400,
            detail={"code": "invalid_cursor", "message": "The pagination cursor is invalid."},
        ) from None
