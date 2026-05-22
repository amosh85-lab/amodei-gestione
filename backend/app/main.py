"""Amodei Wine Bar — FastAPI application entry point."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.routers import auth as auth_router

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
