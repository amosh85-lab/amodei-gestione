"""End-of-day inventory closes (staff records remaining stock per product)."""
from __future__ import annotations

from datetime import date as date_type
from decimal import Decimal

from sqlalchemy import BigInteger, Date, ForeignKey, Numeric, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import AmodeiBase, TimestampMixin


class EveningClose(AmodeiBase, TimestampMixin):
    __tablename__ = "evening_closes"

    # Date is unique → only one close per day. The UNIQUE constraint already
    # provides an index, so no separate index is needed.
    date: Mapped[date_type] = mapped_column(Date, nullable=False, unique=True)
    user_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    items: Mapped[list[EveningCloseItem]] = relationship(
        "EveningCloseItem",
        back_populates="close",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class EveningCloseItem(AmodeiBase):
    __tablename__ = "evening_close_items"

    evening_close_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("evening_closes.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    product_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("products.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    qty_remaining: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)

    close: Mapped[EveningClose] = relationship("EveningClose", back_populates="items")
