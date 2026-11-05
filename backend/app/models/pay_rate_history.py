"""PayRateHistory — storico delle modifiche al compenso di un dipendente.

Ogni riga è la tariffa/stipendio in vigore A PARTIRE da `effective_from`
(incluso), finché non arriva una riga più recente per lo stesso utente.

User.pay_type / hourly_rate / monthly_salary restano la tariffa CORRENTE
(sincronizzata quando si salva una riga qui con effective_from <= oggi),
così il resto dell'app continua a leggerla senza modifiche. Il calcolo
della busta paga mensile (services/payroll.py) invece usa questa tabella
per applicare la tariffa giusta a ogni sotto-periodo del mese, nel caso
cambi a metà mese.
"""
from __future__ import annotations

from datetime import date as date_type
from decimal import Decimal

from sqlalchemy import (
    BigInteger,
    Date,
    ForeignKey,
    Numeric,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import AmodeiBase, TimestampMixin, pg_enum
from app.models.users import PayType


class PayRateHistory(AmodeiBase, TimestampMixin):
    __tablename__ = "pay_rate_history"

    user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True,
    )
    effective_from: Mapped[date_type] = mapped_column(Date, nullable=False, index=True)
    pay_type: Mapped[PayType] = mapped_column(pg_enum(PayType, "pay_type"), nullable=False)
    hourly_rate: Mapped[Decimal | None] = mapped_column(Numeric(8, 2), nullable=True)
    monthly_salary: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True,
    )

    __table_args__ = (
        UniqueConstraint("user_id", "effective_from", name="uq_pay_rate_history_user_date"),
    )
