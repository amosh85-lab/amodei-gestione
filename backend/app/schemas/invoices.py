"""Pydantic schemas for /invoices.

Two output shapes intentionally — manager must never see payment info:
- InvoiceOut: visible to manager + admin (no is_paid / payment fields)
- InvoiceOutWithPayment: ADMIN ONLY (adds is_paid, payment)

The router decides which one to use based on the caller's role.
"""
from __future__ import annotations

from datetime import date as date_type, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.users import UserMini


class _SupplierMiniWithCategory(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    category: Literal["food", "beverage", "consumo"]


class InvoiceCreate(BaseModel):
    """Manager/admin posts a new invoice (photo via multipart separately)."""

    supplier_id: int = Field(gt=0)
    invoice_number: str = Field(min_length=1, max_length=50)
    invoice_date: date_type
    amount_total: Decimal = Field(gt=0)
    notes: str | None = None


class InvoiceUpdate(BaseModel):
    """Patch an unpaid invoice. amount_total cannot be changed if invoice
    is already settled (router enforces). Manager can only patch invoices
    of the current month; admin always (router enforces)."""

    invoice_number: str | None = Field(default=None, min_length=1, max_length=50)
    invoice_date: date_type | None = None
    amount_total: Decimal | None = Field(default=None, gt=0)
    notes: str | None = None


class InvoiceMini(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    invoice_number: str
    invoice_date: date_type
    amount_total: Decimal


class _PaymentMini(BaseModel):
    """Minimal payment info embedded into InvoiceOutWithPayment."""

    model_config = ConfigDict(from_attributes=True)
    id: int
    payment_date: date_type
    method: Literal["bank_transfer", "check", "cash"]
    check_number: str | None = None


class InvoiceOut(BaseModel):
    """Manager+admin view — NO payment info."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    supplier: _SupplierMiniWithCategory
    invoice_number: str
    invoice_date: date_type
    amount_total: Decimal
    notes: str | None = None
    photo_url: str | None = None
    created_by: UserMini
    created_at: datetime
    updated_at: datetime | None = None


class InvoiceOutWithPayment(InvoiceOut):
    """Admin-only view — includes payment status."""

    is_paid: bool
    payment: _PaymentMini | None = None


# ----- /unpaid response shape -----

class UnpaidBySupplierRow(BaseModel):
    supplier: _SupplierMiniWithCategory
    total: Decimal
    count: int
    invoices: list[InvoiceMini]


class UnpaidSummaryOut(BaseModel):
    total_unpaid: Decimal
    count: int
    by_supplier: list[UnpaidBySupplierRow]
