"""Staff meals: track team consumption, drive FIFO movements, monthly stats."""
from __future__ import annotations

import calendar
import logging
from collections import defaultdict
from datetime import date as date_type, datetime, time, timezone
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, exists, func, select
from sqlalchemy.orm import Session

from app.database import get_session
from app.dependencies.auth import (
    get_current_user,
    require_admin,
    require_manager_or_admin,
)
from app.models.inventory import Batch, Movement, MovementSource, MovementType, Product
from app.models.staff_meals import StaffMeal, StaffMealItem, StaffMealParticipant
from app.models.users import User, UserRole
from app.schemas.staff_meals import (
    MonthlyByDay,
    MonthlyByProduct,
    MonthlyByUser,
    MonthlyStatsOut,
    StaffMealCreate,
    StaffMealItemOut,
    StaffMealOut,
)
from app.schemas.users import UserMini
from app.services.inventory import (
    InsufficientStockError,
    apply_movement,
)
from app.services.staff_meals import calculate_meal_costs_bulk

router = APIRouter(prefix="/staff-meals", tags=["staff-meals"])
logger = logging.getLogger("amodei.staff_meals")


# ----------------------------------------------------------------------
# Hydration helpers
# ----------------------------------------------------------------------


def _hydrate_meals(
    session: Session, meals: list[StaffMeal]
) -> list[StaffMealOut]:
    """Build StaffMealOut for many meals in one round-trip (no N+1)."""
    if not meals:
        return []
    meal_ids = [m.id for m in meals]

    # Participants
    parts_rows = session.execute(
        select(StaffMealParticipant.staff_meal_id, User)
        .join(User, User.id == StaffMealParticipant.user_id)
        .where(StaffMealParticipant.staff_meal_id.in_(meal_ids))
        .order_by(User.full_name.asc())
    ).all()
    parts_map: dict[int, list[User]] = defaultdict(list)
    for meal_id, user in parts_rows:
        parts_map[meal_id].append(user)

    # Items with product info
    items_rows = session.execute(
        select(StaffMealItem, Product.name, Product.unit)
        .join(Product, Product.id == StaffMealItem.product_id)
        .where(StaffMealItem.staff_meal_id.in_(meal_ids))
        .order_by(StaffMealItem.id.asc())
    ).all()
    items_map: dict[int, list[tuple[StaffMealItem, str, str]]] = defaultdict(list)
    for item, prod_name, prod_unit in items_rows:
        items_map[item.staff_meal_id].append((item, prod_name, prod_unit))

    # Per-meal cost (sum across movements with source=staff_meal, type=staff_meal)
    cost_map = calculate_meal_costs_bulk(session, meal_ids)

    # Per-item cost: same SUM but grouped by product_id within each meal
    item_cost_rows = session.execute(
        select(
            Movement.source_id, Movement.product_id,
            func.sum(Movement.qty * Batch.purchase_price_unit)
        )
        .join(Batch, Batch.id == Movement.batch_id)
        .where(
            Movement.source_type == MovementSource.staff_meal,
            Movement.source_id.in_(meal_ids),
            Movement.type == MovementType.staff_meal,
        )
        .group_by(Movement.source_id, Movement.product_id)
    ).all()
    item_cost_map: dict[tuple[int, int], Decimal] = {
        (mid, pid): Decimal(total or 0) for mid, pid, total in item_cost_rows
    }

    # Creators
    creator_ids = {m.created_by_user_id for m in meals}
    creator_names = {
        uid: name for uid, name in session.execute(
            select(User.id, User.full_name).where(User.id.in_(creator_ids))
        )
    }

    results: list[StaffMealOut] = []
    for m in meals:
        items_out: list[StaffMealItemOut] = []
        for item, prod_name, prod_unit in items_map.get(m.id, []):
            cost = item_cost_map.get((m.id, item.product_id), Decimal("0"))
            items_out.append(StaffMealItemOut(
                id=item.id,
                product_id=item.product_id,
                product_name=prod_name,
                product_unit=prod_unit,
                qty=item.qty,
                cost_total=cost,
            ))
        out = StaffMealOut.model_validate(m)
        out.created_by_name = creator_names.get(m.created_by_user_id)
        out.participants = [UserMini.model_validate(u) for u in parts_map.get(m.id, [])]
        out.items = items_out
        out.cost_total = cost_map.get(m.id, Decimal("0"))
        results.append(out)
    return results


