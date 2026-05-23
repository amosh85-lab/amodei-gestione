"""Staff meals — track what the team eats during shifts."""
from __future__ import annotations

from datetime import date as date_type, datetime
from decimal import Decimal

from sqlalchemy import BigInteger, Date, DateTime, ForeignKey, Index, Numeric, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import AmodeiBase, SERVICE_KIND_ENUM, ServiceKind, TimestampMixin


class StaffMeal(AmodeiBase, TimestampMixin):
    __tablename__ = "staff_meals"

    date: Mapped[date_type] = mapped_column(Date, nullable=False)
    service: Mapped[ServiceKind] = mapped_column(SERVICE_KIND_ENUM, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_user_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )

    # Cancellation (admin-only): keeps the audit trail intact while marking
    # the meal as voided. Counter-movements are emitted to restore stock.
    cancelled_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    cancelled_by_user_id: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
    )

    participants: Mapped[list[StaffMealParticipant]] = relationship(
        "StaffMealParticipant",
        back_populates="meal",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    items: Mapped[list[StaffMealItem]] = relationship(
        "StaffMealItem",
        back_populates="meal",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )

    __table_args__ = (
        Index("ix_staff_meals_date_service", "date", "service"),
    )


class StaffMealParticipant(AmodeiBase):
    __tablename__ = "staff_meal_participants"

    staff_meal_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("staff_meals.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )

    meal: Mapped[StaffMeal] = relationship("StaffMeal", back_populates="participants")


class StaffMealItem(AmodeiBase):
    __tablename__ = "staff_meal_items"

    staff_meal_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("staff_meals.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    product_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("products.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    qty: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)

    meal: Mapped[StaffMeal] = relationship("StaffMeal", back_populates="items")
