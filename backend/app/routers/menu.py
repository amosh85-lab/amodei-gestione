"""CRUD endpoints for combined dishes (menu items composed of products)."""
from __future__ import annotations

import logging
from collections import defaultdict
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_session
from app.dependencies.auth import (
    get_current_user,
    require_admin,
    require_manager_or_admin,
)
from app.models.inventory import Batch, Product
from app.models.menu import CombinedDish, CombinedDishComponent
from app.models.users import User
from app.schemas.menu import (
    CombinedDishCreate,
    CombinedDishOut,
    CombinedDishUpdate,
    ComponentIn,
    ComponentOut,
)

router = APIRouter(prefix="/menu", tags=["menu"])
logger = logging.getLogger("amodei.menu")


# ----------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------


def _validate_components(session: Session, comps: list[ComponentIn]) -> None:
    """Ensure every product_id exists and is active. Raises 400 otherwise."""
    if not comps:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Almeno un componente è richiesto.")
    ids = [c.product_id for c in comps]
    found = session.execute(
        select(Product.id, Product.active).where(Product.id.in_(ids))
    ).all()
    found_map = {pid: active for pid, active in found}
    missing = [pid for pid in ids if pid not in found_map]
    if missing:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Prodotti inesistenti nei componenti: {missing}",
        )
    inactive = [pid for pid in ids if not found_map[pid]]
    if inactive:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Componenti che fanno riferimento a prodotti disattivati: {inactive}",
        )


def _hydrate_dishes(session: Session, dishes: list[CombinedDish]) -> list[CombinedDishOut]:
    """Bulk-load components + per-product stock totals; build full output objects.

    Single round-trip per side table (components and aggregated batches),
    independent of how many dishes are in the result set.
    """
    if not dishes:
        return []
    dish_ids = [d.id for d in dishes]

    # Components + the joined product info needed for both UI display and
    # the cost calculation.
    comp_rows = session.execute(
        select(
            CombinedDishComponent,
            Product.name,
            Product.unit,
            Product.last_purchase_price,
        )
        .join(Product, Product.id == CombinedDishComponent.product_id)
        .where(CombinedDishComponent.combined_dish_id.in_(dish_ids))
        .order_by(CombinedDishComponent.combined_dish_id, CombinedDishComponent.id)
    ).all()

    comps_by_dish: dict[int, list[tuple[CombinedDishComponent, str, str, Decimal | None]]] = defaultdict(list)
    product_ids: set[int] = set()
    for c, name, unit, price in comp_rows:
        comps_by_dish[c.combined_dish_id].append((c, name, unit, price))
        product_ids.add(c.product_id)

    # Aggregated in-stock qty per product across all batches (single query).
    qty_map: dict[int, Decimal] = {pid: Decimal("0") for pid in product_ids}
    if product_ids:
        rows = session.execute(
            select(Batch.product_id, func.coalesce(func.sum(Batch.current_qty), 0))
            .where(Batch.product_id.in_(product_ids))
            .group_by(Batch.product_id)
        ).all()
        for pid, total in rows:
            qty_map[pid] = Decimal(total or 0)

    results: list[CombinedDishOut] = []
    for dish in dishes:
        component_outs: list[ComponentOut] = []
        cost = Decimal("0")
        cost_known = True
        available = True
        for comp, prod_name, prod_unit, last_price in comps_by_dish.get(dish.id, []):
            avail_qty = qty_map.get(comp.product_id, Decimal("0"))
            if avail_qty < comp.qty:
                available = False
            if last_price is None:
                cost_known = False
            else:
                cost += comp.qty * Decimal(last_price)
            component_outs.append(
                ComponentOut(
                    id=comp.id,
                    product_id=comp.product_id,
                    qty=comp.qty,
                    product_name=prod_name,
                    product_unit=prod_unit,
                    last_purchase_price=last_price,
                    available_qty=avail_qty,
                )
            )
        # A dish without components is structurally "unavailable".
        if not component_outs:
            available = False

        if cost_known and component_outs:
            cost_final: Decimal | None = cost
            margin: Decimal | None = dish.sale_price - cost
            margin_pct: Decimal | None = (
                (margin / dish.sale_price * Decimal("100"))
                if dish.sale_price and dish.sale_price > 0 else None
            )
        else:
            cost_final = None
            margin = None
            margin_pct = None

        out = CombinedDishOut.model_validate(dish)
        out.components = component_outs
        out.available = available
        out.cost = cost_final
        out.margin = margin
        out.margin_percent = margin_pct
        results.append(out)
    return results


