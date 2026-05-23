"""Stock alerts: staff signals low/out-of-stock products, manager triages."""
from __future__ import annotations

import logging
from collections import defaultdict
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_session
from app.dependencies.auth import (
    get_current_user,
    require_manager_or_admin,
)
from app.models.inventory import Batch, Product, Supplier
from app.models.reorder import (
    StockAlert,
    StockAlertSource,
    StockAlertStatus,
    StockSignaledStatus,
)
from app.models.users import User
from app.schemas.alerts import (
    AlertsGroup,
    StockAlertCreate,
    StockAlertOut,
    StockAlertPatch,
    _ProductMini,
    _SupplierMini,
)

router = APIRouter(prefix="/alerts", tags=["alerts"])
logger = logging.getLogger("amodei.alerts")


# ----------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------


def _qty_totals(session: Session, product_ids: list[int]) -> dict[int, Decimal]:
    if not product_ids:
        return {}
    rows = session.execute(
        select(Batch.product_id, func.coalesce(func.sum(Batch.current_qty), 0))
        .where(Batch.product_id.in_(product_ids))
        .group_by(Batch.product_id)
    ).all()
    return {pid: Decimal(total or 0) for pid, total in rows}


def _hydrate_alerts(session: Session, alerts: list[StockAlert]) -> list[StockAlertOut]:
    """Bulk-load nested product + supplier + reporter name in one round-trip."""
    if not alerts:
        return []
    product_ids = list({a.product_id for a in alerts})
    user_ids = list({a.signaled_by_user_id for a in alerts})

    products: dict[int, Product] = {
        p.id: p for p in session.scalars(
            select(Product).where(Product.id.in_(product_ids))
        )
    }
    supplier_ids = {p.preferred_supplier_id for p in products.values() if p.preferred_supplier_id}
    suppliers: dict[int, Supplier] = {}
    if supplier_ids:
        suppliers = {
            s.id: s for s in session.scalars(
                select(Supplier).where(Supplier.id.in_(list(supplier_ids)))
            )
        }
    qty_map = _qty_totals(session, product_ids)
    user_names: dict[int, str] = {
        uid: name for uid, name in session.execute(
            select(User.id, User.full_name).where(User.id.in_(user_ids))
        )
    }

    out: list[StockAlertOut] = []
    for a in alerts:
        item = StockAlertOut.model_validate(a)
        item.signaled_by_name = user_names.get(a.signaled_by_user_id)
        p = products.get(a.product_id)
        if p is not None:
            prod = _ProductMini.model_validate(p)
            prod.qty_total = qty_map.get(p.id, Decimal("0"))
            item.product = prod
            if p.preferred_supplier_id and p.preferred_supplier_id in suppliers:
                item.supplier = _SupplierMini.model_validate(suppliers[p.preferred_supplier_id])
        out.append(item)
    return out


# Severity rank for status_signaled: out is more severe than low.
_SEVERITY = {StockSignaledStatus.low: 1, StockSignaledStatus.out: 2}


# ----------------------------------------------------------------------
# POST /alerts — staff signal
# ----------------------------------------------------------------------
@router.post("", response_model=StockAlertOut, status_code=status.HTTP_201_CREATED)
def create_alert(
    payload: StockAlertCreate,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
) -> StockAlertOut:
    product = session.get(Product, payload.product_id)
    if product is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Prodotto non trovato.")
    if not product.active:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Prodotto disattivato.")

    new_signal = StockSignaledStatus(payload.status_signaled)

    # Idempotent: look for any open alert on this product.
    existing = session.scalar(
        select(StockAlert).where(
            StockAlert.product_id == payload.product_id,
            StockAlert.status == StockAlertStatus.open,
        )
    )
    if existing is not None:
        # Escalate severity only — never demote.
        if _SEVERITY[new_signal] > _SEVERITY[existing.status_signaled]:
            existing.status_signaled = new_signal
        if payload.suggested_qty is not None:
            existing.suggested_qty = payload.suggested_qty
        if payload.notes is not None:
            existing.notes = payload.notes
        session.commit()
        session.refresh(existing)
        logger.info(
            "StockAlert updated id=%d product_id=%d signaled=%s by user_id=%d (was already open)",
            existing.id, existing.product_id, existing.status_signaled.value, user.id,
        )
        return _hydrate_alerts(session, [existing])[0]

    alert = StockAlert(
        product_id=payload.product_id,
        status_signaled=new_signal,
        suggested_qty=payload.suggested_qty,
        notes=payload.notes,
        signaled_by_user_id=user.id,
        status=StockAlertStatus.open,
        source=StockAlertSource.staff,
    )
    session.add(alert)
    session.commit()
    session.refresh(alert)
    logger.info(
        "StockAlert creato id=%d product_id=%d signaled=%s by user_id=%d",
        alert.id, alert.product_id, alert.status_signaled.value, user.id,
    )
    return _hydrate_alerts(session, [alert])[0]


