"""Stock movements: scarto (FIFO waste), rettifica (admin adjust), GET list."""
from __future__ import annotations

import logging
from datetime import date as date_type, datetime, time
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_session
from app.dependencies.auth import (
    get_current_user,
    require_manager_or_admin,
)
from app.models.inventory import Batch, Movement, MovementType, Product
from app.models.users import User
from app.schemas.batches import MovementOut, RettificaRequest, ScartoRequest
from app.services.inventory import InsufficientStockError, apply_movement

router = APIRouter(prefix="/movements", tags=["movements"])
logger = logging.getLogger("amodei.movements")


# ----------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------


def _movements_to_out(
    session: Session, movements: list[Movement]
) -> list[MovementOut]:
    """Hydrate Movements with product/user names (single batch query)."""
    if not movements:
        return []
    product_ids = {m.product_id for m in movements}
    user_ids = {m.user_id for m in movements}
    products = {
        p.id: p.name
        for p in session.execute(
            select(Product.id, Product.name).where(Product.id.in_(product_ids))
        ).all()
    }
    users = {
        u.id: u.full_name
        for u in session.execute(
            select(User.id, User.full_name).where(User.id.in_(user_ids))
        ).all()
    }
    out: list[MovementOut] = []
    for m in movements:
        item = MovementOut.model_validate(m)
        item.product_name = products.get(m.product_id)
        item.user_name = users.get(m.user_id)
        out.append(item)
    return out


# ----------------------------------------------------------------------
# POST /movements/scarto — staff+ can mark waste
# ----------------------------------------------------------------------
@router.post(
    "/scarto",
    response_model=list[MovementOut],
    status_code=status.HTTP_201_CREATED,
)
def scarto(
    payload: ScartoRequest,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
) -> list[MovementOut]:
    # Map the Literal to the canonical MovementType enum.
    mtype = MovementType(payload.type)
    try:
        movements = apply_movement(
            session,
            product_id=payload.product_id,
            qty_needed=payload.qty,
            mtype=mtype,
            reason=payload.reason,
            user_id=user.id,
        )
    except InsufficientStockError as exc:
        session.rollback()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    except ValueError as exc:
        session.rollback()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc

    session.commit()
    for m in movements:
        session.refresh(m)
    logger.info(
        "Scarto applicato: product_id=%d qty=%s type=%s user_id=%d",
        payload.product_id, payload.qty, payload.type, user.id,
    )
    return _movements_to_out(session, movements)


# ----------------------------------------------------------------------
# POST /movements/rettifica — admin/manager, exact batch adjustment
# ----------------------------------------------------------------------
@router.post(
    "/rettifica",
    response_model=list[MovementOut],
    status_code=status.HTTP_201_CREATED,
)
def rettifica(
    payload: RettificaRequest,
    session: Session = Depends(get_session),
    user: User = Depends(require_manager_or_admin),
) -> list[MovementOut]:
    batch = session.get(Batch, payload.batch_id)
    if batch is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Lotto non trovato.")
    if payload.new_qty > batch.initial_qty:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"La nuova quantità ({payload.new_qty}) non può superare l'initial_qty del lotto ({batch.initial_qty}).",
        )

    delta = payload.new_qty - batch.current_qty
    if delta == 0:
        # Idempotent: no-op, no movement created.
        return []

    movement = Movement(
        batch_id=batch.id,
        product_id=batch.product_id,
        type=MovementType.adjustment,
        qty=delta,  # signed: positive = qty up, negative = qty down
        reason=payload.reason,
        user_id=user.id,
    )
    session.add(movement)
    batch.current_qty = payload.new_qty
    session.commit()
    session.refresh(movement)
    logger.info(
        "Rettifica batch_id=%d delta=%s new_qty=%s by user_id=%d",
        batch.id, delta, payload.new_qty, user.id,
    )
    return _movements_to_out(session, [movement])


# ----------------------------------------------------------------------
# GET /movements — history, admin/manager only
# ----------------------------------------------------------------------
@router.get("", response_model=list[MovementOut])
def list_movements(
    product_id: int | None = Query(None),
    type: MovementType | None = Query(None),
    from_date: date_type | None = Query(None),
    to_date: date_type | None = Query(None),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    session: Session = Depends(get_session),
    _user: User = Depends(require_manager_or_admin),
) -> list[MovementOut]:
    stmt = select(Movement)
    if product_id is not None:
        stmt = stmt.where(Movement.product_id == product_id)
    if type is not None:
        stmt = stmt.where(Movement.type == type)
    if from_date is not None:
        stmt = stmt.where(Movement.created_at >= datetime.combine(from_date, time.min))
    if to_date is not None:
        stmt = stmt.where(Movement.created_at <= datetime.combine(to_date, time.max))
    stmt = (
        stmt.order_by(Movement.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    movements = list(session.scalars(stmt))
    return _movements_to_out(session, movements)
