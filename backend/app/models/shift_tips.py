"""Shift tips: mancia POS lasciata in un servizio (pranzo/cena).

Una riga = la mancia totale di un (date, service). Non si registra la
quota per persona: a fine mese il payroll divide l'importo in parti
uguali tra chi ha un work_shift su quel (date, service), così le
correzioni ai turni ricalcolano automaticamente le quote.
"""
from __future__ import annotations

from datetime import date as date_type, datetime
from decimal import Decimal

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Numeric,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import AmodeiBase, SERVICE_KIND_ENUM, ServiceKind, TimestampMixin


class ShiftTip(AmodeiBase, TimestampMixin):
    __tablename__ = "shift_tips"

    date: Mapped[date_type] = mapped_column(Date, nullable=False, index=True)
    service: Mapped[ServiceKind] = mapped_column(SERVICE_KIND_ENUM, nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(8, 2), nullable=False)
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

    __table_args__ = (
        # Una sola mancia per servizio per giorno.
        UniqueConstraint("date", "service", name="uq_shift_tips_date_service"),
        CheckConstraint("amount > 0", name="ck_shift_tips_amount_positive"),
    )
