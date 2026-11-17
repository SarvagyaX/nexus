"""Log domain helpers, cursor encoding, and analytics."""

import base64
import binascii
from collections import defaultdict
from datetime import datetime, timedelta, timezone
import json
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.log import LogRecord, LogSeverity
from app.models.service import Service
from app.schemas.log import LogServiceSummary, LogTimeBucket


def _invalid_cursor():
    raise HTTPException(
        status_code=400,
        detail={"code": "invalid_cursor", "message": "The pagination cursor is invalid."},
    )


def decode_log_cursor(cursor: str | None) -> tuple[datetime, UUID] | None:
    if cursor is None:
        return None
    try:
        if not cursor or len(cursor) > 512:
            raise ValueError
        data = json.loads(
            base64.b64decode(cursor + "=" * (-len(cursor) % 4), altchars=b"-_", validate=True)
        )
        if not isinstance(data, dict) or set(data) != {"timestamp", "id"}:
            raise ValueError
        timestamp = datetime.fromisoformat(data["timestamp"])
        if timestamp.tzinfo is None:
            raise ValueError
        return timestamp, UUID(data["id"])
    except (ValueError, TypeError, KeyError, binascii.Error, json.JSONDecodeError):
        _invalid_cursor()


def encode_log_cursor(log: LogRecord) -> str:
    timestamp = log.timestamp
    if timestamp.tzinfo is None:
        timestamp = timestamp.replace(tzinfo=timezone.utc)
    payload = json.dumps(
        {"timestamp": timestamp.isoformat(), "id": str(log.id)},
        separators=(",", ":"),
    ).encode("utf-8")
    return base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")


def calculate_log_stats(
    db: Session,
    workspace_id: UUID,
    base_filter_clauses: list,
    from_at: datetime | None,
    to_at: datetime | None,
) -> tuple[int, dict[str, int], list[LogTimeBucket], dict[str, int]]:
    """Compute aggregate count, severity distribution, time buckets, and service counts."""
    # 1. Total and severity counts
    severity_query = (
        select(LogRecord.severity, func.count(LogRecord.id))
        .where(LogRecord.workspace_id == workspace_id, *base_filter_clauses)
        .group_by(LogRecord.severity)
    )
    severity_rows = db.execute(severity_query).all()
    severity_counts = {sev.value: 0 for sev in LogSeverity}
    total_count = 0
    for sev, count in severity_rows:
        sev_key = sev.value if hasattr(sev, "value") else str(sev)
        severity_counts[sev_key] = count
        total_count += count

    # 2. Service counts
    service_query = (
        select(LogRecord.service_id, func.count(LogRecord.id))
        .where(LogRecord.workspace_id == workspace_id, *base_filter_clauses)
        .group_by(LogRecord.service_id)
    )
    service_rows = db.execute(service_query).all()
    service_counts = {str(s_id): count for s_id, count in service_rows}

    # 3. Time histogram buckets
    now = datetime.now(timezone.utc)
    window_end = to_at or now
    window_start = from_at or (window_end - timedelta(hours=24))

    if window_end <= window_start:
        window_start = window_end - timedelta(hours=1)

    total_duration = (window_end - window_start).total_seconds()
    num_buckets = 12 if total_duration <= 3600 else 24
    bucket_interval = total_duration / num_buckets

    # Query timestamp and severity for bucket aggregation
    time_query = (
        select(LogRecord.timestamp, LogRecord.severity)
        .where(
            LogRecord.workspace_id == workspace_id,
            LogRecord.timestamp >= window_start,
            LogRecord.timestamp <= window_end,
            *base_filter_clauses,
        )
    )
    time_rows = db.execute(time_query).all()

    buckets_data: list[dict] = [
        {
            "timestamp": (window_start + timedelta(seconds=i * bucket_interval)).isoformat(),
            "count": 0,
            "severity_breakdown": {sev.value: 0 for sev in LogSeverity},
        }
        for i in range(num_buckets)
    ]

    for record_ts, record_sev in time_rows:
        ts = record_ts if record_ts.tzinfo is not None else record_ts.replace(tzinfo=timezone.utc)
        offset = (ts - window_start).total_seconds()
        bucket_idx = int(offset // bucket_interval)
        if 0 <= bucket_idx < num_buckets:
            buckets_data[bucket_idx]["count"] += 1
            sev_key = record_sev.value if hasattr(record_sev, "value") else str(record_sev)
            buckets_data[bucket_idx]["severity_breakdown"][sev_key] = (
                buckets_data[bucket_idx]["severity_breakdown"].get(sev_key, 0) + 1
            )

    time_buckets = [LogTimeBucket(**b) for b in buckets_data]
    return total_count, severity_counts, time_buckets, service_counts
