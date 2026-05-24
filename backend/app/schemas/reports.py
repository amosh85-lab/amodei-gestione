"""Pydantic schemas for /reports."""
from __future__ import annotations

from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict


class _ProductMini(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    category: str | None = None
    unit: str


# ----- waste -----

class WasteByReason(BaseModel):
    reason: Literal["waste_expiry", "waste_other"]
    value: Decimal
    count: int


class WasteByProduct(BaseModel):
    product: _ProductMini
    value_lost: Decimal
    qty: Decimal


class WasteByMonth(BaseModel):
    month: str   # YYYY-MM
    value_lost: Decimal


class WasteReportOut(BaseModel):
    total_value_lost: Decimal
    items_count: int
    breakdown_by_reason: list[WasteByReason]
    breakdown_by_product: list[WasteByProduct]
    breakdown_by_month: list[WasteByMonth]


# ----- margins -----

class MarginRow(BaseModel):
    product: _ProductMini
    sales_qty: Decimal
    sales_revenue: Decimal
    cost: Decimal
    margin_eur: Decimal
    margin_pct: Decimal | None   # None when revenue == 0


class MarginsReportOut(BaseModel):
    rows: list[MarginRow]
    totals: MarginRow | None   # aggregate totals row, None when no data


# ----- staff meals summary -----

class StaffMealsByProduct(BaseModel):
    product: _ProductMini
    qty_total: Decimal
    cost_total: Decimal


class StaffMealsByMonth(BaseModel):
    month: str   # YYYY-MM
    cost_total: Decimal
    meals_count: int


class StaffMealsSummaryOut(BaseModel):
    total_cost: Decimal
    meals_count: int
    breakdown_by_product: list[StaffMealsByProduct]
    breakdown_by_month: list[StaffMealsByMonth]
