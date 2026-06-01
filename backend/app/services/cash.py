"""Cash reporting: read cash_float from settings, calculate_summary."""
from __future__ import annotations

import logging
from datetime import date as date_type
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.cash import (
    DailySummary,
    EmployeeAdvance,
    Expense,
    PosSession,
)
from app.models.settings import AppSetting
from app.schemas.cash import DailySummaryOut

logger = logging.getLogger("amodei.cash")

CASH_FLOAT_KEY = "cash_float"
DEFAULT_CASH_FLOAT = Decimal("100.00")
ZERO = Decimal("0.00")


def _q(value: Decimal | int | float | None) -> Decimal:
    """Round to 2 decimals, half-up. None passes through as None."""
    if value is None:
        return None  # type: ignore[return-value]
    if not isinstance(value, Decimal):
        value = Decimal(str(value))
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def get_cash_float(session: Session) -> Decimal:
    """Read the current cash_float setting; falls back to 100.00 if missing
    or malformed (and logs a warning so the dev knows to seed it)."""
    setting = session.scalar(
        select(AppSetting).where(AppSetting.key == CASH_FLOAT_KEY)
    )
    if setting is None:
        logger.warning("cash_float setting missing — using default %s", DEFAULT_CASH_FLOAT)
        return DEFAULT_CASH_FLOAT
    try:
        return _q(Decimal(setting.value))
    except (InvalidOperation, ValueError):
        logger.warning(
            "cash_float setting value %r non parseable — using default %s",
            setting.value, DEFAULT_CASH_FLOAT,
        )
        return DEFAULT_CASH_FLOAT


def _pos_totals(session: Session, day: date_type) -> tuple[Decimal, Decimal]:
    rows = session.execute(
        select(PosSession.service, func.sum(PosSession.closing_amount))
        .where(PosSession.date == day)
        .group_by(PosSession.service)
    ).all()
    lunch = ZERO
    dinner = ZERO
    for service, total in rows:
        amt = _q(total or 0)
        if service == "lunch" or getattr(service, "value", None) == "lunch":
            lunch = amt
        elif service == "dinner" or getattr(service, "value", None) == "dinner":
            dinner = amt
    return lunch, dinner


def _expenses_totals(session: Session, day: date_type) -> tuple[Decimal, Decimal]:
    rows = session.execute(
        select(Expense.service, func.sum(Expense.amount))
        .where(Expense.date == day)
        .group_by(Expense.service)
    ).all()
    lunch = ZERO
    dinner = ZERO
    for service, total in rows:
        amt = _q(total or 0)
        if service == "lunch" or getattr(service, "value", None) == "lunch":
            lunch = amt
        elif service == "dinner" or getattr(service, "value", None) == "dinner":
            dinner = amt
    return lunch, dinner


def _advances_totals(session: Session, day: date_type) -> tuple[Decimal, Decimal]:
    """Employee cash advances given during the day, split by service.
    Settlement state is irrelevant for the cash math — what matters is that
    the money LEFT the drawer on this day."""
    rows = session.execute(
        select(EmployeeAdvance.service, func.sum(EmployeeAdvance.amount))
        .where(EmployeeAdvance.date == day)
        .where(EmployeeAdvance.payment_method == "cash")
        .group_by(EmployeeAdvance.service)
    ).all()
    lunch = ZERO
    dinner = ZERO
    for service, total in rows:
        amt = _q(total or 0)
        if service == "lunch" or getattr(service, "value", None) == "lunch":
            lunch = amt
        elif service == "dinner" or getattr(service, "value", None) == "dinner":
            dinner = amt
    return lunch, dinner


