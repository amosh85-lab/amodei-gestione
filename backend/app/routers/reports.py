"""/reports router: waste analytics + margin analysis + staff-meal summary.

All aggregates filter on Movement.created_at within [from, to] inclusive.
- /waste explicitly EXCLUDES staff_meal (it's a separate concept, not waste).
- /margins also excludes staff_meal (those are consumed, not sold).
- /staff-meals-summary aggregates only staff_meal movements.
"""
from __future__ import annotations

import logging
from datetime import date as date_type, datetime, time, timedelta
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session

from app.database import get_session
from app.dependencies.auth import require_manager_or_admin
from app.models.inventory import Batch, Movement, MovementType, Product
from app.models.users import User
from app.schemas.reports import (
    MarginRow,
    MarginsReportOut,
    StaffMealsByMonth,
    StaffMealsByProduct,
    StaffMealsSummaryOut,
    WasteByMonth,
    WasteByProduct,
    WasteByReason,
    WasteReportOut,
)

router = APIRouter(prefix="/reports", tags=["reports"])
logger = logging.getLogger("amodei.reports")

ZERO = Decimal("0")


def _q(value: Decimal | int | float | None) -> Decimal:
    if value is None:
        return ZERO
    if not isinstance(value, Decimal):
        value = Decimal(str(value))
    return value.quantize(Decimal("0.01"))


def _date_window(from_date: date_type, to_date: date_type):
    """Return (start_dt_inclusive, end_dt_exclusive) for created_at filtering."""
    if to_date < from_date:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "from non può essere successiva a to.")
    return (
        datetime.combine(from_date, time.min),
        datetime.combine(to_date + timedelta(days=1), time.min),
    )


# ----------------------------------------------------------------------
# /waste


@router.get("/waste", response_model=WasteReportOut)
def waste_report(
    from_date: date_type = Query(alias="from"),
    to_date: date_type = Query(alias="to"),
    category: str | None = Query(default=None),
    product_id: int | None = Query(default=None),
    session: Session = Depends(get_session),
    _user: User = Depends(require_manager_or_admin),
) -> WasteReportOut:
    start, end = _date_window(from_date, to_date)

    waste_types = (MovementType.waste_expiry, MovementType.waste_other)

    base_filters = [
        Movement.type.in_(waste_types),
        Movement.created_at >= start,
        Movement.created_at < end,
    ]
    if product_id is not None:
        base_filters.append(Movement.product_id == product_id)
    if category is not None:
        base_filters.append(Product.category == category)

    # Join once for all aggregations
    base = (
        select(
            Movement.id.label("movement_id"),
            Movement.product_id.label("product_id"),
            Movement.type.label("type"),
            Movement.qty.label("qty"),
            Movement.created_at.label("created_at"),
            Batch.purchase_price_unit.label("ppu"),
            Product.category.label("category"),
        )
        .join(Batch, Movement.batch_id == Batch.id)
        .join(Product, Movement.product_id == Product.id)
        .where(and_(*base_filters))
    ).subquery()

    # KPI: total value + items count
    kpi = session.execute(
        select(
            func.coalesce(func.sum(base.c.qty * base.c.ppu), 0),
            func.count(base.c.movement_id),
        )
    ).one()
    total_value = _q(kpi[0])
    items_count = int(kpi[1] or 0)

    # By reason
    rows = session.execute(
        select(
            base.c.type,
            func.coalesce(func.sum(base.c.qty * base.c.ppu), 0),
            func.count(base.c.movement_id),
        ).group_by(base.c.type)
    ).all()
    by_reason = [
        WasteByReason(reason=str(r[0].value if hasattr(r[0], "value") else r[0]),
                      value=_q(r[1]), count=int(r[2]))
        for r in rows
    ]

    # By product (top N — return all; the UI can slice)
    prod_rows = session.execute(
        select(
            base.c.product_id,
            func.coalesce(func.sum(base.c.qty * base.c.ppu), 0).label("value_lost"),
            func.coalesce(func.sum(base.c.qty), 0).label("qty_total"),
        )
        .group_by(base.c.product_id)
        .order_by(func.sum(base.c.qty * base.c.ppu).desc())
    ).all()
    products_by_id = {
        p.id: p for p in session.scalars(
            select(Product).where(Product.id.in_([r[0] for r in prod_rows]))
        )
    } if prod_rows else {}
    by_product = []
    for pid, value_lost, qty_total in prod_rows:
        p = products_by_id.get(pid)
        if not p:
            continue
        by_product.append(WasteByProduct(
            product={"id": p.id, "name": p.name, "category": p.category, "unit": p.unit},
            value_lost=_q(value_lost),
            qty=_q(qty_total),
        ))

    # By month — YYYY-MM
    month_rows = session.execute(
        select(
            func.to_char(base.c.created_at, "YYYY-MM").label("month"),
            func.coalesce(func.sum(base.c.qty * base.c.ppu), 0),
        )
        .group_by("month")
        .order_by("month")
    ).all()
    by_month = [WasteByMonth(month=str(m[0]), value_lost=_q(m[1])) for m in month_rows]

    return WasteReportOut(
        total_value_lost=total_value,
        items_count=items_count,
        breakdown_by_reason=by_reason,
        breakdown_by_product=by_product,
        breakdown_by_month=by_month,
    )


# ----------------------------------------------------------------------
# /margins


