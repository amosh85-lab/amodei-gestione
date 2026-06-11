"""/shift-tips router — mancia POS per (date, service).

La mancia è un importo unico per servizio; il payroll mensile la divide
in parti uguali tra chi ha un work_shift su quel (date, service).
Permessi allineati ai turni: manager può scrivere solo sugli ultimi 7
giorni, admin sempre.
"""
from __future__ import annotations

import logging
from datetime import date as date_type, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_session
from app.dependencies.auth import require_manager_or_admin
from app.models.base import ServiceKind
from app.models.shift_tips import ShiftTip
from app.models.users import User, UserRole
from app.models.work_shifts import WorkShift
from app.schemas.shift_tips import ShiftTipOut, ShiftTipUpsert

router = APIRouter(prefix="/shift-tips", tags=["shift-tips"])
logger = logging.getLogger("amodei.shift_tips")


def _check_can_modify(day: date_type, user: User) -> None:
    """Manager: solo ultimi 7 giorni (come i turni); admin sempre."""
    if user.role == UserRole.admin:
        return
    today = date_type.today()
    if day < today - timedelta(days=7) or day > today:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Il manager può registrare mance solo per gli ultimi 7 giorni.",
        )


def _hydrate(session: Session, row: ShiftTip) -> ShiftTipOut:
    out = ShiftTipOut.model_validate(row)
    out.participants_count = session.scalar(
        select(func.count(WorkShift.id))
        .where(WorkShift.date == row.date)
        .where(WorkShift.service == row.service)
    ) or 0
    out.created_by_name = session.scalar(
        select(User.full_name).where(User.id == row.created_by_user_id)
    )
    return out


@router.put("", response_model=ShiftTipOut)
def upsert_tip(
    payload: ShiftTipUpsert,
    session: Session = Depends(get_session),
    user: User = Depends(require_manager_or_admin),
) -> ShiftTipOut:
    _check_can_modify(payload.date, user)
    service_enum = ServiceKind(payload.service)
    row = session.scalar(
        select(ShiftTip)
        .where(ShiftTip.date == payload.date)
        .where(ShiftTip.service == service_enum)
    )
    if row is None:
        row = ShiftTip(
            date=payload.date, service=service_enum,
            amount=payload.amount, notes=payload.notes,
            created_by_user_id=user.id,
        )
        session.add(row)
    else:
        row.amount = payload.amount
        row.notes = payload.notes
    session.commit()
    session.refresh(row)
    logger.info("ShiftTip upsert: id=%d date=%s service=%s amount=%s by=%d",
                row.id, row.date, payload.service, row.amount, user.id)
    return _hydrate(session, row)


@router.get("", response_model=list[ShiftTipOut])
def list_tips(
    from_date: date_type | None = Query(None),
    to_date: date_type | None = Query(None),
    session: Session = Depends(get_session),
    _user: User = Depends(require_manager_or_admin),
) -> list[ShiftTipOut]:
    if from_date is None and to_date is None:
        from_date = to_date = date_type.today()
    stmt = select(ShiftTip)
    if from_date is not None:
        stmt = stmt.where(ShiftTip.date >= from_date)
    if to_date is not None:
        stmt = stmt.where(ShiftTip.date <= to_date)
    rows = list(session.scalars(stmt.order_by(ShiftTip.date.asc(), ShiftTip.service.asc())))
    return [_hydrate(session, r) for r in rows]


@router.delete(
    "/{tip_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
)
def delete_tip(
    tip_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(require_manager_or_admin),
) -> None:
    row = session.get(ShiftTip, tip_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Mancia non trovata.")
    _check_can_modify(row.date, user)
    session.delete(row)
    session.commit()
    logger.info("ShiftTip %d eliminata by user_id=%d", tip_id, user.id)
