"""Amodei Wine Bar — FastAPI application entry point."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import get_settings
from app.routers import (
    auth as auth_router,
    batches as batches_router,
    evening_close as evening_close_router,
    menu as menu_router,
    movements as movements_router,
    products as products_router,
    suppliers as suppliers_router,
)
from app.services.storage import UPLOAD_ROOT, ensure_upload_root

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
)
logger = logging.getLogger("amodei.api")

settings = get_settings()


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

app.include_router(auth_router.router)
app.include_router(suppliers_router.router)
app.include_router(products_router.router)
app.include_router(batches_router.router)
app.include_router(movements_router.router)
app.include_router(menu_router.router)
app.include_router(evening_close_router.router)

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
