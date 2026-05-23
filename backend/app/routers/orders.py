"""/supplier-orders router: convert alerts into orders, WhatsApp deep link."""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_session
from app.dependencies.auth import (
    require_admin,
    require_manager_or_admin,
)
from app.models.inventory import Product, Supplier
from app.models.reorder import (
    StockAlert,
    StockAlertStatus,
    SupplierOrder,
    SupplierOrderLine,
    SupplierOrderStatus,
)
from app.models.users import User
from app.schemas.orders import (
    SupplierOrderCreate,
    SupplierOrderLineIn,
    SupplierOrderLineOut,
    SupplierOrderOut,
    SupplierOrderPatch,
    _ProductMini,
    _SupplierMini,
)
from app.services.whatsapp import build_message, build_whatsapp_url

router = APIRouter(prefix="/supplier-orders", tags=["supplier-orders"])
logger = logging.getLogger("amodei.orders")


# ----------------------------------------------------------------------
# Hydration
# ----------------------------------------------------------------------


def _hydrate_orders(
    session: Session, orders: list[SupplierOrder]
) -> list[SupplierOrderOut]:
    if not orders:
        return []
    order_ids = [o.id for o in orders]

    lines_rows = session.execute(
        select(SupplierOrderLine, Product)
        .join(Product, Product.id == SupplierOrderLine.product_id)
        .where(SupplierOrderLine.order_id.in_(order_ids))
        .order_by(SupplierOrderLine.id.asc())
    ).all()
    lines_by_order: dict[int, list[tuple[SupplierOrderLine, Product]]] = {oid: [] for oid in order_ids}
    for line, product in lines_rows:
        lines_by_order[line.order_id].append((line, product))

    supplier_ids = list({o.supplier_id for o in orders})
    suppliers = {
        s.id: s for s in session.scalars(
            select(Supplier).where(Supplier.id.in_(supplier_ids))
        )
    }

    creator_ids = list({o.created_by_user_id for o in orders})
    creator_names = {
        uid: name for uid, name in session.execute(
            select(User.id, User.full_name).where(User.id.in_(creator_ids))
        )
    }

    out: list[SupplierOrderOut] = []
    for o in orders:
        sup = suppliers.get(o.supplier_id)
        line_outs: list[SupplierOrderLineOut] = []
        msg_lines = []
        for line, product in lines_by_order.get(o.id, []):
            line_out = SupplierOrderLineOut.model_validate(line)
            line_out.product = _ProductMini.model_validate(product)
            line_outs.append(line_out)
            msg_lines.append({
                "qty": line.qty,
                "unit": product.unit,
                "product_name": product.name,
            })

        item = SupplierOrderOut.model_validate(o)
        item.created_by_name = creator_names.get(o.created_by_user_id)
        item.supplier = _SupplierMini.model_validate(sup) if sup is not None else None
        item.lines = line_outs

        if sup is not None and msg_lines:
            preview = build_message(
                sup.name,
                msg_lines,
                custom_template=sup.message_template,
            )
            item.whatsapp_message_preview = preview
            # Prefer .whatsapp (E.164), fall back to .phone.
            item.whatsapp_url = build_whatsapp_url(sup.whatsapp or sup.phone, preview)

        out.append(item)
    return out


# ----------------------------------------------------------------------
# Validation helpers
# ----------------------------------------------------------------------


def _validate_lines(
    session: Session, supplier_id: int, lines: list[SupplierOrderLineIn]
) -> tuple[dict[int, Product], dict[int, StockAlert]]:
    """Return (products_by_id, alerts_by_id) if valid, otherwise raise 400."""
    product_ids = [li.product_id for li in lines]
    products = {
        p.id: p for p in session.scalars(
            select(Product).where(Product.id.in_(product_ids))
        )
    }
    missing = [pid for pid in product_ids if pid not in products]
    if missing:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Prodotti non trovati: {missing}")
    inactive = [pid for pid, p in products.items() if not p.active]
    if inactive:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Prodotti disattivati: {inactive}")

    alert_ids = [li.alert_id for li in lines if li.alert_id is not None]
    alerts: dict[int, StockAlert] = {}
    if alert_ids:
        alerts = {
            a.id: a for a in session.scalars(
                select(StockAlert).where(StockAlert.id.in_(alert_ids))
            )
        }
        missing_alerts = [aid for aid in alert_ids if aid not in alerts]
        if missing_alerts:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Alert non trovati: {missing_alerts}")
        # Check open + product match
        for li in lines:
            if li.alert_id is None:
                continue
            a = alerts[li.alert_id]
            if a.status != StockAlertStatus.open:
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST,
                    f"Alert {a.id} non è in stato 'open' (è {a.status.value}). Rimuovilo dalla riga.",
                )
            if a.product_id != li.product_id:
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST,
                    f"Alert {a.id} riferisce product_id={a.product_id}, ma la riga è per {li.product_id}.",
                )
    return products, alerts


