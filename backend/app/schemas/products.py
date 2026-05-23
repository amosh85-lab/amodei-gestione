"""Pydantic schemas for the /products router."""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field

from app.models.inventory import VatRate


class _ProductFields(BaseModel):
    """Fields shared between create / update / out."""

    code: str | None = Field(default=None, max_length=64)
    name: str = Field(min_length=1, max_length=200)
    category: str | None = Field(default=None, max_length=80)
    unit: str = Field(min_length=1, max_length=32)
    unit_size: str | None = Field(default=None, max_length=40)
    sale_price: Decimal | None = Field(default=None, ge=0)
    vat_rate: VatRate = VatRate.iva_22
    min_stock: Decimal = Field(default=Decimal("0"), ge=0)
    preferred_supplier_id: int | None = None
    default_order_qty: Decimal | None = Field(default=None, ge=0)


class ProductCreate(_ProductFields):
    """Payload for POST /products. ``last_purchase_price`` is omitted on
    purpose — it is set by the batch-load flow, not by the user."""


class ProductUpdate(BaseModel):
    """Payload for PATCH /products/{id}. All fields optional."""

    code: str | None = Field(default=None, max_length=64)
    name: str | None = Field(default=None, min_length=1, max_length=200)
    category: str | None = Field(default=None, max_length=80)
    unit: str | None = Field(default=None, min_length=1, max_length=32)
    unit_size: str | None = Field(default=None, max_length=40)
    sale_price: Decimal | None = Field(default=None, ge=0)
    vat_rate: VatRate | None = None
    min_stock: Decimal | None = Field(default=None, ge=0)
    preferred_supplier_id: int | None = None
    default_order_qty: Decimal | None = Field(default=None, ge=0)
    active: bool | None = None


class ProductOut(_ProductFields):
    model_config = ConfigDict(from_attributes=True)

    id: int
    active: bool
    last_purchase_price: Decimal | None = None
    created_at: datetime


class ProductOutWithStock(ProductOut):
    """List/grid view — extends ProductOut with cheap aggregates."""

    qty_total: Decimal = Decimal("0")
    expiring_soon_count: int = 0


class ProductBatchSummary(BaseModel):
    """Batch row attached to a product detail response. Distinct from
    ``schemas.batches.BatchOut`` (which includes a product summary)."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    current_qty: Decimal
    initial_qty: Decimal
    purchase_price_unit: Decimal
    load_date: date
    expiry_date: date | None
    supplier_id: int | None
    supplier_name: str | None = None
    notes: str | None = None
    created_at: datetime


class ProductDetail(ProductOutWithStock):
    """Detail view returned by GET /products/{id}."""

    batches: list[ProductBatchSummary] = []