def calculate_summary(session: Session, day: date_type) -> DailySummaryOut:
    """Compute the full DailySummaryOut for ``day``.

    Does NOT create or modify the DailySummary row — it just reads what's
    there (if anything) plus aggregates from POS sessions and expenses.

    Cash float source:
      * If a DailySummary row exists with ``cash_float_snapshot`` set, use
        that (snapshot from the moment the manager first entered the cash
        count → keeps the historic number stable even if the setting changes).
      * Otherwise, fall back to the current setting value.
    """
    summary_row = session.scalar(
        select(DailySummary).where(DailySummary.date == day)
    )

    # cash_float to apply
    if summary_row is not None and summary_row.cash_float_snapshot is not None:
        cash_float = _q(summary_row.cash_float_snapshot)
    else:
        cash_float = get_cash_float(session)

    pos_lunch, pos_dinner = _pos_totals(session, day)
    expenses_lunch, expenses_dinner = _expenses_totals(session, day)
    advances_lunch, advances_dinner = _advances_totals(session, day)
    pos_total = _q(pos_lunch + pos_dinner)
    expenses_total = _q(expenses_lunch + expenses_dinner)
    advances_total = _q(advances_lunch + advances_dinner)

    cash_lunch_above = _q(summary_row.cash_lunch_above_float) if summary_row and summary_row.cash_lunch_above_float is not None else None
    cash_dinner_above = _q(summary_row.cash_dinner_above_float) if summary_row and summary_row.cash_dinner_above_float is not None else None
    fiscal = _q(summary_row.fiscal_total) if summary_row and summary_row.fiscal_total is not None else None
    ipratico = _q(summary_row.ipratico_total) if summary_row and summary_row.ipratico_total is not None else None

    # Both cash inputs are CUMULATIVE snapshots above-float (≥ 0):
    #   cash_lunch_above_float  = TUTTO il contante in cassa meno fondo, a fine pranzo
    #   cash_dinner_above_float = TUTTO il contante in cassa meno fondo, a fine serata
    # Quindi cash_dinner_above include già il contante presente a fine pranzo:
    # NON si sommano fra loro. Il cash netto incassato durante la cena si
    # ottiene per differenza (più le uscite cash della cena, reincorporate).
    # Il float non entra mai nei calcoli — è solo uno snapshot informativo.
    if cash_lunch_above is not None:
        cash_lunch_incassato = _q(cash_lunch_above + expenses_lunch + advances_lunch)
        partial_lunch = _q(pos_lunch + cash_lunch_incassato)
    else:
        cash_lunch_incassato = None
        partial_lunch = None

    if cash_dinner_above is not None:
        # Baseline = cash a fine pranzo (0 se non ancora compilato).
        cash_lunch_baseline = cash_lunch_above if cash_lunch_above is not None else ZERO
        cash_dinner_incassato = _q(
            cash_dinner_above - cash_lunch_baseline + expenses_dinner + advances_dinner
        )
        partial_dinner = _q(pos_dinner + cash_dinner_incassato)
    else:
        cash_dinner_incassato = None
        partial_dinner = None

    # Aggregate totals: available once BOTH cash inputs are set (così abbiamo
    # entrambi i parziali). cash_dinner_above è già il totale a fine giornata,
    # quindi NON si somma a cash_lunch_above.
    if cash_lunch_above is not None and cash_dinner_above is not None:
        cash_above_float = cash_dinner_above
        cash_incassato = _q(cash_dinner_above + expenses_total + advances_total)
        computed_total = _q(pos_total + cash_incassato)
    else:
        cash_above_float = None
        cash_incassato = None
        computed_total = None

    delta_fiscal = _q(fiscal - computed_total) if (fiscal is not None and computed_total is not None) else None
    delta_ipratico = _q(ipratico - computed_total) if (ipratico is not None and computed_total is not None) else None
    delta_fiscal_ipratico = _q(fiscal - ipratico) if (fiscal is not None and ipratico is not None) else None

    cash_complete = cash_lunch_above is not None and cash_dinner_above is not None
    if cash_complete and fiscal is not None and ipratico is not None:
        status = "closed"
    elif cash_lunch_above is not None or cash_dinner_above is not None or fiscal is not None or ipratico is not None:
        status = "partial"
    else:
        status = "open"

    out = DailySummaryOut(
        date=day,
        cash_float=cash_float,
        pos_lunch=pos_lunch,
        pos_dinner=pos_dinner,
        pos_total=pos_total,
        expenses_lunch=expenses_lunch,
        expenses_dinner=expenses_dinner,
        expenses_total=expenses_total,
        advances_lunch=advances_lunch,
        advances_dinner=advances_dinner,
        advances_total=advances_total,
        cash_lunch_above_float=cash_lunch_above,
        cash_lunch_incassato=cash_lunch_incassato,
        partial_lunch=partial_lunch,
        cash_dinner_above_float=cash_dinner_above,
        cash_dinner_incassato=cash_dinner_incassato,
        partial_dinner=partial_dinner,
        cash_above_float=cash_above_float,
        cash_incassato=cash_incassato,
        computed_total=computed_total,
        fiscal_total=fiscal,
        ipratico_total=ipratico,
        delta_fiscal=delta_fiscal,
        delta_ipratico=delta_ipratico,
        delta_fiscal_ipratico=delta_fiscal_ipratico,
        status=status,
        notes=summary_row.notes if summary_row else None,
        id=summary_row.id if summary_row else None,
        closed_by_user_id=summary_row.closed_by_user_id if summary_row else None,
        closed_at=summary_row.closed_at if summary_row else None,
    )
    return out
