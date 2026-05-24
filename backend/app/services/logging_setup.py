"""Structured JSON logging + request-id propagation.

Production logs are emitted as one JSON object per line, indexable by
Railway / Loki / Datadog without further parsing. Each line carries the
request ID (when in a request scope) so you can correlate everything that
happened during a single API call.

In development (ENVIRONMENT != "production") logs stay in the readable
human format — JSON noise in `tail -f` is awful when you're debugging.

Wire-up in main.py:

    from app.services.logging_setup import configure_logging, RequestIdMiddleware
    configure_logging(json_logs=settings.environment.lower() == "production")
    app.add_middleware(RequestIdMiddleware)
"""
from __future__ import annotations

import contextvars
import json
import logging
import sys
import uuid

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware

REQUEST_ID_CTX: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "amodei_request_id", default=None,
)
REQUEST_ID_HEADER = "X-Request-ID"


class JsonFormatter(logging.Formatter):
    """One JSON object per record, request_id appended when available."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, object] = {
            "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        rid = REQUEST_ID_CTX.get()
        if rid:
            payload["request_id"] = rid
        # Surface known structured attrs if set via `logger.info("…", extra={…})`
        for key in ("user_id", "route", "method", "status", "duration_ms"):
            value = getattr(record, key, None)
            if value is not None:
                payload[key] = value
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False)


def configure_logging(*, json_logs: bool) -> None:
    """Replace the root handlers with a single stdout handler.

    Called once at startup. Safe to call again (handlers get reset).
    """
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    for h in list(root.handlers):
        root.removeHandler(h)
    handler = logging.StreamHandler(stream=sys.stdout)
    if json_logs:
        handler.setFormatter(JsonFormatter())
    else:
        handler.setFormatter(logging.Formatter(
            "%(asctime)s | %(levelname)s | %(name)s | %(message)s"
        ))
    root.addHandler(handler)
    # uvicorn's own access logger uses its own format and is noisy in prod
    # JSON output. Silence it; we log the same info from our middleware.
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)


class RequestIdMiddleware(BaseHTTPMiddleware):
    """Assign or propagate X-Request-ID for every request.

    - Reads incoming X-Request-ID header (e.g. set by an upstream proxy) or
      generates a new uuid4. Stores it in a ContextVar so JsonFormatter
      can attach it to every log line emitted during the request.
    - Echoes the ID back in the response header so the frontend / curl can
      include it in bug reports.
    - Emits a structured INFO line at request end with method, path, status,
      duration_ms.
    """

    async def dispatch(self, request: Request, call_next):
        rid = request.headers.get(REQUEST_ID_HEADER) or uuid.uuid4().hex[:16]
        token = REQUEST_ID_CTX.set(rid)
        logger = logging.getLogger("amodei.http")
        from time import perf_counter
        t0 = perf_counter()
        try:
            response = await call_next(request)
        except Exception:
            duration_ms = int((perf_counter() - t0) * 1000)
            logger.exception(
                "request crashed",
                extra={"method": request.method, "route": request.url.path,
                       "status": 500, "duration_ms": duration_ms},
            )
            REQUEST_ID_CTX.reset(token)
            raise
        duration_ms = int((perf_counter() - t0) * 1000)
        response.headers[REQUEST_ID_HEADER] = rid
        logger.info(
            "request completed",
            extra={"method": request.method, "route": request.url.path,
                   "status": response.status_code, "duration_ms": duration_ms},
        )
        REQUEST_ID_CTX.reset(token)
        return response
