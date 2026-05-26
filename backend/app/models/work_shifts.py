"""Work shifts: ore lavorate per dipendente per giorno, divise per servizio.

Una riga = un turno (date, user_id, service) con start_time e durata
in ore. Un dipendente può fare 2 turni nello stesso giorno (pranzo +
cena) → 2 righe separate.
"""
from __future__ import annotations

from datetime import date as date_type, datetime, time as time_type
from decimal import Decimal

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Numeric,
    Text,
    Time,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import AmodeiBase, SERVICE_KIND_ENUM, ServiceKind, TimestampMixin


class WorkShift(AmodeiBase, TimestampMixin):
    __tablename__ = "work_shifts"

    date: Mapped[date_type] = mapped_column(Date, nullable=False, index=True)
    user_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    service: Mapped[ServiceKind] = mapped_column(SERVICE_KIND_ENUM, nullable=False)
    start_time: Mapped[time_type] = mapped_column(Time, nullable=False)
    hours: Mapped[Decimal] = mapped_column(Numeric(4, 2), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_user_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, onupdate=lambda: datetime.now(),
    )

    user = relationship("User", foreign_keys=[user_id])

    __table_args__ = (
        # Una persona può avere al massimo UN turno per servizio per giorno.
        UniqueConstraint("date", "user_id", "service", name="uq_work_shifts_date_user_service"),
        # hours valido: 0 < h ≤ 12. La regola "multiplo di 0.25" è
        # validata lato Pydantic per evitare MOD() su NUMERIC che è poco
        # portabile e meno chiara da diagnosticare in caso di errore.
        CheckConstraint("hours > 0 AND hours <= 12", name="ck_work_shifts_hours_range"),
        Index("ix_work_shifts_user_date", "user_id", "date"),
    )
