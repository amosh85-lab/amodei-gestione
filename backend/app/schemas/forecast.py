"""Pydantic schemas for /forecast."""
from __future__ import annotations

from decimal import Decimal

from pydantic import BaseModel


class ProductForecastOut(BaseModel):
    product_id: int
    name: str
    category: str | None = None
    unit: str
    current_qty: Decimal
    consumption_per_day: Decimal
    days_until_stockout: int | None
    suggested_order_qty: Decimal


class GenerateAlertsOut(BaseModel):
    created: int
    skipped_existing_open: int
    skipped_no_signal: int
