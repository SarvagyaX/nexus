"""Small process-local login limiter for the single-process demo deployment."""

from collections import defaultdict, deque
from hashlib import sha256
from threading import Lock
from time import monotonic

WINDOW_SECONDS = 900
MAX_FAILURES = 5
MAX_KEYS = 10_000
_attempts: dict[str, deque[float]] = defaultdict(deque)
_lock = Lock()


def _key(client_host: str, normalized_email: str) -> str:
    return sha256(f"{client_host}\0{normalized_email}".encode("utf-8")).hexdigest()


def is_limited(client_host: str, normalized_email: str) -> bool:
    key = _key(client_host, normalized_email)
    now = monotonic()
    with _lock:
        attempts = _attempts[key]
        while attempts and now - attempts[0] >= WINDOW_SECONDS:
            attempts.popleft()
        return len(attempts) >= MAX_FAILURES


def record_failure(client_host: str, normalized_email: str) -> None:
    key = _key(client_host, normalized_email)
    now = monotonic()
    with _lock:
        if len(_attempts) >= MAX_KEYS and key not in _attempts:
            oldest = min(_attempts, key=lambda item: _attempts[item][0] if _attempts[item] else now)
            _attempts.pop(oldest, None)
        attempts = _attempts[key]
        while attempts and now - attempts[0] >= WINDOW_SECONDS:
            attempts.popleft()
        attempts.append(now)


def clear_failures(client_host: str, normalized_email: str) -> None:
    with _lock:
        _attempts.pop(_key(client_host, normalized_email), None)
