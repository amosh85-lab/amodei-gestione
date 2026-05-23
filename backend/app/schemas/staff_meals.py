"""Pydantic schemas for the /staff-meals router."""
from __future__ import annotations

from datetime import date as date_type, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.users import UserMini


# ---------- Inputs ----------


class StaffMealItemIn(BaseModel):
    product_id: int = Field(gt=0)
    qty: Decimal = Field(gt=0)


class StaffMealCreate(BaseModel):
    date: date_type | None = Field(default=None, description="Default = today")
    service: Literal["lunch", "dinner"]
    participant_user_ids: list[int] = Field(min_length=1)
    items: list[StaffMealItemIn] = Field(min_length=1)
    notes: str | None = None


# ---------- Outputs ----------


class ProductMini(BaseModel):
    """Small product payload embedded in StaffMealOut.items[]."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    unit: str


class StaffMealItemOut(BaseModel):
    """One line of a saved staff meal, with the meal-share of its cost."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    product_id: int
    product_name: str
    product_unit: str
    qty: Decimal
    cost_total: Decimal = Decimal("0")  # qty × purchase_price (sum across FIFO batches)


class StaffMealOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    date: date_type
    service: Literal["lunch", "dinner"]
    notes: str | None
    created_by_user_id: int
    created_by_name: str | None = None
    created_at: datetime

    cancelled_at: datetime | None = None
    cancelled_by_user_id: int | None = None

    participants: list[UserMini] = []
    items: list[StaffMealItemOut] = []
    cost_total: Decimal = Decimal("0")


# ---------- Monthly stats ----------


class MonthlyByUser(BaseModel):
    user: UserMini
    meal_count: int
    cost_total: Decimal


class MonthlyByProduct(BaseModel):
    product_id: int
    product_name: str
    product_unit: str
    qty_total: Decimal
    cost_total: Decimal


class MonthlyByDay(BaseModel):
    date: date_type
    meal_count: int
    cost_total: Decimal


class MonthlyStatsOut(BaseModel):
    year: int
    month: int
    total_meals: int
    total_cost: Decimal
    avg_cost_per_meal: Decimal
    by_user: list[MonthlyByUser] = []
    by_product: list[MonthlyByProduct] = []
    by_day: list[MonthlyByDay] = []
