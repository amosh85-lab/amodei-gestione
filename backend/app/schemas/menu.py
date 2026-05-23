"""Pydantic schemas for the /menu router (combined dishes)."""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


class ComponentIn(BaseModel):
    """One ingredient line in a combined dish create/update payload."""

    product_id: int = Field(gt=0)
    qty: Decimal = Field(gt=0, description="Quantità del prodotto necessaria per 1 piatto")


class ComponentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    product_id: int
    qty: Decimal

    # Joined fields filled by the router for UI convenience.
    product_name: str | None = None
    product_unit: str | None = None
    last_purchase_price: Decimal | None = None
    available_qty: Decimal = Decimal("0")


class CombinedDishCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    sale_price: Decimal = Field(ge=0)
    components: list[ComponentIn] = Field(min_length=1)


class CombinedDishUpdate(BaseModel):
    """Partial update. If ``components`` is present the whole list is replaced
    atomically; if omitted the existing components stay as they are."""

    name: str | None = Field(default=None, min_length=1, max_length=200)
    sale_price: Decimal | None = Field(default=None, ge=0)
    components: list[ComponentIn] | None = None
    active: bool | None = None


class CombinedDishOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    sale_price: Decimal
    active: bool
    created_at: datetime

    # Computed by the router (single SQL pass — no N+1)
    components: list[ComponentOut] = []
    available: bool = False                     # all components have qty in stock
    cost: Decimal | None = None                 # sum(qty × last_purchase_price)
    margin: Decimal | None = None               # sale_price − cost (if cost known)
    margin_percent: Decimal | None = None       # margin / sale_price × 100
