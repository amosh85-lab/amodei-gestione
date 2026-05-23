"""End-of-day inventory close: physical count → automatic stock movements."""
from __future__ import annotations

import logging
from collections import defaultdict
from datetime import date as date_type, datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_session
from app.dependencies.auth import (
    get_current_user,
    require_manager_or_admin,
)
from app.models.inventory import Batch, Movement, MovementType, Product
from app.models.inventory_close import EveningClose, EveningCloseItem
from app.models.users import User
from app.schemas.inventory_close import (
    EveningCloseDetail,
    EveningCloseItemOut,
    EveningCloseOut,
    EveningCloseSavePayload,
    EveningCloseSaveResult,
)
from app.services.inventory import (
    InsufficientStockError,
    apply_movement,
)

router = APIRouter(prefix="/evening-close", tags=["evening-close"])
logger = logging.getLogger("amodei.evening_close")


# ----------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------


def _qty_totals(session: Session, product_ids: list[int]) -> dict[int, Decimal]:
    """Return {product_id: sum(batch.current_qty)} for the given ids."""
    if not product_ids:
        return {}
    rows = session.execute(
        select(Batch.product_id, func.coalesce(func.sum(Batch.current_qty), 0))
        .where(Batch.product_id.in_(product_ids))
        .group_by(Batch.product_id)
    ).all()
    return {pid: Decimal(total or 0) for pid, total in rows}


def _apply_increase_to_newest_batch(
    session: Session,
    *,
    product_id: int,
    delta: Decimal,
    reason: str,
    user_id: int,
) -> Movement | None:
    """Credit ``delta`` (positive) to the product's most recent batch.

    Returns the created Movement or None if no batch exists (caller should
    surface a warning to the user — no audit trail possible without a batch).
    """
    if delta <= 0:
        raise ValueError("delta must be positive")
    batch = session.scalar(
        select(Batch)
        .where(Batch.product_id == product_id)
        .order_by(Batch.load_date.desc(), Batch.id.desc())
        .limit(1)
    )
    if batch is None:
        return None
    batch.current_qty = Decimal(batch.current_qty) + delta
    movement = Movement(
        batch_id=batch.id,
        product_id=product_id,
        type=MovementType.adjustment,
        qty=delta,  # positive — adjustment up
        reason=reason,
        user_id=user_id,
    )
    session.add(movement)
    return movement


def _close_to_out(session: Session, close: EveningClose) -> EveningCloseOut:
    user_name = session.scalar(
        select(User.full_name).where(User.id == close.user_id)
    )
    out = EveningCloseOut.model_validate(close)
    out.user_name = user_name
    return out


def _items_for_today(
    session: Session, close: EveningClose | None
) -> list[EveningCloseItemOut]:
    """Build the per-product list shown on the close form."""
    # Active products only.
    products = list(session.scalars(
        select(Product)
        .where(Product.active.is_(True))
        .order_by(func.lower(Product.name).asc())
    ))
    qty_map = _qty_totals(session, [p.id for p in products])
    saved_map: dict[int, Decimal] = {}
    if close is not None:
        saved_rows = session.execute(
            select(EveningCloseItem.product_id, EveningCloseItem.qty_remaining)
            .where(EveningCloseItem.evening_close_id == close.id)
        ).all()
        saved_map = {pid: Decimal(qty) for pid, qty in saved_rows}
    out: list[EveningCloseItemOut] = []
    for p in products:
        out.append(EveningCloseItemOut(
            product_id=p.id,
            product_name=p.name,
            product_unit=p.unit,
            category=p.category,
            qty_actual=qty_map.get(p.id, Decimal("0")),
            qty_remaining_saved=saved_map.get(p.id),
        ))
    return out


def _items_for_existing(
    session: Session, close: EveningClose
) -> list[EveningCloseItemOut]:
    """Build the list view of an existing close: only the products that
    were actually counted, with their saved qty + current qty."""
    rows = session.execute(
        select(
            EveningCloseItem,
            Product.id,
            Product.name,
            Product.unit,
            Product.category,
        )
        .join(Product, Product.id == EveningCloseItem.product_id)
        .where(EveningCloseItem.evening_close_id == close.id)
        .order_by(func.lower(Product.name).asc())
    ).all()
    pids = [pid for _, pid, *_ in rows]
    qty_map = _qty_totals(session, pids)
    out: list[EveningCloseItemOut] = []
    for item, pid, name, unit, category in rows:
        out.append(EveningCloseItemOut(
            product_id=pid,
            product_name=name,
            product_unit=unit,
            category=category,
            qty_actual=qty_map.get(pid, Decimal("0")),
            qty_remaining_saved=Decimal(item.qty_remaining),
        ))
    return out