def _replace_components(
    session: Session, dish: CombinedDish, comps: list[ComponentIn]
) -> None:
    """Delete the dish's current components and replace them with ``comps``.
    Caller is responsible for committing the transaction.
    """
    session.execute(
        CombinedDishComponent.__table__
        .delete()
        .where(CombinedDishComponent.combined_dish_id == dish.id)
    )
    for c in comps:
        session.add(
            CombinedDishComponent(
                combined_dish_id=dish.id,
                product_id=c.product_id,
                qty=c.qty,
            )
        )


# ----------------------------------------------------------------------
# GET /menu/combined — list
# ----------------------------------------------------------------------
@router.get("/combined", response_model=list[CombinedDishOut])
def list_combined(
    include_inactive: bool = Query(False),
    session: Session = Depends(get_session),
    _user: User = Depends(get_current_user),
) -> list[CombinedDishOut]:
    stmt = select(CombinedDish)
    if not include_inactive:
        stmt = stmt.where(CombinedDish.active.is_(True))
    stmt = stmt.order_by(func.lower(CombinedDish.name).asc())
    dishes = list(session.scalars(stmt))
    return _hydrate_dishes(session, dishes)


# ----------------------------------------------------------------------
# POST /menu/combined — create
# ----------------------------------------------------------------------
@router.post(
    "/combined",
    response_model=CombinedDishOut,
    status_code=status.HTTP_201_CREATED,
)
def create_combined(
    payload: CombinedDishCreate,
    session: Session = Depends(get_session),
    user: User = Depends(require_manager_or_admin),
) -> CombinedDishOut:
    _validate_components(session, payload.components)
    dish = CombinedDish(name=payload.name, sale_price=payload.sale_price, active=True)
    session.add(dish)
    session.flush()  # need dish.id
    for c in payload.components:
        session.add(
            CombinedDishComponent(
                combined_dish_id=dish.id, product_id=c.product_id, qty=c.qty
            )
        )
    session.commit()
    session.refresh(dish)
    logger.info(
        "CombinedDish creato id=%d name=%r components=%d by user_id=%d",
        dish.id, dish.name, len(payload.components), user.id,
    )
    return _hydrate_dishes(session, [dish])[0]


# ----------------------------------------------------------------------
# GET /menu/combined/{id} — detail
# ----------------------------------------------------------------------
@router.get("/combined/{dish_id}", response_model=CombinedDishOut)
def get_combined(
    dish_id: int,
    session: Session = Depends(get_session),
    _user: User = Depends(get_current_user),
) -> CombinedDishOut:
    dish = session.get(CombinedDish, dish_id)
    if dish is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Piatto combinato non trovato.")
    return _hydrate_dishes(session, [dish])[0]


# ----------------------------------------------------------------------
# PATCH /menu/combined/{id} — partial update
# ----------------------------------------------------------------------
@router.patch("/combined/{dish_id}", response_model=CombinedDishOut)
def update_combined(
    dish_id: int,
    payload: CombinedDishUpdate,
    session: Session = Depends(get_session),
    user: User = Depends(require_manager_or_admin),
) -> CombinedDishOut:
    dish = session.get(CombinedDish, dish_id)
    if dish is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Piatto combinato non trovato.")

    changes = payload.model_dump(exclude_unset=True)
    components_payload = changes.pop("components", None)
    for key, value in changes.items():
        setattr(dish, key, value)

    if components_payload is not None:
        # Re-validate the replacement components, then swap atomically.
        comps = [ComponentIn(**c) for c in components_payload]
        _validate_components(session, comps)
        _replace_components(session, dish, comps)

    session.commit()
    session.refresh(dish)
    logger.info(
        "CombinedDish aggiornato id=%d fields=%s components=%s by user_id=%d",
        dish.id,
        list(changes),
        "replaced" if components_payload is not None else "unchanged",
        user.id,
    )
    return _hydrate_dishes(session, [dish])[0]


# ----------------------------------------------------------------------
# DELETE /menu/combined/{id} — soft delete (admin)
# ----------------------------------------------------------------------
@router.delete(
    "/combined/{dish_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
)
def delete_combined(
    dish_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(require_admin),
) -> None:
    dish = session.get(CombinedDish, dish_id)
    if dish is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Piatto combinato non trovato.")
    if dish.active is False:
        return  # Idempotent
    dish.active = False
    session.commit()
    logger.info("CombinedDish soft-deleted id=%d by user_id=%d", dish.id, user.id)
