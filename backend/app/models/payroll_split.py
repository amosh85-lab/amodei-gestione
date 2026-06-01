"""Ripartizione Ben/Dan per mese.

Per ogni dipendente per mese, l'admin specifica quanto del lordo va pagato
via bonifico ("Ben") e quanto via contante ("Dan"). Non vincolato a
total = ben + dan.

UNIQUE(user_id, payroll_month) garantisce una sola riga per mese.
"""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Numeric,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import AmodeiBase, TimestampMixin


class PayrollSplit(AmodeiBase, TimestampMixin):
    __tablename__ = "payroll_splits"

    user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False, index=True,
    )
    payroll_month: Mapped[str] = mapped_column(String(7), nullable=False)
    ben_amount: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False, server_default="0")
    dan_amount: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False, server_default="0")
    created_by_user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False, index=True,
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, onupdate=lambda: datetime.now(),
    )

    __table_args__ = (
        CheckConstraint("ben_amount >= 0", name="ck_payroll_splits_ben_nonneg"),
        CheckConstraint("dan_amount >= 0", name="ck_payroll_splits_dan_nonneg"),
        CheckConstraint(
            r"payroll_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'",
            name="ck_payroll_splits_month_format",
        ),
        UniqueConstraint("user_id", "payroll_month", name="uq_payroll_splits_user_month"),
    )
