"""/daily-summary router: cash recap per day with computed totals."""
from __future__ import annotations

import logging
from datetime import date as date_type, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_session
from app.dependencies.auth import require_manager_or_admin
from app.models.cash import DailySummary
from app.models.users import User
from app.schemas.cash import DailySummaryOut, DailySummaryUpdate
from app.services.cash import calculate_summary, get_cash_float
from app.services.push import send_to_admins

router = APIRouter(prefix="/daily-summary", tags=["daily-summary"])
logger = logging.getLogger("amodei.daily_summary")


def _ensure_row(session: Session, day: date_type) -> DailySummary:
    """Find-or-create the DailySummary row for ``day``."""
    row = session.scalar(select(DailySummary).where(DailySummary.date == day))
    if row is None:
        row = DailySummary(
            date=day,
            cash_float_snapshot=get_cash_float(session),
        )
        session.add(row)
        session.commit()
        session.refresh(row)
    return row


def _attach_creator_names(session: Session, summary_out: DailySummaryOut) -> DailySummaryOut:
    if summary_out.closed_by_user_id is not None:
        summary_out.closed_by_name = session.scalar(
            select(User.full_name).where(User.id == summary_out.closed_by_user_id)
        )
    return summary_out


@router.get("/today", response_model=DailySummaryOut)
def get_today(
    session: Session = Depends(get_session),
    _user: User = Depends(require_manager_or_admin),
) -> DailySummaryOut:
    today = date_type.today()
    _ensure_row(session, today)
    return _attach_creator_names(session, calculate_summary(session, today))


@router.get("", response_model=list[DailySummaryOut])
def list_summaries(
    from_date: date_type | None = Query(None, alias="from"),
    to_date: date_type | None = Query(None, alias="to"),
    limit: int = Query(60, ge=1, le=365),
    offset: int = Query(0, ge=0),
    session: Session = Depends(get_session),
    _user: User = Depends(require_manager_or_admin),
) -> list[DailySummaryOut]:
    stmt = select(DailySummary)
    if from_date is not None:
        stmt = stmt.where(DailySummary.date >= from_date)
    if to_date is not None:
        stmt = stmt.where(DailySummary.date <= to_date)
    stmt = stmt.order_by(DailySummary.date.desc()).limit(limit).offset(offset)
    rows = list(session.scalars(stmt))
    out = []
    for r in rows:
        s = calculate_summary(session, r.date)
        out.append(_attach_creator_names(session, s))
    return out


@router.get("/{day}", response_model=DailySummaryOut)
def get_summary(
    day: date_type,
    session: Session = Depends(get_session),
    _user: User = Depends(require_manager_or_admin),
) -> DailySummaryOut:
    row = session.scalar(select(DailySummary).where(DailySummary.date == day))
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Nessun riepilogo per {day.isoformat()}.")
    s = calculate_summary(session, day)
    logger.warning(
        "[CASH-DEBUG] GET %s cash_lunch_db=%r cash_dinner_db=%r cash_lunch_out=%r cash_dinner_out=%r",
        day.isoformat(), row.cash_lunch_above_float, row.cash_dinner_above_float,
        s.cash_lunch_above_float, s.cash_dinner_above_float,
    )
    return _attach_creator_names(session, s)


@router.patch("/{day}", response_model=DailySummaryOut)
def update_summary(
    day: date_type,
    payload: DailySummaryUpdate,
    session: Session = Depends(get_session),
    user: User = Depends(require_manager_or_admin),
) -> DailySummaryOut:
    row = _ensure_row(session, day)
    changes = payload.model_dump(exclude_unset=True)

    # Snapshot the cash_float setting the first time ANY cash count is
    # provided (lunch above-float OR dinner above-float) — whichever comes first.
    # The float itself isn't used in any computation; this is informational.
    introducing_lunch  = changes.get("cash_lunch_above_float")  is not None and row.cash_lunch_above_float  is None
    introducing_dinner = changes.get("cash_dinner_above_float") is not None and row.cash_dinner_above_float is None
    no_cash_yet = row.cash_lunch_above_float is None and row.cash_dinner_above_float is None
    if (introducing_lunch or introducing_dinner) and no_cash_yet:
        row.cash_float_snapshot = get_cash_float(session)

    for k, v in changes.items():
        setattr(row, k, v)

    # Closed when both cash inputs AND both reconciliation totals are filled.
    cash_complete = row.cash_lunch_above_float is not None and row.cash_dinner_above_float is not None
    if cash_complete and row.fiscal_total is not None and row.ipratico_total is not None and row.closed_at is None:
        row.closed_at = datetime.now(timezone.utc)
        row.closed_by_user_id = user.id

    session.commit()
    session.refresh(row)
    logger.info(
        "DailySummary %s aggiornato by user_id=%d",
        day.isoformat(), user.id,
    )
    # DEBUG temporaneo per indagare "cash dice salvato ma non appare":
    # voglio vedere cosa arriva, cosa viene committato, cosa il calculate ritorna.
    logger.warning(
        "[CASH-DEBUG] day=%s payload_changes=%r row.cash_lunch=%r row.cash_dinner=%r",
        day.isoformat(), changes, row.cash_lunch_above_float, row.cash_dinner_above_float,
    )

    summary = calculate_summary(session, day)
    logger.warning(
        "[CASH-DEBUG] summary day=%s cash_lunch_out=%r cash_dinner_out=%r partial_lunch=%r partial_dinner=%r",
        day.isoformat(), summary.cash_lunch_above_float, summary.cash_dinner_above_float,
        summary.partial_lunch, summary.partial_dinner,
    )

    # Push notification quando si compila per la prima volta cash pranzo o
    # cash cena (transizione null → valore). L'autore non riceve la propria
    # notifica. Errori di invio non rompono la response.
    try:
        if introducing_lunch and summary.partial_lunch is not None:
            send_to_admins(
                session,
                title="Parziale pranzo inserito",
                body=f"€ {summary.partial_lunch:.2f} · da {user.full_name} ({day.strftime('%d/%m')})",
                url=f"/cassa?date={day.isoformat()}&tab=lunch",
                tag=f"cash-lunch-{day.isoformat()}",
                exclude_user_id=user.id,
            )
        if introducing_dinner and summary.partial_dinner is not None:
            total_str = (
                f" · totale € {summary.computed_total:.2f}"
                if summary.computed_total is not None else ""
            )
            send_to_admins(
                session,
                title="Cassa serata chiusa",
                body=f"Parziale cena € {summary.partial_dinner:.2f}{total_str} · da {user.full_name} ({day.strftime('%d/%m')})",
                url=f"/cassa?date={day.isoformat()}&tab=total",
                tag=f"cash-dinner-{day.isoformat()}",
                exclude_user_id=user.id,
            )
    except Exception:
        logger.exception("Push send failed (non-fatal) for DailySummary %s", day.isoformat())

    return _attach_creator_names(session, summary)