def _user_can_view(meal: StaffMeal, current: User) -> bool:
    """Staff can only view their own meals; everyone else sees everything."""
    if current.role != UserRole.staff:
        return True
    # Need participant check — small query.
    return False  # caller should check via dedicated query


def _is_participant(session: Session, meal_id: int, user_id: int) -> bool:
    return session.scalar(
        select(exists().where(
            StaffMealParticipant.staff_meal_id == meal_id,
            StaffMealParticipant.user_id == user_id,
        ))
    ) or False


# ----------------------------------------------------------------------
# POST /staff-meals  — any auth (with staff = self-only restriction)
# ----------------------------------------------------------------------
@router.post(
    "",
    response_model=StaffMealOut,
    status_code=status.HTTP_201_CREATED,
)
def create_staff_meal(
    payload: StaffMealCreate,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
) -> StaffMealOut:
    # ---- role check ----
    if user.role == UserRole.staff:
        if (
            len(payload.participant_user_ids) != 1
            or payload.participant_user_ids[0] != user.id
        ):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "Lo staff può registrare un pasto solo per sé stesso. "
                "Chiedi a un manager per pasti di gruppo.",
            )

    # ---- validate participants ----
    if len(set(payload.participant_user_ids)) != len(payload.participant_user_ids):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Lo stesso utente compare due volte tra i partecipanti.",
        )
    users_found = {
        u.id: u for u in session.scalars(
            select(User).where(User.id.in_(payload.participant_user_ids))
        )
    }
    missing_users = [uid for uid in payload.participant_user_ids if uid not in users_found]
    if missing_users:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Utenti non trovati: {missing_users}",
        )
    inactive_users = [uid for uid, u in users_found.items() if not u.active]
    if inactive_users:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Utenti disattivati: {inactive_users}",
        )

    # ---- validate products ----
    product_ids = [it.product_id for it in payload.items]
    if len(set(product_ids)) != len(product_ids):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Lo stesso prodotto compare due volte tra gli item.",
        )
    products = {
        p.id: p for p in session.scalars(
            select(Product).where(Product.id.in_(product_ids))
        )
    }
    missing_products = [pid for pid in product_ids if pid not in products]
    if missing_products:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Prodotti non trovati: {missing_products}",
        )

    meal_date = payload.date or date_type.today()
    meal = StaffMeal(
        date=meal_date,
        service=payload.service,
        notes=payload.notes,
        created_by_user_id=user.id,
    )
    session.add(meal)
    session.flush()  # need meal.id for the source_id

    for uid in payload.participant_user_ids:
        session.add(StaffMealParticipant(staff_meal_id=meal.id, user_id=uid))

    reason = f"Pasto staff {meal_date.isoformat()} {payload.service}"
    for it in payload.items:
        try:
            apply_movement(
                session,
                product_id=it.product_id,
                qty_needed=it.qty,
                mtype=MovementType.staff_meal,
                reason=reason,
                user_id=user.id,
                source_type=MovementSource.staff_meal,
                source_id=meal.id,
            )
        except InsufficientStockError as exc:
            session.rollback()
            raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
        session.add(StaffMealItem(
            staff_meal_id=meal.id,
            product_id=it.product_id,
            qty=it.qty,
        ))

    session.commit()
    session.refresh(meal)
    logger.info(
        "StaffMeal creato id=%d date=%s service=%s participants=%d items=%d by user_id=%d",
        meal.id, meal.date, payload.service, len(payload.participant_user_ids),
        len(payload.items), user.id,
    )
    return _hydrate_meals(session, [meal])[0]


