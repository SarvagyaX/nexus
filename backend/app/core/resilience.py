"""API resilience utilities: bounded retries with jitter, safe error sanitization, and timeouts."""

import asyncio
import logging
import random
import time
from typing import Any, Callable, TypeVar

from sqlalchemy.exc import OperationalError, TimeoutError as SATimeoutError

logger = logging.getLogger(__name__)

T = TypeVar("T")

DEFAULT_RETRYABLE_EXCEPTIONS = (
    OperationalError,
    SATimeoutError,
    ConnectionResetError,
    TimeoutError,
    asyncio.TimeoutError,
)


def with_retry(
    fn: Callable[[], T],
    max_retries: int = 3,
    base_delay: float = 0.05,
    max_delay: float = 0.5,
    retryable_exceptions: tuple[type[Exception], ...] = DEFAULT_RETRYABLE_EXCEPTIONS,
    *,
    max_attempts: int | None = None,
    initial_delay_sec: float | None = None,
    retry_exceptions: tuple[type[Exception], ...] | None = None,
) -> T:
    """Executes a synchronous callable with bounded exponential backoff and randomized jitter.

    STRICTLY FOR IDEMPOTENT OPERATIONS ONLY (e.g. read queries, health checks).
    """
    retries = max_attempts if max_attempts is not None else max_retries
    delay = initial_delay_sec if initial_delay_sec is not None else base_delay
    exceptions = retry_exceptions if retry_exceptions is not None else retryable_exceptions

    attempt = 0
    while True:
        try:
            return fn()
        except exceptions as exc:
            attempt += 1
            if attempt >= retries:
                logger.warning(
                    f"Retry budget exhausted after {retries} attempts: {exc.__class__.__name__}"
                )
                raise
            # Bounded exponential backoff with +/- 25% jitter
            backoff = min(max_delay, delay * (2 ** (attempt - 1)))
            jittered_delay = backoff * random.uniform(0.75, 1.25)
            time.sleep(jittered_delay)


async def with_retry_async(
    coro_fn: Callable[[], Any],
    max_retries: int = 3,
    base_delay: float = 0.05,
    max_delay: float = 0.5,
    retryable_exceptions: tuple[type[Exception], ...] = DEFAULT_RETRYABLE_EXCEPTIONS,
    *,
    max_attempts: int | None = None,
    initial_delay_sec: float | None = None,
    retry_exceptions: tuple[type[Exception], ...] | None = None,
) -> Any:
    """Executes an async callable with bounded exponential backoff and jitter."""
    retries = max_attempts if max_attempts is not None else max_retries
    delay = initial_delay_sec if initial_delay_sec is not None else base_delay
    exceptions = retry_exceptions if retry_exceptions is not None else retryable_exceptions

    attempt = 0
    while True:
        try:
            return await coro_fn()
        except exceptions as exc:
            attempt += 1
            if attempt >= retries:
                logger.warning(
                    f"Async retry budget exhausted after {retries} attempts: {exc.__class__.__name__}"
                )
                raise
            backoff = min(max_delay, delay * (2 ** (attempt - 1)))
            jittered_delay = backoff * random.uniform(0.75, 1.25)
            await asyncio.sleep(jittered_delay)