@router.get("/margins", response_model=MarginsReportOut)
def margins_report(
    from_date: date_type = Query(alias="from"),
    to_date: date_type = Query(alias="to"),
    sort: str = Query(default="margin_pct", regex="^(margin_pct|margin_eur)$"),
    session: Session = Depends(get_session),
    _user: User = Depends(require_manager_or_admin),
) -> MarginsReportOut:
    start, end = _date_window(from_date, to_date)

    # Per-product aggregates:
    #   qty_sold = SUM(Movement.qty WHERE type=sale)
    #   cost     = SUM(Movement.qty × Batch.purchase_price_unit)
    rows = session.execute(
        select(
            Movement.product_id,
            func.coalesce(func.sum(Movement.qty), 0).label("qty_sold"),
            func.coalesce(func.sum(Movement.qty * Batch.purchase_price_unit), 0).label("cost"),
        )
        .join(Batch, Movement.batch_id == Batch.id)
        .where(Movement.type == MovementType.sale)
        .where(Movement.created_at >= start)
        .where(Movement.created_at < end)
        .group_by(Movement.product_id)
    ).all()

    if not rows:
        return MarginsReportOut(rows=[], totals=None)

    products_by_id = {
        p.id: p for p in session.scalars(
            select(Product).where(Product.id.in_([r[0] for r in rows]))
        )
    }

    out: list[MarginRow] = []
    tot_qty = ZERO
    tot_revenue = ZERO
    tot_cost = ZERO
    for product_id, qty_sold, cost in rows:
        p = products_by_id.get(product_id)
        if not p:
            continue
        qty = _q(qty_sold)
        sale_price = _q(p.sale_price) if p.sale_price is not None else ZERO
        revenue = _q(qty * sale_price)
        cost_q = _q(cost)
        margin = _q(revenue - cost_q)
        margin_pct = _q(margin / revenue * 100) if revenue > 0 else None
        out.append(MarginRow(
            product={"id": p.id, "name": p.name, "category": p.category, "unit": p.unit},
            sales_qty=qty,
            sales_revenue=revenue,
            cost=cost_q,
            margin_eur=margin,
            margin_pct=margin_pct,
        ))
        tot_qty += qty
        tot_revenue += revenue
        tot_cost += cost_q

    # Sort
    if sort == "margin_eur":
        out.sort(key=lambda r: r.margin_eur, reverse=True)
    else:
        # margin_pct desc; None last
        out.sort(key=lambda r: (r.margin_pct is None, -(r.margin_pct or Decimal(0))))

    total_margin = _q(tot_revenue - tot_cost)
    totals = MarginRow(
        product={"id": 0, "name": "Totale", "category": None, "unit": ""},
        sales_qty=_q(tot_qty),
        sales_revenue=_q(tot_revenue),
        cost=_q(tot_cost),
        margin_eur=total_margin,
        margin_pct=_q(total_margin / tot_revenue * 100) if tot_revenue > 0 else None,
    )

    return MarginsReportOut(rows=out, totals=totals)


# ----------------------------------------------------------------------
# /staff-meals-summary


@router.get("/staff-meals-summary", response_model=StaffMealsSummaryOut)
def staff_meals_summary(
    from_date: date_type = Query(alias="from"),
    to_date: date_type = Query(alias="to"),
    session: Session = Depends(get_session),
    _user: User = Depends(require_manager_or_admin),
) -> StaffMealsSummaryOut:
    start, end = _date_window(from_date, to_date)

    # Total cost across all staff_meal movements in window
    kpi = session.execute(
        select(
            func.coalesce(func.sum(Movement.qty * Batch.purchase_price_unit), 0),
            func.count(func.distinct(Movement.source_id)),  # distinct StaffMeal rows
        )
        .join(Batch, Movement.batch_id == Batch.id)
        .where(Movement.type == MovementType.staff_meal)
        .where(Movement.created_at >= start)
        .where(Movement.created_at < end)
    ).one()
    total_cost = _q(kpi[0])
    meals_count = int(kpi[1] or 0)

    # By product
    prod_rows = session.execute(
        select(
            Movement.product_id,
            func.coalesce(func.sum(Movement.qty), 0),
            func.coalesce(func.sum(Movement.qty * Batch.purchase_price_unit), 0),
        )
        .join(Batch, Movement.batch_id == Batch.id)
        .where(Movement.type == MovementType.staff_meal)
        .where(Movement.created_at >= start)
        .where(Movement.created_at < end)
        .group_by(Movement.product_id)
        .order_by(func.sum(Movement.qty * Batch.purchase_price_unit).desc())
    ).all()
    products_by_id = {
        p.id: p for p in session.scalars(
            select(Product).where(Product.id.in_([r[0] for r in prod_rows]))
        )
    } if prod_rows else {}
    by_product = []
    for pid, qty_tot, cost_tot in prod_rows:
        p = products_by_id.get(pid)
        if not p:
            continue
        by_product.append(StaffMealsByProduct(
            product={"id": p.id, "name": p.name, "category": p.category, "unit": p.unit},
            qty_total=_q(qty_tot),
            cost_total=_q(cost_tot),
        ))

    # By month
    month_rows = session.execute(
        select(
            func.to_char(Movement.created_at, "YYYY-MM").label("month"),
            func.coalesce(func.sum(Movement.qty * Batch.purchase_price_unit), 0),
            func.count(func.distinct(Movement.source_id)),
        )
        .join(Batch, Movement.batch_id == Batch.id)
        .where(Movement.type == MovementType.staff_meal)
        .where(Movement.created_at >= start)
        .where(Movement.created_at < end)
        .group_by("month")
        .order_by("month")
    ).all()
    by_month = [
        StaffMealsByMonth(month=str(m[0]), cost_total=_q(m[1]), meals_count=int(m[2] or 0))
        for m in month_rows
    ]

    return StaffMealsSummaryOut(
        total_cost=total_cost,
        meals_count=meals_count,
        breakdown_by_product=by_product,
        breakdown_by_month=by_month,
    )
