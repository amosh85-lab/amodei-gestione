"""Payroll service: weekly + monthly summaries from work_shifts.

Integrazione con la PATCH `reference_month` degli acconti:
- Gli "acconti del mese di X" sono quelli con
  `EmployeeAdvance.reference_month == 'YYYY-MM'`, NON quelli con .date
  nel mese. Coerente con la patch precedente: ciò che conta per la busta
  di maggio è il reference_month, non quando il cash è uscito dal cassetto.
"""
from __future__ import annotations

import calendar
from dataclasses import dataclass
from datetime import date as date_type, timedelta
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.cash import EmployeeAdvance
from app.models.users import PayType, User, UserRole
from app.models.work_shifts import WorkShift

ZERO = Decimal("0")
MONTH_LABELS_IT = [
    "Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno",
    "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre",
]


def _q2(value) -> Decimal:
    if value is None:
        return ZERO
    if not isinstance(value, Decimal):
        value = Decimal(str(value))
    return value.quantize(Decimal("0.01"))


def get_week_bounds(d: date_type) -> tuple[date_type, date_type]:
    """Lunedì (incluso) e domenica (incluso) della settimana che contiene `d`."""
    weekday = d.weekday()   # 0 = lunedì
    monday = d - timedelta(days=weekday)
    sunday = monday + timedelta(days=6)
    return monday, sunday


def _month_bounds(year: int, month: int) -> tuple[date_type, date_type]:
    """Primo e ultimo giorno del mese (inclusivi)."""
    first = date_type(year, month, 1)
    last_day = calendar.monthrange(year, month)[1]
    return first, date_type(year, month, last_day)


def calculate_user_weekly_summary(
    session: Session, user_id: int, week_start: date_type,
) -> dict:
    """Somma ore settimana per un utente. Include overtime se contratto.

    Returns: dict con week_start/week_end/total_hours/contract_hours/
             overtime_hours/is_overtime. (contract_hours/overtime_hours
             possono essere None — il router decide poi cosa mostrare al
             chiamante in base al ruolo).
    """
    monday, sunday = get_week_bounds(week_start)
    user = session.get(User, user_id)
    total = session.scalar(
        select(func.coalesce(func.sum(WorkShift.hours), 0))
        .where(WorkShift.user_id == user_id)
        .where(WorkShift.date >= monday)
        .where(WorkShift.date <= sunday)
    ) or ZERO
    total = _q2(total)
    contract = _q2(user.weekly_hours_contract) if (user and user.weekly_hours_contract) else None
    overtime = _q2(max(ZERO, total - contract)) if contract is not None else None
    is_overtime = bool(contract is not None and total > contract)
    return {
        "week_start": monday, "week_end": sunday,
        "user": user, "total_hours": total,
        "contract_hours": contract, "overtime_hours": overtime,
        "is_overtime": is_overtime,
    }


def get_users_without_shift(session: Session, d: date_type) -> list[User]:
    """Utenti staff/manager attivi che NON hanno un work_shift per quella data.
    Usato dall'UI di inserimento per mostrare chi resta da assegnare."""
    has_shift_subq = select(WorkShift.user_id).where(WorkShift.date == d)
    return list(session.scalars(
        select(User)
        .where(User.role.in_([UserRole.staff, UserRole.manager]))
        .where(User.active.is_(True))
        .where(~User.id.in_(has_shift_subq))
        .order_by(User.full_name.asc())
    ))


