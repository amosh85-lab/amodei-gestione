"""/payments router — ADMIN ONLY.

Workflow:
- POST: admin selects a list of UNPAID invoices from the SAME supplier and
  registers a Payment that settles all of them. All-or-nothing transaction.
- GET list/detail: filter by date / method / supplier.
- DELETE: cancels the payment, the InvoicePayment rows are cascade-deleted,
  and the linked invoices go back to "unpaid".
- GET /summary/monthly: bonifico/check/cash totals + per-supplier breakdown.
"""
from __future__ import annotations

import logging
from collections import defaultdict
from datetime import date as date_type
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_session
from app.dependencies.auth import require_admin
from app.models.inventory import Supplier
from app.models.invoices import Invoice, InvoicePayment, Payment, PaymentMethod
from app.models.users import User
from app.schemas.invoices import InvoiceMini
from app.schemas.payments import (
    PaymentByMethod,
    PaymentBySupplierRow,
    PaymentCreate,
    PaymentMonthlySummary,
    PaymentOut,
)

router = APIRouter(prefix="/payments", tags=["payments"])
logger = logging.getLogger("amodei.payments")


def _hydrate(p: Payment, session: Session) -> PaymentOut:
    registered_by = session.get(User, p.registered_by_user_id)
    invoices = list(session.scalars(
        select(Invoice).join(InvoicePayment, Invoice.id == InvoicePayment.invoice_id)
        .where(InvoicePayment.payment_id == p.id)
        .order_by(Invoice.invoice_date.asc())
    ))
    supplier = session.get(Supplier, invoices[0].supplier_id) if invoices else None
    return PaymentOut(
        id=p.id,
        payment_date=p.payment_date,
        method=p.method.value if hasattr(p.method, "value") else p.method,
        amount_total=p.amount_total,
        check_number=p.check_number,
        notes=p.notes,
        registered_by=registered_by,
        created_at=p.created_at,
        supplier={"id": supplier.id, "name": supplier.name,
                  "category": supplier.category.value if hasattr(supplier.category, "value") else supplier.category}
                  if supplier else None,
        invoices=[InvoiceMini(id=i.id, invoice_number=i.invoice_number,
                               invoice_date=i.invoice_date, amount_total=i.amount_total)
                  for i in invoices],
    )


# ---------------------------------------------------------------------
# POST /payments


@router.post("", response_model=PaymentOut, status_code=status.HTTP_201_CREATED)
def create_payment(
    payload: PaymentCreate,
    session: Session = Depends(get_session),
    actor: User = Depends(require_admin),
) -> PaymentOut:
    invoices = list(session.scalars(
        select(Invoice).where(Invoice.id.in_(payload.invoice_ids))
    ))
    found = {inv.id for inv in invoices}
    missing = set(payload.invoice_ids) - found
    if missing:
        raise HTTPException(status.HTTP_404_NOT_FOUND,
                            f"Fatture non trovate: {sorted(missing)}")

    # All must belong to the same supplier.
    supplier_ids = {inv.supplier_id for inv in invoices}
    if len(supplier_ids) > 1:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "Le fatture devono essere dello stesso fornitore.")

    # None must already be paid.
    paid_check = list(session.scalars(
        select(InvoicePayment).where(InvoicePayment.invoice_id.in_(payload.invoice_ids))
    ))
    if paid_check:
        already = [str(ip.invoice_id) for ip in paid_check]
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            f"La fattura #{already[0]} è già pagata.")

    amount_total = sum((inv.amount_total for inv in invoices), Decimal("0"))

    payment = Payment(
        payment_date=payload.payment_date,
        method=PaymentMethod(payload.method),
        amount_total=amount_total,
        check_number=payload.check_number,
        notes=payload.notes,
        registered_by_user_id=actor.id,
    )
    session.add(payment)
    session.flush()  # need payment.id for the bridge rows
    for inv in invoices:
        session.add(InvoicePayment(invoice_id=inv.id, payment_id=payment.id))
    session.commit()
    session.refresh(payment)
    logger.info("Payment created: id=%d supplier=%d amount=%s method=%s invoices=%d by_admin=%d",
                payment.id, list(supplier_ids)[0], amount_total, payload.method,
                len(invoices), actor.id)
    return _hydrate(payment, session)


# ---------------------------------------------------------------------
# GET /payments


