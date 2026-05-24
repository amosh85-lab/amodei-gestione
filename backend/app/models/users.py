"""User accounts and authentication-related types."""
from __future__ import annotations

import enum
from decimal import Decimal

from sqlalchemy import Boolean, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import AmodeiBase, TimestampMixin, pg_enum


class UserRole(str, enum.Enum):
    """Role hierarchy: admin > manager > staff (enforced in services/auth)."""

    admin = "admin"
    manager = "manager"
    staff = "staff"


class User(AmodeiBase, TimestampMixin):
    __tablename__ = "users"

    email: Mapped[str] = mapped_column(String(255), nullable=False, unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str] = mapped_column(String(120), nullable=False)
    role: Mapped[UserRole] = mapped_column(pg_enum(UserRole, "user_role"), nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    # PAYROLL — dati sensibili, esposti SOLO via UserOutAdmin (in /users router).
    # Nessun altro endpoint deve includerli (anche su /auth/me).
    hourly_rate: Mapped[Decimal | None] = mapped_column(Numeric(8, 2), nullable=True)
    weekly_hours_contract: Mapped[Decimal | None] = mapped_column(Numeric(4, 2), nullable=True)