def calculate_monthly_payroll(session: Session, year: int, month: int) -> dict:
    """Riepilogo stipendi mensile: ore × tariffa − acconti riferiti al mese.

    Filtro acconti = `reference_month = "YYYY-MM"` (NON .date). Coerente
    con la PATCH reference_month: ciò che la busta di X deve scalare è
    quanto è stato anticipato CON reference_month=X.
    """
    first, last = _month_bounds(year, month)
    payroll_str = f"{year:04d}-{month:02d}"

    # Tutti gli utenti staff+manager attivi (anche senza tariffa, mostrati con flag)
    users = list(session.scalars(
        select(User)
        .where(User.role.in_([UserRole.staff, UserRole.manager]))
        .where(User.active.is_(True))
        .order_by(User.full_name.asc())
    ))

    # Pre-compute weekly breakdown: per ogni utente, raggruppo i giorni del
    # mese per settimana (lunedì-domenica). Una settimana può sforare i bordi
    # del mese — qui contiamo SOLO le ore dei giorni interni al mese, ma
    # confrontiamo col contratto settimanale standard.
    rows: list[dict] = []
    totals = {"hours": ZERO, "gross": ZERO, "advances": ZERO, "net": ZERO}

    for u in users:
        # Ore totali del mese
        total_hours = session.scalar(
            select(func.coalesce(func.sum(WorkShift.hours), 0))
            .where(WorkShift.user_id == u.id)
            .where(WorkShift.date >= first)
            .where(WorkShift.date <= last)
        ) or ZERO
        total_hours = _q2(total_hours)

        # Acconti riferiti a questo mese (reference_month)
        adv_for_month = session.scalar(
            select(func.coalesce(func.sum(EmployeeAdvance.amount), 0))
            .where(EmployeeAdvance.user_id == u.id)
            .where(EmployeeAdvance.reference_month == payroll_str)
        ) or ZERO
        adv_for_month = _q2(adv_for_month)

        # Acconti già marcati come settled IN questa busta paga
        adv_settled = session.scalar(
            select(func.coalesce(func.sum(EmployeeAdvance.amount), 0))
            .where(EmployeeAdvance.user_id == u.id)
            .where(EmployeeAdvance.settled_in_payroll_month == payroll_str)
        ) or ZERO
        adv_settled = _q2(adv_settled)

        # Ci sono acconti del mese non ancora saldati?
        unsettled_count = session.scalar(
            select(func.count(EmployeeAdvance.id))
            .where(EmployeeAdvance.user_id == u.id)
            .where(EmployeeAdvance.reference_month == payroll_str)
            .where(EmployeeAdvance.settled_at.is_(None))
        ) or 0

        # Lordo / netto: dipende dal tipo di compenso
        is_fixed = u.pay_type == PayType.fixed
        if is_fixed and u.monthly_salary is not None:
            gross = _q2(u.monthly_salary)
            net = _q2(gross - adv_for_month)
        elif not is_fixed and u.hourly_rate is not None:
            gross = _q2(total_hours * u.hourly_rate)
            net = _q2(gross - adv_for_month)
        else:
            gross = None
            net = None

        # Weekly breakdown: settimane che TOCCANO questo mese
        weekly_rows = []
        # Trova tutti i lunedì che ricadono "vicino" al mese.
        # Strategy: parto dal lunedì della settimana del primo giorno del
        # mese, e itero finché il lunedì è ≤ last.
        wk_monday = get_week_bounds(first)[0]
        while wk_monday <= last:
            wk_sunday = wk_monday + timedelta(days=6)
            # Ore della settimana (TUTTA, non solo giorni nel mese — per
            # confronto col contratto settimanale)
            wk_hours = session.scalar(
                select(func.coalesce(func.sum(WorkShift.hours), 0))
                .where(WorkShift.user_id == u.id)
                .where(WorkShift.date >= wk_monday)
                .where(WorkShift.date <= wk_sunday)
            ) or ZERO
            wk_hours = _q2(wk_hours)
            wk_overtime = ZERO
            if u.weekly_hours_contract is not None:
                wk_overtime = _q2(max(ZERO, wk_hours - u.weekly_hours_contract))
            weekly_rows.append({
                "week_start": wk_monday, "week_end": wk_sunday,
                "hours": wk_hours, "overtime": wk_overtime,
            })
            wk_monday = wk_monday + timedelta(days=7)

        needs_config = (
            (is_fixed and u.monthly_salary is None)
            or (not is_fixed and u.hourly_rate is None)
        )
        rows.append({
            "user": u,
            "total_hours": total_hours,
            "gross_amount": gross,
            "advances_taken": adv_for_month,
            "advances_settled_in_month": adv_settled,
            "net_to_pay": net,
            "has_unsettled_advances": unsettled_count > 0,
            "needs_configuration": needs_config,
            "weekly_breakdown": weekly_rows,
        })

        totals["hours"] += total_hours
        if gross is not None:
            totals["gross"] += gross
            totals["net"] += net
        totals["advances"] += adv_for_month

    return {
        "year": year, "month": month,
        "month_label": f"{MONTH_LABELS_IT[month - 1]} {year}",
        "by_user": rows,
        "totals": {
            "total_hours": _q2(totals["hours"]),
            "total_gross": _q2(totals["gross"]),
            "total_advances": _q2(totals["advances"]),
            "total_net": _q2(totals["net"]),
        },
    }


def settle_advances_for_month(
    session: Session, user_id: int, year: int, month: int, admin_user_id: int,
) -> dict:
    """Marca settled tutti gli acconti dell'utente con reference_month=YYYY-MM
    non ancora saldati. Setta settled_in_payroll_month = reference_month (= YYYY-MM).
    """
    from datetime import datetime, timezone

    payroll_str = f"{year:04d}-{month:02d}"
    advances = list(session.scalars(
        select(EmployeeAdvance)
        .where(EmployeeAdvance.user_id == user_id)
        .where(EmployeeAdvance.reference_month == payroll_str)
        .where(EmployeeAdvance.settled_at.is_(None))
    ))
    now = datetime.now(timezone.utc)
    total = ZERO
    for adv in advances:
        adv.settled_at = now
        adv.settled_in_payroll_month = payroll_str
        adv.settled_by_user_id = admin_user_id
        total += adv.amount
    if advances:
        session.commit()
    return {"settled_count": len(advances), "total_settled_amount": _q2(total)}
