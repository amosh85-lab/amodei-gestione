"""Pydantic schemas for /work-shifts."""
from __future__ import annotations

from datetime import date as date_type, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.users import UserMini


def _validate_quarter_hour(v: Decimal | None) -> Decimal | None:
    """0 < h ≤ 12 e multiplo di 0.25 (15 minuti)."""
    if v is None:
        return None
    if v <= 0 or v > Decimal("12"):
        raise ValueError("Ore deve essere tra 0.25 e 12.")
    # Multiplo di 0.25: hours*4 deve essere intero
    if (v * 4) % 1 != 0:
        raise ValueError("Ore deve essere multiplo di 0.25 (es. 0.25, 0.5, 0.75, 1.0…).")
    return v


class WorkShiftCreate(BaseModel):
    """Singolo turno (manager/admin)."""
    date: date_type
    user_id: int = Field(gt=0)
    hours: Decimal
    notes: str | None = None

    @field_validator("hours")
    @classmethod
    def _h(cls, v: Decimal) -> Decimal:
        return _validate_quarter_hour(v) or v


class WorkShiftBulkItem(BaseModel):
    user_id: int = Field(gt=0)
    hours: Decimal
    notes: str | None = None

    @field_validator("hours")
    @classmethod
    def _h(cls, v: Decimal) -> Decimal:
        return _validate_quarter_hour(v) or v


class WorkShiftBulkCreate(BaseModel):
    """Inserimento giornaliero multiplo. Upsert per (date, user_id)."""
    date: date_type
    shifts: list[WorkShiftBulkItem] = Field(min_length=1)


class WorkShiftUpdate(BaseModel):
    hours: Decimal | None = None
    notes: str | None = None

    @field_validator("hours")
    @classmethod
    def _h(cls, v: Decimal | None) -> Decimal | None:
        return _validate_quarter_hour(v)


class WorkShiftOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    date: date_type
    user: UserMini
    hours: Decimal
    notes: str | None = None
    created_by: UserMini
    created_at: datetime
    updated_at: datetime | None = None


class WorkShiftDailySummary(BaseModel):
    date: date_type
    total_hours: Decimal
    shifts: list[WorkShiftOut]
    users_without_shift: list[UserMini]


class WorkShiftWeeklySummary(BaseModel):
    """Per ogni utente nella settimana. contract_hours e overtime_hours
    vengono inclusi SOLO per admin (router decide lato applicativo)."""
    week_start: date_type
    week_end: date_type
    user: UserMini
    total_hours: Decimal
    contract_hours: Decimal | None = None
    overtime_hours: Decimal | None = None
    is_overtime: bool


# ---- Monthly payroll (admin only) ----


class WeeklyBreakdownRow(BaseModel):
    week_start: date_type
    week_end: date_type
    hours: Decimal
    overtime: Decimal


class _UserMiniWithRate(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    email: str
    full_name: str
    role: str
    active: bool
    hourly_rate: Decimal | None = None
    weekly_hours_contract: Decimal | None = None


class MonthlyPayrollByUser(BaseModel):
    user: _UserMiniWithRate
    total_hours: Decimal
    gross_amount: Decimal | None = None       # None se hourly_rate non set
    advances_taken: Decimal                   # filtro reference_month=YYYY-MM
    advances_settled_in_month: Decimal        # filtro settled_in_payroll_month=YYYY-MM
    net_to_pay: Decimal | None = None         # None se hourly_rate non set
    has_unsettled_advances: bool
    needs_configuration: bool                 # true se hourly_rate is None
    weekly_breakdown: list[WeeklyBreakdownRow]


class MonthlyPayrollTotals(BaseModel):
    total_hours: Decimal
    total_gross: Decimal       # somma solo per chi ha tariffa
    total_advances: Decimal
    total_net: Decimal


class WorkShiftMonthlyPayrollSummary(BaseModel):
    year: int
    month: int
    month_label: str
    by_user: list[MonthlyPayrollByUser]
    totals: MonthlyPayrollTotals


class SettleAdvancesResult(BaseModel):
    settled_count: int
    total_settled_amount: Decimal
