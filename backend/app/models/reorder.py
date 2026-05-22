"""Stock alerts (staff flags) and supplier reorder workflow."""
from __future__ import annotations

import enum
from datetime import datetime
from decimal import Decimal

from sqlalchemy import BigInteger, DateTime, ForeignKey, Index, Numeric, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import AmodeiBase, TimestampMixin, pg_enum


class StockSignaledStatus(str, enum.Enum):
    """The kind of stock issue being flagged."""

    low = "low"
    out = "out"


class StockAlertStatus(str, enum.Enum):
    """Lifecycle state of a stock alert."""

    open = "open"
    included_in_order = "included_in_order"
    ignored = "ignored"


class StockAlertSource(str, enum.Enum):
    """Where the alert originated."""

    staff = "staff"
    system = "system"


class SupplierOrderStatus(str, enum.Enum):
    draft = "draft"
    sent = "sent"
    received = "received"
    cancelled = "cancelled"


class StockAlert(AmodeiBase, TimestampMixin):
    __tablename__ = "stock_alerts"

    product_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("products.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    status_signaled: Mapped[StockSignaledStatus] = mapped_column(
        pg_enum(StockSignaledStatus, "stock_signaled_status"),
        nullable=False,
    )
    suggested_qty: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    signaled_by_user_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    status: Mapped[StockAlertStatus] = mapped_column(
        pg_enum(StockAlertStatus, "stock_alert_status"),
        nullable=False,
        server_default=StockAlertStatus.open.value,
    )
    source: Mapped[StockAlertSource] = mapped_column(
        pg_enum(StockAlertSource, "stock_alert_source"),
        nullable=False,
        server_default=StockAlertSource.staff.value,
    )


class SupplierOrder(AmodeiBase, TimestampMixin):
    __tablename__ = "supplier_orders"

    supplier_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("suppliers.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    status: Mapped[SupplierOrderStatus] = mapped_column(
        pg_enum(SupplierOrderStatus, "supplier_order_status"),
        nullable=False,
        server_default=SupplierOrderStatus.draft.value,
    )
    created_by_user_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    received_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    whatsapp_message_generated: Mapped[str | None] = mapped_column(Text, nullable=True)

    lines: Mapped[list[SupplierOrderLine]] = relationship(
        "SupplierOrderLine",
        back_populates="order",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )

    __table_args__ = (
        Index("ix_supplier_orders_created_at", "created_at"),
    )


class SupplierOrderLine(AmodeiBase):
    __tablename__ = "supplier_order_lines"

    order_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("supplier_orders.id", ondelete="CASCADE"),
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
    # Agreed unit price (VAT-excluded) at the moment of the order — distinct
    # from Batch.purchase_price_unit, which is the actual price recorded at
    # receipt time. The two should match in the happy path.
    unit_price: Mapped[Decimal | None] = mapped_column(Numeric(10, 4), nullable=True)
    alert_id: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey("stock_alerts.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
    )

    order: Mapped[SupplierOrder] = relationship("SupplierOrder", back_populates="lines")

    __table_args__ = (
        Index("ix_supplier_order_lines_product_order", "product_id", "order_id"),
    )
