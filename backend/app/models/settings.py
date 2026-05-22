"""Application-wide settings (key-value store)."""
from __future__ import annotations

import enum
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import AmodeiBase, pg_enum


class AppSettingValueType(str, enum.Enum):
    """How the ``value`` string should be parsed by the application."""

    string = "string"
    number = "number"
    boolean = "boolean"
    json = "json"


class AppSetting(AmodeiBase):
    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(80), nullable=False, unique=True)
    value: Mapped[str] = mapped_column(String(500), nullable=False)
    value_type: Mapped[AppSettingValueType] = mapped_column(
        pg_enum(AppSettingValueType, "app_setting_value_type"),
        nullable=False,
    )
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Nullable: the seed script and future programmatic migrations may insert
    # settings before any user exists. The UI sets it when an admin edits.
    updated_by_user_id: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