@router.get("", response_model=list[PaymentOut])
def list_payments(
    from_date: date_type | None = Query(None, alias="from_date"),
    to_date: date_type | None = Query(None, alias="to_date"),
    method: Literal["bank_transfer", "check", "cash"] | None = Query(None),
    supplier_id: int | None = Query(None),
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    session: Session = Depends(get_session),
    _actor: User = Depends(require_admin),
) -> list[PaymentOut]:
    stmt = select(Payment)
    if from_date is not None:
        stmt = stmt.where(Payment.payment_date >= from_date)
    if to_date is not None:
        stmt = stmt.where(Payment.payment_date <= to_date)
    if method is not None:
        stmt = stmt.where(Payment.method == method)
    if supplier_id is not None:
        # Join via invoice_payments → invoice → supplier_id
        stmt = stmt.where(Payment.id.in_(
            select(InvoicePayment.payment_id).join(Invoice, InvoicePayment.invoice_id == Invoice.id)
            .where(Invoice.supplier_id == supplier_id)
        ))
    stmt = stmt.order_by(Payment.payment_date.desc(), Payment.created_at.desc()).limit(limit).offset(offset)
    return [_hydrate(p, session) for p in session.scalars(stmt)]


# ---------------------------------------------------------------------
# GET /payments/summary/monthly (must be BEFORE /{id})


@router.get("/summary/monthly", response_model=PaymentMonthlySummary)
def monthly_summary(
    year: int | None = Query(None, ge=2024, le=2100),
    month: int | None = Query(None, ge=1, le=12),
    session: Session = Depends(get_session),
    _actor: User = Depends(require_admin),
) -> PaymentMonthlySummary:
    today = date_type.today()
    y = year or today.year
    m = month or today.month
    first = date_type(y, m, 1)
    if m == 12:
        next_first = date_type(y + 1, 1, 1)
    else:
        next_first = date_type(y, m + 1, 1)

    payments = list(session.scalars(
        select(Payment).where(Payment.payment_date >= first).where(Payment.payment_date < next_first)
    ))
    total = sum((p.amount_total for p in payments), Decimal("0"))
    by_method = PaymentByMethod()
    for p in payments:
        mname = p.method.value if hasattr(p.method, "value") else p.method
        setattr(by_method, mname, getattr(by_method, mname) + p.amount_total)

    # Group by supplier
    if payments:
        supplier_map = defaultdict(lambda: {"total": Decimal("0"), "count": 0, "supplier": None})
        # For each payment find supplier via first invoice (all share supplier)
        for p in payments:
            first_invoice = session.scalar(
                select(Invoice).join(InvoicePayment, Invoice.id == InvoicePayment.invoice_id)
                .where(InvoicePayment.payment_id == p.id).limit(1)
            )
            if first_invoice is None:
                continue
            s = session.get(Supplier, first_invoice.supplier_id)
            row = supplier_map[s.id]
            row["supplier"] = {"id": s.id, "name": s.name,
                               "category": s.category.value if hasattr(s.category, "value") else s.category}
            row["total"] += p.amount_total
            row["count"] += 1
        by_supplier = [
            PaymentBySupplierRow(supplier=row["supplier"], total=row["total"], count=row["count"])
            for row in sorted(supplier_map.values(), key=lambda r: r["total"], reverse=True)
        ]
    else:
        by_supplier = []

    return PaymentMonthlySummary(
        year=y, month=m, total_paid=total, count=len(payments),
        by_method=by_method, by_supplier=by_supplier,
    )


# ---------------------------------------------------------------------
# GET /payments/{id}


@router.get("/{payment_id}", response_model=PaymentOut)
def get_payment(
    payment_id: int,
    session: Session = Depends(get_session),
    _actor: User = Depends(require_admin),
) -> PaymentOut:
    p = session.get(Payment, payment_id)
    if p is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pagamento non trovato.")
    return _hydrate(p, session)


# ---------------------------------------------------------------------
# DELETE /payments/{id}


@router.delete("/{payment_id}")
def delete_payment(
    payment_id: int,
    session: Session = Depends(get_session),
    actor: User = Depends(require_admin),
) -> dict:
    p = session.get(Payment, payment_id)
    if p is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pagamento non trovato.")
    # The InvoicePayment rows are cascade-deleted by the FK; invoices stay
    # but the link disappears so they become "unpaid" again.
    session.delete(p)
    session.commit()
    logger.info("Payment deleted: id=%d by_admin=%d (invoices unpaid again)",
                payment_id, actor.id)
    return {"deleted_id": payment_id}