# ----------------------------------------------------------------------
# POST /supplier-orders — create draft
# ----------------------------------------------------------------------
@router.post("", response_model=SupplierOrderOut, status_code=status.HTTP_201_CREATED)
def create_order(
    payload: SupplierOrderCreate,
    session: Session = Depends(get_session),
    user: User = Depends(require_manager_or_admin),
) -> SupplierOrderOut:
    supplier = session.get(Supplier, payload.supplier_id)
    if supplier is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Fornitore non trovato.")
    if not supplier.active:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Fornitore disattivato.")

    _, alerts = _validate_lines(session, payload.supplier_id, payload.lines)

    order = SupplierOrder(
        supplier_id=payload.supplier_id,
        status=SupplierOrderStatus.draft,
        created_by_user_id=user.id,
        notes=payload.notes,
    )
    session.add(order)
    session.flush()  # need order.id for the lines FK
    for li in payload.lines:
        session.add(SupplierOrderLine(
            order_id=order.id,
            product_id=li.product_id,
            qty=li.qty,
            unit_price=li.unit_price,
            alert_id=li.alert_id,
        ))
    # Move every linked alert to "included_in_order".
    for alert_id, alert in alerts.items():
        alert.status = StockAlertStatus.included_in_order

    session.commit()
    session.refresh(order)
    logger.info(
        "SupplierOrder creato id=%d supplier_id=%d lines=%d alerts_linked=%d by user_id=%d",
        order.id, order.supplier_id, len(payload.lines), len(alerts), user.id,
    )
    return _hydrate_orders(session, [order])[0]


# ----------------------------------------------------------------------
# GET /supplier-orders — list
# ----------------------------------------------------------------------
@router.get("", response_model=list[SupplierOrderOut])
def list_orders(
    status: Literal["draft", "sent", "received", "cancelled"] | None = Query(None),
    supplier_id: int | None = Query(None),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    session: Session = Depends(get_session),
    _user: User = Depends(require_manager_or_admin),
) -> list[SupplierOrderOut]:
    stmt = select(SupplierOrder)
    if status is not None:
        stmt = stmt.where(SupplierOrder.status == SupplierOrderStatus(status))
    if supplier_id is not None:
        stmt = stmt.where(SupplierOrder.supplier_id == supplier_id)
    stmt = stmt.order_by(SupplierOrder.created_at.desc()).limit(limit).offset(offset)
    orders = list(session.scalars(stmt))
    return _hydrate_orders(session, orders)


# ----------------------------------------------------------------------
# GET /supplier-orders/{id} — detail
# ----------------------------------------------------------------------
@router.get("/{order_id}", response_model=SupplierOrderOut)
def get_order(
    order_id: int,
    session: Session = Depends(get_session),
    _user: User = Depends(require_manager_or_admin),
) -> SupplierOrderOut:
    order = session.get(SupplierOrder, order_id)
    if order is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ordine non trovato.")
    return _hydrate_orders(session, [order])[0]


# ----------------------------------------------------------------------
# PATCH /supplier-orders/{id} — edit while draft
# ----------------------------------------------------------------------
@router.patch("/{order_id}", response_model=SupplierOrderOut)
def update_order(
    order_id: int,
    payload: SupplierOrderPatch,
    session: Session = Depends(get_session),
    user: User = Depends(require_manager_or_admin),
) -> SupplierOrderOut:
    order = session.get(SupplierOrder, order_id)
    if order is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ordine non trovato.")
    if order.status != SupplierOrderStatus.draft:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"L'ordine è in stato '{order.status.value}': non è più modificabile.",
        )

    changes = payload.model_dump(exclude_unset=True)
    if "notes" in changes:
        order.notes = changes["notes"]

    if "lines" in changes and changes["lines"] is not None:
        new_lines = [SupplierOrderLineIn(**c) for c in changes["lines"]]
        _, new_alerts = _validate_lines(session, order.supplier_id, new_lines)

        # Release alerts that were previously linked but are no longer in the new list
        old_alert_ids = {
            line.alert_id for line in session.scalars(
                select(SupplierOrderLine).where(SupplierOrderLine.order_id == order.id)
            ) if line.alert_id is not None
        }
        new_alert_ids = {li.alert_id for li in new_lines if li.alert_id is not None}
        released = old_alert_ids - new_alert_ids
        if released:
            for a in session.scalars(
                select(StockAlert).where(StockAlert.id.in_(list(released)))
            ):
                if a.status == StockAlertStatus.included_in_order:
                    a.status = StockAlertStatus.open

        # Replace lines (CASCADE-safe)
        session.execute(
            SupplierOrderLine.__table__.delete().where(SupplierOrderLine.order_id == order.id)
        )
        for li in new_lines:
            session.add(SupplierOrderLine(
                order_id=order.id,
                product_id=li.product_id,
                qty=li.qty,
                unit_price=li.unit_price,
                alert_id=li.alert_id,
            ))
        # Mark newly-linked alerts as included_in_order
        for a in new_alerts.values():
            if a.status == StockAlertStatus.open:
                a.status = StockAlertStatus.included_in_order

    session.commit()
    session.refresh(order)
    logger.info("SupplierOrder %d aggiornato (status=%s) by user_id=%d",
                order.id, order.status.value, user.id)
    return _hydrate_orders(session, [order])[0]


