"""Sincronizza User.pay_type/hourly_rate/monthly_salary (la tariffa
CORRENTE, letta da tutto il resto dell'app) con la riga di PayRateHistory
più recente la cui effective_from non è nel futuro.

Chiamata dopo ogni scrittura su /pay-rate-history, e opportunisticamente
da GET /users: così una modifica programmata con data futura si attiva
da sola, senza bisogno di un job pianificato, non appena un admin apre
la lista utenti dal giorno in cui diventa valida in avanti.
"""
from __future__ import annotations

from datetime import date as date_type

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.pay_rate_history import PayRateHistory
from app.models.users import User


def sync_current_rate(session: Session, user_id: int) -> None:
    active = session.scalar(
        select(PayRateHistory)
        .where(PayRateHistory.user_id == user_id)
        .where(PayRateHistory.effective_from <= date_type.today())
        .order_by(PayRateHistory.effective_from.desc())
        .limit(1)
    )
    if active is None:
        return
    user = session.get(User, user_id)
    if user is None:
        return
    user.pay_type = active.pay_type
    user.hourly_rate = active.hourly_rate
    user.monthly_salary = active.monthly_salary


def sync_all_current_rates(session: Session) -> None:
    user_ids = session.scalars(select(PayRateHistory.user_id).distinct()).all()
    for uid in user_ids:
        sync_current_rate(session, uid)
    if user_ids:
        session.commit()
