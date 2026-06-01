"""/payroll-splits router (admin) — Ben/Dan per dipendente per mese."""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_session
from app.dependencies.auth import require_admin
from app.models.payroll_split import PayrollSplit
from app.models.users import User
from app.schemas.payroll_splits import PayrollSplitOut, PayrollSplitUpsert

router = APIRouter(prefix="/payroll-splits", tags=["payroll-splits"])
logger = logging.getLogger("amodei.payroll_splits")


@router.get("", response_model=list[PayrollSplitOut])
def list_splits(
    payroll_month: str | None = Query(
        None, pattern=r"^[0-9]{4}-(0[1-9]|1[0-2])$",
    ),
    session: Session = Depends(get_session),
    _user: User = Depends(require_admin),
) -> list[PayrollSplit]:
    stmt = select(PayrollSplit)
    if payroll_month is not None:
        stmt = stmt.where(PayrollSplit.payroll_month == payroll_month)
    return list(session.scalars(stmt))


@router.put("", response_model=PayrollSplitOut)
def upsert_split(
    payload: PayrollSplitUpsert,
    session: Session = Depends(get_session),
    actor: User = Depends(require_admin),
) -> PayrollSplit:
    target = session.get(User, payload.user_id)
    if target is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Dipendente non trovato.")
    existing = session.scalar(
        select(PayrollSplit)
        .where(PayrollSplit.user_id == payload.user_id)
        .where(PayrollSplit.payroll_month == payload.payroll_month)
    )
    if existing is not None:
        existing.ben_amount = payload.ben_amount
        existing.dan_amount = payload.dan_amount
        session.commit()
        session.refresh(existing)
        logger.info("PayrollSplit aggiornato user=%d month=%s by=%d",
                    payload.user_id, payload.payroll_month, actor.id)
        return existing
    row = PayrollSplit(
        user_id=payload.user_id,
        payroll_month=payload.payroll_month,
        ben_amount=payload.ben_amount,
        dan_amount=payload.dan_amount,
        created_by_user_id=actor.id,
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    logger.info("PayrollSplit creato user=%d month=%s by=%d",
                payload.user_id, payload.payroll_month, actor.id)
    return row
