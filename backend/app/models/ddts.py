"""DDT — documenti di trasporto (delivery notes).

Un fornitore consegna merce con un DDT a ogni consegna; a fine mese emette
UNA fattura che raggruppa più DDT dello stesso fornitore. Il modello
rispecchia Invoice (testata + importo) e aggiunge `invoice_id`, il
collegamento alla fattura generata a fine mese:

- invoice_id NULL          → DDT non ancora fatturato, modificabile.
- invoice_id valorizzato   → DDT "fatturato", bloccato (sola lettura).

ondelete='SET NULL' sul collegamento: cancellando la fattura (admin), i DDT
collegati tornano automaticamente liberi e di nuovo modificabili.
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
    Index,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import AmodeiBase, TimestampMixin


class Ddt(AmodeiBase, TimestampMixin):
    __tablename__ = "ddts"

    supplier_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("suppliers.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    ddt_number: Mapped[str] = mapped_column(String(50), nullable=False)
    ddt_date: Mapped[date_type] = mapped_column(Date, nullable=False, index=True)
    amount_total: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    photo_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Collegamento alla fattura generata a fine mese. NULL = non fatturato.
    invoice_id: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey("invoices.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    created_by_user_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, onupdate=lambda: datetime.now(),
    )

    supplier = relationship("Supplier")
    invoice = relationship("Invoice")

    __table_args__ = (
        CheckConstraint("amount_total > 0", name="ck_ddts_amount_positive"),
        UniqueConstraint("supplier_id", "ddt_number", name="uq_ddts_supplier_number"),
        Index("ix_ddts_supplier_date", "supplier_id", "ddt_date"),
    )
