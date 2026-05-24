"""In-memory request counters exposed by the /metrics endpoint.

Production-grade observability uses Prometheus + Grafana or a hosted APM.
For a single-instance wine-bar PWA this is overkill: a counter dict in
memory tells the admin at a glance "is anything throwing 500s?" without
extra infra. Counters reset on restart — that's fine; we're not doing SLO.
"""
from __future__ import annotations

import threading
from collections import defaultdict
from datetime import datetime, timezone

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware

_LOCK = threading.Lock()
_REQUEST_COUNT = 0
_ERROR_COUNT = 0
_BY_STATUS: dict[int, int] = defaultdict(int)
_BY_ROUTE: dict[str, int] = defaultdict(int)
_STARTED_AT = datetime.now(timezone.utc)


class MetricsMiddleware(BaseHTTPMiddleware):
    """Counts every response by status code and route template."""

    async def dispatch(self, request: Request, call_next):
        global _REQUEST_COUNT, _ERROR_COUNT
        response = await call_next(request)
        # route.path is the template (e.g. /products/{id}); fallback to literal
        route_key = getattr(getattr(request, "scope", {}).get("route"), "path", request.url.path)
        with _LOCK:
            _REQUEST_COUNT += 1
            _BY_STATUS[response.status_code] += 1
            _BY_ROUTE[route_key] += 1
            if response.status_code >= 500:
                _ERROR_COUNT += 1
        return response


def snapshot() -> dict:
    """Read a stable copy of the counters under the lock."""
    with _LOCK:
        return {
            "started_at": _STARTED_AT.isoformat(),
            "uptime_seconds": int((datetime.now(timezone.utc) - _STARTED_AT).total_seconds()),
            "total_requests": _REQUEST_COUNT,
            "total_errors_5xx": _ERROR_COUNT,
            "by_status": dict(_BY_STATUS),
            # Top 20 routes by traffic — full dict is unbounded over time
            "by_route_top": dict(sorted(_BY_ROUTE.items(), key=lambda kv: kv[1], reverse=True)[:20]),
        }
