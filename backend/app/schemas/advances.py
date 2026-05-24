"""Pydantic schemas for /advances (employee cash advances).

`reference_month` (YYYY-MM) = a quale stipendio l'acconto va imputato.
È diverso da `date` (quando è stato fisicamente dato). Vedi router per la
logica del default automatico (giorno <= 10 → mese precedente, else corrente).
"""
from __future__ import annotations

from datetime import date as date_type, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.users import UserMini

REFERENCE_MONTH_PATTERN = r"^\d{4}-(0[1-9]|1[0-2])$"


class EmployeeAdvanceCreate(BaseModel):
    """Manager/admin records a new advance for a staff/manager employee.

    `reference_month` è opzionale: se omesso, il router lo calcola in base
    a `date` (giorno <= 10 → mese precedente, altrimenti corrente).
    """

    date: date_type | None = Field(default=None, description="Default = today")
    service: Literal["lunch", "dinner"]
    user_id: int = Field(gt=0)
    amount: Decimal = Field(gt=0)
    notes: str | None = None
    reference_month: str | None = Field(default=None, pattern=REFERENCE_MONTH_PATTERN,
                                         description="YYYY-MM. Se omesso → default da date.")


class EmployeeAdvanceUpdate(BaseModel):
    """Patch an unsettled advance. date/service/user_id are immutable —
    per correggere quelli, delete + recreate. reference_month può essere
    modificato solo dall'admin (anche su settled); il manager non può."""

    amount: Decimal | None = Field(default=None, gt=0)
    notes: str | None = None
    reference_month: str | None = Field(default=None, pattern=REFERENCE_MONTH_PATTERN)


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
    reference_month: str
    reference_month_label: str        # "Maggio 2026" — pre-computed per il frontend
    settled_at: datetime | None = None
    settled_in_payroll_month: str | None = None
    settled_by: UserMini | None = None


class AdvanceSettleRequest(BaseModel):
    """Admin marks one or more advances as paid in a specific payroll."""

    advance_ids: list[int] = Field(min_length=1)
    payroll_month: str = Field(pattern=REFERENCE_MONTH_PATTERN,
                                description="YYYY-MM (es. 2026-05)")


class AdvanceSettleResult(BaseModel):
    settled_count: int
    skipped_count: int


# ----- by-employee aggregate -----


class _UserAdvanceGroup(BaseModel):
    user: UserMini
    total_amount: Decimal
    count: int
    advances: list[EmployeeAdvanceOut]


class AdvancesByReferenceMonth(BaseModel):
    """Primary grouping: by reference_month → then by user."""

    reference_month: str
    label: str
    total_amount: Decimal
    by_user: list[_UserAdvanceGroup]


class AdvancesByEmployeeResponse(BaseModel):
    """New shape for GET /advances/by-employee: primary group is the
    reference_month (i.e. the stipendio), secondary is the user."""

    by_reference_month: list[AdvancesByReferenceMonth]


# ----- monthly summary -----


class AdvancesByUserMonthly(BaseModel):
    user: UserMini
    given_in_month: Decimal          # acconti DATI (date) nel mese
    for_month: Decimal               # acconti CON reference_month = X
    settled_in_month: Decimal
    unsettled_total: Decimal


class AdvancesMonthlySummary(BaseModel):
    year: int
    month: int
    total_amount_for_month: Decimal       # filtro per reference_month
    total_amount_given_in_month: Decimal  # filtro per date nel mese
    total_amount_settled: Decimal
    unsettled_total: Decimal
    by_user: list[AdvancesByUserMonthly]
