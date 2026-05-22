"""Combined dishes — menu items composed of multiple stocked products."""
from __future__ import annotations

from decimal import Decimal

from sqlalchemy import BigInteger, Boolean, ForeignKey, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import AmodeiBase, TimestampMixin


class CombinedDish(AmodeiBase, TimestampMixin):
    __tablename__ = "combined_dishes"

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    sale_price: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")

    components: Mapped[list[CombinedDishComponent]] = relationship(
        "CombinedDishComponent",
        back_populates="dish",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class CombinedDishComponent(AmodeiBase):
    __tablename__ = "combined_dish_components"

    combined_dish_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("combined_dishes.id", ondelete="CASCADE"),
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

    dish: Mapped[CombinedDish] = relationship("CombinedDish", back_populates="components")
