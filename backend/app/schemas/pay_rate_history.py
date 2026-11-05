"""Schemi per /pay-rate-history."""
from __future__ import annotations

from datetime import date as date_type, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field

from app.models.users import PayType
from app.schemas.users import UserMini


class PayRateHistoryCreate(BaseModel):
    """Admin registra una modifica di compenso per un dipendente, con la
    data da cui vale (oggi, una data passata per correggere con effetto
    retroattivo, o futura per programmarla in anticipo)."""

    user_id: int = Field(gt=0)
    effective_from: date_type
    pay_type: PayType
    hourly_rate: Decimal | None = Field(default=None, ge=0)
    monthly_salary: Decimal | None = Field(default=None, ge=0)
    notes: str | None = Field(default=None, max_length=500)


class PayRateHistoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    effective_from: date_type
    pay_type: PayType
    hourly_rate: Decimal | None = None
    monthly_salary: Decimal | None = None
    notes: str | None = None
    # Default None: l'oggetto ORM PayRateHistory non ha un attributo
    # `created_by` (solo `created_by_user_id`), quindi senza un default
    # qui model_validate(row) fallisce con "Field required" prima che
    # _hydrate() nel router riesca a impostarlo dal lookup separato.
    created_by: UserMini | None = None
    created_at: datetime
