"""Thread-safe, lightweight application metrics collector and Prometheus exporter."""

from collections import Counter, deque
import math
from threading import RLock
import time
from typing import Any

LATENCY_BUCKETS_MS = [5.0, 10.0, 25.0, 50.0, 100.0, 250.0, 500.0, 1000.0, 2500.0, 5000.0]


class NexusMetricsCollector:
    """In-memory metrics accumulator for operational telemetry."""

    def __init__(self) -> None:
        self._lock = RLock()
        self.start_time = time.time()

        # HTTP Request metrics
        self.total_requests = 0
        self.active_requests = 0
        self.status_counts: Counter[str] = Counter()
        self.method_counts: Counter[str] = Counter()
        self.total_duration_ms = 0.0

        # Latency distribution (last 1000 requests for percentiles)
        self.recent_latencies_ms: deque[float] = deque(maxlen=1000)
        self.bucket_counts: Counter[float] = Counter()

        # Dependency counters
        self.db_checks_total = 0
        self.db_errors_total = 0
        self.redis_ops_total = 0
        self.redis_errors_total = 0

        # Background processing counters
        self.background_tasks_total = 0
        self.background_tasks_failed = 0

    def start_request(self) -> None:
        with self._lock:
            self.active_requests += 1

    def end_request(self, method: str, status_code: int, duration_ms: float) -> None:
        with self._lock:
            self.active_requests = max(0, self.active_requests - 1)
            self.total_requests += 1
            self.total_duration_ms += duration_ms

            # Normalize method (low cardinality)
            norm_method = method.upper() if method else "UNKNOWN"
            self.method_counts[norm_method] += 1

            # Count status code
            code_str = str(status_code)
            self.status_counts[code_str] += 1

            # Class count (2xx, 3xx, 4xx, 5xx)
            class_str = f"{code_str[0]}xx"
            self.status_counts[class_str] += 1

            # Latency sampling
            self.recent_latencies_ms.append(duration_ms)
            for b in LATENCY_BUCKETS_MS:
                if duration_ms <= b:
                    self.bucket_counts[b] += 1

    def record_db_check(self, success: bool) -> None:
        with self._lock:
            self.db_checks_total += 1
            if not success:
                self.db_errors_total += 1

    def record_redis_op(self, success: bool) -> None:
        with self._lock:
            self.redis_ops_total += 1
            if not success:
                self.redis_errors_total += 1

    def record_background_task(self, success: bool) -> None:
        with self._lock:
            self.background_tasks_total += 1
            if not success:
                self.background_tasks_failed += 1

    def get_percentiles(self) -> dict[str, float]:
        with self._lock:
            if not self.recent_latencies_ms:
                return {"p50": 0.0, "p90": 0.0, "p95": 0.0, "p99": 0.0}
            sorted_lat = sorted(self.recent_latencies_ms)
            n = len(sorted_lat)

            def _pct(p: float) -> float:
                idx = min(int(math.ceil(p * n) - 1), n - 1)
                return round(sorted_lat[max(0, idx)], 2)

            return {
                "p50": _pct(0.50),
                "p90": _pct(0.90),
                "p95": _pct(0.95),
                "p99": _pct(0.99),
            }

    def get_snapshot(self) -> dict[str, Any]:
        """Returns JSON-serializable snapshot for system diagnostics UI."""
        with self._lock:
            uptime_seconds = round(time.time() - self.start_time, 1)
            total = self.total_requests
            avg_latency = round(self.total_duration_ms / total, 2) if total > 0 else 0.0

            pcts = self.get_percentiles()
            err_4xx = self.status_counts.get("4xx", 0)
            err_5xx = self.status_counts.get("5xx", 0)
            success_count = self.status_counts.get("2xx", 0)
            error_rate = round((err_5xx / total) * 100.0, 2) if total > 0 else 0.0

            return {
                "uptime_seconds": uptime_seconds,
                "total_requests": total,
                "active_requests": self.active_requests,
                "avg_latency_ms": avg_latency,
                "percentiles_ms": pcts,
                "error_rate_pct": error_rate,
                "status_classes": {
                    "2xx": success_count,
                    "3xx": self.status_counts.get("3xx", 0),
                    "4xx": err_4xx,
                    "5xx": err_5xx,
                },
                "status_codes": dict(self.status_counts),
                "methods": dict(self.method_counts),
                "dependencies": {
                    "database": {
                        "checks_total": self.db_checks_total,
                        "errors_total": self.db_errors_total,
                    },
                    "redis": {
                        "operations_total": self.redis_ops_total,
                        "errors_total": self.redis_errors_total,
                    },
                },
                "background_tasks": {
                    "total": self.background_tasks_total,
                    "failed": self.background_tasks_failed,
                },
            }

    def format_prometheus(self) -> str:
        """Exports metrics in standard Prometheus text format."""
        with self._lock:
            uptime = time.time() - self.start_time
            lines = [
                "# HELP nexus_uptime_seconds Application uptime in seconds.",
                "# TYPE nexus_uptime_seconds gauge",
                f"nexus_uptime_seconds {uptime:.2f}",
                "",
                "# HELP nexus_http_requests_total Total number of HTTP requests processed.",
                "# TYPE nexus_http_requests_total counter",
                f"nexus_http_requests_total {self.total_requests}",
                "",
                "# HELP nexus_http_active_requests Number of requests currently being handled.",
                "# TYPE nexus_http_active_requests gauge",
                f"nexus_http_active_requests {self.active_requests}",
                "",
                "# HELP nexus_http_requests_by_status_total HTTP requests partitioned by status code.",
                "# TYPE nexus_http_requests_by_status_total counter",
            ]

            for code, count in sorted(self.status_counts.items()):
                if not code.endswith("xx"):
                    lines.append(f'nexus_http_requests_by_status_total{{status="{code}"}} {count}')

            lines.extend([
                "",
                "# HELP nexus_http_requests_by_method_total HTTP requests partitioned by HTTP method.",
                "# TYPE nexus_http_requests_by_method_total counter",
            ])
            for method, count in sorted(self.method_counts.items()):
                lines.append(f'nexus_http_requests_by_method_total{{method="{method}"}} {count}')

            lines.extend([
                "",
                "# HELP nexus_http_request_duration_ms_total Sum of all request durations in milliseconds.",
                "# TYPE nexus_http_request_duration_ms_total counter",
                f"nexus_http_request_duration_ms_total {self.total_duration_ms:.2f}",
                "",
                "# HELP nexus_database_checks_total Total database readiness checks performed.",
                "# TYPE nexus_database_checks_total counter",
                f"nexus_database_checks_total {self.db_checks_total}",
                "",
                "# HELP nexus_database_errors_total Total database connectivity check failures.",
                "# TYPE nexus_database_errors_total counter",
                f"nexus_database_errors_total {self.db_errors_total}",
                "",
                "# HELP nexus_redis_operations_total Total Redis operations attempted.",
                "# TYPE nexus_redis_operations_total counter",
                f"nexus_redis_operations_total {self.redis_ops_total}",
                "",
                "# HELP nexus_redis_errors_total Total Redis operation failures.",
                "# TYPE nexus_redis_errors_total counter",
                f"nexus_redis_errors_total {self.redis_errors_total}",
                "",
                "# HELP nexus_background_tasks_total Total background tasks executed.",
                "# TYPE nexus_background_tasks_total counter",
                f"nexus_background_tasks_total {self.background_tasks_total}",
                "",
                "# HELP nexus_background_tasks_failed_total Total background tasks that failed.",
                "# TYPE nexus_background_tasks_failed_total counter",
                f"nexus_background_tasks_failed_total {self.background_tasks_failed}",
                "",
            ])

            return "\n".join(lines)


# Singleton metrics collector instance
metrics_collector = NexusMetricsCollector()
