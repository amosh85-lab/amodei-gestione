"""Cash handling: expense categories, POS sessions, expenses, daily summaries."""
from __future__ import annotations

from datetime import date as date_type, datetime
from decimal import Decimal

from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    String,
    Text,
    UniqueConstraint,
    Numeric,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import AmodeiBase, SERVICE_KIND_ENUM, ServiceKind, TimestampMixin


class ExpenseCategory(AmodeiBase, TimestampMixin):
    __tablename__ = "expense_categories"

    name: Mapped[str] = mapped_column(String(120), nullable=False, unique=True)
    icon: Mapped[str | None] = mapped_column(String(60), nullable=True)
    color: Mapped[str | None] = mapped_column(String(16), nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")


class PosSession(AmodeiBase):
    __tablename__ = "pos_sessions"

    date: Mapped[date_type] = mapped_column(Date, nullable=False)
    service: Mapped[ServiceKind] = mapped_column(SERVICE_KIND_ENUM, nullable=False)
    closing_amount: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    closed_by_user_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    closed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        # UniqueConstraint already produces an index — no separate Index needed
        # to cover the prompt's "PosSession(date, service)" requirement.
        UniqueConstraint("date", "service", name="uq_pos_sessions_date_service"),
    )


class Expense(AmodeiBase, TimestampMixin):
    __tablename__ = "expenses"

    date: Mapped[date_type] = mapped_column(Date, nullable=False, index=True)
    service: Mapped[ServiceKind] = mapped_column(SERVICE_KIND_ENUM, nullable=False)
    category_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("expense_categories.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    description: Mapped[str] = mapped_column(String(255), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    receipt_photo_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_user_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )


class DailySummary(AmodeiBase):
    __tablename__ = "daily_summaries"

    date: Mapped[date_type] = mapped_column(Date, nullable=False, unique=True)
    # End-of-day TOTAL cash in the drawer — INCLUDES the opening cash float.
    cash_total_end_of_day: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    fiscal_total: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    ipratico_total: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    # Snapshot of the cash_float setting at close time — preserves history
    # if the global setting is changed in the future.
    cash_float_snapshot: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    closed_by_user_id: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
    )
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
