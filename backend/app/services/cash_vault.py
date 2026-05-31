"""Cassaforte: helpers per saldo + upsert dell'entrata automatica end-of-day."""
from __future__ import annotations

import logging
from datetime import date as date_type
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.cash_vault import CashVaultMovement, MovementKind

logger = logging.getLogger("amodei.cash_vault")

ZERO = Decimal("0.00")


def upsert_auto_daily(
    session: Session,
    *,
    day: date_type,
    new_cash_dinner_above_float: Decimal | None,
    user_id: int | None,
) -> None:
    """Sincronizza l'entrata automatica della cassaforte per ``day``.

    Chiamato dal router ``PATCH /daily-summary/{day}`` ogni volta che
    ``cash_dinner_above_float`` cambia. È idempotente per giorno grazie
    all'unique constraint (kind, source_date).

    - se ``new_cash_dinner_above_float is None`` e c'era un mov auto → lo cancello
    - se c'era un mov auto con amount diverso → aggiorno l'amount in place
    - se non c'era e ora c'è un valore > 0 → inserisco
    - se non c'era e il nuovo valore è None/0 → no-op
    """
    existing = session.scalar(
        select(CashVaultMovement).where(
            CashVaultMovement.kind == MovementKind.auto_daily,
            CashVaultMovement.source_date == day,
        )
    )

    target_amount = Decimal(new_cash_dinner_above_float) if new_cash_dinner_above_float is not None else None

    if existing is None:
        if target_amount is None or target_amount == 0:
            return
        session.add(CashVaultMovement(
            kind=MovementKind.auto_daily,
            amount=target_amount,
            movement_date=day,
            source_date=day,
            description=f"Cash fine serata del {day.strftime('%d/%m/%Y')}",
            created_by_user_id=user_id,
        ))
        session.commit()
        logger.info("Cash vault: aggiunto auto_daily %s per %s", target_amount, day)
        return

    if target_amount is None:
        session.delete(existing)
        session.commit()
        logger.info("Cash vault: rimosso auto_daily per %s", day)
        return

    if existing.amount != target_amount:
        existing.amount = target_amount
        existing.created_by_user_id = user_id or existing.created_by_user_id
        session.commit()
        logger.info("Cash vault: aggiornato auto_daily per %s → %s", day, target_amount)


def compute_balance(session: Session) -> dict:
    """Calcola il saldo corrente + statistiche di breakdown."""
    rows = session.execute(
        select(CashVaultMovement.kind, func.coalesce(func.sum(CashVaultMovement.amount), 0), func.count())
        .group_by(CashVaultMovement.kind)
    ).all()
    by_kind: dict[str, tuple[Decimal, int]] = {}
    for kind, total, count in rows:
        key = kind.value if hasattr(kind, "value") else str(kind)
        by_kind[key] = (Decimal(total or 0), int(count))

    baseline_amount, _ = by_kind.get("baseline", (ZERO, 0))
    auto_total, _ = by_kind.get("auto_daily", (ZERO, 0))
    out_total, _ = by_kind.get("manual_out", (ZERO, 0))   # già negativo
    balance = baseline_amount + auto_total + out_total

    baseline_row = session.scalar(
        select(CashVaultMovement)
        .where(CashVaultMovement.kind == MovementKind.baseline)
        .order_by(CashVaultMovement.created_at.desc())
        .limit(1)
    )
    return {
        "balance": balance.quantize(Decimal("0.01")),
        "baseline": baseline_amount.quantize(Decimal("0.01")),
        "baseline_date": baseline_row.movement_date if baseline_row else None,
        "auto_total": auto_total.quantize(Decimal("0.01")),
        # esposto come VALORE ASSOLUTO per chiarezza UI ("uscite del periodo: € X")
        "manual_out_total": (-out_total).quantize(Decimal("0.01")),
        "movements_count": sum(c for _, c in by_kind.values()),
    }
