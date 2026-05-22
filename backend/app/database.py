"""SQLAlchemy engine and session factory.

The engine is created lazily so the app can boot without a database — useful
in early scaffolding and during health checks before migrations are run.
"""
from __future__ import annotations

import logging
from typing import Iterator

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import get_settings

logger = logging.getLogger("amodei.db")


class Base(DeclarativeBase):
    """Declarative base shared by all ORM models."""


_engine: Engine | None = None
_SessionLocal: sessionmaker[Session] | None = None


def _normalise_url(url: str) -> str:
    # Railway historically exposes `postgres://`, SQLAlchemy needs `postgresql://`.
    if url.startswith("postgres://"):
        return url.replace("postgres://", "postgresql://", 1)
    return url


def get_engine() -> Engine:
    global _engine, _SessionLocal
    if _engine is None:
        settings = get_settings()
        if not settings.database_url:
            raise RuntimeError(
                "DATABASE_URL is not configured. Set it in your environment "
                "before using the database."
            )
        logger.info("Initialising SQLAlchemy engine")
        _engine = create_engine(
            _normalise_url(settings.database_url),
            pool_pre_ping=True,
            future=True,
        )
        _SessionLocal = sessionmaker(bind=_engine, autoflush=False, autocommit=False)
    return _engine


def get_session() -> Iterator[Session]:
    """FastAPI dependency yielding a SQLAlchemy session."""
    get_engine()  # ensure session factory is initialised
    assert _SessionLocal is not None
    session = _SessionLocal()
    try:
        yield session
    finally:
        session.close()
