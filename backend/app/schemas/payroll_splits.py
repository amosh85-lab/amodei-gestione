"""Schemi per /payroll-splits."""
from __future__ import annotations

from decimal import Decimal
from pydantic import BaseModel, ConfigDict, Field


class PayrollSplitUpsert(BaseModel):
    user_id: int = Field(gt=0)
    payroll_month: str = Field(pattern=r"^[0-9]{4}-(0[1-9]|1[0-2])$")
    ben_amount: Decimal = Field(ge=0)
    dan_amount: Decimal = Field(ge=0)


class PayrollSplitOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    payroll_month: str
    ben_amount: Decimal
    dan_amount: Decimal
