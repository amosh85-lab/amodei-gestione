"""/cash-vault router: cassaforte (saldo + entrate/uscite). Admin only."""
from __future__ import annotations

import logging
from datetime import date as date_type
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_session
from app.dependencies.auth import require_admin
from app.models.cash_vault import CashVaultMovement, MovementKind
from app.models.users import User
from app.schemas.cash_vault import (
    CashVaultBalanceOut,
    CashVaultBaselineIn,
    CashVaultManualOutIn,
    CashVaultMovementOut,
)
from app.services.cash_vault import compute_balance

router = APIRouter(prefix="/cash-vault", tags=["cash-vault"])
logger = logging.getLogger("amodei.cash_vault")


def _attach_creator(session: Session, mov: CashVaultMovement) -> CashVaultMovementOut:
    out = CashVaultMovementOut.model_validate(mov)
    if mov.created_by_user_id is not None:
        out.created_by_name = session.scalar(
            select(User.full_name).where(User.id == mov.created_by_user_id)
        )
    return out


@router.get("/balance", response_model=CashVaultBalanceOut)
def get_balance(
    last_n: int = Query(5, ge=0, le=100),
    session: Session = Depends(get_session),
    _user: User = Depends(require_admin),
) -> CashVaultBalanceOut:
    stats = compute_balance(session)
    last_rows = list(session.scalars(
        select(CashVaultMovement)
        .order_by(CashVaultMovement.movement_date.desc(), CashVaultMovement.id.desc())
        .limit(last_n)
    ))
    last_movements = [_attach_creator(session, m) for m in last_rows]
    return CashVaultBalanceOut(**stats, last_movements=last_movements)


@router.get("/movements", response_model=list[CashVaultMovementOut])
def list_movements(
    from_date: date_type | None = Query(None, alias="from"),
    to_date: date_type | None = Query(None, alias="to"),
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    session: Session = Depends(get_session),
    _user: User = Depends(require_admin),
) -> list[CashVaultMovementOut]:
    stmt = select(CashVaultMovement)
    if from_date is not None:
        stmt = stmt.where(CashVaultMovement.movement_date >= from_date)
    if to_date is not None:
        stmt = stmt.where(CashVaultMovement.movement_date <= to_date)
    stmt = stmt.order_by(
        CashVaultMovement.movement_date.desc(), CashVaultMovement.id.desc()
    ).limit(limit).offset(offset)
    rows = list(session.scalars(stmt))
    return [_attach_creator(session, m) for m in rows]


@router.put("/baseline", response_model=CashVaultMovementOut)
def set_baseline(
    body: CashVaultBaselineIn,
    session: Session = Depends(get_session),
    user: User = Depends(require_admin),
) -> CashVaultMovementOut:
    """Sovrascrive la baseline (cancella la precedente, se esisteva)."""
    session.query(CashVaultMovement).filter(
        CashVaultMovement.kind == MovementKind.baseline
    ).delete(synchronize_session=False)
    row = CashVaultMovement(
        kind=MovementKind.baseline,
        amount=Decimal(body.amount),
        movement_date=body.date,
        description=body.description or f"Saldo iniziale del {body.date.strftime('%d/%m/%Y')}",
        created_by_user_id=user.id,
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return _attach_creator(session, row)


@router.post(
    "/movements",
    response_model=CashVaultMovementOut,
    status_code=status.HTTP_201_CREATED,
)
def add_manual_out(
    body: CashVaultManualOutIn,
    session: Session = Depends(get_session),
    user: User = Depends(require_admin),
) -> CashVaultMovementOut:
    """Aggiunge un'uscita manuale. ``amount`` viene salvato come negativo."""
    row = CashVaultMovement(
        kind=MovementKind.manual_out,
        amount=-Decimal(body.amount),
        movement_date=body.date,
        description=body.description.strip(),
        created_by_user_id=user.id,
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return _attach_creator(session, row)


@router.delete("/movements/{movement_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_movement(
    movement_id: int,
    session: Session = Depends(get_session),
    _user: User = Depends(require_admin),
) -> Response:
    """Cancella un movimento. Per le entrate auto_daily il modo corretto di
    "cancellarle" è azzerare cash_dinner_above_float nel DailySummary del
    giorno (lì l'upsert le rimuove). Qui blocco la delete per evitare
    desincronizzazione."""
    row = session.scalar(
        select(CashVaultMovement).where(CashVaultMovement.id == movement_id)
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Movimento non trovato.")
    if row.kind == MovementKind.auto_daily:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Non si possono cancellare le entrate automatiche da qui — azzera "
            "il cash extra fondo della giornata in /cassa.",
        )
    session.delete(row)
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
