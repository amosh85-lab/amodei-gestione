"""/pos-sessions router: lunch/dinner POS closings."""
from __future__ import annotations

import logging
from datetime import date as date_type, datetime, timezone
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_session
from app.dependencies.auth import require_admin, require_manager_or_admin
from app.models.base import ServiceKind
from app.models.cash import PosSession
from app.models.users import User, UserRole
from app.schemas.cash import PosSessionCreate, PosSessionOut, PosSessionUpdate

router = APIRouter(prefix="/pos-sessions", tags=["pos-sessions"])
logger = logging.getLogger("amodei.pos_sessions")


def _check_can_modify(session_row: PosSession, user: User) -> None:
    """Same-day edits ok for any manager/admin; older days admin-only."""
    if session_row.date != date_type.today() and user.role != UserRole.admin:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Solo un admin può modificare le sessioni di giorni precedenti.",
        )


def _hydrate(session: Session, row: PosSession) -> PosSessionOut:
    out = PosSessionOut.model_validate(row)
    out.closed_by_name = session.scalar(
        select(User.full_name).where(User.id == row.closed_by_user_id)
    )
    return out


@router.post("", response_model=PosSessionOut, status_code=status.HTTP_201_CREATED)
def create_session(
    payload: PosSessionCreate,
    session: Session = Depends(get_session),
    user: User = Depends(require_manager_or_admin),
) -> PosSessionOut:
    day = payload.date or date_type.today()
    row = PosSession(
        date=day,
        service=ServiceKind(payload.service),
        closing_amount=payload.closing_amount,
        closed_by_user_id=user.id,
        closed_at=datetime.now(timezone.utc),
        notes=payload.notes,
    )
    session.add(row)
    try:
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Esiste già una sessione {payload.service} per il {day.isoformat()}. "
            f"Modifica quella esistente.",
        ) from exc
    session.refresh(row)
    logger.info(
        "PosSession creata id=%d date=%s service=%s amount=%s by user_id=%d",
        row.id, row.date, payload.service, row.closing_amount, user.id,
    )
    return _hydrate(session, row)


@router.get("", response_model=list[PosSessionOut])
def list_sessions(
    date: date_type | None = Query(None, description="Filtra per data (default oggi)"),
    session: Session = Depends(get_session),
    _user: User = Depends(require_manager_or_admin),
) -> list[PosSessionOut]:
    if date is None:
        date = date_type.today()
    rows = list(session.scalars(
        select(PosSession).where(PosSession.date == date).order_by(PosSession.service.asc())
    ))
    return [_hydrate(session, r) for r in rows]


@router.patch("/{session_id}", response_model=PosSessionOut)
def update_session(
    session_id: int,
    payload: PosSessionUpdate,
    session: Session = Depends(get_session),
    user: User = Depends(require_manager_or_admin),
) -> PosSessionOut:
    row = session.get(PosSession, session_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sessione POS non trovata.")
    _check_can_modify(row, user)
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(row, k, v)
    session.commit()
    session.refresh(row)
    logger.info("PosSession %d aggiornata by user_id=%d", row.id, user.id)
    return _hydrate(session, row)


@router.delete(
    "/{session_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
)
def delete_session(
    session_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(require_admin),
) -> None:
    row = session.get(PosSession, session_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sessione POS non trovata.")
    session.delete(row)
    session.commit()
    logger.info("PosSession %d eliminata by user_id=%d", session_id, user.id)
