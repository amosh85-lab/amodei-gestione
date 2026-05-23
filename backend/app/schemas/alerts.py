"""Pydantic schemas for the /alerts router."""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


# ---------- Embedded summaries ----------


class _SupplierMini(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    whatsapp: str | None = None
    phone: str | None = None


class _ProductMini(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    unit: str
    code: str | None = None
    category: str | None = None
    min_stock: Decimal | None = None
    qty_total: Decimal = Decimal("0")  # filled by the router from a sub-query


# ---------- Inputs ----------


class StockAlertCreate(BaseModel):
    product_id: int = Field(gt=0)
    status_signaled: Literal["low", "out"]
    suggested_qty: Decimal | None = Field(default=None, ge=0)
    notes: str | None = None


class StockAlertPatch(BaseModel):
    """PATCH /alerts/{id}. status accepts the lifecycle values; status_signaled
    allows manual override (rare)."""

    suggested_qty: Decimal | None = Field(default=None, ge=0)
    notes: str | None = None
    status: Literal["open", "included_in_order", "ignored"] | None = None
    status_signaled: Literal["low", "out"] | None = None


# ---------- Outputs ----------


class StockAlertOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    product_id: int
    status_signaled: Literal["low", "out"]
    status: Literal["open", "included_in_order", "ignored"]
    source: Literal["staff", "system"]
    suggested_qty: Decimal | None = None
    notes: str | None = None
    signaled_by_user_id: int
    signaled_by_name: str | None = None
    created_at: datetime

    product: _ProductMini | None = None
    supplier: _SupplierMini | None = None


class AlertsGroup(BaseModel):
    """One supplier bucket in the GET /open response."""

    supplier: _SupplierMini | None = None
    alerts: list[StockAlertOut] = []
