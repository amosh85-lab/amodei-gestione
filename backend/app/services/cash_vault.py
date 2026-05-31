"""Cassaforte: helpers per saldo + upsert dell'entrata automatica end-of-day."""
from __future__ import annotations

import logging
from datetime import date as date_type
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.cash import DailySummary
from app.models.cash_vault import CashVaultMovement, MovementKind

logger = logging.getLogger("amodei.cash_vault")

ZERO = Decimal("0.00")


def _baseline_date(session: Session) -> date_type | None:
    """Ritorna la data della baseline corrente, se esiste."""
    row = session.scalar(
        select(CashVaultMovement)
        .where(CashVaultMovement.kind == MovementKind.baseline)
        .order_by(CashVaultMovement.created_at.desc())
        .limit(1)
    )
    return row.movement_date if row else None


def upsert_auto_daily(
    session: Session,
    *,
    day: date_type,
    new_cash_dinner_above_float: Decimal | None,
    user_id: int | None,
) -> None:
    """Sincronizza l'entrata automatica della cassaforte per ``day``.

    Chiamato dal router ``PATCH /daily-summary/{day}`` ogni volta che
    ``cash_dinner_above_float`` cambia. Idempotente per giorno (unique
    constraint kind+source_date).

    Rispetta la baseline: se ``day < baseline_date`` lascia stare
    (sarebbe già "incluso" nella baseline e creerebbe doppio conteggio).
    Se esiste un auto_daily storico per quel giorno e ora è < baseline,
    lo rimuove per pulizia.
    """
    base_date = _baseline_date(session)

    existing = session.scalar(
        select(CashVaultMovement).where(
            CashVaultMovement.kind == MovementKind.auto_daily,
            CashVaultMovement.source_date == day,
        )
    )

    # Giorno coperto dalla baseline → no auto_daily.
    if base_date is not None and day < base_date:
        if existing is not None:
            session.delete(existing)
            session.commit()
            logger.info("Cash vault: rimosso auto_daily per %s (precede baseline %s)", day, base_date)
        return

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


def rebuild_auto_daily_from_baseline(
    session: Session,
    *,
    baseline_date: date_type,
    user_id: int | None,
) -> tuple[int, int]:
    """Pulisce le auto_daily precedenti la baseline e fa backfill di tutte
    quelle ≥ baseline_date da DailySummary già esistenti.

    Ritorna (deleted_count, upserted_count).
    """
    # 1) Cancello tutte le auto_daily PRIMA della baseline (incluse: source_date < baseline_date)
    deleted = session.query(CashVaultMovement).filter(
        CashVaultMovement.kind == MovementKind.auto_daily,
        CashVaultMovement.source_date < baseline_date,
    ).delete(synchronize_session=False)

    # 2) Backfill: per ogni DailySummary con date ≥ baseline e cash_dinner valorizzato
    summaries = list(session.scalars(
        select(DailySummary).where(
            DailySummary.date >= baseline_date,
            DailySummary.cash_dinner_above_float.is_not(None),
        )
    ))
    upserted = 0
    for s in summaries:
        existing = session.scalar(
            select(CashVaultMovement).where(
                CashVaultMovement.kind == MovementKind.auto_daily,
                CashVaultMovement.source_date == s.date,
            )
        )
        amount = Decimal(s.cash_dinner_above_float)
        if existing is None:
            session.add(CashVaultMovement(
                kind=MovementKind.auto_daily,
                amount=amount,
                movement_date=s.date,
                source_date=s.date,
                description=f"Cash fine serata del {s.date.strftime('%d/%m/%Y')}",
                created_by_user_id=user_id,
            ))
            upserted += 1
        elif existing.amount != amount:
            existing.amount = amount
            upserted += 1
    session.commit()
    logger.info(
        "Cash vault rebuild: deleted=%d (pre-baseline), upserted=%d (≥ baseline=%s)",
        deleted, upserted, baseline_date,
    )
    return deleted, upserted


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
    in_total, _ = by_kind.get("manual_in", (ZERO, 0))
    out_total, _ = by_kind.get("manual_out", (ZERO, 0))   # già negativo
    balance = baseline_amount + auto_total + in_total + out_total

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
        "manual_in_total": in_total.quantize(Decimal("0.01")),
        # esposto come VALORE ASSOLUTO per chiarezza UI ("uscite del periodo: € X")
        "manual_out_total": (-out_total).quantize(Decimal("0.01")),
        "movements_count": sum(c for _, c in by_kind.values()),
    }
