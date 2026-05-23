"""Pydantic schemas for /batches and /movements."""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.models.inventory import MovementType


# ---------- Embedded summaries (joined into list responses) ----------


class ProductSummary(BaseModel):
    """Minimal product info attached to BatchOut / MovementOut."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    code: str | None = None
    unit: str


class SupplierSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str


# ---------- Batches ----------


class BatchPatch(BaseModel):
    """Payload for PATCH /batches/{id} — only the user-editable fields.

    Quantities and the load_date are immutable through this endpoint; use
    the movements endpoints to adjust stock instead.
    """

    expiry_date: date | None = None
    notes: str | None = None
    # receipt_photo is uploaded separately via multipart on POST. To replace
    # it on patch you'd hit a future dedicated endpoint; for now allow
    # clearing it by passing an empty string.
    receipt_photo_url: str | None = None


class BatchOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    product_id: int
    supplier_id: int | None
    initial_qty: Decimal
    current_qty: Decimal
    purchase_price_unit: Decimal
    load_date: date
    expiry_date: date | None
    receipt_photo_url: str | None
    notes: str | None
    created_by_user_id: int
    created_at: datetime

    # Joined for client convenience (filled by the router):
    product: ProductSummary | None = None
    supplier: SupplierSummary | None = None


# ---------- Movements ----------


class MovementOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    batch_id: int
    product_id: int
    type: MovementType
    qty: Decimal
    reason: str | None
    user_id: int
    created_at: datetime

    # Joined for client convenience:
    product_name: str | None = None
    user_name: str | None = None


class ScartoRequest(BaseModel):
    """Body for POST /movements/scarto."""

    product_id: int = Field(gt=0)
    qty: Decimal = Field(gt=0, description="Quantità da scartare (positiva)")
    type: Literal["waste_expiry", "waste_other"]
    reason: str = Field(min_length=1, max_length=500)


class RettificaRequest(BaseModel):
    """Body for POST /movements/rettifica (admin/manager only)."""

    batch_id: int = Field(gt=0)
    new_qty: Decimal = Field(ge=0, description="Nuova current_qty del lotto (≥0)")
    reason: str = Field(min_length=1, max_length=500)
