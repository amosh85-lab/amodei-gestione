"""Schemas per /cash-vault."""
from __future__ import annotations

from datetime import date as date_type, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class CashVaultMovementOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    kind: Literal["baseline", "auto_daily", "manual_out"]
    amount: Decimal              # con segno: + entrata, − uscita
    movement_date: date_type
    description: str | None = None
    source_date: date_type | None = None
    created_at: datetime
    created_by_user_id: int | None = None
    created_by_name: str | None = None


class CashVaultBalanceOut(BaseModel):
    balance: Decimal
    baseline: Decimal             # ultimo movimento kind=baseline (o 0)
    baseline_date: date_type | None = None
    auto_total: Decimal           # somma di tutti gli auto_daily
    manual_out_total: Decimal     # somma assoluta delle uscite manuali
    movements_count: int
    last_movements: list[CashVaultMovementOut]


class CashVaultBaselineIn(BaseModel):
    """Setta/aggiorna la baseline (saldo iniziale a una certa data).
    Sovrascrive il movimento baseline esistente (se c'è)."""
    amount: Decimal = Field(ge=0)
    date: date_type
    description: str | None = Field(default=None, max_length=255)


class CashVaultManualOutIn(BaseModel):
    """Nuova uscita manuale. ``amount`` POSITIVO; la persistenza usa segno
    negativo."""
    amount: Decimal = Field(gt=0)
    date: date_type
    description: str = Field(min_length=1, max_length=255)
