"""In-memory per-IP rate limiter for the login endpoint.

Why not slowapi: its decorator wraps the view function in a way that confuses
FastAPI's signature introspection when combined with response_model and a
Pydantic body — the body ends up parsed as a query param. Since we only need
rate-limiting on /auth/login and the backend runs as a single uvicorn process,
a small sliding-window store in memory is sufficient and predictable.

Usage:
    from fastapi import Depends, Request
    from app.services.rate_limit import login_rate_limit_check

    @router.post("/login")
    def login(request: Request, _rl = Depends(login_rate_limit_check), ...):
        ...
"""
from __future__ import annotations

import threading
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, Request, status

_LOCK = threading.Lock()
_ATTEMPTS: dict[str, deque[datetime]] = defaultdict(deque)

LOGIN_MAX_ATTEMPTS = 5
LOGIN_WINDOW = timedelta(minutes=5)


def _client_ip(request: Request) -> str:
    # Behind Railway's proxy the real client IP is in X-Forwarded-For.
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def login_rate_limit_check(request: Request) -> None:
    """Raise 429 if this IP has hit LOGIN_MAX_ATTEMPTS within LOGIN_WINDOW."""
    ip = _client_ip(request)
    now = datetime.now(timezone.utc)
    cutoff = now - LOGIN_WINDOW
    with _LOCK:
        dq = _ATTEMPTS[ip]
        while dq and dq[0] < cutoff:
            dq.popleft()
        if len(dq) >= LOGIN_MAX_ATTEMPTS:
            retry_seconds = int((dq[0] + LOGIN_WINDOW - now).total_seconds())
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Troppi tentativi di login. Riprova tra {max(1, retry_seconds)} secondi.",
            )
        dq.append(now)