# ----------------------------------------------------------------------
# GET /staff-meals  — list with filters (staff: self only)
# ----------------------------------------------------------------------
@router.get("", response_model=list[StaffMealOut])
def list_staff_meals(
    from_date: date_type | None = Query(None, alias="from"),
    to_date: date_type | None = Query(None, alias="to"),
    user_id: int | None = Query(None),
    service: Literal["lunch", "dinner"] | None = Query(None),
    include_cancelled: bool = Query(False),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    session: Session = Depends(get_session),
    current: User = Depends(get_current_user),
) -> list[StaffMealOut]:
    stmt = select(StaffMeal)
    if from_date is not None:
        stmt = stmt.where(StaffMeal.date >= from_date)
    if to_date is not None:
        stmt = stmt.where(StaffMeal.date <= to_date)
    if service is not None:
        stmt = stmt.where(StaffMeal.service == service)
    if not include_cancelled:
        stmt = stmt.where(StaffMeal.cancelled_at.is_(None))

    # Staff: force-filter to meals where they are a participant. user_id
    # param is ignored for staff (they only ever see themselves).
    if current.role == UserRole.staff:
        stmt = stmt.where(
            StaffMeal.id.in_(
                select(StaffMealParticipant.staff_meal_id)
                .where(StaffMealParticipant.user_id == current.id)
            )
        )
    elif user_id is not None:
        stmt = stmt.where(
            StaffMeal.id.in_(
                select(StaffMealParticipant.staff_meal_id)
                .where(StaffMealParticipant.user_id == user_id)
            )
        )

    stmt = (
        stmt.order_by(StaffMeal.date.desc(), StaffMeal.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    meals = list(session.scalars(stmt))
    return _hydrate_meals(session, meals)


# ----------------------------------------------------------------------
# GET /staff-meals/stats/monthly  — manager/admin
# ----------------------------------------------------------------------
@router.get("/stats/monthly", response_model=MonthlyStatsOut)
def stats_monthly(
    year: int | None = Query(None, ge=2020, le=2100),
    month: int | None = Query(None, ge=1, le=12),
    session: Session = Depends(get_session),
    _user: User = Depends(require_manager_or_admin),
) -> MonthlyStatsOut:
    today = date_type.today()
    y = year or today.year
    m = month or today.month
    first_day = date_type(y, m, 1)
    last_day = date_type(y, m, calendar.monthrange(y, m)[1])

    # All non-cancelled meals in the month
    meals = list(session.scalars(
        select(StaffMeal).where(
            StaffMeal.date >= first_day,
            StaffMeal.date <= last_day,
            StaffMeal.cancelled_at.is_(None),
        )
    ))
    meal_ids = [m.id for m in meals]
    total_meals = len(meals)

    # Per-meal costs
    cost_map = calculate_meal_costs_bulk(session, meal_ids)
    total_cost = sum(cost_map.values(), Decimal("0"))
    avg_cost = (total_cost / total_meals) if total_meals else Decimal("0")

    # Participants by meal (for splitting cost across users)
    parts_rows = session.execute(
        select(StaffMealParticipant.staff_meal_id, StaffMealParticipant.user_id)
        .where(StaffMealParticipant.staff_meal_id.in_(meal_ids))
    ).all()
    parts_by_meal: dict[int, list[int]] = defaultdict(list)
    for mid, uid in parts_rows:
        parts_by_meal[mid].append(uid)

    by_user_count: dict[int, int] = defaultdict(int)
    by_user_cost: dict[int, Decimal] = defaultdict(lambda: Decimal("0"))
    for meal in meals:
        users_in = parts_by_meal.get(meal.id, [])
        if not users_in:
            continue
        per_share = cost_map.get(meal.id, Decimal("0")) / len(users_in)
        for uid in users_in:
            by_user_count[uid] += 1
            by_user_cost[uid] += per_share

    user_ids = list({uid for uids in parts_by_meal.values() for uid in uids})
    users_map = {
        u.id: u for u in session.scalars(
            select(User).where(User.id.in_(user_ids))
        )
    } if user_ids else {}
    by_user = sorted(
        (
            MonthlyByUser(
                user=UserMini.model_validate(users_map[uid]),
                meal_count=by_user_count[uid],
                cost_total=by_user_cost[uid],
            )
            for uid in user_ids if uid in users_map
        ),
        key=lambda x: x.cost_total,
        reverse=True,
    )

    # Per-product aggregation
    prod_rows = session.execute(
        select(
            Movement.product_id,
            Product.name,
            Product.unit,
            func.sum(Movement.qty),
            func.sum(Movement.qty * Batch.purchase_price_unit),
        )
        .join(Batch, Batch.id == Movement.batch_id)
        .join(Product, Product.id == Movement.product_id)
        .where(
            Movement.source_type == MovementSource.staff_meal,
            Movement.source_id.in_(meal_ids),
            Movement.type == MovementType.staff_meal,
        )
        .group_by(Movement.product_id, Product.name, Product.unit)
        .order_by(func.sum(Movement.qty * Batch.purchase_price_unit).desc())
        .limit(20)
    ).all()
    by_product = [
        MonthlyByProduct(
            product_id=pid, product_name=pname, product_unit=punit,
            qty_total=Decimal(qty or 0), cost_total=Decimal(cost or 0),
        )
        for pid, pname, punit, qty, cost in prod_rows
    ]

    # Per-day aggregation
    by_day_count: dict[date_type, int] = defaultdict(int)
    by_day_cost: dict[date_type, Decimal] = defaultdict(lambda: Decimal("0"))
    for meal in meals:
        by_day_count[meal.date] += 1
        by_day_cost[meal.date] += cost_map.get(meal.id, Decimal("0"))
    by_day = [
        MonthlyByDay(date=d, meal_count=by_day_count[d], cost_total=by_day_cost[d])
        for d in sorted(by_day_count.keys())
    ]

    return MonthlyStatsOut(
        year=y, month=m,
        total_meals=total_meals,
        total_cost=total_cost,
        avg_cost_per_meal=avg_cost,
        by_user=by_user,
        by_product=by_product,
        by_day=by_day,
    )


# ----------------------------------------------------------------------
# GET /staff-meals/{id}  — detail (staff: only if participant)
# ----------------------------------------------------------------------
@router.get("/{meal_id}", response_model=StaffMealOut)
def get_staff_meal(
    meal_id: int,
    session: Session = Depends(get_session),
    current: User = Depends(get_current_user),
) -> StaffMealOut:
    meal = session.get(StaffMeal, meal_id)
    if meal is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pasto non trovato.")
    if current.role == UserRole.staff and not _is_participant(session, meal_id, current.id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Non sei tra i partecipanti.")
    return _hydrate_meals(session, [meal])[0]


# ----------------------------------------------------------------------
# DELETE /staff-meals/{id}  — admin only, restores stock via counter-movements
# ----------------------------------------------------------------------
@router.delete("/{meal_id}", response_model=StaffMealOut)
def cancel_staff_meal(
    meal_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(require_admin),
) -> StaffMealOut:
    meal = session.get(StaffMeal, meal_id)
    if meal is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pasto non trovato.")
    if meal.cancelled_at is not None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Pasto già annullato il {meal.cancelled_at.isoformat()}.",
        )

    # Pull every consumption movement linked to this meal.
    rows = session.execute(
        select(Movement, Batch)
        .join(Batch, Batch.id == Movement.batch_id)
        .where(
            Movement.source_type == MovementSource.staff_meal,
            Movement.source_id == meal_id,
            Movement.type == MovementType.staff_meal,
        )
    ).all()

    reason = f"Annullamento pasto staff #{meal_id}"
    for orig_mov, batch in rows:
        batch.current_qty = Decimal(batch.current_qty) + Decimal(orig_mov.qty)
        session.add(Movement(
            batch_id=batch.id,
            product_id=orig_mov.product_id,
            type=MovementType.adjustment,
            qty=Decimal(orig_mov.qty),  # positive — restoring stock
            reason=reason,
            user_id=user.id,
            source_type=MovementSource.staff_meal,
            source_id=meal_id,
        ))

    meal.cancelled_at = datetime.now(timezone.utc)
    meal.cancelled_by_user_id = user.id
    session.commit()
    session.refresh(meal)
    logger.info(
        "StaffMeal cancellato id=%d by user_id=%d (%d counter-movements)",
        meal_id, user.id, len(rows),
    )
    return _hydrate_meals(session, [meal])[0]
