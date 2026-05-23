"""Pydantic schemas for /supplier-orders."""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


# ---------- Embedded summaries ----------


class _ProductMini(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    unit: str
    code: str | None = None


class _SupplierMini(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    contact_name: str | None = None
    phone: str | None = None
    whatsapp: str | None = None
    message_template: str | None = None


# ---------- Inputs ----------


class SupplierOrderLineIn(BaseModel):
    product_id: int = Field(gt=0)
    qty: Decimal = Field(gt=0)
    unit_price: Decimal | None = Field(default=None, ge=0)
    alert_id: int | None = None


class SupplierOrderCreate(BaseModel):
    supplier_id: int = Field(gt=0)
    lines: list[SupplierOrderLineIn] = Field(min_length=1)
    notes: str | None = None


class SupplierOrderPatch(BaseModel):
    """PATCH /supplier-orders/{id}. Only meaningful while status=draft.
    Passing `lines` replaces the full list (same idiom as the menu CRUD).
    """

    lines: list[SupplierOrderLineIn] | None = None
    notes: str | None = None


# ---------- Outputs ----------


class SupplierOrderLineOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    product_id: int
    qty: Decimal
    unit_price: Decimal | None = None
    alert_id: int | None = None
    product: _ProductMini | None = None


class SupplierOrderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    supplier_id: int
    status: Literal["draft", "sent", "received", "cancelled"]
    created_by_user_id: int
    created_by_name: str | None = None
    created_at: datetime
    sent_at: datetime | None = None
    received_at: datetime | None = None
    notes: str | None = None

    # Snapshot of the text actually sent — populated on /mark-sent.
    whatsapp_message_generated: str | None = None

    # Live nested + computed fields
    supplier: _SupplierMini | None = None
    lines: list[SupplierOrderLineOut] = []
    # The text that *would* be sent right now (template + current lines).
    whatsapp_message_preview: str | None = None
    # https://wa.me/<digits>?text=<urlencoded preview>, or None if no number.
    whatsapp_url: str | None = None
