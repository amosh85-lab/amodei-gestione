"""Inventory operations: FIFO stock consumption.

The session is borrowed from the caller (router); we do NOT commit here —
that's the router's job — but every write happens inside the same
SQLAlchemy transaction so a mid-loop failure rolls everything back.
"""
from __future__ import annotations

import logging
from decimal import Decimal
from typing import Iterable

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.inventory import Batch, Movement, MovementSource, MovementType

logger = logging.getLogger("amodei.inventory")


class InsufficientStockError(ValueError):
    """Raised when ``qty_needed`` exceeds the sum of in-stock batches."""


def get_fifo_batches(
    session: Session, product_id: int, qty_needed: Decimal
) -> list[tuple[Batch, Decimal]]:
    """Return the list of ``(batch, qty_to_take)`` that would satisfy
    ``qty_needed`` following FIFO (earliest expiry → oldest load → lowest id).

    Pure read; doesn't mutate anything. Useful for previews / UI.
    """
    if qty_needed <= 0:
        return []
    batches = _fetch_fifo_candidates(session, product_id)
    return _allocate(batches, qty_needed)


def apply_movement(
    session: Session,
    *,
    product_id: int,
    qty_needed: Decimal,
    mtype: MovementType,
    reason: str | None,
    user_id: int,
    source_type: MovementSource | None = None,
    source_id: int | None = None,
) -> list[Movement]:
    """Consume ``qty_needed`` of ``product_id`` via FIFO, recording one
    :class:`Movement` per batch touched and decrementing ``current_qty``.

    If ``source_type``/``source_id`` are provided they're stamped on every
    movement created — used by feature routers (staff_meals, evening_close,
    …) to find their own movements back later for cancellation/reporting.

    Raises :class:`InsufficientStockError` (a ValueError subclass) if total
    in-stock qty is less than ``qty_needed`` — the caller should map this
    to HTTP 400.
    """
    if qty_needed <= 0:
        raise ValueError("La quantità deve essere positiva.")

    batches = _fetch_fifo_candidates(session, product_id)
    available = sum((b.current_qty for b in batches), start=Decimal(0))
    if qty_needed > available:
        raise InsufficientStockError(
            f"Scorta insufficiente: richiesti {qty_needed}, disponibili {available}."
        )

    allocation = _allocate(batches, qty_needed)
    movements: list[Movement] = []
    for batch, take in allocation:
        movement = Movement(
            batch_id=batch.id,
            product_id=product_id,
            type=mtype,
            qty=take,
            reason=reason,
            user_id=user_id,
            source_type=source_type,
            source_id=source_id,
        )
        session.add(movement)
        batch.current_qty = batch.current_qty - take
        movements.append(movement)
    logger.info(
        "Movement(type=%s) applied: product_id=%d total=%s across %d batch(es)",
        mtype.value, product_id, qty_needed, len(movements),
    )
    return movements


# ----------------------------------------------------------------------
# Helpers (internal)
# ----------------------------------------------------------------------


def _fetch_fifo_candidates(session: Session, product_id: int) -> list[Batch]:
    stmt = (
        select(Batch)
        .where(Batch.product_id == product_id, Batch.current_qty > 0)
        .order_by(
            Batch.expiry_date.asc().nulls_last(),
            Batch.load_date.asc(),
            Batch.id.asc(),
        )
    )
    return list(session.scalars(stmt))


def _allocate(
    batches: Iterable[Batch], qty_needed: Decimal
) -> list[tuple[Batch, Decimal]]:
    remaining = qty_needed
    out: list[tuple[Batch, Decimal]] = []
    for batch in batches:
        if remaining <= 0:
            break
        take = batch.current_qty if batch.current_qty <= remaining else remaining
        if take > 0:
            out.append((batch, take))
            remaining -= take
    return out
