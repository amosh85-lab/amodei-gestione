"""Supplier invoices + payments.

Design notes:
- Invoice has NO direct `paid_at` / `is_paid` column. Payment status is
  derived from the existence of an associated InvoicePayment row. A
  UNIQUE constraint on invoice_payments.invoice_id enforces that an
  invoice can belong to AT MOST one Payment (no partial payments today).
- A single Payment can settle MULTIPLE invoices (real-world: bonifico
  unico di fine mese per N fatture dello stesso fornitore).
- All invoices in one Payment MUST be from the same supplier — enforced
  in the router layer, not at the schema level.
- Method 'check' requires check_number; methods 'bank_transfer' and
  'cash' must have check_number NULL. Enforced via CHECK constraint.
"""
from __future__ import annotations

import enum
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

from app.models.base import AmodeiBase, TimestampMixin, pg_enum


class PaymentMethod(str, enum.Enum):
    bank_transfer = "bank_transfer"
    check = "check"
    cash = "cash"


class Invoice(AmodeiBase, TimestampMixin):
    __tablename__ = "invoices"

    supplier_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("suppliers.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    invoice_number: Mapped[str] = mapped_column(String(50), nullable=False)
    invoice_date: Mapped[date_type] = mapped_column(Date, nullable=False, index=True)
    amount_total: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    photo_url: Mapped[str | None] = mapped_column(Text, nullable=True)
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
    # Backref tramite invoice_payments → Payment (single, per UNIQUE constraint).
    invoice_payment = relationship(
        "InvoicePayment", back_populates="invoice", uselist=False,
        cascade="save-update, merge",
    )

    __table_args__ = (
        CheckConstraint("amount_total > 0", name="ck_invoices_amount_positive"),
        UniqueConstraint("supplier_id", "invoice_number", name="uq_invoices_supplier_number"),
        Index("ix_invoices_supplier_date", "supplier_id", "invoice_date"),
    )


class Payment(AmodeiBase, TimestampMixin):
    __tablename__ = "payments"

    payment_date: Mapped[date_type] = mapped_column(Date, nullable=False, index=True)
    method: Mapped[PaymentMethod] = mapped_column(
        pg_enum(PaymentMethod, "payment_method"),
        nullable=False,
        index=True,
    )
    amount_total: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    check_number: Mapped[str | None] = mapped_column(String(50), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    registered_by_user_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )

    # Le righe InvoicePayment vengono eliminate in cascade quando il Payment
    # viene cancellato — le Invoice tornano quindi "non pagate".
    invoice_payments = relationship(
        "InvoicePayment", back_populates="payment", cascade="all, delete-orphan",
    )

    __table_args__ = (
        CheckConstraint("amount_total > 0", name="ck_payments_amount_positive"),
        CheckConstraint(
            "(method = 'check' AND check_number IS NOT NULL) "
            "OR (method <> 'check' AND check_number IS NULL)",
            name="ck_payments_check_number_consistency",
        ),
    )


class InvoicePayment(AmodeiBase):
    """Bridge invoice ↔ payment. UNIQUE invoice_id means an invoice can
    be settled by at most one Payment (today: no partial payments)."""

    __tablename__ = "invoice_payments"

    invoice_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("invoices.id", ondelete="RESTRICT"),
        nullable=False,
    )
    payment_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("payments.id", ondelete="CASCADE"),
        nullable=False,
    )

    invoice = relationship("Invoice", back_populates="invoice_payment")
    payment = relationship("Payment", back_populates="invoice_payments")

    __table_args__ = (
        UniqueConstraint("invoice_id", name="uq_invoice_payments_invoice_once"),
        Index("ix_invoice_payments_payment", "payment_id"),
    )
