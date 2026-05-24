"""Amodei Wine Bar — FastAPI application entry point."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware
from app.config import get_settings
from app.routers import (
    advances as advances_router,
    alerts as alerts_router,
    auth as auth_router,
    batches as batches_router,
    cash_export as cash_export_router,
    daily_summary as daily_summary_router,
    evening_close as evening_close_router,
    expense_categories as expense_categories_router,
    expenses as expenses_router,
    foodcost as foodcost_router,
    forecast as forecast_router,
    invoices as invoices_router,
    menu as menu_router,
    metrics as metrics_router,
    movements as movements_router,
    orders as orders_router,
    payments as payments_router,
    pos_sessions as pos_sessions_router,
    products as products_router,
    reports as reports_router,
    settings as settings_router,
    staff_meals as staff_meals_router,
    suppliers as suppliers_router,
    users as users_router,
)
from app.services.logging_setup import RequestIdMiddleware, configure_logging
from app.services.metrics import MetricsMiddleware
from app.services.storage import UPLOAD_ROOT, ensure_upload_root

settings = get_settings()

configure_logging(json_logs=settings.environment.lower() == "production")
logger = logging.getLogger("amodei.api")

# Sentry: only when SENTRY_DSN is set. Captures unhandled exceptions and
# (with traces_sample_rate > 0) performance spans. Tags with environment.
if settings.sentry_dsn:
    import sentry_sdk
    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.environment,
        release=settings.app_version,
        traces_sample_rate=settings.sentry_traces_sample_rate,
        send_default_pii=False,
    )
    logger.info("Sentry attivo (env=%s, traces=%.2f)",
                settings.environment, settings.sentry_traces_sample_rate)

# Production safety net: refuse to boot with CORS wildcard or default JWT
# secret. Catches forgotten env vars before they hit real users.
if settings.environment.lower() == "production":
    if "*" in settings.allowed_origins_list:
        raise RuntimeError(
            "ALLOWED_ORIGINS non può essere '*' in produzione. "
            "Imposta su Railway l'URL esatto del frontend Netlify."
        )
    if settings.jwt_secret == "change-me-in-production":
        raise RuntimeError(
            "JWT_SECRET non è stato cambiato dal default. "
            "Imposta su Railway un secret robusto: `openssl rand -hex 32`."
        )


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    logger.info(
        "Amodei API starting | version=%s | env=%s | origins=%s",
        settings.app_version,
        settings.environment,
        settings.allowed_origins_list,
    )
    yield
    logger.info("Amodei API shutting down")


app = FastAPI(
    title="Amodei API",
    version=settings.app_version,
    description="Backend for the Amodei Wine Bar management PWA.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Adds baseline browser security headers to every response.

    - HSTS: forces HTTPS for 1 year (Railway already terminates TLS).
      Skipped on the local dev origin (http://localhost) so the browser
      doesn't lock itself out of plain-HTTP development.
    - X-Content-Type-Options: nosniff — disables MIME sniffing.
    - X-Frame-Options: DENY — prevents the app from being iframed (clickjacking).
    - Referrer-Policy: strict-origin-when-cross-origin — minimum leakage.
    """

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        # HSTS only when serving over HTTPS (don't issue it on dev http://).
        if request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https":
            response.headers.setdefault(
                "Strict-Transport-Security",
                "max-age=31536000; includeSubDomains",
            )
        return response


app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(RequestIdMiddleware)
app.add_middleware(MetricsMiddleware)


app.include_router(auth_router.router)
app.include_router(suppliers_router.router)
app.include_router(products_router.router)
app.include_router(batches_router.router)
app.include_router(movements_router.router)
app.include_router(menu_router.router)
app.include_router(evening_close_router.router)
app.include_router(users_router.router)
app.include_router(staff_meals_router.router)
app.include_router(alerts_router.router)
app.include_router(orders_router.router)
app.include_router(settings_router.router)
app.include_router(expense_categories_router.router)
app.include_router(pos_sessions_router.router)
app.include_router(expenses_router.router)
app.include_router(daily_summary_router.router)
app.include_router(cash_export_router.router)
app.include_router(advances_router.router)
app.include_router(invoices_router.router)
app.include_router(payments_router.router)
app.include_router(foodcost_router.router)
app.include_router(reports_router.router)
app.include_router(forecast_router.router)
app.include_router(metrics_router.router)

# Persistent uploads (mounted on Railway as a Volume at /app/uploads). The
# directory is created on startup so the StaticFiles mount doesn't fail on
# a clean checkout / new deploy.
ensure_upload_root()
app.mount("/uploads", StaticFiles(directory=str(UPLOAD_ROOT)), name="uploads")
logger.info("Static uploads mounted at /uploads → %s", UPLOAD_ROOT)


def _health_payload() -> dict[str, str]:
    return {
        "status": "ok",
        "service": "amodei-api",
        "version": settings.app_version,
    }


@app.get("/", tags=["meta"])
async def root() -> dict[str, str]:
    return _health_payload()


@app.get("/health", tags=["meta"])
async def health() -> dict[str, str]:
    return _health_payload()