def _save_diffs(
    session: Session,
    *,
    close: EveningClose,
    payload: EveningCloseSavePayload,
    user_id: int,
    close_date: date_type,
) -> tuple[int, list[str]]:
    """Compute server-side deltas against current qty_total and emit
    movements (sale for decreases via FIFO, adjustment for increases on
    the newest batch). Replaces EveningCloseItem rows on the close.

    Returns (movements_created_count, warnings).
    """
    # 1) Look up products + validate
    product_ids = [it.product_id for it in payload.items]
    if len(set(product_ids)) != len(product_ids):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Hai duplicato lo stesso prodotto nella chiusura.",
        )
    products = {
        p.id: p for p in session.scalars(
            select(Product).where(Product.id.in_(product_ids))
        )
    }
    missing = [pid for pid in product_ids if pid not in products]
    if missing:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Prodotti non trovati: {missing}",
        )
    inactive = [pid for pid, p in products.items() if not p.active]
    if inactive:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Prodotti disattivati nella chiusura: {inactive}",
        )

    # 2) Replace existing items on the close (CASCADE-safe; same close.id)
    session.execute(
        EveningCloseItem.__table__
        .delete()
        .where(EveningCloseItem.evening_close_id == close.id)
    )

    # 3) Compute fresh qty_actual and emit diffs
    qty_map = _qty_totals(session, product_ids)
    reason = f"Chiusura serale {close_date.isoformat()}"
    warnings: list[str] = []
    movements_count = 0

    for item in payload.items:
        current = Decimal(qty_map.get(item.product_id, Decimal("0")))
        target = Decimal(item.qty_remaining)
        delta = current - target  # positive = sold; negative = unexpected increase
        if delta > 0:
            try:
                ms = apply_movement(
                    session,
                    product_id=item.product_id,
                    qty_needed=delta,
                    mtype=MovementType.sale,
                    reason=reason,
                    user_id=user_id,
                )
            except InsufficientStockError as exc:
                # Shouldn't normally happen: current was just summed; but
                # if it does, surface it cleanly.
                raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
            movements_count += len(ms)
        elif delta < 0:
            increase = -delta
            mv = _apply_increase_to_newest_batch(
                session,
                product_id=item.product_id,
                delta=increase,
                reason=reason,
                user_id=user_id,
            )
            if mv is None:
                warnings.append(
                    f"{products[item.product_id].name}: aumento di {increase} "
                    f"{products[item.product_id].unit} non tracciato (nessun lotto). "
                    f"Carica un lotto e fai una rettifica manuale."
                )
            else:
                movements_count += 1

        # Always store the EveningCloseItem with the user's count
        session.add(EveningCloseItem(
            evening_close_id=close.id,
            product_id=item.product_id,
            qty_remaining=target,
        ))

    return movements_count, warnings


# ----------------------------------------------------------------------
# Endpoints
# ----------------------------------------------------------------------


@router.get("/today", response_model=EveningCloseDetail)
def get_today(
    session: Session = Depends(get_session),
    _user: User = Depends(get_current_user),
) -> EveningCloseDetail:
    today = date_type.today()
    close = session.scalar(
        select(EveningClose).where(EveningClose.date == today)
    )
    if close is not None:
        return EveningCloseDetail(
            close=_close_to_out(session, close),
            items=_items_for_existing(session, close),
        )
    return EveningCloseDetail(
        close=None,
        items=_items_for_today(session, None),
    )


@router.get("/history", response_model=list[EveningCloseOut])
def list_history(
    session: Session = Depends(get_session),
    _user: User = Depends(require_manager_or_admin),
) -> list[EveningCloseOut]:
    closes = list(session.scalars(
        select(EveningClose).order_by(EveningClose.date.desc()).limit(60)
    ))
    return [_close_to_out(session, c) for c in closes]


@router.get("/{close_id}", response_model=EveningCloseDetail)
def get_detail(
    close_id: int,
    session: Session = Depends(get_session),
    _user: User = Depends(get_current_user),
) -> EveningCloseDetail:
    close = session.get(EveningClose, close_id)
    if close is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Chiusura non trovata.")
    return EveningCloseDetail(
        close=_close_to_out(session, close),
        items=_items_for_existing(session, close),
    )


@router.post(
    "",
    response_model=EveningCloseSaveResult,
    status_code=status.HTTP_201_CREATED,
)
def create_today(
    payload: EveningCloseSavePayload,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
) -> EveningCloseSaveResult:
    today = date_type.today()
    # Pre-check (the unique constraint backstops this too)
    existing = session.scalar(select(EveningClose).where(EveningClose.date == today))
    if existing is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Chiusura di oggi già esistente. Modifica quella tramite PATCH /evening-close/{id}.",
        )
    close = EveningClose(date=today, user_id=user.id, notes=payload.notes)
    session.add(close)
    try:
        session.flush()
    except IntegrityError as exc:
        session.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Chiusura di oggi già esistente.",
        ) from exc

    movements_count, warnings = _save_diffs(
        session,
        close=close,
        payload=payload,
        user_id=user.id,
        close_date=today,
    )
    session.commit()
    session.refresh(close)
    logger.info(
        "EveningClose creata id=%d date=%s items=%d movements=%d by user_id=%d",
        close.id, close.date, len(payload.items), movements_count, user.id,
    )
    return EveningCloseSaveResult(
        close=_close_to_out(session, close),
        items=_items_for_existing(session, close),
        movements_created=movements_count,
        warnings=warnings,
    )


@router.patch("/{close_id}", response_model=EveningCloseSaveResult)
def update_close(
    close_id: int,
    payload: EveningCloseSavePayload,
    session: Session = Depends(get_session),
    user: User = Depends(require_manager_or_admin),
) -> EveningCloseSaveResult:
    close = session.get(EveningClose, close_id)
    if close is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Chiusura non trovata.")
    if payload.notes is not None:
        close.notes = payload.notes

    movements_count, warnings = _save_diffs(
        session,
        close=close,
        payload=payload,
        user_id=user.id,
        close_date=close.date,
    )
    session.commit()
    session.refresh(close)
    logger.info(
        "EveningClose aggiornata id=%d date=%s items=%d movements=%d by user_id=%d",
        close.id, close.date, len(payload.items), movements_count, user.id,
    )
    return EveningCloseSaveResult(
        close=_close_to_out(session, close),
        items=_items_for_existing(session, close),
        movements_created=movements_count,
        warnings=warnings,
    )
