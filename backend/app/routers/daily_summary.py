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
    return _attach_creator_names(session, calculate_summary(session, day))


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
    # provided (lunch above-float OR end-of-day) — whichever comes first.
    introducing_lunch = changes.get("cash_lunch_above_float") is not None and row.cash_lunch_above_float is None
    introducing_end   = changes.get("cash_total_end_of_day")  is not None and row.cash_total_end_of_day  is None
    no_cash_yet = row.cash_lunch_above_float is None and row.cash_total_end_of_day is None
    if (introducing_lunch or introducing_end) and no_cash_yet:
        row.cash_float_snapshot = get_cash_float(session)

    for k, v in changes.items():
        setattr(row, k, v)

    # If all three totals are filled, mark the row closed (forward-only)
    filled = sum(1 for v in (
        row.cash_total_end_of_day, row.fiscal_total, row.ipratico_total
    ) if v is not None)
    if filled == 3 and row.closed_at is None:
        row.closed_at = datetime.now(timezone.utc)
        row.closed_by_user_id = user.id

    session.commit()
    session.refresh(row)
    logger.info(
        "DailySummary %s aggiornato (status filled=%d) by user_id=%d",
        day.isoformat(), filled, user.id,
    )
    return _attach_creator_names(session, calculate_summary(session, day))
