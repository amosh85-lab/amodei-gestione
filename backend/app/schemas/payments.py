"""Pydantic schemas for /payments (ADMIN ONLY).

A Payment can settle multiple invoices — but ALL of them must be from the
same supplier (enforced in the router). For method='check', check_number
is required; for other methods it must be omitted.
"""
from __future__ import annotations

from datetime import date as date_type, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.schemas.invoices import InvoiceMini, _SupplierMiniWithCategory
from app.schemas.users import UserMini


class PaymentCreate(BaseModel):
    invoice_ids: list[int] = Field(min_length=1)
    payment_date: date_type
    method: Literal["bank_transfer", "check", "cash"]
    check_number: str | None = Field(default=None, max_length=50)
    notes: str | None = None

    @model_validator(mode="after")
    def _check_number_consistency(self):
        if self.method == "check" and not (self.check_number and self.check_number.strip()):
            raise ValueError("check_number è obbligatorio quando method='check'.")
        if self.method != "check" and self.check_number:
            raise ValueError("check_number deve essere null se method non è 'check'.")
        return self


class PaymentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    payment_date: date_type
    method: Literal["bank_transfer", "check", "cash"]
    amount_total: Decimal
    check_number: str | None = None
    notes: str | None = None
    registered_by: UserMini
    created_at: datetime
    supplier: _SupplierMiniWithCategory
    invoices: list[InvoiceMini]


# ----- /summary/monthly -----

class PaymentByMethod(BaseModel):
    bank_transfer: Decimal = Decimal("0")
    check: Decimal = Decimal("0")
    cash: Decimal = Decimal("0")


class PaymentBySupplierRow(BaseModel):
    supplier: _SupplierMiniWithCategory
    total: Decimal
    count: int


class PaymentMonthlySummary(BaseModel):
    year: int
    month: int
    total_paid: Decimal
    count: int
    by_method: PaymentByMethod
    by_supplier: list[PaymentBySupplierRow]