# ----------------------------------------------------------------------
# POST /{id}/mark-sent — snapshot + flip status
# ----------------------------------------------------------------------
@router.post("/{order_id}/mark-sent", response_model=SupplierOrderOut)
def mark_sent(
    order_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(require_manager_or_admin),
) -> SupplierOrderOut:
    order = session.get(SupplierOrder, order_id)
    if order is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ordine non trovato.")
    if order.status != SupplierOrderStatus.draft:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Solo ordini in 'draft' possono essere marcati come inviati (questo è '{order.status.value}').",
        )

    # Compute the snapshot from CURRENT state
    out = _hydrate_orders(session, [order])[0]
    snapshot = out.whatsapp_message_preview or ""
    order.status = SupplierOrderStatus.sent
    order.sent_at = datetime.now(timezone.utc)
    order.whatsapp_message_generated = snapshot
    session.commit()
    session.refresh(order)
    logger.info("SupplierOrder %d marcato 'sent' by user_id=%d", order.id, user.id)
    return _hydrate_orders(session, [order])[0]


# ----------------------------------------------------------------------
# POST /{id}/mark-received — flip status + timestamp
# ----------------------------------------------------------------------
@router.post("/{order_id}/mark-received", response_model=SupplierOrderOut)
def mark_received(
    order_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(require_manager_or_admin),
) -> SupplierOrderOut:
    order = session.get(SupplierOrder, order_id)
    if order is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ordine non trovato.")
    if order.status != SupplierOrderStatus.sent:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Solo ordini in 'sent' possono essere marcati come ricevuti (questo è '{order.status.value}').",
        )
    order.status = SupplierOrderStatus.received
    order.received_at = datetime.now(timezone.utc)
    session.commit()
    session.refresh(order)
    logger.info("SupplierOrder %d marcato 'received' by user_id=%d", order.id, user.id)
    return _hydrate_orders(session, [order])[0]


# ----------------------------------------------------------------------
# POST /{id}/cancel — flip status + release linked alerts
# ----------------------------------------------------------------------
@router.post("/{order_id}/cancel", response_model=SupplierOrderOut)
def cancel_order(
    order_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(require_manager_or_admin),
) -> SupplierOrderOut:
    order = session.get(SupplierOrder, order_id)
    if order is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ordine non trovato.")
    if order.status == SupplierOrderStatus.cancelled:
        return _hydrate_orders(session, [order])[0]  # idempotent
    if order.status == SupplierOrderStatus.received:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Un ordine già ricevuto non può essere annullato (la merce è entrata).",
        )

    # Release alerts (open again)
    alert_ids = [
        line.alert_id for line in session.scalars(
            select(SupplierOrderLine).where(SupplierOrderLine.order_id == order.id)
        ) if line.alert_id is not None
    ]
    if alert_ids:
        for a in session.scalars(
            select(StockAlert).where(StockAlert.id.in_(alert_ids))
        ):
            if a.status == StockAlertStatus.included_in_order:
                a.status = StockAlertStatus.open

    order.status = SupplierOrderStatus.cancelled
    session.commit()
    session.refresh(order)
    logger.info(
        "SupplierOrder %d cancellato by user_id=%d (released %d alerts)",
        order.id, user.id, len(alert_ids),
    )
    return _hydrate_orders(session, [order])[0]


# ----------------------------------------------------------------------
# DELETE /{id} — admin only, draft only
# ----------------------------------------------------------------------
@router.delete(
    "/{order_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
)
def delete_order(
    order_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(require_admin),
) -> None:
    order = session.get(SupplierOrder, order_id)
    if order is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ordine non trovato.")
    if order.status != SupplierOrderStatus.draft:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Solo ordini in 'draft' possono essere eliminati (questo è '{order.status.value}'). Usa /cancel.",
        )
    # Release linked alerts on hard delete too.
    alert_ids = [
        line.alert_id for line in session.scalars(
            select(SupplierOrderLine).where(SupplierOrderLine.order_id == order.id)
        ) if line.alert_id is not None
    ]
    if alert_ids:
        for a in session.scalars(
            select(StockAlert).where(StockAlert.id.in_(alert_ids))
        ):
            if a.status == StockAlertStatus.included_in_order:
                a.status = StockAlertStatus.open
    session.delete(order)  # CASCADE removes lines
    session.commit()
    logger.info("SupplierOrder %d eliminato by user_id=%d", order_id, user.id)
