"""/pay-rate-history router — storico compensi dei dipendenti (admin only).

Ogni riga = la tariffa/stipendio in vigore da `effective_from`. Dopo ogni
scrittura, User.pay_type/hourly_rate/monthly_salary (la tariffa CORRENTE,
letta ovunque nel resto dell'app) viene risincronizzata sulla riga più
recente non futura — vedi services/pay_rate.py.
"""
from __future__ import annotations

import logging
from datetime import date as date_type

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_session
from app.dependencies.auth import require_admin
from app.models.pay_rate_history import PayRateHistory
from app.models.users import User
from app.schemas.pay_rate_history import PayRateHistoryCreate, PayRateHistoryOut
from app.services.pay_rate import sync_current_rate

router = APIRouter(prefix="/pay-rate-history", tags=["pay-rate-history"])
logger = logging.getLogger("amodei.pay_rate_history")


def _hydrate(session: Session, rows: list[PayRateHistory]) -> list[PayRateHistoryOut]:
    if not rows:
        return []
    creators = {
        u.id: u for u in session.scalars(
            select(User).where(User.id.in_({r.created_by_user_id for r in rows}))
        )
    }
    out = []
    for r in rows:
        item = PayRateHistoryOut.model_validate(r)
        creator = creators.get(r.created_by_user_id)
        if creator is not None:
            item.created_by = creator
        out.append(item)
    return out


@router.get("", response_model=list[PayRateHistoryOut])
def list_pay_rate_history(
    user_id: int = Query(..., gt=0),
    session: Session = Depends(get_session),
    _actor: User = Depends(require_admin),
):
    rows = list(session.scalars(
        select(PayRateHistory)
        .where(PayRateHistory.user_id == user_id)
        .order_by(PayRateHistory.effective_from.desc(), PayRateHistory.id.desc())
    ))
    return _hydrate(session, rows)


@router.post("", response_model=PayRateHistoryOut, status_code=status.HTTP_201_CREATED)
def create_pay_rate_history(
    payload: PayRateHistoryCreate,
    session: Session = Depends(get_session),
    actor: User = Depends(require_admin),
):
    """Upsert su (user_id, effective_from): se per questo dipendente esiste
    già una voce con la stessa data (es. correzione di un errore inserito
    poco prima, stesso giorno), la aggiorna invece di rifiutarla con 409 —
    stesso pattern di PUT /day-leaves."""
    target = session.get(User, payload.user_id)
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Dipendente non trovato.")

    if payload.pay_type == "fixed" and payload.monthly_salary is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "Stipendio fisso: lo stipendio mensile è obbligatorio.")
    if payload.pay_type == "hourly" and payload.hourly_rate is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "A ore: la tariffa oraria è obbligatoria.")

    # Se questa è la PRIMA voce di storico in assoluto per l'utente, la
    # tariffa che aveva FINO AD ORA (quella corrente, prima di essere
    # sovrascritta da sync_current_rate più sotto) non è registrata da
    # nessuna parte: senza questo backfill sparirebbe sia dalla lista
    # sia — più grave — dal calcolo busta paga dei mesi passati, che
    # altrimenti ricadrebbe sulla tariffa NUOVA come fallback.
    has_history = session.scalar(
        select(PayRateHistory.id).where(PayRateHistory.user_id == payload.user_id).limit(1)
    ) is not None
    if not has_history and (target.hourly_rate is not None or target.monthly_salary is not None):
        backfill_date = target.created_at.date() if target.created_at else date_type(2024, 1, 1)
        if backfill_date < payload.effective_from:
            session.add(PayRateHistory(
                user_id=payload.user_id,
                effective_from=backfill_date,
                pay_type=target.pay_type,
                hourly_rate=target.hourly_rate,
                monthly_salary=target.monthly_salary,
                notes="Tariffa precedente a questa modifica (aggiunta automaticamente per completare lo storico).",
                created_by_user_id=actor.id,
            ))

    row = session.scalar(
        select(PayRateHistory)
        .where(PayRateHistory.user_id == payload.user_id)
        .where(PayRateHistory.effective_from == payload.effective_from)
    )
    if row is not None:
        row.pay_type = payload.pay_type
        row.hourly_rate = payload.hourly_rate
        row.monthly_salary = payload.monthly_salary
        row.notes = payload.notes
        row.created_by_user_id = actor.id
    else:
        row = PayRateHistory(
            user_id=payload.user_id,
            effective_from=payload.effective_from,
            pay_type=payload.pay_type,
            hourly_rate=payload.hourly_rate,
            monthly_salary=payload.monthly_salary,
            notes=payload.notes,
            created_by_user_id=actor.id,
        )
        session.add(row)
    session.flush()
    sync_current_rate(session, payload.user_id)
    session.commit()
    session.refresh(row)
    logger.info("PayRateHistory salvato: user_id=%d effective_from=%s pay_type=%s by_admin=%d",
                payload.user_id, payload.effective_from, payload.pay_type, actor.id)
    return _hydrate(session, [row])[0]


@router.delete("/{entry_id}")
def delete_pay_rate_history(
    entry_id: int,
    session: Session = Depends(get_session),
    actor: User = Depends(require_admin),
) -> dict:
    row = session.get(PayRateHistory, entry_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Voce di storico non trovata.")
    user_id = row.user_id
    session.delete(row)
    session.flush()
    sync_current_rate(session, user_id)
    session.commit()
    logger.info("PayRateHistory eliminato: id=%d user_id=%d by_admin=%d", entry_id, user_id, actor.id)
    return {"deleted_id": entry_id}