# ----------------------------------------------------------------------
# GET /alerts/open — grouped by supplier (manager/admin)
# ----------------------------------------------------------------------
@router.get("/open", response_model=list[AlertsGroup])
def list_open_grouped(
    session: Session = Depends(get_session),
    _user: User = Depends(require_manager_or_admin),
) -> list[AlertsGroup]:
    alerts = list(session.scalars(
        select(StockAlert)
        .where(StockAlert.status == StockAlertStatus.open)
        .order_by(StockAlert.status_signaled.desc(), StockAlert.created_at.asc())
    ))
    hydrated = _hydrate_alerts(session, alerts)

    groups: dict[int | None, list[StockAlertOut]] = defaultdict(list)
    suppliers_map: dict[int, _SupplierMini] = {}
    for a in hydrated:
        key = a.supplier.id if a.supplier else None
        groups[key].append(a)
        if a.supplier and a.supplier.id not in suppliers_map:
            suppliers_map[a.supplier.id] = a.supplier

    out: list[AlertsGroup] = []
    # Suppliers first, sorted by name; "Senza fornitore" bucket last if non-empty.
    for sid in sorted(suppliers_map.keys(), key=lambda s: suppliers_map[s].name.lower()):
        out.append(AlertsGroup(supplier=suppliers_map[sid], alerts=groups[sid]))
    if None in groups:
        out.append(AlertsGroup(supplier=None, alerts=groups[None]))
    return out


# ----------------------------------------------------------------------
# GET /alerts — flat list with filters (manager/admin)
# ----------------------------------------------------------------------
@router.get("", response_model=list[StockAlertOut])
def list_alerts(
    status: Literal["open", "included_in_order", "ignored"] | None = Query(None),
    supplier_id: int | None = Query(None),
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    session: Session = Depends(get_session),
    _user: User = Depends(require_manager_or_admin),
) -> list[StockAlertOut]:
    stmt = select(StockAlert)
    if status is not None:
        stmt = stmt.where(StockAlert.status == StockAlertStatus(status))
    if supplier_id is not None:
        # join through Product.preferred_supplier_id
        stmt = stmt.join(Product, Product.id == StockAlert.product_id).where(
            Product.preferred_supplier_id == supplier_id
        )
    stmt = (
        stmt.order_by(StockAlert.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    alerts = list(session.scalars(stmt))
    return _hydrate_alerts(session, alerts)


# ----------------------------------------------------------------------
# PATCH /alerts/{id} — manager/admin
# ----------------------------------------------------------------------
@router.patch("/{alert_id}", response_model=StockAlertOut)
def update_alert(
    alert_id: int,
    payload: StockAlertPatch,
    session: Session = Depends(get_session),
    user: User = Depends(require_manager_or_admin),
) -> StockAlertOut:
    alert = session.get(StockAlert, alert_id)
    if alert is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Segnalazione non trovata.")
    changes = payload.model_dump(exclude_unset=True)
    if "status" in changes:
        alert.status = StockAlertStatus(changes.pop("status"))
    if "status_signaled" in changes:
        alert.status_signaled = StockSignaledStatus(changes.pop("status_signaled"))
    for k, v in changes.items():
        setattr(alert, k, v)
    session.commit()
    session.refresh(alert)
    logger.info(
        "StockAlert aggiornato id=%d by user_id=%d fields=%s",
        alert.id, user.id, list(payload.model_dump(exclude_unset=True).keys()),
    )
    return _hydrate_alerts(session, [alert])[0]


# ----------------------------------------------------------------------
# POST /alerts/{id}/ignore — shortcut to close as ignored
# ----------------------------------------------------------------------
@router.post("/{alert_id}/ignore", response_model=StockAlertOut)
def ignore_alert(
    alert_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(require_manager_or_admin),
) -> StockAlertOut:
    alert = session.get(StockAlert, alert_id)
    if alert is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Segnalazione non trovata.")
    if alert.status == StockAlertStatus.ignored:
        # Idempotent
        return _hydrate_alerts(session, [alert])[0]
    alert.status = StockAlertStatus.ignored
    session.commit()
    session.refresh(alert)
    logger.info("StockAlert ignored id=%d by user_id=%d", alert.id, user.id)
    return _hydrate_alerts(session, [alert])[0]
