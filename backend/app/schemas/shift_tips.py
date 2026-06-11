"""Pydantic schemas for /shift-tips."""
from __future__ import annotations

from datetime import date as date_type, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

ServiceLiteral = Literal["lunch", "dinner"]


class ShiftTipUpsert(BaseModel):
    """PUT /shift-tips — crea o sovrascrive la mancia di (date, service)."""
    date: date_type
    service: ServiceLiteral
    amount: Decimal = Field(gt=0, le=Decimal("99999"))
    notes: str | None = None


class ShiftTipOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    date: date_type
    service: ServiceLiteral
    amount: Decimal
    notes: str | None = None
    # Quante persone hanno un turno su (date, service): è il divisore con
    # cui il payroll ripartirà la mancia. 0 = nessun turno ancora salvato.
    participants_count: int = 0
    created_by_name: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
