"""Pydantic schemas for /advances (employee cash advances)."""
from __future__ import annotations

from datetime import date as date_type, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.users import UserMini


class EmployeeAdvanceCreate(BaseModel):
    """Manager/admin records a new advance for a staff/manager employee."""

    date: date_type | None = Field(default=None, description="Default = today")
    service: Literal["lunch", "dinner"]
    user_id: int = Field(gt=0)
    amount: Decimal = Field(gt=0)
    notes: str | None = None


class EmployeeAdvanceUpdate(BaseModel):
    """Patch an unsettled advance. date/service/user_id are immutable —
    to correct those, delete and recreate."""

    amount: Decimal | None = Field(default=None, gt=0)
    notes: str | None = None


class EmployeeAdvanceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    date: date_type
    service: Literal["lunch", "dinner"]
    user: UserMini
    amount: Decimal
    notes: str | None = None
    receipt_photo_url: str | None = None
    created_by: UserMini
    created_at: datetime
    settled_at: datetime | None = None
    settled_in_payroll_month: str | None = None
    settled_by: UserMini | None = None


class AdvanceSettleRequest(BaseModel):
    """Admin marks one or more advances as paid in a specific payroll."""

    advance_ids: list[int] = Field(min_length=1)
    payroll_month: str = Field(pattern=r"^\d{4}-(0[1-9]|1[0-2])$",
                                description="YYYY-MM (es. 2026-05)")


class AdvanceSettleResult(BaseModel):
    settled_count: int
    skipped_count: int


# ----- by-employee aggregate -----


class AdvancesByEmployeeRow(BaseModel):
    user: UserMini
    total_amount: Decimal
    count: int
    advances: list[EmployeeAdvanceOut]


# ----- monthly summary -----


class AdvancesByUserMonthly(BaseModel):
    user: UserMini
    given_in_month: Decimal
    settled_in_month: Decimal
    unsettled_total: Decimal


class AdvancesMonthlySummary(BaseModel):
    year: int
    month: int
    total_amount_given: Decimal
    total_amount_settled: Decimal
    unsettled_total: Decimal
    by_user: list[AdvancesByUserMonthly]
