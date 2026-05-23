"""Pydantic schemas for cash: categories, POS sessions, expenses, summary."""
from __future__ import annotations

from datetime import date as date_type, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


# ----- Expense categories -----


class ExpenseCategoryBase(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    icon: str | None = Field(default=None, max_length=60)
    color: str | None = Field(default=None, max_length=16)


class ExpenseCategoryCreate(ExpenseCategoryBase):
    pass


class ExpenseCategoryUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    icon: str | None = Field(default=None, max_length=60)
    color: str | None = Field(default=None, max_length=16)
    active: bool | None = None


class ExpenseCategoryOut(ExpenseCategoryBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    active: bool
    created_at: datetime


# ----- POS sessions -----


class PosSessionCreate(BaseModel):
    date: date_type | None = Field(default=None, description="Default = today")
    service: Literal["lunch", "dinner"]
    closing_amount: Decimal = Field(ge=0)
    notes: str | None = None


class PosSessionUpdate(BaseModel):
    closing_amount: Decimal | None = Field(default=None, ge=0)
    notes: str | None = None


class PosSessionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    date: date_type
    service: Literal["lunch", "dinner"]
    closing_amount: Decimal
    closed_by_user_id: int
    closed_by_name: str | None = None
    closed_at: datetime
    notes: str | None = None


# ----- Expenses -----


class ExpenseUpdate(BaseModel):
    description: str | None = Field(default=None, min_length=1, max_length=255)
    amount: Decimal | None = Field(default=None, gt=0)
    category_id: int | None = Field(default=None, gt=0)


class _CategoryMini(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    icon: str | None = None
    color: str | None = None


class ExpenseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    date: date_type
    service: Literal["lunch", "dinner"]
    category_id: int
    description: str
    amount: Decimal
    receipt_photo_url: str | None = None
    created_by_user_id: int
    created_by_name: str | None = None
    created_at: datetime
    category: _CategoryMini | None = None


# ----- Daily summary -----


class DailySummaryUpdate(BaseModel):
    """All fields optional → PATCH semantics. notes is also patchable."""

    cash_lunch_above_float: Decimal | None = Field(default=None, ge=0)
    cash_total_end_of_day: Decimal | None = Field(default=None, ge=0)
    fiscal_total: Decimal | None = Field(default=None, ge=0)
    ipratico_total: Decimal | None = Field(default=None, ge=0)
    notes: str | None = None


class DailySummaryOut(BaseModel):
    """Single source of truth for the cash dashboard.

    Fields starting with the underscore convention (cash_total_end_of_day,
    fiscal_total, ipratico_total, notes) come from the row. Everything else
    is computed live in :func:`services.cash.calculate_summary` so the UI
    can render the day's numbers without any further math.
    """

    date: date_type
    cash_float: Decimal               # snapshot if closed, else current setting

    pos_lunch: Decimal = Decimal("0")
    pos_dinner: Decimal = Decimal("0")
    pos_total: Decimal = Decimal("0")

    expenses_lunch: Decimal = Decimal("0")
    expenses_dinner: Decimal = Decimal("0")
    expenses_total: Decimal = Decimal("0")

    # Lunch close (input) + derived partial
    cash_lunch_above_float: Decimal | None = None
    cash_lunch_incassato: Decimal | None = None    # above_float_lunch + expenses_lunch
    partial_lunch: Decimal | None = None           # pos_lunch + cash_lunch_incassato

    # End-of-day inputs + derived totals
    cash_total_end_of_day: Decimal | None = None
    cash_above_float: Decimal | None = None     # max(0, end - float)
    cash_incassato: Decimal | None = None       # above_float + expenses_total

    # Dinner partial (derived once cash_total_end_of_day is set)
    cash_dinner_incassato: Decimal | None = None
    partial_dinner: Decimal | None = None

    computed_total: Decimal | None = None       # pos_total + cash_incassato

    fiscal_total: Decimal | None = None
    ipratico_total: Decimal | None = None
    delta_fiscal: Decimal | None = None         # fiscal - computed
    delta_ipratico: Decimal | None = None       # ipratico - computed
    delta_fiscal_ipratico: Decimal | None = None  # fiscal - ipratico

    status: Literal["open", "partial", "closed"]
    notes: str | None = None

    # Persistence-side metadata (only relevant if a row exists)
    id: int | None = None
    closed_by_user_id: int | None = None
    closed_by_name: str | None = None
    closed_at: datetime | None = None
