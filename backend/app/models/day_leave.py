"""DayLeave — marca una giornata di un dipendente come ferie/riposo/malattia.

Granularità: 1 sola entry per (user_id, date). Indipendente dal servizio.
Per ora puramente informativo: non impatta il calcolo dello stipendio.
"""
from __future__ import annotations

import enum
from datetime import date as date_type

from sqlalchemy import (
    BigInteger,
    Date,
    ForeignKey,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import AmodeiBase, TimestampMixin, pg_enum


class DayLeaveKind(str, enum.Enum):
    ferie = "ferie"
    riposo = "riposo"
    malattia = "malattia"


class DayLeave(AmodeiBase, TimestampMixin):
    __tablename__ = "day_leaves"

    user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False, index=True,
    )
    date: Mapped[date_type] = mapped_column(Date, nullable=False, index=True)
    kind: Mapped[DayLeaveKind] = mapped_column(
        pg_enum(DayLeaveKind, "day_leave_kind"), nullable=False,
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_by_user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False, index=True,
    )

    __table_args__ = (
        UniqueConstraint("user_id", "date", name="uq_day_leaves_user_date"),
    )
