"""Pydantic schemas for the /evening-close router."""
from __future__ import annotations

from datetime import date as date_type, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


# ---------- Inputs ----------


class EveningCloseItemIn(BaseModel):
    """One line of a save payload: how much of `product_id` is left in stock."""

    product_id: int = Field(gt=0)
    qty_remaining: Decimal = Field(ge=0)


class EveningCloseSavePayload(BaseModel):
    """Body for POST /evening-close and PATCH /evening-close/{id}."""

    items: list[EveningCloseItemIn] = Field(min_length=1)
    notes: str | None = None


# ---------- Outputs ----------


class EveningCloseItemOut(BaseModel):
    """One row of the GET /today response.

    `qty_actual` is the live `qty_total` (sum of in-stock batches at request
    time) — used by the UI as a pre-fill and a "before" reference.
    `qty_remaining_saved` is the value already stored on a matching
    EveningCloseItem (or None if no close exists yet for this date).
    """

    product_id: int
    product_name: str
    product_unit: str
    category: str | None = None
    qty_actual: Decimal
    qty_remaining_saved: Decimal | None = None


class EveningCloseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    date: date_type
    user_id: int
    user_name: str | None = None
    notes: str | None = None
    created_at: datetime


class EveningCloseDetail(BaseModel):
    """Returned by GET /today and GET /{id}."""

    close: EveningCloseOut | None = None
    items: list[EveningCloseItemOut] = []


class EveningCloseSaveResult(BaseModel):
    """Returned by POST/PATCH — close + items + audit summary."""

    close: EveningCloseOut
    items: list[EveningCloseItemOut]
    movements_created: int
    warnings: list[str] = []
