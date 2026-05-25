"""Suppliers, products, batches and stock movements."""
from __future__ import annotations

import enum
from datetime import date as date_type
from decimal import Decimal

from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    ForeignKey,
    Index,
    Numeric,
    String,
    Text,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import AmodeiBase, TimestampMixin, pg_enum


# UI-suggested units. The DB column is free-text (String(32)) on purpose:
# Postgres enums are painful to extend, while the wine bar will keep coining
# new units ("cassa da 6", "tanica 5L", …). Validation is at the form layer.
COMMON_UNITS: list[str] = [
    "pz",
    "kg",
    "g",
    "lt",
    "cl",
    "ml",
    "bottiglia",
    "cassa",
    "confezione",
    "scatola",
    "tanica",
    "fusto",
    "barattolo",
    "vaschetta",
    "mazzo",
    "metro",
]


class VatRate(str, enum.Enum):
    """Italian VAT rates currently in force."""

    iva_4 = "iva_4"
    iva_5 = "iva_5"
    iva_10 = "iva_10"
    iva_22 = "iva_22"


class MovementType(str, enum.Enum):
    """Reason for a stock movement."""

    load = "load"
    sale = "sale"
    waste_expiry = "waste_expiry"
    waste_other = "waste_other"
    adjustment = "adjustment"
    staff_meal = "staff_meal"


class SupplierCategory(str, enum.Enum):
    """Coarse category to slice invoices into food cost groups.
    food = ingredients & meals · beverage = wine, drinks · consumo = cleaning
    supplies, paper goods, small equipment. Drives the /foodcost dashboard.
    """

    food = "food"
    beverage = "beverage"
    consumo = "consumo"


class MovementSource(str, enum.Enum):
    """High-level workflow that produced a Movement.

    Different from :class:`MovementType`: ``type`` describes the accounting
    effect (sale / adjustment / etc.), ``source`` records *which feature*
    emitted the movement. ``source_id`` then references the originating row
    (e.g. ``source=staff_meal, source_id=42`` ⇒ StaffMeal #42).

    Populated since prompt 9; older rows have ``source=None``.
    """

    load = "load"
    sale = "sale"
    waste = "waste"
    staff_meal = "staff_meal"
    adjustment = "adjustment"


class Supplier(AmodeiBase, TimestampMixin):
    __tablename__ = "suppliers"

    name: Mapped[str] = mapped_column(String(160), nullable=False)
    contact_name: Mapped[str | None] = mapped_column(String(160), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(40), nullable=True)
    whatsapp: Mapped[str | None] = mapped_column(String(40), nullable=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    message_template: Mapped[str | None] = mapped_column(Text, nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    # Bucket per food-cost reporting. Default 'food' per i fornitori esistenti
    # via server_default; admin può ri-categorizzarli da /fornitori.
    category: Mapped[SupplierCategory] = mapped_column(
        pg_enum(SupplierCategory, "supplier_category"),
        nullable=False,
        server_default=SupplierCategory.food.value,
    )


class Product(AmodeiBase, TimestampMixin):
    __tablename__ = "products"

    code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    category: Mapped[str | None] = mapped_column(String(80), nullable=True)
    unit: Mapped[str] = mapped_column(String(32), nullable=False)
    unit_size: Mapped[str | None] = mapped_column(String(40), nullable=True)
    sale_price: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    last_purchase_price: Mapped[Decimal | None] = mapped_column(Numeric(10, 4), nullable=True)
    vat_rate: Mapped[VatRate] = mapped_column(
        pg_enum(VatRate, "vat_rate"),
        nullable=False,
        server_default=VatRate.iva_22.value,
    )
    min_stock: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False, server_default="0")
    preferred_supplier_id: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey("suppliers.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
    )
    default_order_qty: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")

    preferred_supplier: Mapped[Supplier | None] = relationship("Supplier")

    __table_args__ = (
        Index(
            "uq_products_code_when_not_null",
            "code",
            unique=True,
            postgresql_where=text("code IS NOT NULL"),
        ),
    )


class Batch(AmodeiBase, TimestampMixin):
    __tablename__ = "batches"

    product_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("products.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    supplier_id: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey("suppliers.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
    )
    initial_qty: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    current_qty: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    # NETTO unitario (post-sconto). Alimenta food cost, margine, valorizzazione.
    purchase_price_unit: Mapped[Decimal] = mapped_column(Numeric(10, 4), nullable=False)
    # Listino unitario PRE-sconto (opzionale).
    list_price_unit: Mapped[Decimal | None] = mapped_column(Numeric(10, 4), nullable=True)
    # Sconto % applicato (es. 15.00). Opzionale, coerente con list/net.
    discount_pct: Mapped[Decimal | None] = mapped_column(Numeric(5, 2), nullable=True)
    load_date: Mapped[date_type] = mapped_column(Date, nullable=False)
    expiry_date: Mapped[date_type | None] = mapped_column(Date, nullable=True)
    receipt_photo_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_user_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )

    product: Mapped[Product] = relationship("Product")
    supplier: Mapped[Supplier | None] = relationship("Supplier")

    __table_args__ = (
        Index("ix_batches_expiry_date", "expiry_date"),
        Index("ix_batches_product_expiry", "product_id", "expiry_date"),
    )


class Movement(AmodeiBase, TimestampMixin):
    __tablename__ = "movements"

    batch_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("batches.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    # Denormalised for fast aggregate queries by product across all batches.
    product_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("products.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    type: Mapped[MovementType] = mapped_column(
        pg_enum(MovementType, "movement_type"),
        nullable=False,
    )
    qty: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    user_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )

    # Polymorphic link back to the workflow that created this movement.
    # source_id intentionally has no FK constraint (it points at different
    # tables depending on source_type). Both are nullable for backwards
    # compatibility with movements created before this column existed.
    source_type: Mapped[MovementSource | None] = mapped_column(
        pg_enum(MovementSource, "movement_source"),
        nullable=True,
    )
    source_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)

    batch: Mapped[Batch] = relationship("Batch")
    product: Mapped[Product] = relationship("Product")

    __table_args__ = (
        Index("ix_movements_product_created", "product_id", "created_at"),
        Index("ix_movements_source", "source_type", "source_id"),
    )
