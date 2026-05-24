"""/metrics endpoint — admin-only snapshot of in-memory request counters.

Also exposes /metrics/sentry-test (admin-only) to verify the error pipeline
in production: it raises a real unhandled exception so Sentry records it.
HTTPException would not work — those are handled by FastAPI before reaching
sentry-sdk's unhandled-exception hook.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends

from app.dependencies.auth import require_admin
from app.models.users import User
from app.services.metrics import snapshot

router = APIRouter(prefix="/metrics", tags=["metrics"])


@router.get("")
def get_metrics(_user: User = Depends(require_admin)) -> dict:
    return snapshot()


@router.get("/sentry-test")
def sentry_test(_user: User = Depends(require_admin)) -> None:
    """Deliberately crashes with an UNHANDLED exception — used once at setup
    to confirm Sentry receives the event. The response will be a 500 from
    FastAPI's default exception handler.
    """
    raise RuntimeError("Sentry test triggered intentionally by admin.")
