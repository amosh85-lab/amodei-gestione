"""Cost computation for staff meals — pure read-side helper."""
from __future__ import annotations

from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.inventory import Batch, Movement, MovementSource


def calculate_meal_cost(session: Session, staff_meal_id: int) -> Decimal:
    """Return the total cost of a staff meal as the sum of
    ``qty × purchase_price_unit`` for every Movement linked back to the
    meal via ``source_type='staff_meal'`` and ``source_id=staff_meal_id``.

    Cancellation creates positive counter-movements with ``source_type=NULL``,
    so they're naturally excluded and the cost reported here is the
    *originally consumed* value — useful for "money already spent" reporting.
    """
    rows = session.execute(
        select(Movement.qty, Batch.purchase_price_unit)
        .join(Batch, Batch.id == Movement.batch_id)
        .where(
            Movement.source_type == MovementSource.staff_meal,
            Movement.source_id == staff_meal_id,
        )
    ).all()
    total = Decimal("0")
    for qty, price in rows:
        total += Decimal(qty) * Decimal(price)
    return total


def calculate_meal_costs_bulk(
    session: Session, staff_meal_ids: list[int]
) -> dict[int, Decimal]:
    """Same as :func:`calculate_meal_cost` but for many meals at once.

    Returns a dict ``{meal_id: cost}``; missing keys mean zero cost.
    Used by the list and stats endpoints to avoid N+1.
    """
    if not staff_meal_ids:
        return {}
    rows = session.execute(
        select(Movement.source_id, Movement.qty, Batch.purchase_price_unit)
        .join(Batch, Batch.id == Movement.batch_id)
        .where(
            Movement.source_type == MovementSource.staff_meal,
            Movement.source_id.in_(staff_meal_ids),
        )
    ).all()
    out: dict[int, Decimal] = {mid: Decimal("0") for mid in staff_meal_ids}
    for source_id, qty, price in rows:
        out[source_id] = out.get(source_id, Decimal("0")) + Decimal(qty) * Decimal(price)
    return out
