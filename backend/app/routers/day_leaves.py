"""/day-leaves router — flag ferie/riposo/malattia per (user, date)."""
from __future__ import annotations

import logging
from datetime import date as date_type

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_session
from app.dependencies.auth import require_manager_or_admin
from app.models.day_leave import DayLeave, DayLeaveKind
from app.models.users import User
from app.schemas.day_leaves import DayLeaveOut, DayLeaveUpsert, _UserMini

router = APIRouter(prefix="/day-leaves", tags=["day-leaves"])
logger = logging.getLogger("amodei.day_leaves")


def _hydrate(session: Session, rows: list[DayLeave]) -> list[DayLeaveOut]:
    if not rows:
        return []
    user_ids = list({r.user_id for r in rows})
    users = {
        u.id: u for u in session.scalars(select(User).where(User.id.in_(user_ids)))
    }
    out: list[DayLeaveOut] = []
    for r in rows:
        item = DayLeaveOut.model_validate(r)
        u = users.get(r.user_id)
        if u is not None:
            item.user = _UserMini.model_validate(u)
        out.append(item)
    return out


@router.get("", response_model=list[DayLeaveOut])
def list_day_leaves(
    from_date: date_type | None = Query(None, alias="from_date"),
    to_date: date_type | None = Query(None, alias="to_date"),
    user_id: int | None = Query(None),
    session: Session = Depends(get_session),
    _user: User = Depends(require_manager_or_admin),
):
    stmt = select(DayLeave)
    if from_date is not None:
        stmt = stmt.where(DayLeave.date >= from_date)
    if to_date is not None:
        stmt = stmt.where(DayLeave.date <= to_date)
    if user_id is not None:
        stmt = stmt.where(DayLeave.user_id == user_id)
    stmt = stmt.order_by(DayLeave.date.asc(), DayLeave.user_id.asc())
    return _hydrate(session, list(session.scalars(stmt)))


@router.put("", response_model=DayLeaveOut)
def upsert_day_leave(
    payload: DayLeaveUpsert,
    session: Session = Depends(get_session),
    actor: User = Depends(require_manager_or_admin),
):
    target = session.get(User, payload.user_id)
    if target is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Dipendente non trovato.")
    existing = session.scalar(
        select(DayLeave)
        .where(DayLeave.user_id == payload.user_id)
        .where(DayLeave.date == payload.date)
    )
    if existing is not None:
        existing.kind = DayLeaveKind(payload.kind)
        existing.notes = payload.notes
        session.commit()
        session.refresh(existing)
        logger.info("DayLeave aggiornato user=%d date=%s kind=%s by=%d",
                    payload.user_id, payload.date, payload.kind, actor.id)
        return _hydrate(session, [existing])[0]
    row = DayLeave(
        user_id=payload.user_id,
        date=payload.date,
        kind=DayLeaveKind(payload.kind),
        notes=payload.notes,
        created_by_user_id=actor.id,
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    logger.info("DayLeave creato user=%d date=%s kind=%s by=%d",
                payload.user_id, payload.date, payload.kind, actor.id)
    return _hydrate(session, [row])[0]


@router.delete("/{leave_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
def delete_day_leave(
    leave_id: int,
    session: Session = Depends(get_session),
    actor: User = Depends(require_manager_or_admin),
) -> None:
    row = session.get(DayLeave, leave_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Stato giorno non trovato.")
    session.delete(row)
    session.commit()
    logger.info("DayLeave %d eliminato by=%d", leave_id, actor.id)
