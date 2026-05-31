"""Cassaforte (cash vault): saldo cumulativo del contante "fuori cassa".

Modello dati:
- ``CashVaultMovement`` — un movimento singolo (entrata o uscita).
  Ogni riga ha un ``amount`` con segno: positivo = entrata, negativo = uscita.
- ``MovementKind`` discrimina la sorgente del movimento:
  * ``baseline``    — saldo iniziale settato manualmente (1 sola riga, riaggiornata)
  * ``auto_daily`` — entrata automatica dal cash_dinner_above_float di una giornata
  * ``manual_out`` — uscita inserita a mano dall'admin (con causale)

Il saldo corrente è ``sum(amount)`` su tutti i movimenti.
"""
from __future__ import annotations

import enum
from datetime import date as date_type
from decimal import Decimal

from sqlalchemy import BigInteger, Date, ForeignKey, Numeric, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import AmodeiBase, TimestampMixin, pg_enum


class MovementKind(str, enum.Enum):
    baseline = "baseline"
    auto_daily = "auto_daily"
    manual_in = "manual_in"
    manual_out = "manual_out"


class CashVaultMovement(AmodeiBase, TimestampMixin):
    __tablename__ = "cash_vault_movements"
    __table_args__ = (
        # Una sola entrata automatica per giorno (idempotente: upsert su PATCH cash)
        UniqueConstraint("kind", "source_date", name="uq_cash_vault_auto_per_day"),
    )

    kind: Mapped[MovementKind] = mapped_column(
        pg_enum(MovementKind, "cash_vault_movement_kind"), nullable=False, index=True,
    )
    # amount con SEGNO: + entrata, − uscita. Decimal(12,2) per stare larghi.
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    # Data "logica" del movimento (per ordinamento e per match con DailySummary).
    movement_date: Mapped[date_type] = mapped_column(Date, nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Per auto_daily: la data del DailySummary di origine (= movement_date in
    # genere, ma esplicita per il join e l'upsert idempotente).
    source_date: Mapped[date_type | None] = mapped_column(Date, nullable=True)
    created_by_user_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True,
    )
