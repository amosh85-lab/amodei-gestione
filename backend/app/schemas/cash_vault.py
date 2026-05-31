"""Schemas per /cash-vault."""
from __future__ import annotations

from datetime import date as date_type, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class CashVaultMovementOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    kind: Literal["baseline", "auto_daily", "manual_in", "manual_out"]
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
    manual_in_total: Decimal      # somma delle entrate manuali
    manual_out_total: Decimal     # somma assoluta delle uscite manuali
    movements_count: int
    last_movements: list[CashVaultMovementOut]


class CashVaultBaselineIn(BaseModel):
    """Setta/aggiorna la baseline (saldo iniziale a una certa data).
    Sovrascrive il movimento baseline esistente (se c'è) e ricalcola le
    entrate automatiche: cancella le auto_daily con source_date < date e
    fa backfill di tutte le DailySummary con date ≥ baseline_date che
    hanno cash_dinner_above_float compilato."""
    amount: Decimal = Field(ge=0)
    date: date_type
    description: str | None = Field(default=None, max_length=255)


class CashVaultManualMovementIn(BaseModel):
    """Entrata o uscita manuale. ``amount`` SEMPRE positivo; il segno viene
    applicato in funzione del tipo nel router."""
    amount: Decimal = Field(gt=0)
    date: date_type
    description: str = Field(min_length=1, max_length=255)


# Retro-compatibilità: il vecchio endpoint POST /movements accetta lo
# stesso payload (uscite manuali). Alias = stesso schema.
CashVaultManualOutIn = CashVaultManualMovementIn
