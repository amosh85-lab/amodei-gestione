"""Pydantic schemas for /ddts (documenti di trasporto).

DDT = testata + importo, come una fattura. In più espone `is_billed` e un
riferimento minimale alla fattura generata (`invoice`) quando il DDT è già
stato fatturato a fine mese.
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


class DdtUpdate(BaseModel):
    """Patch a un DDT non ancora fatturato. Se il DDT è già fatturato il
    router blocca ogni modifica. Il manager può modificare solo DDT del
    mese corrente; admin sempre (router enforces)."""

    ddt_number: str | None = Field(default=None, min_length=1, max_length=50)
    ddt_date: date_type | None = None
    amount_total: Decimal | None = Field(default=None, gt=0)
    notes: str | None = None


class DdtMini(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    ddt_number: str
    ddt_date: date_type
    amount_total: Decimal


class _InvoiceRef(BaseModel):
    """Riferimento minimale alla fattura che ha 'assorbito' il DDT."""

    model_config = ConfigDict(from_attributes=True)
    id: int
    invoice_number: str
    invoice_date: date_type


class DdtOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    supplier: _SupplierMiniWithCategory
    ddt_number: str
    ddt_date: date_type
    amount_total: Decimal
    notes: str | None = None
    photo_url: str | None = None
    is_billed: bool
    invoice: _InvoiceRef | None = None
    created_by: UserMini
    created_at: datetime
    updated_at: datetime | None = None


# ----- /summary response shape (raggruppati per fornitore, solo non fatturati) -----

class DdtBySupplierRow(BaseModel):
    supplier: _SupplierMiniWithCategory
    total: Decimal
    count: int
    ddts: list[DdtMini]


class DdtSummaryOut(BaseModel):
    total_unbilled: Decimal
    count: int
    by_supplier: list[DdtBySupplierRow]


# ----- POST /ddts/generate-invoice -----

class GenerateInvoiceIn(BaseModel):
    """Genera UNA fattura a partire da N DDT non fatturati dello stesso
    fornitore. L'importo della fattura è la somma dei DDT (calcolata dal
    server, non passata dal client)."""

    supplier_id: int = Field(gt=0)
    ddt_ids: list[int] = Field(min_length=1)
    invoice_number: str = Field(min_length=1, max_length=50)
    invoice_date: date_type
    notes: str | None = None


class GenerateInvoiceOut(BaseModel):
    invoice_id: int
    amount_total: Decimal
    ddt_count: int
