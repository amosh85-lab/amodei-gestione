"""Shared base class, mixins, and cross-domain SQL types for the Amodei ORM."""
from __future__ import annotations

import enum
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Enum as SAEnum, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class AmodeiBase(Base):
    """Common base for every Amodei domain model.

    Provides a BigInteger autoincrement primary key. Subclasses must set
    ``__tablename__`` explicitly (snake_case, plural).
    """

    __abstract__ = True

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)


class TimestampMixin:
    """Adds a ``created_at`` column populated server-side at INSERT."""

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )


# --- Cross-domain enums ---


class ServiceKind(str, enum.Enum):
    """Wine bar service shift, used by cash, expenses, and staff meals."""

    lunch = "lunch"
    dinner = "dinner"


def pg_enum(enum_cls: type[enum.Enum], name: str) -> SAEnum:
    """Build a native Postgres ENUM column type for a Python Enum.

    Single source of truth for our enum conventions:
      - native_enum (real Postgres type, not VARCHAR + CHECK)
      - SQL value is the Python enum's ``.value`` (lowercase), not its name
      - validate_strings rejects bogus inserts at the Python layer
    """
    return SAEnum(
        enum_cls,
        name=name,
        native_enum=True,
        values_callable=lambda members: [m.value for m in members],
        validate_strings=True,
    )


# Shared SAEnum instance reused by cash.py and staff_meals.py — declaring it
# once avoids duplicate CREATE TYPE statements in the migration.
SERVICE_KIND_ENUM = pg_enum(ServiceKind, "service_kind")
